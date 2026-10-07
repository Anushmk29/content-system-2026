// Aggregates adapter probes + last module-run state into one system-health object
// for the dashboard. This is what makes "if one doesn't work, we know it" true.
import type { ModuleContext } from '../modules/module.ts';
import { rollup, type HealthReport, type HealthState } from '../health.ts';
import { MODULES } from '../modules/registry.ts';
import { createRepo, type ModuleHealthRow } from '../db/repo.ts';

export interface ModuleHealth {
  id: string;
  title: string;
  description: string;
  lastStatus: string;        // ok|degraded|error|skipped|running|never
  lastRunAt: string | null;
  durationMs: number | null;
  itemsProcessed: number | null;
  message: string | null;
  error: string | null;
}

export interface SystemHealth {
  overall: HealthState;
  checkedAt: string;
  adapters: HealthReport[];
  database: HealthReport;
  modules: ModuleHealth[];
}

export async function getSystemHealth(ctx: ModuleContext): Promise<SystemHealth> {
  // Probe adapters + DB concurrently; probes never throw (they catch internally).
  const [database, claude, postiz, jev, apify, tinyfish] = await Promise.all([
    ctx.db.healthCheck(),
    ctx.adapters.claude.healthCheck(),
    ctx.adapters.postiz.healthCheck(),
    ctx.adapters.jev.healthCheck(),
    ctx.adapters.apify.healthCheck(),
    ctx.adapters.tinyfish.healthCheck(),
  ]);
  const adapters = [claude, postiz, jev, apify, tinyfish];

  // Pull last-known run state per module (empty if DB is down).
  let runRows: ModuleHealthRow[] = [];
  try {
    runRows = await createRepo(ctx.db).moduleHealth();
  } catch {
    // DB unreachable — health below will reflect it via `database`.
  }
  const byId = new Map(runRows.map((r) => [r.module_id, r]));

  const modules: ModuleHealth[] = MODULES.map((m) => {
    const last = byId.get(m.id);
    return {
      id: m.id, title: m.title, description: m.description,
      lastStatus: last?.status ?? 'never',
      lastRunAt: last?.started_at ?? null,
      durationMs: last?.duration_ms ?? null,
      itemsProcessed: last?.items_processed ?? null,
      message: last?.message ?? null,
      error: last?.error ?? null,
    };
  });

  // Overall = worst of (database, adapters). Module 'error' also degrades overall.
  const moduleReports: HealthReport[] = modules.map((m) => ({
    id: m.id,
    state: m.lastStatus === 'error' ? 'error' : m.lastStatus === 'degraded' ? 'degraded' : 'ok',
    message: m.message ?? '',
    checkedAt: m.lastRunAt ?? new Date().toISOString(),
  }));

  return {
    overall: rollup([database, ...adapters, ...moduleReports]),
    checkedAt: new Date().toISOString(),
    adapters, database, modules,
  };
}

/** Recent module runs across all modules, newest first — the System page's run log. */
export const getRunHistory = (ctx: ModuleContext, limit = 60) => createRepo(ctx.db).recentRuns(limit);

/** Approvals and runs as one newest-first feed. */
export const getActivity = (ctx: ModuleContext, limit = 60) => createRepo(ctx.db).activity(limit);
