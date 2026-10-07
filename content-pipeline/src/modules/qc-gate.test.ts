import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../db/test-db.ts';
import { createContentItems } from '../db/content-items.ts';
import { qcGateModule } from './qc-gate.module.ts';
import { applyApprovalDecision } from '../services/approval-service.ts';
import type { ModuleContext } from './module.ts';
import type { NewContentItem } from '../db/repo.ts';

const db = await createTestDb();
const items = createContentItems(db);
// No LLM and no Jev: the gate runs on format rules + claims alone.
const ctx = (allowSafeAuto = false) => ({
  db, env: { allowSafeAuto }, logger: { warn() {} },
  adapters: { claude: { configured: false }, jev: { configured: false, mode: 'off' } },
}) as unknown as ModuleContext;

const piece = (format: string): NewContentItem =>
  ({ title: format, pillar: 'founder_build_notes', funnelStage: 'trust', platform: 'linkedin', format, body: 'b' });
async function draftSet(formats: string[], claims: string[] = []) {
  const t = await db.query<{ id: string }>(`insert into content.topics (title, status) values ('x','selected') returning id`);
  return items.createDraftSet(t.rows[0]!.id, formats.map(piece), claims);
}
const state = async (id: string) => (await db.query<{ status: string; approval_lane: string | null }>(
  `select status, approval_lane from content.content_items where id = $1`, [id])).rows[0]!;

test('unproven claim stays draft; a plain post goes to a human (review)', async () => {
  const [claimed] = await draftSet(['founder_post'], ['cut costs 40%']);
  const [plain] = await draftSet(['founder_post']);
  await qcGateModule.run(ctx());
  assert.deepEqual(await state(claimed!), { status: 'draft', approval_lane: null });
  assert.deepEqual(await state(plain!), { status: 'needs_approval', approval_lane: 'review' });
});

test('safe_auto is earned only when allowed, template-based and derived from approved work', async () => {
  const [anchor, card] = await draftSet(['article', 'quote_card']);
  await items.transition(anchor!, { event: 'submit', lane: 'review' });
  await items.transition(anchor!, { event: 'approve' });
  await qcGateModule.run(ctx(true));
  assert.deepEqual(await state(card!), { status: 'approved', approval_lane: 'safe_auto' });

  const [a2, c2] = await draftSet(['article', 'quote_card']);
  await items.transition(a2!, { event: 'submit', lane: 'review' });
  await items.transition(a2!, { event: 'approve' });
  await qcGateModule.run(ctx(false));
  assert.deepEqual(await state(c2!), { status: 'needs_approval', approval_lane: 'review' }, 'flag off → human');
});

test('approval decisions: legal once, idempotent on repeat, refused once scheduled', async () => {
  const [id] = await draftSet(['founder_post']);
  await qcGateModule.run(ctx());
  assert.equal((await applyApprovalDecision(ctx(), { itemId: id!, action: 'approve' })).ok, true);
  const again = await applyApprovalDecision(ctx(), { itemId: id!, action: 'approve' });
  assert.deepEqual([again.ok, /Already/.test(again.message)], [true, true]);
  await items.transition(id!, { event: 'schedule', postizId: 'p', utmUrl: 'u', scheduledAt: new Date().toISOString() });
  const late = await applyApprovalDecision(ctx(), { itemId: id!, action: 'reject' });
  assert.deepEqual([late.ok, /queued/.test(late.message)], [false, true]);
});
