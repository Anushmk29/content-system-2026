import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../db/test-db.ts';
import { createRepo, type NewContentItem } from '../db/repo.ts';
import { createContentItems } from '../db/content-items.ts';
import type { ModuleContext } from '../modules/module.ts';
import type { SystemHealth } from './health-service.ts';
import { getIdeaBoard, editItemCopy, planItem, getItemDetail } from './board-service.ts';
import { getToday, weekStart, runwayDays } from './today-service.ts';
import { recordMetrics, getAnalytics } from './analytics-service.ts';

const db = await createTestDb();
const repo = createRepo(db);
const items = createContentItems(db);
const ctx = { db } as unknown as ModuleContext;
const health: SystemHealth = {
  overall: 'ok', checkedAt: new Date().toISOString(), adapters: [],
  database: { id: 'database', state: 'ok', message: '', checkedAt: '' }, modules: [],
};

const piece = (platform: string, format: string): NewContentItem =>
  ({ title: `idea-${platform}`, pillar: 'proof_and_use_cases', funnelStage: 'trust', platform, format, body: 'b' });

async function draftSet(claims: string[] = []): Promise<string[]> {
  const t = await db.query<{ id: string }>(`insert into content.topics (title, status) values ('t', 'selected') returning id`);
  return items.createDraftSet(t.rows[0]!.id, [piece('blog', 'article'), piece('linkedin', 'founder_post'), piece('x', 'thread')], claims);
}

test('board: one card per idea, sitting at its least-advanced piece', async () => {
  const [anchor, li, x] = await draftSet();
  await items.transition(li!, { event: 'auto_approve' });
  await items.transition(x!, { event: 'reject' });
  const board = await getIdeaBoard(ctx);
  const card = board.ideas.find((i) => i.id === anchor)!;
  assert.equal(card.pieces.length, 3);
  assert.equal(card.stage, 'draft', 'blog still draft; archived x ignored');
  assert.ok(board.columns.find((c) => c.status === 'draft')!.ideas.includes(card));
  const detail = await getItemDetail(ctx, li!);
  assert.equal(detail!.pieces.length, 3);
  assert.equal(detail!.approvals[0]!.decision, 'not_required');
});

test('copy edits allowed before approval, refused after', async () => {
  const [a, b] = await draftSet();
  assert.equal((await editItemCopy(ctx, a!, { body: 'new body' })).ok, true);
  assert.equal((await repo.getItem(a!))!.body, 'new body');
  await items.transition(b!, { event: 'auto_approve' });
  assert.equal((await editItemCopy(ctx, b!, { body: 'sneaky' })).ok, false);
  assert.equal((await editItemCopy(ctx, a!, { body: 42 })).ok, false, 'non-text refused');
});

test('planning a time: only approved + not yet in Postiz, only in the future', async () => {
  const [a, b] = await draftSet();
  const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
  assert.equal((await planItem(ctx, a!, future)).ok, false, 'draft refused');
  await items.transition(b!, { event: 'auto_approve' });
  assert.equal((await planItem(ctx, b!, new Date(Date.now() - 1000).toISOString())).ok, false, 'past refused');
  assert.equal((await planItem(ctx, b!, future)).ok, true);
  await items.transition(b!, { event: 'schedule', postizId: 'p', utmUrl: 'u', scheduledAt: future });
  assert.equal((await planItem(ctx, b!, future)).ok, false, 'already in Postiz');
});

test('today: unproven claim on an approved item is blocked; mix counts ideas not copies', async () => {
  const ids = await draftSet(['saved 10 hours a week']);
  for (const id of ids) await items.transition(id, { event: 'auto_approve' });
  const today = await getToday(ctx, health);
  const blocked = today.actions.filter((a) => a.kind === 'blocked' && ids.includes(a.itemId!));
  assert.equal(blocked.length, 3);
  assert.match(blocked[0]!.detail, /no proof/);
  const proof = today.mix.find((m) => m.pillar === 'proof_and_use_cases')!;
  const anchors = await db.query<{ n: number }>(
    `select count(distinct coalesce(anchor_id, id))::int as n from content.content_items where status in ('approved','queued','published','performance_captured')`);
  assert.equal(proof.count, anchors.rows[0]!.n, 'one per anchor');
  assert.equal(today.funnel.reduce((s, f) => s + f.count, 0), (await getIdeaBoard(ctx)).ideas.length);
});

test('week starts Monday UTC; runway is days of content at target pace', () => {
  assert.equal(weekStart(new Date('2026-10-01T10:00Z')).toISOString(), '2026-09-28T00:00:00.000Z'); // Thu
  assert.equal(weekStart(new Date('2026-09-28T00:30Z')).toISOString(), '2026-09-28T00:00:00.000Z'); // Mon
  assert.equal(weekStart(new Date('2026-10-04T23:00Z')).toISOString(), '2026-09-28T00:00:00.000Z'); // Sun
  assert.equal(runwayDays(5, 5), 7);
  assert.equal(runwayDays(0, 5), 0);
});

test('metrics: only for live items, whole numbers; analytics picks them up', async () => {
  const [a] = await draftSet();
  assert.equal((await recordMetrics(ctx, a!, { reach: 10 })).ok, false, 'draft refused');
  await items.transition(a!, { event: 'auto_approve' });
  await items.transition(a!, { event: 'schedule', postizId: 'p', utmUrl: 'u', scheduledAt: new Date(Date.now() - 60_000).toISOString() });
  await items.goLiveDue();
  assert.equal((await recordMetrics(ctx, a!, { reach: -1 })).ok, false);
  assert.equal((await recordMetrics(ctx, a!, {})).ok, false);
  assert.equal((await recordMetrics(ctx, a!, { reach: '1200', likes: 30, comments: 4, qualifiedEngagement: 7 })).ok, true);
  const an = await getAnalytics(ctx, 30);
  assert.equal(an.series.length, 30);
  assert.ok(an.posts.some((p) => p.id === a));
  assert.ok(an.totals.reach >= 1200);
  assert.equal(an.bestByEngagement[0]!.id, a);
  assert.equal(an.posts.find((p) => p.id === a)!.engagement, 34, 'likes + comments + shares');
  assert.equal(an.bestByUsual.length, 0, 'no "x your usual" before own results exist');
});

test('activity merges approvals and runs newest first', async () => {
  await repo.recordRun({ moduleId: 'research', status: 'ok', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 1, itemsProcessed: 0, message: 'm' });
  const feed = await repo.activity(50);
  assert.deepEqual(new Set(feed.map((f) => f.kind)), new Set(['approval', 'run']));
  assert.ok(feed.every((f, i) => i === 0 || feed[i - 1]!.at >= f.at));
});
