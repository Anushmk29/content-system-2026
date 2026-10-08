import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../db/test-db.ts';
import { createContentItems } from '../db/content-items.ts';
import type { ModuleContext } from '../modules/module.ts';
import { applyApprovalDecision } from './approval-service.ts';
import { feedbackText, refreshLessons } from './feedback-service.ts';
import { saveBrand } from './brand-service.ts';
import { brand, setBrand, DEFAULT_BRAND } from '../brand.ts';
import { brandSystem } from '../prompts/brand-context.ts';

const db = await createTestDb();
const items = createContentItems(db);

/** A context whose LLM answers from a queue and records each prompt. */
function ctxWith(replies: string[], env: Record<string, unknown> = {}) {
  const prompts: string[] = [];
  const ctx = {
    db, env, logger: { warn() {}, info() {} },
    adapters: { claude: { configured: true, model: 'llm-test', complete: async (p: string) => { prompts.push(p); return replies.shift() ?? '{}'; } } },
  } as unknown as ModuleContext;
  return { ctx, prompts };
}

async function waitingItem(body = 'Old body with a weak opening.'): Promise<string> {
  const topic = (await db.query<{ id: string }>(`insert into content.topics (title, status) values ('t', 'selected') returning id`)).rows[0]!.id;
  const [id] = await items.createDraftSet(topic, [{ title: 'Post', pillar: 'founder_build_notes', funnelStage: 'trust', platform: 'linkedin', format: 'founder_post', body }], []);
  await items.transition(id!, { event: 'submit', lane: 'review' });
  return id!;
}
const copy = async (id: string) =>
  (await db.query<{ hook: string | null; body: string; status: string }>(`select hook, body, status from content.content_items where id = $1`, [id])).rows[0]!;

test('feedbackText: picked reasons + note; unknown reasons dropped', () => {
  assert.equal(feedbackText(['Too long', 'nonsense', 'Weak hook'], ' Lead with the cost. '), 'Too long, Weak hook. Lead with the cost.');
  assert.equal(feedbackText(undefined, null), '');
});

test('request changes (flag on): that one post is rewritten from the feedback and stays a draft', async () => {
  await saveBrand(ctxWith([]).ctx, { name: 'Brew & Books' });
  const id = await waitingItem();
  const { ctx, prompts } = ctxWith(['{"hook":"New hook","body":"New body.","cta":"Reply below"}'], { reviseOnChanges: true });
  const r = await applyApprovalDecision(ctx, { itemId: id, action: 'changes', reasons: ['Weak hook'], note: 'Open with the cost' });
  assert.ok(r.ok && /rewritten with your feedback/.test(r.message), r.message);
  assert.match(prompts[0]!, /FEEDBACK FROM THE FOUNDER:\nWeak hook\. Open with the cost/);
  assert.match(prompts[0]!, /Old body with a weak opening/);
  assert.deepEqual(await copy(id), { hook: 'New hook', body: 'New body.', status: 'draft' });
  const note = (await db.query<{ note: string }>(`select note from content.approvals where content_item_id = $1`, [id])).rows[0]!.note;
  assert.equal(note, 'Weak hook. Open with the cost');
});

test('request changes (flag off): original behaviour, back to draft untouched; a failed rewrite keeps the text', async () => {
  const off = await waitingItem('Keep me.');
  await applyApprovalDecision(ctxWith([]).ctx, { itemId: off, action: 'changes', note: 'shorter' });
  assert.equal((await copy(off)).body, 'Keep me.');

  const broken = await waitingItem('Still me.');
  const r = await applyApprovalDecision(ctxWith(['not json'], { reviseOnChanges: true }).ctx, { itemId: broken, action: 'changes', note: 'shorter' });
  assert.ok(r.ok && /couldn't rewrite/.test(r.message), r.message);
  assert.deepEqual(await copy(broken), { hook: null, body: 'Still me.', status: 'draft' });
});

test('lessons: re-learned after enough new notes, saved on the kit, and in every draft prompt', async () => {
  const { ctx, prompts } = ctxWith(['{"rules":["Never open with a question","LinkedIn: under 200 words"]}']);
  assert.equal(await refreshLessons(ctx), true);                           // 3 notes from the tests above
  assert.match(prompts[0]!, /\[linkedin, changes\] Weak hook\. Open with the cost/);
  assert.deepEqual(brand().learnedRules, ['Never open with a question', 'LinkedIn: under 200 words']);
  assert.match(brandSystem(), /LEARNED FROM THE FOUNDER'S FEEDBACK[\s\S]*- Never open with a question/);
  assert.equal(await refreshLessons(ctxWith([]).ctx), false, 'no new notes since → no call');

  await saveBrand(ctx, { learnedRules: ['LinkedIn: under 200 words'] });  // "Forget" on the Brand page
  assert.deepEqual(brand().learnedRules, ['LinkedIn: under 200 words']);
  setBrand(DEFAULT_BRAND);
});
