// Training dataset built from content.decisions. Three label sources are merged,
// strongest first, so personalisation never outvotes what actually performs:
//   1. outcome  — did the published content really get reach / engagement
//   2. human    — the operator's own choices (topic select/drop, approvals, corrections)
//   3. teacher  — the LLM's answer (the bulk; "distillation" labels)
// Each example also flags where Jev and the teacher disagree: those are the rows
// worth labelling by hand first (most information per minute of your time).
import type { ModuleContext } from '../modules/module.ts';
import { createRepo, type DatasetRow } from '../db/repo.ts';
import { toQcSignals } from '../modules/qc-parse.ts';
import { randomUUID } from 'node:crypto';
import { parseJsonObject } from '../modules/llm-json.ts';
import { seedQcSystem, buildSeedQcPrompt } from '../prompts/brand-brain.ts';
import { loadBrand } from './brand-service.ts';
import { DECISION_TASKS, QC_SIGNALS, minConfidence, type DecisionTask } from '../modules/decision-tasks.ts';
import { performanceSignal } from '../../core/src/index.ts';

export interface TrainingExample {
  task: string;
  subjectId: string;
  state: string;
  /** Target for the typed questions: human correction if any, else the teacher. */
  label: Record<string, unknown>;
  labelSource: 'human' | 'teacher';
  /** Operator's pick for topics: selected (incl. drafted) / dropped / null = undecided. */
  picked: boolean | null;
  /** Approved by the operator at review, if it got that far. */
  approved: boolean | null;
  /** Market truth: Bible Table 30 quadrant once published. Null until known. */
  outcome: string | null;
  /** Both models' raw answers, kept so you can see (and train on) what each said. */
  teacher: Record<string, unknown> | null;
  jev: Record<string, unknown> | null;
  /** Jev and teacher gave different answers — label this one yourself. */
  disagreement: boolean;
  /** LLM-written practice example. Only trained on after you review it. */
  seed: boolean;
  /** Should be in your labelling queue: an unreviewed disagreement or seed. */
  needsReview: boolean;
  /** outcome 3 > human 2 > teacher-only 1 — use as a per-example loss weight. */
  weight: number;
}

export function toExample(r: DatasetRow): TrainingExample | null {
  const label = r.human ?? r.teacher;
  if (!r.state || !label) return null;

  const picked = r.topic_status === 'dropped' ? false
    : r.topic_auto_selected ? null // autopilot's pick, not yours
    : r.topic_status === 'selected' || r.topic_status === 'used' ? true : null;
  const approved = r.approvals?.includes('approved') ? true
    : r.approvals?.some((a) => a === 'rejected') ? false : null;
  const outcome = r.outcome ? performanceSignal(r.outcome) : null;
  const disagreement = !!r.jev && !!r.teacher && JSON.stringify(sortKeys(r.jev)) !== JSON.stringify(sortKeys(r.teacher));

  const seed = r.seed === true;
  return {
    seed, needsReview: !r.human && (disagreement || seed),
    task: r.task, subjectId: r.subject_id, state: r.state,
    label, labelSource: r.human ? 'human' : 'teacher',
    picked, approved, outcome, teacher: r.teacher, jev: r.jev, disagreement,
    weight: outcome ? 3 : r.human || picked !== null || approved !== null ? 2 : 1,
  };
}

const sortKeys = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

/** Whole dataset as JSONL (one example per line). `queue` = only the labelling queue (unreviewed disagreements and seeds). */
export async function exportDataset(ctx: ModuleContext, opts: { workspace?: string; queue?: boolean } = {}): Promise<string> {
  const rows = await createRepo(ctx.db).datasetRows(opts.workspace);
  return rows.map(toExample)
    // Unreviewed seeds are the LLM grading its own homework — never train on them.
    .filter((e): e is TrainingExample => !!e && (opts.queue ? e.needsReview : !(e.seed && e.labelSource !== 'human')))
    .map((e) => JSON.stringify(e)).join('\n');
}

export interface TrainingOverview {
  examples: number;
  humanLabels: number;
  compared: number;           // examples where both Jev and the teacher answered
  agreementRate: number | null;
  seedsToReview: number;
  queue: TrainingExample[];   // unreviewed disagreements + seeds, disagreements first
}

