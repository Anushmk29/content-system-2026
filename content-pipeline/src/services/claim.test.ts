import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '../db/test-db.ts';
import { createRepo } from '../db/repo.ts';
import { createContentItems } from '../db/content-items.ts';
import type { ModuleContext } from '../modules/module.ts';
import { updateClaim } from './claim-service.ts';
import { qcItem } from '../modules/qc-gate.module.ts';

const db = await createTestDb(), repo = createRepo(db), items = createContentItems(db);
const ctx = { db, env: {}, logger: { warn() {} }, adapters: { claude: { configured: false }, jev: { configured: false } } } as unknown as ModuleContext;
const originalCopy = { hook: 'A useful workflow', body: 'We saved 10 hours each week. Keep a person for exceptions.', cta: 'Save this.' };
async function fixture(claims = ['We saved 10 hours each week.']) {
  const topic = await repo.insertTopic({ title: 'Claim fixture', status: 'selected' });
  const [id] = await items.createDraftSet(topic, [{ title: 'Claim fixture', platform: 'linkedin', format: 'founder_post', pillar: 'proof_and_use_cases', funnelStage: 'trust', ...originalCopy }], claims);
  return { id: id!, claim: (await repo.claimsFor(id!))[0]! };
}
const remove = (id: string, copy = { ...originalCopy, body: 'Keep a person for exceptions.' }) => ({
  id, action: 'remove', originalCopy, copy, note: 'Removed the unsupported time-saving statement.', confirmed: true,
});

test('proof save revokes approval, preserves lane, records history, and requires fresh review', async () => {
  const { id, claim } = await fixture();
  await items.transition(id, { event: 'submit', lane: 'sensitive' }); await items.transition(id, { event: 'approve' });
  assert.equal((await updateClaim(ctx, id, { id: claim.id, action: 'proof', proofUrl: ' https://example.com/evidence ' }, 'client')).ok, true);
  const row = (await repo.getItem(id))!;
  assert.equal(row.status, 'draft'); assert.equal(row.approval_lane, 'sensitive'); assert.equal(row.approval_status, 'changes_requested');
  assert.equal((await repo.claimsFor(id))[0]!.proof_url, 'https://example.com/evidence');
  assert.equal((await db.query('select 1 from content.v_publish_ready where id=$1', [id])).rowCount, 0);
  assert.match((await repo.approvalsFor(id)).at(-1)!.note!, /Proof saved.*We saved 10 hours/s);
  await qcItem(ctx, (await repo.getItem(id))!); await items.transition(id, { event: 'approve' });
  assert.equal((await db.query('select 1 from content.v_publish_ready where id=$1', [id])).rowCount, 1);
  const n = (await repo.approvalsFor(id)).length;
  await updateClaim(ctx, id, { id: claim.id, action: 'proof', proofUrl: 'https://example.com/evidence' });
  assert.equal((await repo.getItem(id))!.status, 'approved', 'an unchanged retry must not revoke a new approval');
  assert.equal((await repo.approvalsFor(id)).length, n);
});

test('clearing proof blocks review and invalid links cannot mutate the claim or approval', async () => {
  const { id, claim } = await fixture();
  for (const proofUrl of ['javascript:alert(1)', 'file:///secret', 'https://user:password@example.com', 'http:example.com', 'not a URL', 'https://example.com/a\u0000b', 'https://example.com/' + 'x'.repeat(2048), 42, undefined]) {
    await assert.rejects(() => updateClaim(ctx, id, { id: claim.id, action: 'proof', proofUrl }));
  }
  assert.equal((await repo.claimsFor(id))[0]!.proof_url, null); assert.equal((await repo.approvalsFor(id)).length, 0);
  await updateClaim(ctx, id, { id: claim.id, action: 'proof', proofUrl: 'https://example.com/evidence' });
  await updateClaim(ctx, id, { id: claim.id, action: 'proof', proofUrl: null });
  assert.equal((await qcItem(ctx, (await repo.getItem(id))!)).outcome, 'blocked');
});

