import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { decide } from './decide.ts';
import { topicScoreFromJev, minConfidence, TOPIC_SCORE, QC_SIGNALS } from './decision-tasks.ts';
import { toExample } from '../services/dataset-service.ts';
import { createTestDb } from '../db/test-db.ts';
import type { ModuleContext } from './module.ts';
import type { JevAnswer } from '../adapters/jev.ts';
import type { DatasetRow } from '../db/repo.ts';

const sc = (score: number, confidence = 0.9): JevAnswer => ({ type: 'score', score, confidence });
const db = await createTestDb();
const DRAFT = { platform: 'linkedin', format: 'founder_post', title: 't', body: 'We cut quoting time by 40%.' };
const LLM_ANSWER = '{"hasMetric":false}';

/** A context over the real test DB. `jev` answers (or an Error = outage, null = not configured). */
function ctxWith(opts: { llm: boolean; mode?: 'shadow' | 'primary'; jev: Record<string, JevAnswer> | Error | null }) {
  const prompts: string[] = [];
  const ctx = {
    db, logger: { warn() {} },
    adapters: {
      claude: { configured: opts.llm, model: 'llm-test', complete: async (p: string) => { prompts.push(p); return LLM_ANSWER; } },
      jev: {
        mode: opts.mode ?? 'shadow', configured: opts.jev !== null, minConfidence: 0.8,
        decide: async () => { if (opts.jev instanceof Error) throw opts.jev; return { model: 'jev-test', answers: opts.jev }; },
      },
    },
  } as unknown as ModuleContext;
  return { ctx, prompts };
}

async function run(opts: Parameters<typeof ctxWith>[0]) {
  const id = randomUUID();
  const { ctx, prompts } = ctxWith(opts);
  const value = await decide(ctx, QC_SIGNALS, id, DRAFT);
  const rows = (await db.query<{ source: string; used: boolean; state: string }>(
    `select source, used, state from content.decisions where subject_id = $1 order by source`, [id])).rows;
  return { value, prompts, logged: rows.map((r) => `${r.source}:${r.used ? 'used' : 'logged'}`), rows };
}

const JEV_HIGH = { hasMetric: { type: 'noul', noul: 0.95 } as JevAnswer, isCaseStudy: { type: 'noul', noul: 0.02 } as JevAnswer };
const JEV_UNSURE = { hasMetric: { type: 'noul', noul: 0.6 } as JevAnswer };

test('shadow: the LLM decides, Jev is only logged, and both saw the same input text', async () => {
  const r = await run({ llm: true, jev: JEV_HIGH });
  assert.equal(r.value.hasMetric, false);
  assert.deepEqual(r.logged, ['claude:used', 'jev:logged']);
  assert.ok(r.prompts[0]!.endsWith(r.rows[0]!.state), 'LLM prompt carries the logged state verbatim');
});

test('primary + confident: Jev decides and the LLM is never called', async () => {
  const r = await run({ llm: true, mode: 'primary', jev: JEV_HIGH });
  assert.equal(r.value.hasMetric, true);
  assert.equal(r.prompts.length, 0);
  assert.deepEqual(r.logged, ['jev:used']);
});

test('primary + low confidence: falls back to the LLM', async () => {
  const r = await run({ llm: true, mode: 'primary', jev: JEV_UNSURE });
  assert.equal(r.value.hasMetric, false);
  assert.deepEqual(r.logged, ['claude:used', 'jev:logged']);
});

test('Jev outage never blocks the decision', async () => {
  const r = await run({ llm: true, mode: 'primary', jev: new Error('Jev 529') });
  assert.deepEqual(r.logged, ['claude:used']);
});

test('no LLM: Jev decides at any confidence', async () => {
  assert.deepEqual((await run({ llm: false, jev: JEV_UNSURE })).logged, ['jev:used']);
});

test('no LLM, no Jev: throws instead of inventing an answer', async () => {
  const { ctx } = ctxWith({ llm: false, jev: null });
  await assert.rejects(decide(ctx, TOPIC_SCORE, randomUUID(), { title: 't' }), /nothing to decide with/);
});

test('Jev answers map onto the 1-5 scales and valid enums', () => {
  const t = topicScoreFromJev({
    leadIntent: sc(4.4), reach: sc(0), brandFit: sc(2.6), proof: sc(-1), repurpose: sc(9),
    pillar: { type: 'choice', choice: 'proof_and_use_cases' }, funnelStage: { type: 'choice', choice: 'nope' },
  });
  assert.deepEqual(t, { leadIntent: 5, reach: 1, brandFit: 4, proof: 1, repurpose: 5, pillar: 'proof_and_use_cases' });
  assert.equal(minConfidence({ a: sc(1, 0.9), b: { type: 'noul', noul: 0.6 } }), 0.6);
});