/** Dashboard summary + the labelling queue (capped so the page stays light). */
export async function getTrainingOverview(ctx: ModuleContext, opts: { workspace?: string; limit?: number } = {}): Promise<TrainingOverview> {
  const all = (await createRepo(ctx.db).datasetRows(opts.workspace))
    .map(toExample).filter((e): e is TrainingExample => !!e);
  const compared = all.filter((e) => e.teacher && e.jev && !e.seed);
  return {
    examples: all.length,
    humanLabels: all.filter((e) => e.labelSource === 'human').length,
    compared: compared.length,
    agreementRate: compared.length ? 1 - compared.filter((e) => e.disagreement).length / compared.length : null,
    seedsToReview: all.filter((e) => e.seed && e.needsReview).length,
    // Real disagreements before seeds: they come from your own pipeline.
    queue: all.filter((e) => e.needsReview).sort((a, b) => Number(a.seed) - Number(b.seed)).slice(0, opts.limit ?? 25),
  };
}

/** Operator's hand label / correction for one decision. Validated + clamped to the
 *  same shape the models produce, so it drops straight into the dataset. */
export async function recordHumanLabel(
  ctx: ModuleContext,
  input: { task: string; subjectId: string; answer: unknown; workspace?: string },
): Promise<void> {
  if (!Object.hasOwn(DECISION_TASKS, input.task)) throw new Error(`unknown task "${input.task}"`);
  const task = input.task as DecisionTask;
  if (!/^[0-9a-f-]{36}$/i.test(input.subjectId ?? '')) throw new Error('subjectId must be a uuid');
  if (!input.answer || typeof input.answer !== 'object') throw new Error('answer must be an object');

  // Same parser as the LLM's answers, so hand labels land in the same shape.
  const answer = DECISION_TASKS[task].parse(JSON.stringify(input.answer));
  await createRepo(ctx.db).logDecision({
    task, subjectId: input.subjectId, state: null, source: 'human', model: null,
    answer, used: false, workspace: input.workspace,
  });
}

/** Have the LLM write `count` labelled practice drafts for the QC checks. They land in
 *  the labelling queue (seed=true) and stay out of the training export until reviewed.
 *  Jev answers them too when configured, so you also see where it would disagree. */
export async function seedQcExamples(ctx: ModuleContext, count = 20): Promise<{ created: number }> {
  if (!ctx.adapters.claude.configured) throw new Error('seeding needs an LLM key (CONTENT_OPENROUTER_API_KEY or CONTENT_ANTHROPIC_API_KEY)');
  const n = Math.min(Math.max(Math.round(count) || 20, 1), 25); // one call stays inside max_tokens
  await loadBrand(ctx);
  const raw = await ctx.adapters.claude.complete(buildSeedQcPrompt(n), { system: seedQcSystem(), maxTokens: 8000 });
  const examples = parseJsonObject(raw).examples;
  if (!Array.isArray(examples)) throw new Error('LLM returned no examples');

  const repo = createRepo(ctx.db);
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  let created = 0;
  for (const ex of examples.slice(0, n) as Array<Record<string, unknown>>) {
    const body = str(ex?.body);
    if (!body) continue;
    const state = QC_SIGNALS.state({ platform: str(ex.platform) || 'linkedin', format: str(ex.format) || 'founder_post', title: str(ex.title), body });
    const subjectId = randomUUID();
    const signals = (ex.signals && typeof ex.signals === 'object' ? ex.signals : {}) as Record<string, unknown>;
    await repo.logDecision({
      task: 'qc_signals', subjectId, state, source: 'claude', model: `seed:${ctx.adapters.claude.model}`,
      answer: toQcSignals(signals), used: false, seed: true,
    });
    if (ctx.adapters.jev.configured) {
      try {
        const r = await ctx.adapters.jev.decide(state, QC_SIGNALS.questions);
        await repo.logDecision({
          task: 'qc_signals', subjectId, state, source: 'jev', model: r.model,
          answer: QC_SIGNALS.fromJev(r.answers), used: false, seed: true, confidence: minConfidence(r.answers),
        });
      } catch (e) {
        ctx.logger.warn(`jev seed ${subjectId}: ${(e as Error).message}`);
      }
    }
    created++;
  }
  return { created };
}
