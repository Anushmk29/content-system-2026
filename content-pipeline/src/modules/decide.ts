// One decision, routed between Jev (fast, typed) and the LLM "teacher", with every
// answer logged to content.decisions. That log is the training dataset: each row is
// (exact input text, which model, its answer, confidence), later joined with the
// operator's own choices and real post performance (see services/dataset-service.ts).
// Who decides, in order:
//   0. Nobody: this subject was already decided on exactly this input text (e.g. QC on a
//      draft that came back unchanged) — the applied answer is reused, no model is called.
//   1. Jev, when this task runs Jev-primary (CONTENT_JEV_MODE=primary, or the task is in
//      CONTENT_JEV_PRIMARY_TASKS) and its weakest answer >= minConfidence (any, for trustJev tasks).
//   2. The LLM, when configured (otherwise Jev runs alongside and is only logged).
//   3. With no LLM: Jev at any confidence, else it throws.
import type { ModuleContext } from './module.ts';
import type { JevResult } from '../adapters/jev.ts';
import { createRepo } from '../db/repo.ts';
import { minConfidence, type DecisionTaskDef } from './decision-tasks.ts';

/** False when nothing could answer (no LLM, no Jev): skip it quietly. */
export const canDecide = (ctx: ModuleContext) =>
  ctx.adapters.claude.configured || ctx.adapters.jev.configured;

/** Jev answers first for this task: globally (mode primary) or switched on per task once
 *  the Training page shows Jev agrees with the LLM often enough. */
const jevFirst = (ctx: ModuleContext, task: string) =>
  ctx.adapters.jev.mode === 'primary' || (ctx.adapters.jev.configured && (ctx.env?.jevPrimaryTasks ?? []).includes(task));

export async function decide<S, T>(ctx: ModuleContext, def: DecisionTaskDef<S, T>, subjectId: string, subject: S): Promise<T> {
  const { jev, claude } = ctx.adapters;
  const state = def.state(subject);
  const repo = createRepo(ctx.db);
  const cached = await repo.cachedDecision(def.task, subjectId, state).catch(() => null);
  if (cached !== null) return cached as T;
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

  if (jevFirst(ctx, def.task)) {
    const r = await jevRun;
    if (r && (def.trustJev || minConfidence(r.answers) >= jev.minConfidence)) return useJev(r);
  }

  if (!claude.configured) {
    const r = await jevRun;
    if (r) return useJev(r);
    throw new Error(`${def.task}: nothing to decide with (no LLM, Jev unavailable)`);
  }

  // Teacher decides; Jev (if any) runs alongside for comparison. allSettled: a failed LLM call
  // must not throw away a finished Jev answer — it is still logged for the dataset.
  const t1 = Date.now();
  const [teach, jevDone] = await Promise.allSettled([
    claude.complete(def.prompt(state), { system: def.system }).then((raw) => ({ raw, ms: Date.now() - t1 })),
    jevRun,
  ]);
  const r = jevDone.status === 'fulfilled' ? jevDone.value : null;
  if (teach.status === 'rejected') {
    if (r) {
      // The LLM is down but Jev answered: use it rather than fail the item.
      ctx.logger.warn(`${def.task} ${subjectId}: LLM failed (${(teach.reason as Error).message}); using Jev`);
      return useJev(r);
    }
    throw teach.reason;
  }
  const value = def.parse(teach.value.raw, subject);
  await log('claude', claude.model, value, true, teach.value.ms);
  if (r) await log('jev', r.model, def.fromJev(r.answers), false, r.ms, minConfidence(r.answers));
  return value;
}