test('dataset: human label beats teacher; outcome carries the most weight; disagreement flagged', () => {
  const base: DatasetRow = {
    task: 'topic_score', subject_id: 'x', seed: false, state: 'TOPIC: t',
    teacher: { reach: 3 }, jev: { reach: 4 }, human: null,
    topic_status: 'new', approvals: null, outcome: null,
  };
  const a = toExample(base)!;
  assert.deepEqual([a.labelSource, a.disagreement, a.weight, a.picked], ['teacher', true, 1, null]);

  const b = toExample({ ...base, human: { reach: 5 }, topic_status: 'dropped' })!;
  assert.deepEqual([b.labelSource, b.label, b.weight, b.picked], ['human', { reach: 5 }, 2, false]);

  const c = toExample({ ...base, topic_status: 'used', approvals: ['approved'],
    outcome: { reach: 2400, qualified_engagement: 40 } })!;
  assert.deepEqual([c.outcome, c.weight, c.approved], ['repurpose', 3, true]);

  // autopilot picks are not your preference; your drop of one still is
  assert.equal(toExample({ ...base, topic_status: 'used', topic_auto_selected: true })!.picked, null);
  assert.equal(toExample({ ...base, topic_status: 'dropped', topic_auto_selected: true })!.picked, false);

  assert.equal(toExample({ ...base, state: null }), null);
});

test('QC signals: only explicit yes counts; garbled or missing never adds or removes risk', async () => {
  const { parseQcSignals, toQcSignals } = await import('./qc-parse.ts');
  const qcSignalsFromJev = QC_SIGNALS.fromJev;
  const p = parseQcSignals('{"hasMetric": true, "isCaseStudy": "yes", "hasClientClaim": "maybe"}');
  assert.equal(p.hasMetric, true);
  assert.equal(p.isCaseStudy, true);
  assert.equal(p.hasClientClaim, false);
  assert.equal(Object.keys(p).length, 7);
  assert.equal(Object.values(toQcSignals({})).some(Boolean), false);
  const j = qcSignalsFromJev({ hasMetric: { type: 'noul', noul: 0.51 }, isCaseStudy: { type: 'noul', noul: 0.2 } });
  assert.deepEqual([j.hasMetric, j.isCaseStudy, j.isNewPositioning], [true, false, false]);
});

test('seeds: queued for review, never exported for training until a human reviews them', () => {
  const seed: DatasetRow = {
    task: 'qc_signals', subject_id: 's', seed: true, state: 'BODY: x',
    teacher: { hasMetric: true }, jev: null, human: null,
    topic_status: null, approvals: null, outcome: null,
  };
  const e = toExample(seed)!;
  assert.deepEqual([e.seed, e.needsReview, e.disagreement], [true, true, false]);
  const reviewed = toExample({ ...seed, human: { hasMetric: false } })!;
  assert.deepEqual([reviewed.needsReview, reviewed.labelSource, reviewed.label], [false, 'human', { hasMetric: false }]);
});

test('same subject, same text: the applied answer is reused, no model is called, nothing new is logged', async () => {
  const id = randomUUID();
  const first = ctxWith({ llm: true, jev: JEV_HIGH });
  await decide(first.ctx, QC_SIGNALS, id, DRAFT);
  const again = ctxWith({ llm: true, jev: new Error('must not be called') });
  const value = await decide(again.ctx, QC_SIGNALS, id, DRAFT);
  assert.equal(value.hasMetric, false);
  assert.equal(again.prompts.length, 0);
  const n = (await db.query(`select 1 from content.decisions where subject_id = $1`, [id])).rowCount;
  assert.equal(n, 2); // the first run's claude + jev rows only

  const edited = ctxWith({ llm: true, jev: null });
  await decide(edited.ctx, QC_SIGNALS, id, { ...DRAFT, body: 'Rewritten without the number.' });
  assert.equal(edited.prompts.length, 1, 'changed text is decided again');
});

test('shadow + LLM down: the finished Jev answer is used and logged instead of failing', async () => {
  const id = randomUUID();
  const { ctx } = ctxWith({ llm: true, jev: JEV_HIGH });
  (ctx.adapters.claude as { complete: unknown }).complete = async () => { throw new Error('LLM 503'); };
  const value = await decide(ctx, QC_SIGNALS, id, DRAFT);
  assert.equal(value.hasMetric, true);
  const rows = (await db.query<{ source: string; used: boolean }>(`select source, used from content.decisions where subject_id = $1`, [id])).rows;
  assert.deepEqual(rows.map((r) => `${r.source}:${r.used}`), ['jev:true']);
});

