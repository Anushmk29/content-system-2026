import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './test-db.ts';
import { createContentItems, IllegalTransition } from './content-items.ts';
import type { NewContentItem } from './repo.ts';

const db = await createTestDb();
const items = createContentItems(db);

const piece = (platform: string, format: string): NewContentItem =>
  ({ title: `t-${platform}`, pillar: 'founder_build_notes', funnelStage: 'trust', platform, format, body: 'b' });

async function selectedTopic(): Promise<string> {
  return (await db.query<{ id: string }>(`insert into content.topics (title, status) values ('x', 'selected') returning id`)).rows[0]!.id;
}
const row = async (id: string) =>
  (await db.query<{ status: string; approval_status: string; approval_lane: string | null }>(
    `select status, approval_status, approval_lane from content.content_items where id = $1`, [id])).rows[0]!;
const approvals = async (id: string) =>
  (await db.query<{ decision: string; decided_by: string | null }>(
    `select decision, decided_by from content.approvals where content_item_id = $1 order by created_at`, [id])).rows;

test('createDraftSet: anchor + children + claims + topic used, together', async () => {
  const topic = await selectedTopic();
  const ids = await items.createDraftSet(topic, [piece('blog', 'article'), piece('linkedin', 'founder_post')], ['3x faster']);
  assert.equal(ids.length, 2);
  const kids = await db.query<{ anchor_id: string | null }>(`select anchor_id from content.content_items where id = $1`, [ids[1]]);
  assert.equal(kids.rows[0]!.anchor_id, ids[0]);
  const claims = await db.query(`select 1 from content.claims where content_item_id = any($1::uuid[]) and proof_url is null`, [ids]);
  assert.equal(claims.rowCount, 2);
  const t = await db.query<{ status: string }>(`select status from content.topics where id = $1`, [topic]);
  assert.equal(t.rows[0]!.status, 'used');
  await assert.rejects(items.createDraftSet(topic, [piece('blog', 'article')], []), /not 'selected'/, 'no double-draft');
});

test('createDraftSet rolls back entirely when a piece fails', async () => {
  const topic = await selectedTopic();
  await assert.rejects(items.createDraftSet(topic, [piece('blog', 'article'), piece('blog', 'not_a_format')], []));
  const n = await db.query(`select 1 from content.content_items where topic_id = $1`, [topic]);
  assert.equal(n.rowCount, 0, 'no orphan anchor');
  const t = await db.query<{ status: string }>(`select status from content.topics where id = $1`, [topic]);
  assert.equal(t.rows[0]!.status, 'selected', 'topic can be drafted again');
});

test('review → approve → schedule; approval writes status, columns and log together', async () => {
  const [id] = await items.createDraftSet(await selectedTopic(), [piece('x', 'thread')], []);
  await items.transition(id!, { event: 'submit', lane: 'sensitive' });
  assert.deepEqual(await row(id!), { status: 'needs_approval', approval_status: 'pending', approval_lane: 'sensitive' });
  await items.transition(id!, { event: 'approve', decidedBy: 'dashboard' });
  assert.deepEqual(await row(id!), { status: 'approved', approval_status: 'approved', approval_lane: 'sensitive' });
  assert.deepEqual(await approvals(id!), [{ decision: 'approved', decided_by: 'dashboard' }]);
  await items.transition(id!, { event: 'schedule', postizId: 'p1', utmUrl: 'u', scheduledAt: new Date(0).toISOString() });
  assert.equal(await items.goLiveDue(), 1);
  assert.equal((await row(id!)).status, 'published');
});

test('illegal events are refused and change nothing', async () => {
  const [id] = await items.createDraftSet(await selectedTopic(), [piece('x', 'thread')], []);
  await assert.rejects(items.transition(id!, { event: 'approve' }), (e) => e instanceof IllegalTransition && /draft/.test(e.message));
  await items.transition(id!, { event: 'auto_approve' });
  assert.deepEqual(await row(id!), { status: 'approved', approval_status: 'not_required', approval_lane: 'safe_auto' });
  assert.deepEqual(await approvals(id!), [{ decision: 'not_required', decided_by: 'safe_auto' }]);
  await items.transition(id!, { event: 'schedule', postizId: 'p', utmUrl: 'u', scheduledAt: new Date().toISOString() });
  await assert.rejects(items.transition(id!, { event: 'reject' }), IllegalTransition, 'already handed to Postiz');
  assert.equal((await row(id!)).status, 'queued');
  assert.equal((await approvals(id!)).length, 1);
});

test('priority band comes from the SQL generated columns (the rule that actually runs)', async () => {
  const band = async (s: number[]) => (await db.query<{ priority_band: string }>(
    `insert into content.topics (title, score_lead_intent, score_reach, score_brand_fit, score_proof, score_repurpose)
     values ('b',$1,$2,$3,$4,$5) returning priority_band`, s)).rows[0]!.priority_band;
  assert.equal(await band([4, 4, 4, 4, 4]), 'high');      // 20
  assert.equal(await band([4, 4, 4, 4, 3]), 'queue');     // 19
  assert.equal(await band([3, 3, 3, 3, 3]), 'queue');     // 15
  assert.equal(await band([3, 3, 3, 3, 2]), 'if_timely'); // 14
  assert.equal(await band([2, 2, 2, 2, 2]), 'if_timely'); // 10
  assert.equal(await band([2, 2, 2, 2, 1]), 'drop');      // 9
});
