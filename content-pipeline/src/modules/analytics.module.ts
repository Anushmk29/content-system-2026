// Analytics Collector (Bible §14). First pulls live numbers for every recent post from Postiz
// (which reads them from LinkedIn / Instagram / X / Facebook through the same connected channel it
// posted on), then rolls up per-item performance, classifies each published
// item by the reach×engagement signal grid (Table 30), and marks it 'performance_captured'.
import type { Module, ModuleContext, ModuleResult } from './module.ts';
import { ok } from './module.ts';
import { createRepo } from '../db/repo.ts';
import { createContentItems } from '../db/content-items.ts';
import { performanceSignal } from '../../core/src/index.ts';

// Postiz allows 30 API calls an hour; 25 leaves room for publishing in the same hour.
const WINDOW_DAYS = 30, STALE_HOURS = 6, MAX_PULLS = 25;

async function pullStats(ctx: ModuleContext): Promise<{ pulled: number; failed: number }> {
  if (!ctx.adapters.postiz.configured) return { pulled: 0, failed: 0 };
  const repo = createRepo(ctx.db);
  let pulled = 0, failed = 0;
  for (const post of await repo.postsDueForStats(WINDOW_DAYS, STALE_HOURS, MAX_PULLS)) {
    try {
      const { metrics, raw } = await ctx.adapters.postiz.postStats(post.postiz_id);
      if (!Object.keys(metrics).length) continue; // not released yet, or the channel gives no stats
      // Qualified engagement is a human call ("comments that matter"); keep the last one given.
      await repo.insertMetrics({ contentItemId: post.id, ...metrics, qualifiedEngagement: post.qualified_engagement, raw });
      pulled++;
    } catch (e) {
      failed++;
      ctx.logger.warn(`post stats ${post.id}: ${(e as Error).message}`);
    }
  }
  return { pulled, failed };
}

export const analyticsModule: Module = {
  id: 'analytics',
  title: 'Analytics Collector',
  description: 'Pulls live post numbers from every platform via Postiz, then rolls up metrics per item and classifies the reach×engagement signal (Bible §14, Table 30).',

  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const { pulled, failed } = await pullStats(ctx);
    const pullNote = `pulled stats for ${pulled} post(s)` + (failed ? `, ${failed} failed` : '');

    const repo = createRepo(ctx.db);
    const items = createContentItems(ctx.db);
    const rows = await repo.publishedWithMetrics();

    const signals: Record<string, number> = {};
    for (const row of rows) {
      const signal = performanceSignal(row);
      signals[signal] = (signals[signal] ?? 0) + 1;
      await items.transition(row.id, { event: 'capture', signal });
    }

    const summary = Object.entries(signals).map(([k, v]) => `${v} ${k}`).join(', ');
    const message = rows.length ? `${pullNote}; captured ${rows.length} item(s): ${summary}` : `${pullNote}; none ready to capture`;
    return ok(pulled + rows.length, message, { pulled, failed, signals, captured: rows.length });
  },
};
