// One decision, routed between Jev (fast, typed) and the LLM "teacher", with every
// answer logged to content.decisions. That log is the training dataset: each row is
// (exact input text, which model, its answer, confidence), later joined with the
// operator's own choices and real post performance (see services/dataset-service.ts).
// Who decides, in order:
//   1. Jev, in primary mode, when its weakest answer >= minConfidence.
//   2. The LLM, when configured (in shadow mode Jev runs alongside and is only logged).
//   3. With no LLM: Jev at any confidence, else the task's keyword rules, else it throws.
import type { ModuleContext } from './module.ts';
import type { JevResult } from '../adapters/jev.ts';
import { createRepo } from '../db/repo.ts';
import { minConfidence, type DecisionTaskDef } from './decision-tasks.ts';

/** False when nothing could answer this task (no LLM, no Jev, no rules): skip it quietly. */
export const canDecide = (ctx: ModuleContext, def: DecisionTaskDef<never, unknown>) =>
  ctx.adapters.claude.configured || ctx.adapters.jev.configured || !!def.rules;

export async function decide<S, T>(ctx: ModuleContext, def: DecisionTaskDef<S, T>, subjectId: string, subject: S): Promise<T> {
  const { jev, claude } = ctx.adapters;
  const state = def.state(subject);
  const repo = createRepo(ctx.db);
  const log = (source: string, model: string, answer: unknown, used: boolean, ms: number, confidence?: number) =>
    repo.logDecision({ task: def.task, subjectId, state, source, model, answer, used, latencyMs: ms, confidence })
      // A logging failure (e.g. schema not migrated yet) must never block the pipeline.
      .catch((e: Error) => ctx.logger.warn(`decision log failed: ${e.message}`));
  const useJev = async (r: JevResult & { ms: number }) => {
    const value = def.fromJev(r.answers);
    await log('jev', r.model, value, true, r.ms, minConfidence(r.answers));
    return value;
  };

  const t0 = Date.now();
  const jevRun: Promise<(JevResult & { ms: number }) | null> = jev.configured
    ? jev.decide(state, def.questions).then(
        (r) => ({ ...r, ms: Date.now() - t0 }),
        (e: Error) => { ctx.logger.warn(`jev ${def.task} ${subjectId}: ${e.message}`); return null; })
    : Promise.resolve(null);

  if (jev.mode === 'primary') {
    const r = await jevRun;
    if (r && minConfidence(r.answers) >= jev.minConfidence) return useJev(r);
  }

  if (!claude.configured) {
    const r = await jevRun;
    if (r) return useJev(r);
    if (!def.rules) throw new Error(`${def.task}: nothing to decide with (no LLM, Jev unavailable, no rules)`);
    const value = def.rules(subject);
    await log('rules', 'keyword-rules', value, true, 0);
    return value;
  }

  // Teacher decides; Jev (if any) runs alongside for comparison.
  // CONTENT_DECISION_MODEL (e.g. typesafe/jev-router) answers decisions; drafting keeps the main model.
  const model = ctx.env?.decisionModel;
  const t1 = Date.now();
  const teach = claude.complete(def.prompt(state), { system: def.system, model }).then((raw) => ({ raw, ms: Date.now() - t1 }));
  const [{ raw, ms }, r] = await Promise.all([teach, jevRun]);
  const value = def.parse(raw, subject);
  await log('claude', model ?? claude.model, value, true, ms);
  if (r) await log('jev', r.model, def.fromJev(r.answers), false, r.ms, minConfidence(r.answers));
  return value;
}
