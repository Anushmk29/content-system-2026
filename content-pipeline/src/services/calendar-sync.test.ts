import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../db/test-db.ts';
import { createContentItems } from '../db/content-items.ts';
import type { ModuleContext } from '../modules/module.ts';
import { planItem } from './board-service.ts';
import { bookItem, syncPlanned, setItemChannels } from './calendar-sync-service.ts';
import { createPostiz } from '../adapters/postiz.ts';

const db = await createTestDb();
const items = createContentItems(db);
const DAY = 86_400_000;

/** A fake Postiz: records calls; `fail` makes the next schedule or delete throw. */
function fakePostiz(prefix = "pz") {
  const calls: string[] = [];
  let n = 0;
  const p = {
    configured: true, fail: '' as '' | 'schedule' | 'remove',
    async schedule(i: { scheduledAt: string }) { if (p.fail === 'schedule') throw new Error('Postiz 500'); calls.push(`schedule ${i.scheduledAt}`); return { postizId: `${prefix}${++n}` }; },
    async remove(id: string) { if (p.fail === 'remove') throw new Error('Postiz 404'); calls.push(`remove ${id}`); },
  };
  return { p, calls };
}
const ctxWith = (sync: boolean, postiz: unknown) =>
  ({ db, env: { postizSync: sync, defaultUtmCampaign: 'c' }, logger: { warn() {}, info() {} }, adapters: { postiz } } as unknown as ModuleContext);

async function approved(claim?: string): Promise<string> {
  const topic = (await db.query<{ id: string }>(`insert into content.topics (title, status) values ('t', 'selected') returning id`)).rows[0]!.id;
  const [id] = await items.createDraftSet(topic, [{ title: 'Post', pillar: 'founder_build_notes', funnelStage: 'trust', platform: 'linkedin', format: 'founder_post', body: 'b' }], claim ? [claim] : []);
  await items.transition(id!, { event: 'submit', lane: 'review' });
  await items.transition(id!, { event: 'approve' });
  return id!;
}
const row = async (id: string) =>
  (await db.query<{ status: string; postiz_id: string | null; scheduled_at: Date | null }>(`select status, postiz_id, scheduled_at from content.content_items where id = $1`, [id])).rows[0]!;

test('sync off: planning only stores the time (the publish run books it later)', async () => {
  const { p, calls } = fakePostiz();
  const id = await approved();
  const r = await planItem(ctxWith(false, p), id, new Date(Date.now() + DAY).toISOString());
  assert.ok(r.ok && /Planned for/.test(r.message));
  assert.equal(calls.length, 0);
  assert.equal((await row(id)).status, 'approved');
});

test('sync on: plan → booked in Postiz now; move → deleted there and re-booked; unproven claims wait', async () => {
  const { p, calls } = fakePostiz();
  const ctx = ctxWith(true, p);
  const id = await approved();
  const first = new Date(Date.now() + DAY);
  assert.ok((await planItem(ctx, id, first.toISOString())).ok);
  assert.deepEqual(await row(id), { status: 'queued', postiz_id: 'pz1', scheduled_at: first });

  const later = new Date(Date.now() + 3 * DAY);
  const moved = await planItem(ctx, id, later.toISOString());
  assert.ok(moved.ok && /Moved in Postiz/.test(moved.message), moved.message);
  assert.deepEqual(calls, [`schedule ${first.toISOString()}`, 'remove pz1', `schedule ${later.toISOString()}`]);
  assert.deepEqual(await row(id), { status: 'queued', postiz_id: 'pz2', scheduled_at: later });

  const gated = await approved('40% faster');
  assert.ok((await planItem(ctx, gated, first.toISOString())).ok);
  assert.equal((await row(gated)).status, 'approved', 'honest-numbers: not sent until proof is attached');
});

test('sync on, Postiz fails: nothing is lost', async () => {
  const { p } = fakePostiz();
  const ctx = ctxWith(true, p);
  const id = await approved();
  p.fail = 'schedule';
  const r = await planItem(ctx, id, new Date(Date.now() + DAY).toISOString());
  assert.ok(r.ok && /next publish run retries/.test(r.message), r.message);
  assert.equal((await row(id)).status, 'approved');

  p.fail = '';
  await planItem(ctx, id, new Date(Date.now() + DAY).toISOString());
  p.fail = 'remove';
  const keep = await planItem(ctx, id, new Date(Date.now() + 2 * DAY).toISOString());
  assert.equal(keep.ok, false);
  assert.match(keep.message, /kept the old time/);
  assert.equal((await row(id)).status, 'queued');
});