test('CONTENT_JEV_PRIMARY_TASKS: Jev decides that task first while the mode stays shadow', async () => {
  const { ctx, prompts } = ctxWith({ llm: true, jev: JEV_HIGH });
  (ctx as { env: unknown }).env = { jevPrimaryTasks: ['qc_signals'] };
  const value = await decide(ctx, QC_SIGNALS, randomUUID(), DRAFT);
  assert.equal(value.hasMetric, true);
  assert.equal(prompts.length, 0);
});

test('minConfidence: a choice/score answer without `confidence` uses its top probability', () => {
  assert.equal(minConfidence({ pillar: { type: 'choice', choice: 'a', probabilities: { a: 0.85, b: 0.15 } } }), 0.85);
  assert.equal(minConfidence({ x: { type: 'score', score: 2 } }), 0);
});

test('decode skeleton: confident Jev picks override, unsure ones leave the LLM pick', async () => {
  const { skeletonFromJev, skeletonQuestions } = await import('./decision-tasks.ts');
  const q = skeletonQuestions([{ name: 'tool list', description: 'tools' }, { name: 'story', description: 's' }]);
  assert.deepEqual(Object.keys((q.format as { criteria: object }).criteria), ['f1', 'f2', 'none']);
  assert.equal('format' in skeletonQuestions([]), false);
  const ch = (choice: string, p: number): JevAnswer => ({ type: 'choice', choice, probabilities: { [choice]: p } });
  assert.deepEqual(skeletonFromJev({ format: ch('f2', 0.9), value_structure: ch('steps', 0.5), cta_type: ch('dm', 0.95) }, 0.8),
    { format: 2, ctaType: 'dm' });
  assert.deepEqual(skeletonFromJev({ format: ch('none', 0.9) }, 0.8), { format: null });
});

test('platform fit: Jev probabilities per platform, picks at >= 0.5; drafting follows the operator, then Jev, then the default', async () => {
  const { PLATFORM_FIT, suggestedPlatforms } = await import('./decision-tasks.ts');
  const { platformsFor } = await import('./draft-generator.module.ts');
  const yes = (p: number): JevAnswer => ({ type: 'noul', noul: p });
  const { ctx } = ctxWith({ llm: false, jev: { linkedin: yes(0.92), x: yes(0.61), instagram: yes(0.2), reddit: yes(0.55) } });
  const fit = await decide(ctx, PLATFORM_FIT, randomUUID(), { title: 'Why cafés lose money on oat milk' });
  assert.equal(fit.linkedin, 0.92);
  assert.equal(fit.facebook, 0);
  assert.deepEqual(suggestedPlatforms(fit), ['linkedin', 'x', 'reddit']);
  assert.deepEqual(PLATFORM_FIT.parse('{"linkedin": 1.4, "x": "0.5", "blog": -1}').linkedin, 1);

  assert.deepEqual(platformsFor({ platforms: ['instagram', 'nope'], platform_fit: fit }, true), ['instagram']);
  assert.deepEqual(platformsFor({ platforms: null, platform_fit: fit }, true), ['linkedin', 'x', 'reddit']);
  assert.equal(platformsFor({ platforms: null, platform_fit: fit }, false), undefined);   // flag off → default set
  assert.equal(platformsFor({ platforms: null, platform_fit: null }, true), undefined);
});

test("platform fit: Jev also picks each platform's format and framework; the draft follows unless the operator chose", async () => {
  const { PLATFORM_FIT } = await import('./decision-tasks.ts');
  const { formatsFor, frameworksFor } = await import('./draft-generator.module.ts');
  const ch = (choice: string): JevAnswer => ({ type: 'choice', choice, probabilities: { [choice]: 0.9 } });
  const fit = PLATFORM_FIT.fromJev({
    linkedin: { type: 'noul', noul: 0.9 }, linkedin_format: ch('carousel'), linkedin_framework: ch('pas'), x_format: ch('bogus'),
  });
  assert.deepEqual(fit.picks?.linkedin, { format: 'carousel', framework: 'pas' });
  assert.deepEqual(fit.picks?.x, { format: 'thread', framework: 'thread_numbered' });       // unknown → default
  assert.equal(fit.picks?.youtube, undefined);                                                 // nothing to choose
  assert.deepEqual(PLATFORM_FIT.parse('{"x": 0.7, "picks": {"x": {"format": "image", "framework": "single_insight"}}}').picks?.x,
    { format: 'image', framework: 'single_insight' });

  assert.deepEqual(formatsFor({ platforms: null, platform_fit: fit }), { linkedin: 'carousel' });
  assert.deepEqual(formatsFor({ platforms: ['linkedin'], platform_fit: fit }), {});         // operator's own pick wins
  assert.equal(frameworksFor({ frameworks: null, platform_fit: fit }).linkedin, 'pas');
  assert.equal(frameworksFor({ frameworks: { linkedin: 'numbered' }, platform_fit: fit }).linkedin, 'numbered');
});

