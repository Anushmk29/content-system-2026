import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanScore, HUMAN_MIN } from './humanizer.ts';
import { qcItem } from './modules/qc-gate.module.ts';
import { createTestDb } from './db/test-db.ts';
import { createContentItems } from './db/content-items.ts';
import type { ModuleContext } from './modules/module.ts';
import type { ContentItemRow } from './db/repo.ts';

// The content-humanizer skill's own demo samples.
const HUMAN = `We tried to fix our churn problem the wrong way for about a year.

We threw money at marketing, assumed acquisition would outpace loss, and avoided looking at the actual numbers. It didn't work. Churn stayed flat at 8% monthly, which sounds manageable until you realize that's 65% annual churn. We were filling a leaky bucket with a garden hose.

The breakthrough — if you can call it that — was embarrassingly simple: we actually talked to the customers who left.

Not the ones who complained. The ones who quietly disappeared. We called 30 churned accounts over two weeks. You know what most of them said? They didn't hate the product. They just... forgot about it.

Three months later, 30-day activation was up 40%. Churn dropped to 4.5%.`;

const AI = `It is crucial to leverage data-driven insights in order to effectively navigate the challenges of customer retention in the competitive SaaS landscape. Furthermore, by implementing robust onboarding strategies, organizations can ensure that users achieve maximum value from the product, thereby significantly reducing churn rates.

To facilitate this process, it's important to note that companies should delve into their customer behavior data to identify patterns and trends. Moreover, by fostering meaningful connections with customers and ensuring comprehensive support throughout their journey, businesses can cultivate lasting relationships that drive long-term success.

In conclusion, the implementation of these holistic strategies will empower organizations to streamline their customer success operations and achieve sustainable growth in an increasingly competitive marketplace.`;

test('human sample passes, AI sample fails and names its tells', () => {
  const h = humanScore(HUMAN), a = humanScore(AI);
  assert.ok(h.score >= HUMAN_MIN, `human ${h.score}`);
  assert.ok(a.score < 50, `ai ${a.score}`);
  assert.ok(a.phrases.includes('leverage') && a.phrases.includes("it's important to note"));
  assert.match(a.tells.join(' '), /AI words: .*delve/);
});

test('script beat separators and cue tags are not em dashes or words', () => {
  const s = humanScore('Stop doing this.\n---\n[ON SCREEN: robust plan]\nYou lose a day a week.\n---\nFix it today.');
  assert.equal(s.phrases.length, 0);
  assert.ok(!s.tells.includes('Too many em dashes'));
});

test('QC rewrites an AI-sounding draft once, then routes the new text', async () => {
  const db = await createTestDb();
  const t = await db.query<{ id: string }>(`insert into content.topics (title, status) values ('x','selected') returning id`);
  const [id] = await createContentItems(db).createDraftSet(t.rows[0]!.id,
    [{ title: 'x', pillar: 'founder_build_notes', funnelStage: 'trust', platform: 'linkedin', format: 'founder_post', body: AI }], []);
  const prompts: string[] = [];
  const ctx = {
    db, env: { humanizeRewrite: true }, logger: { warn() {} },
    adapters: {
      jev: { configured: false, mode: 'off' },
      claude: { configured: true, model: 'm', complete: async (p: string) => { prompts.push(p); return JSON.stringify({ hook: 'Most churn is quiet.', body: HUMAN, cta: 'Tell me yours.' }); } },
    },
  } as unknown as ModuleContext;
  const row = (await db.query<ContentItemRow>(`select * from content.content_items where id = $1`, [id])).rows[0]!;
  // QC signals also go through claude here; only the first call is the rewrite.
  await qcItem(ctx, row).catch(() => {});
  assert.match(prompts[0]!, /reads AI-written/);
  const after = (await db.query<{ body: string }>(`select body from content.content_items where id = $1`, [id])).rows[0]!;
  assert.equal(after.body, HUMAN);
});
