// Aggregates everything the dashboard's Overview + visualizations need in one read:
// pipeline funnel, headline totals, pillar mix vs the Bible's target split (§5), and
// the performance roll-up. Pure reads — safe to call on every dashboard render.
import type { ModuleContext } from '../modules/module.ts';
import { createRepo, type PerformanceRow } from '../db/repo.ts';
import { CONTENT_STATUSES, LIVE_STATUSES } from '../../core/src/index.ts';
import { brand, pillarSlugs } from '../brand.ts';
import { loadBrand } from './brand-service.ts';

export interface FunnelStage {
  status: string;
  count: number;
}

export interface PillarMix {
  pillar: string;
  count: number;
  share: number;   // actual % of signed-off ideas, last 30 days
  target: number;  // Bible target %
}

/** Per-pillar share of the given counts vs the brand's target mix, in the brand's pillar order. */
export function pillarMix(rows: { pillar: string; count: number }[]): PillarMix[] {
  const total = rows.reduce((s, p) => s + p.count, 0);
  const byPillar = new Map(rows.map((p) => [p.pillar, p.count]));
  return pillarSlugs().map((pillar) => {
    const count = byPillar.get(pillar) ?? 0;
    const target = brand().pillars.find((p) => p.slug === pillar)?.target ?? 0;
    return { pillar, count, share: total ? Math.round((count / total) * 100) : 0, target };
  });
}

export interface OverviewTotals {
  items: number;
  drafts: number;
  needsApproval: number;
  published: number;
  topicsToReview: number;
  signalsWaiting: number;
}

export interface ContentOverview {
  funnel: FunnelStage[];          // pipeline order, zero-filled
  totals: OverviewTotals;
  pillarMix: PillarMix[];         // one row per PILLAR, target-joined
  performance: PerformanceRow[];  // latest metrics per published item
}

export async function getContentOverview(ctx: ModuleContext): Promise<ContentOverview> {
  await loadBrand(ctx);
  const repo = createRepo(ctx.db);
  const [counts, pillars, performance, reviewTopics, signals] = await Promise.all([
    repo.statusCounts(),
    repo.liveMix(30),
    repo.performance(),
    repo.reviewableTopics(),
    repo.unprocessedResearchInputs(),
  ]);

  const countMap = new Map(counts.map((c) => [c.status, c.count]));
  const funnel = CONTENT_STATUSES.map((s) => ({ status: s, count: countMap.get(s) ?? 0 }));

  const totalItems = counts.reduce((s, c) => s + c.count, 0);
  // Mix = signed-off ideas in the last 30 days, one per anchor — not drafts or per-platform copies.
  const mix = pillarMix(pillars);

  const totals: OverviewTotals = {
    items: totalItems,
    drafts: countMap.get('draft') ?? 0,
    needsApproval: countMap.get('needs_approval') ?? 0,
    published: LIVE_STATUSES.reduce((n, s) => n + (countMap.get(s) ?? 0), 0),
    topicsToReview: reviewTopics.length,
    signalsWaiting: signals.length,
  };

  return { funnel, totals, pillarMix: mix, performance };
}
