// Hunt score: which competitor posts are worth copying. Ported from competitor-hunter's `rank`
// (hunt.py, MIT, Charles Dove), with fit built from Jev answers to Brand-Kit questions.
//   demand = 0.5·min(breakout/8, 1) + 0.25·ER percentile + 0.25·reach percentile (within platform)
//   fit    = weighted(icp_fit, proof, replicable, freshness) × (1 − P(off_niche))
//   hunt   = 100·√(demand·fit), or 100·demand when Jev didn't judge the post
// Paid filter: engagement rate under 0.2%, or under 0.6% while breaking out 3×+ (bought reach),
// or Jev says sponsored.
import type { JevAnswer } from '../adapters/jev.ts';

export interface HuntInput {
  id: string; platform: string; views: number | null; reactions: number; comments: number; shares: number;
  breakout: number | null; postedAt: string | null; jev: Record<string, JevAnswer> | null;
}
export interface HuntScore { id: string; demand: number; fit: number | null; hunt: number; paid: boolean }

const FIT_W = { icp: 0.4, replicable: 0.25, proof: 0.2, fresh: 0.15 };
const SCORE_LEVELS = 4;

/** Share of `xs` strictly below `x` (0–1); 0.5 when there's nothing to compare. */
function pct(x: number | null, xs: number[]): number {
  if (x == null || xs.length < 2) return 0.5;
  return xs.filter((v) => v < x).length / (xs.length - 1);
}

export const engagementRate = (p: HuntInput) =>
  p.views ? (p.reactions + p.comments + p.shares) / p.views : null;

export function jevFit(a: Record<string, JevAnswer>, postedAt: string | null, now: Date): number {
  const lvl = (k: string) => Math.min(1, Math.max(0, (a[k]?.score ?? 0) / (SCORE_LEVELS - 1)));
  const ageDays = postedAt ? (now.getTime() - new Date(postedAt).getTime()) / 86_400_000 : 90;
  const fresh = Math.max(0, 1 - ageDays / 90);
  const offNiche = a.lane?.probabilities?.off_niche ?? (a.lane?.choice === 'off_niche' ? 1 : 0);
  const raw = FIT_W.icp * lvl('icp_fit') + FIT_W.proof * lvl('proof') + FIT_W.replicable * (a.replicable?.noul ?? 0) + FIT_W.fresh * fresh;
  return raw * (1 - offNiche);
}

export function huntScores(posts: HuntInput[], now = new Date()): HuntScore[] {
  const byPlatform = new Map<string, HuntInput[]>();
  for (const p of posts) byPlatform.set(p.platform, [...(byPlatform.get(p.platform) ?? []), p]);
  return posts.map((p) => {
    const peers = byPlatform.get(p.platform)!;
    const er = engagementRate(p);
    const ers = peers.map(engagementRate).filter((v): v is number => v != null);
    const reach = (q: HuntInput) => q.views ?? q.reactions;
    const demand = 0.5 * Math.min((p.breakout ?? 0) / 8, 1) + 0.25 * pct(er, ers) + 0.25 * pct(reach(p), peers.map(reach));
    const fit = p.jev ? jevFit(p.jev, p.postedAt, now) : null;
    const paid = (er != null && (er < 0.002 || (er < 0.006 && (p.breakout ?? 0) > 3))) || (p.jev?.sponsored?.noul ?? 0) >= 0.8;
    const hunt = 100 * (fit == null ? demand : Math.sqrt(demand * fit));
    return { id: p.id, demand: round(demand), fit: fit == null ? null : round(fit), hunt: round(hunt), paid };
  });
}

const round = (n: number) => Math.round(n * 1000) / 1000;