test('setTopicPlan: known platforms and frameworks only; null goes back to following Jev', async () => {
  const { setTopicPlan } = await import('../services/console-service.ts');
  const id = (await db.query<{ id: string }>(`insert into content.topics (title, status) values ('t', 'new') returning id`)).rows[0]!.id;
  const ctx = { db } as unknown as ModuleContext;
  assert.equal((await setTopicPlan(ctx, id, { platforms: ['facebook', 'linkedin', 'tiktok'], frameworks: { linkedin: 'pas', x: 'bogus' } })).ok, true);
  let row = (await db.query<{ platforms: string[]; frameworks: Record<string, string> }>(`select platforms, frameworks from content.topics where id = $1`, [id])).rows[0]!;
  assert.deepEqual(row.platforms, ['linkedin', 'facebook']);
  assert.deepEqual(row.frameworks, { linkedin: 'pas' });
  assert.equal((await setTopicPlan(ctx, id, { platforms: [] })).ok, false);
  await setTopicPlan(ctx, id, { platforms: null });
  row = (await db.query<{ platforms: string[]; frameworks: Record<string, string> }>(`select platforms, frameworks from content.topics where id = $1`, [id])).rows[0]!;
  assert.equal(row.platforms, null);
  assert.deepEqual(row.frameworks, { linkedin: 'pas' });                 // untouched
});

test('formats: one written format per platform, default stored bare, scripts kept; the draft reads them', async () => {
  const { setTopicPlan } = await import('../services/console-service.ts');
  const { platformsFor, formatsFor, scriptsFor } = await import('./draft-generator.module.ts');
  const id = (await db.query<{ id: string }>(`insert into content.topics (title, status) values ('t', 'new') returning id`)).rows[0]!.id;
  const ctx = { db } as unknown as ModuleContext;
  await setTopicPlan(ctx, id, { platforms: ['instagram_reel', 'instagram:image', 'linkedin:post', 'instagram:carousel', 'x:bogus', 'facebook:image'] });
  const platforms = (await db.query<{ platforms: string[] }>(`select platforms from content.topics where id = $1`, [id])).rows[0]!.platforms;
  assert.deepEqual(platforms, ['linkedin', 'instagram', 'facebook:image', 'instagram_reel']); // last IG pick wins; junk dropped
  const t = { platforms, platform_fit: null };
  assert.deepEqual(platformsFor(t, false), ['linkedin', 'instagram', 'facebook']);
  assert.deepEqual(formatsFor(t), { facebook: 'image' });
  assert.deepEqual(scriptsFor(t), ['instagram_reel']);
});

test('Jev decides scoring + platform plan at any confidence; QC still needs a confident Jev', async () => {
  const { PLATFORM_FIT, suggestedPlatforms } = await import('./decision-tasks.ts');
  const shaky: JevAnswer = { type: 'score', score: 2, confidence: 0.2 };
  const { ctx, prompts } = ctxWith({ llm: true, jev: { leadIntent: shaky, reach: shaky, brandFit: shaky, proof: shaky, repurpose: shaky } });
  (ctx as { env: unknown }).env = { jevPrimaryTasks: ['topic_score', 'qc_signals'] };
  assert.equal((await decide(ctx, TOPIC_SCORE, randomUUID(), { title: 't' })).reach, 3);
  assert.equal(prompts.length, 0, 'the LLM is not asked');

  const unsure = ctxWith({ llm: true, jev: JEV_UNSURE });
  (unsure.ctx as { env: unknown }).env = { jevPrimaryTasks: ['qc_signals'] };
  assert.equal((await decide(unsure.ctx, QC_SIGNALS, randomUUID(), DRAFT)).hasMetric, false);   // LLM answer
  assert.equal(unsure.prompts.length, 1);

  // Jev scores most platforms 0.5-0.85: only the best 4 are suggested.
  const yes = (p: number): JevAnswer => ({ type: 'noul', noul: p });
  const ch = (choice: string, p: number): JevAnswer => ({ type: 'choice', choice, probabilities: { [choice]: p } });
  const fit = PLATFORM_FIT.fromJev({
    linkedin: yes(0.65), x: yes(0.72), instagram: yes(0.6), facebook: yes(0.51), reddit: yes(0.66), youtube: yes(0.56),
    linkedin_format: ch('carousel', 0.97), linkedin_framework: ch('pas', 0.3),
  });
  assert.deepEqual(suggestedPlatforms(fit), ['linkedin', 'x', 'instagram', 'reddit']);
  assert.deepEqual(fit.picks?.linkedin, { format: 'carousel', framework: 'hook_story_lesson' }); // unsure structure → default
});