test('Postiz remove: DELETE /public/v1/posts/:id with the key', async () => {
  const real = globalThis.fetch;
  let seen = '';
  globalThis.fetch = (async (url: string, init: RequestInit) => { seen = `${init.method} ${url} ${(init.headers as Record<string, string>).authorization}`; return new Response('', { status: 200 }); }) as typeof fetch;
  try {
    await createPostiz('https://postiz.example.com/api/', 'key1').remove('abc');
    assert.equal(seen, 'DELETE https://postiz.example.com/api/public/v1/posts/abc key1');
  } finally {
    globalThis.fetch = real;
  }
});

test('bookItem: two bookings at once reach Postiz once; a pulled item is never booked', async () => {
  const { p, calls } = fakePostiz('book');
  const ctx = ctxWith(false, p);
  const id = await approved();
  const at = new Date(Date.now() + DAY);
  const [a, b] = await Promise.all([bookItem(ctx, id, at), bookItem(ctx, id, at)]);
  assert.equal([a, b].filter(Boolean).length, 1);
  assert.equal(calls.length, 1);
  assert.equal((await row(id)).status, 'queued');

  const pulled = await approved();
  await db.query(`update content.content_items set status = 'draft' where id = $1`, [pulled]);
  assert.equal(await bookItem(ctx, pulled, at), null);
  assert.equal(calls.length, 1);
});

test('overlapping moves remove each previous booking and leave one remote post', async () => {
  const { p } = fakePostiz('moves');
  const active = new Set<string>();
  const schedule = p.schedule, remove = p.remove;
  p.schedule = async (input) => { const booked = await schedule(input); active.add(booked.postizId); return booked; };
  p.remove = async (id) => { await remove(id); active.delete(id); };
  const ctx = ctxWith(true, p);
  const id = await approved();
  await bookItem(ctx, id, new Date(Date.now() + DAY));
  const result = await Promise.all([
    syncPlanned(ctx, id, new Date(Date.now() + 2 * DAY)), syncPlanned(ctx, id, new Date(Date.now() + 3 * DAY)),
  ]);
  assert.ok(result.every((r) => r?.ok));
  assert.deepEqual([...active], [(await row(id)).postiz_id]);
});

test('channel selection saves only after Postiz accepts it, even with calendar auto-sync off', async () => {
  const { p } = fakePostiz('channels');
  const sent: Array<string[] | null | undefined> = [];
  const postiz = { ...p, schedule: async (input: { scheduledAt: string; channelIds?: string[] | null }) => {
    sent.push(input.channelIds); return p.schedule(input);
  }, remove: (id: string) => p.remove(id) };
  const ctx = ctxWith(false, postiz);
  const id = await approved();
  await setItemChannels(ctx, id, ['old']);
  await bookItem(ctx, id, new Date(Date.now() + DAY));
  p.fail = 'remove';
  assert.equal((await setItemChannels(ctx, id, ['new'])).ok, false);
  assert.deepEqual((await db.query<{ channels: string[] }>('select channels from content.content_items where id = $1', [id])).rows[0]!.channels, ['old']);
  p.fail = '';
  assert.equal((await setItemChannels(ctx, id, ['new'])).ok, true);
  assert.deepEqual(sent, [['old'], ['new']]);
  assert.deepEqual((await db.query<{ channels: string[] }>('select channels from content.content_items where id = $1', [id])).rows[0]!.channels, ['new']);
});

test('failed replacement save removes the new remote post before allowing publisher retry', async () => {
  const { p, calls } = fakePostiz('rollback');
  const ctx = ctxWith(true, p);
  const id = await approved();
  await bookItem(ctx, id, new Date(Date.now() + DAY));
  let failSave = true;
  const failing: ModuleContext = { ...ctx, db: { ...db, tx: (fn) => db.tx((q) => fn({ ...q, query: async (sql, args) => {
    if (failSave && sql.startsWith('update content.content_items set postiz_id =')) {
      failSave = false;
      throw new Error('save failed');
    }
    return q.query(sql, args);
  } })) } };
  const result = await syncPlanned(failing, id, new Date(Date.now() + 2 * DAY));
  assert.equal(result?.ok, false);
  assert.deepEqual(calls.filter((c) => c.startsWith('remove')), ['remove rollback1', 'remove rollback2']);
  assert.equal((await row(id)).status, 'approved');
  assert.equal((await row(id)).postiz_id, null);
});
