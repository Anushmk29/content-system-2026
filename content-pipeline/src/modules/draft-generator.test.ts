import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../db/test-db.ts';
import { createRepo } from '../db/repo.ts';
import type { ModuleContext } from './module.ts';
import { draftGeneratorModule } from './draft-generator.module.ts';

const db = await createTestDb(), repo = createRepo(db);
async function fixture(claims: string[] = [], qcReply: string | Error = '{}') {
  const id = await repo.insertTopic({ title: 'Human review in a workflow', status: 'selected', marketContext: 'Local test fixture' });
  await db.query('update content.topics set platforms=$2 where id=$1', [id, ['linkedin']]);
  const replies: (string | Error)[] = [JSON.stringify({ angles: [{ belief: 'Automate everything', truth: 'Keep a human for exceptions', strength: 8 }] }), JSON.stringify({ pillar: 'practical_ai_for_operators', funnelStage: 'education', claims, linkedin: { title: 'A workflow', hook: 'Keep a human for exceptions.', body: 'Write the repeated steps down. Automate them. Have a person review unusual requests.', cta: 'Save the checklist.' } }), qcReply];
  const ctx = {
    db, env: { researchModel: 'off', humanizeRewrite: false, platformFit: false }, logger: { warn() {} },
    adapters: { postiz: { configured: false }, jev: { configured: false, mode: 'off' }, claude: { configured: true, model: 'local-fixture', complete: async () => { const r = replies.shift(); if (r instanceof Error) throw r; assert.ok(r, 'Unexpected extra model call'); return r; } } },
  } as unknown as ModuleContext;
  return { id, ctx, replies };
}

test('draft action performs QC and sends a plain post to human approval without publishing', async () => {
  const { id, ctx } = await fixture();
  const result = await draftGeneratorModule.run(ctx);
  assert.equal(result.status, 'ok'); assert.equal(result.itemsProcessed, 1); assert.equal(result.meta!.toApproval, 1);
  const row = (await db.query<{ status: string; approval_status: string }>('select status,approval_status from content.content_items where topic_id=$1', [id])).rows[0]!;
  assert.equal(row.status, 'needs_approval'); assert.equal(row.approval_status, 'pending');
  assert.equal((await db.query('select 1 from content.v_publish_ready where topic_id=$1', [id])).rowCount, 0);
});

test('automatic QC leaves unsupported claims in draft and does not duplicate drafts on retry', async () => {
  const { id, ctx, replies } = await fixture(['Saved 10 hours a week']);
  const result = await draftGeneratorModule.run(ctx);
  assert.equal(result.status, 'ok'); assert.equal(result.meta!.needProof, 1); assert.equal(result.meta!.toApproval, 0);
  assert.equal((await db.query<{ status: string }>('select status from content.content_items where topic_id=$1', [id])).rows[0]!.status, 'draft');
  assert.equal(replies.length, 1, 'unproven claims are blocked before model-assisted QC');
  assert.equal((await draftGeneratorModule.run(ctx)).itemsProcessed, 0);
  assert.equal((await db.query('select 1 from content.content_items where topic_id=$1', [id])).rowCount, 1);
});

test('unavailable model-assisted QC still requires human review and reports its fallback', async () => {
  const { id, ctx } = await fixture([], new Error('Model unavailable'));
  const result = await draftGeneratorModule.run(ctx);
  assert.equal(result.meta!.signalFailures, 1); assert.match(result.message, /format rules only/);
  assert.equal((await db.query<{ status: string }>('select status from content.content_items where topic_id=$1', [id])).rows[0]!.status, 'needs_approval');
});