test('removing a claim atomically saves corrected copy and history without clearing other claims', async () => {
  const { id, claim } = await fixture(['We saved 10 hours each week.', 'Another statement needing proof']);
  await items.transition(id, { event: 'submit', lane: 'sensitive' }); await items.transition(id, { event: 'approve' });
  assert.equal((await updateClaim(ctx, id, remove(claim.id), 'client')).ok, true);
  const row = (await repo.getItem(id))!;
  assert.equal(row.body, 'Keep a person for exceptions.'); assert.equal(row.status, 'draft'); assert.equal(row.approval_lane, 'sensitive');
  assert.deepEqual((await repo.claimsFor(id)).map(x => x.claim_text), ['Another statement needing proof']);
  const log = (await repo.approvalsFor(id)).at(-1)!;
  assert.match(log.note!, /Claim removed.*We saved 10 hours.*Reason: Removed/s); assert.equal(log.decided_by, 'client');
  assert.equal((await qcItem(ctx, row)).outcome, 'blocked', 'a different unresolved claim still blocks the post');
});

test('claim resolution rejects unchanged copy, retained claims, missing confirmation, stale edits and another post\'s claim', async () => {
  const { id, claim } = await fixture();
  for (const patch of [{ copy: originalCopy }, { copy: { ...originalCopy, cta: 'Changed CTA only.' } }, { confirmed: false }, { note: '' }, { originalCopy: { ...originalCopy, body: 'stale' } }, { copy: { ...originalCopy, body: ' ' } }]) {
    await assert.rejects(() => updateClaim(ctx, id, { ...remove(claim.id), ...patch }));
  }
  const other = await fixture();
  await assert.rejects(() => updateClaim(ctx, id, { id: other.claim.id, action: 'proof', proofUrl: 'https://example.com' }), /Not found/);
  await assert.rejects(() => updateClaim(ctx, id, { id: randomUUID(), action: 'proof', proofUrl: null }), /Not found/);
  for (const bad of [null, [], 'text', {}, { id: 'bad', action: 'proof' }, { id: claim.id, action: 'invented' }]) await assert.rejects(() => updateClaim(ctx, id, bad));
  assert.equal((await repo.getItem(id))!.body, originalCopy.body); assert.equal((await repo.claimsFor(id)).length, 1); assert.equal((await repo.approvalsFor(id)).length, 0);
});

test('claims cannot be changed after scheduling and are scoped to one platform copy', async () => {
  const { id, claim } = await fixture();
  await updateClaim(ctx, id, { id: claim.id, action: 'proof', proofUrl: 'https://example.com/evidence' });
  await qcItem(ctx, (await repo.getItem(id))!); await items.transition(id, { event: 'approve' });
  await items.transition(id, { event: 'schedule', postizId: 'qa-only', utmUrl: '', scheduledAt: new Date(Date.now() + 86400000).toISOString() });
  assert.equal((await updateClaim(ctx, id, { id: claim.id, action: 'proof', proofUrl: null })).ok, false);
  assert.equal((await updateClaim(ctx, id, remove(claim.id))).ok, false);
  assert.equal((await repo.getItem(id))!.status, 'queued'); assert.equal((await repo.claimsFor(id)).length, 1);
  const other = await fixture(); await updateClaim(ctx, other.id, remove(other.claim.id));
  assert.equal((await repo.claimsFor(id))[0]!.proof_url, 'https://example.com/evidence');
});

test('a database failure rolls back corrected copy, claim removal and approval history together', async () => {
  const { id, claim } = await fixture();
  await items.transition(id, { event: 'submit', lane: 'sensitive' });
  await db.query(`create function content.qa_refuse_claim_delete() returns trigger language plpgsql as $$ begin raise exception 'QA delete failed'; end $$`);
  await db.query(`create trigger qa_refuse_claim_delete before delete on content.claims for each row execute function content.qa_refuse_claim_delete()`);
  try {
    await assert.rejects(() => updateClaim(ctx, id, remove(claim.id)), /QA delete failed/);
    assert.equal((await repo.getItem(id))!.body, originalCopy.body);
    assert.equal((await repo.getItem(id))!.status, 'needs_approval');
    assert.equal((await repo.claimsFor(id)).length, 1);
    assert.equal((await repo.approvalsFor(id)).length, 0);
  } finally {
    await db.query('drop trigger qa_refuse_claim_delete on content.claims');
    await db.query('drop function content.qa_refuse_claim_delete()');
  }
});
