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

test('no LLM, no Jev, no rules: throws instead of inventing an answer', async () => {
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
