// Weekly Review Agent (Bible §14.1) — closes the learning loop. Feeds the period's
// performance roll-up + pillar usage to the LLM, which returns concrete next-week
// recommendations. Each becomes an operator todo (so the loop produces action, not
// just a report).
import type { Module, ModuleContext, ModuleResult } from './module.ts';
import { ok, degraded, skipped } from './module.ts';
import { createRepo, type PerformanceRow } from '../db/repo.ts';
import { reviewSystem, buildReviewPrompt } from '../prompts/brand-brain.ts';
import { parseReview } from './review-parse.ts';
import { performanceSignal, LIVE_STATUSES } from '../../core/src/index.ts';

function summarize(perf: PerformanceRow[], pillars: { pillar: string; count: number }[]): string {
  // Analytics' frozen signal where it has run; live classification for items not yet captured.
  const signalOf = (r: PerformanceRow) => r.performance_signal ?? performanceSignal(r);
  // Best first by "x your usual" when own results exist, else by raw engagement.
  const top = [...perf]
    .sort((a, b) => (Number(b.vs_usual ?? -1) - Number(a.vs_usual ?? -1)) || (Number(b.engagement ?? 0) - Number(a.engagement ?? 0)))
    .slice(0, 10)
    .map((r) =>
      `- ${r.platform} · "${r.title}" — ${r.vs_usual != null ? `${r.vs_usual}x your usual, ` : ''}reach ${r.reach ?? r.impressions ?? 0}, ` +
      `engagement ${r.engagement ?? 0} (comments ${r.comments ?? 0}, shares ${r.shares ?? 0}), qualified ${r.qualified_engagement ?? 0} → ${signalOf(r)}`)
    .join('\n');
  const signals: Record<string, number> = {};
  for (const r of perf) signals[signalOf(r)] = (signals[signalOf(r)] ?? 0) + 1;
  const signalLine = Object.entries(signals).map(([k, v]) => `${k}: ${v}`).join(', ');
  const pillarLine = pillars.map((p) => `${p.pillar}: ${p.count}`).join(', ');
  return `TOP ITEMS:\n${top || '(none)'}\n\n` +
    `SIGNALS (reach×engagement — repurpose / improve_hook / awareness_only / archive): ${signalLine || '(none)'}\n\n` +
    `PILLAR USAGE: ${pillarLine || '(none)'}`;
}

export const weeklyReviewModule: Module = {
  id: 'weekly_review',
  title: 'Weekly Review Agent',
  description: 'Recommends next week’s priorities from reach + engagement, creating todos (Bible §14.1).',

  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const repo = createRepo(ctx.db);
    // It sits in the frequent /run pipeline, so it gates itself: one review per 7 days
    // (otherwise every run is an LLM call plus duplicate todos).
    const last = await repo.lastProductiveRun('weekly_review', 7);
    if (last) return skipped(`already reviewed this week (${last.slice(0, 10)}); next review 7 days after that`);

    // Only review items that have actually been out in the world (the view includes drafts).
    const perf = (await repo.performance()).filter(
      (r) => (LIVE_STATUSES as readonly string[]).includes(r.status),
    );
    const pillars = await repo.pillarUsage();

    if (perf.length === 0) return ok(0, 'no published performance yet — nothing to review');
    if (!ctx.adapters.claude.configured) {
      return degraded('performance data present but no LLM configured to generate recommendations');
    }

    const raw = await ctx.adapters.claude.complete(
      buildReviewPrompt(summarize(perf, pillars)),
      { system: reviewSystem() },
    );
    const review = parseReview(raw);

    for (const rec of review.recommendations) {
      await repo.createTodo({ title: rec, detail: 'Weekly review recommendation (Bible §14.1)', priority: 2 });
    }

    return ok(review.recommendations.length,
      `created ${review.recommendations.length} recommendation todo(s)`,
      { summary: review.summary });
  },
};
