// Runs modules with full fault isolation and records every run to content.module_runs
// so the dashboard always shows the true last-known state of each module.
import type { Module, ModuleContext, ModuleResult } from './module.ts';
import { createRepo } from '../db/repo.ts';
import { loadBrand } from '../services/brand-service.ts';

export interface RunRecord extends ModuleResult {
  moduleId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  error?: string;
}

async function recordRun(ctx: ModuleContext, rec: RunRecord): Promise<void> {
  try {
    await createRepo(ctx.db).recordRun(rec);
  } catch (e) {
    // Recording must never crash a run. Surface it in logs and move on.
    ctx.logger.error(`failed to record run for ${rec.moduleId}`, (e as Error).message);
  }
}

/** Run a single module. NEVER throws — failures become an 'error' record. */
export async function runModule(module: Module, ctx: ModuleContext): Promise<RunRecord> {
  const log = ctx.logger.child(module.id);
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  let rec: RunRecord;

  try {
    log.info('run start');
    await loadBrand(ctx); // prompts read the saved brand kit
    const result = await module.run(ctx);
    rec = {
      moduleId: module.id, ...result,
      startedAt, finishedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - t0),
    };
    log.info(`run ${result.status}: ${result.message}`);
  } catch (e) {
    const err = e as Error;
    rec = {
      moduleId: module.id, status: 'error', itemsProcessed: 0,
      message: `unhandled error: ${err.message}`, error: err.stack ?? err.message,
      startedAt, finishedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - t0),
    };
    log.error('run threw', err.message);
  }

  await recordRun(ctx, rec);
  return rec;
}

/**
 * Run many modules IN ORDER, so one /run carries a signal all the way through
 * (research → score → draft → QC …) instead of one stage per run.
 * Isolation guarantee: runModule never throws, so a failed module does NOT stop the rest.
 */
export async function runModules(modules: Module[], ctx: ModuleContext): Promise<RunRecord[]> {
  const records: RunRecord[] = [];
  for (const m of modules) records.push(await runModule(m, ctx));
  return records;
}
