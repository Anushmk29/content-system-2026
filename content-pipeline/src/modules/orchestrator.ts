// Runs modules with full fault isolation and records every run to content.module_runs
// so the dashboard always shows the true last-known state of each module.
import type { Module, ModuleContext, ModuleResult } from './module.ts';
import { createRepo } from '../db/repo.ts';
import { loadBrand } from '../services/brand-service.ts';
import { withCostScope } from '../cost-ledger.ts';
import { randomUUID } from 'node:crypto';

interface RunRecord extends ModuleResult {
  moduleId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  error?: string;
}

async function recordRun(ctx: ModuleContext, rec: RunRecord, runId: string | null): Promise<void> {
  try {
    await createRepo(ctx.db).recordRun({ ...rec, runId });
  } catch (e) {
    // Recording must never crash a run. Surface it in logs and move on.
    ctx.logger.error(`failed to record run for ${rec.moduleId}`, (e as Error).message);
  }
  if (rec.status === 'error') await alert(ctx, `Content pipeline: module "${rec.moduleId}" failed: ${rec.message}`);
}

/** POST a failure to CONTENT_ALERT_WEBHOOK (Slack and Discord incoming webhooks both accept this shape).
 *  ponytail: one message per failed run; add de-duplication if a broken module floods the channel. */
async function alert(ctx: ModuleContext, text: string): Promise<void> {
  const url = process.env.CONTENT_ALERT_WEBHOOK?.trim();
  if (!url) return;
  try {
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: text.slice(0, 1500), content: text.slice(0, 1500) }), signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    ctx.logger.warn('alert webhook failed', (e as Error).message);
  }
}

/** Run a single module. NEVER throws — failures become an 'error' record. One run per module at a
 *  time across every process (cron + Run button + CLI): an overlapping call is skipped, not queued.
 *  ponytail: session advisory lock; needs a direct/session-mode connection, not a transaction pooler. */
export async function runModule(module: Module, ctx: ModuleContext): Promise<RunRecord> {
  try {
    const rec = await ctx.db.tryLock(`content:module:${module.id}`, () => runUnlocked(module, ctx));
    if (rec) return rec;
  } catch (e) {
    ctx.logger.warn(`run lock for ${module.id}: ${(e as Error).message}`);
    const now = new Date().toISOString();
    const rec: RunRecord = { moduleId: module.id, status: 'error', itemsProcessed: 0,
      message: `Could not acquire the run lock: ${(e as Error).message}`, startedAt: now, finishedAt: now, durationMs: 0 };
    await recordRun(ctx, rec, null);
    return rec;
  }
  const now = new Date().toISOString();
  ctx.logger.child(module.id).info('skipped: already running');
  return { moduleId: module.id, status: 'skipped', itemsProcessed: 0, message: 'already running', startedAt: now, finishedAt: now, durationMs: 0 };
}

async function runUnlocked(module: Module, ctx: ModuleContext): Promise<RunRecord> {
  const runRef = randomUUID();
  const log = ctx.logger.child(`${module.id}#${runRef.slice(0, 8)}`);
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  let rec: RunRecord;
  const runId = await createRepo(ctx.db).startRun(module.id, startedAt).catch(() => null);

  try {
    log.info('run start');
    await loadBrand(ctx); // prompts read the saved brand kit
    const result = await withCostScope({ feature: module.id, refType: 'module_run', refId: runRef }, () => module.run(ctx));
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

  await recordRun(ctx, rec, runId);
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
