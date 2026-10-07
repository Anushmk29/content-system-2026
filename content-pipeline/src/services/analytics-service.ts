// Analytics page: totals, trend series, best performers and per-platform/pillar roll-ups over a
// 7/30/90-day window. Engagement = likes + comments + shares; "x your usual" = likes over the
// client's own median on that platform (Own Results scrape). Plus manual metrics entry.
import type { ModuleContext } from '../modules/module.ts';
import { createRepo, type PerformanceRow, type SeriesRow } from '../db/repo.ts';
import { LIVE_STATUSES } from '../../core/src/index.ts';

export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

type PostRow = PerformanceRow & { published_at: string | null; clicks: number | null };

export interface Breakdown { key: string; posts: number; reach: number; engagement: number; vsUsual: number | null }
export interface FormatStat { name: string; posts: number; vsUsual: number | null }
export interface OwnResults {
  /** Brand Kit has own accounts to scrape */
  ready: boolean;
  lastRun: { id: string; status: string; stage: string; started_at: string; finished_at: string | null; total: number; cost: number } | null;
  baseline: { platform: string; median_reactions: number; posts: number }[];
}

export interface Analytics {
  range: AnalyticsRange;
  totals: { published: number; reach: number; engagement: number; clicks: number; engagementPerPost: number | null; vsUsual: number | null };
  series: SeriesRow[];
  posts: PostRow[];
  bestByUsual: PostRow[];
  bestByReach: PostRow[];
  bestByEngagement: PostRow[];
  byPlatform: Breakdown[];
  byPillar: Breakdown[];
  formats: { yours: FormatStat[]; theirs: FormatStat[] };
  own: OwnResults;
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const reachOf = (p: PerformanceRow) => n(p.reach ?? p.impressions);
export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return Math.round((s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) * 100) / 100;
};
const vsOf = (ps: PerformanceRow[]) => median(ps.flatMap((p) => (p.vs_usual == null ? [] : [Number(p.vs_usual)])));

export function breakdown(posts: PerformanceRow[], key: 'platform' | 'pillar'): Breakdown[] {
  const m = new Map<string, PerformanceRow[]>();
  for (const p of posts) m.set(p[key], [...(m.get(p[key]) ?? []), p]);
  return [...m.entries()].map(([k, ps]) => ({
    key: k, posts: ps.length, reach: ps.reduce((s, p) => s + reachOf(p), 0),
    engagement: ps.reduce((s, p) => s + n(p.engagement), 0), vsUsual: vsOf(ps),
  })).sort((a, b) => (b.vsUsual ?? -1) - (a.vsUsual ?? -1) || b.engagement - a.engagement || b.reach - a.reach);
}

/** Latest scrape of our own accounts, and "your usual" per platform from it. */
export async function getOwnResults(ctx: ModuleContext): Promise<OwnResults> {
  const [self, run, baseline] = await Promise.all([
    ctx.db.query<{ n: number }>(`select count(*)::int as n from content.competitors where is_self and handles <> '{}'::jsonb`),
    ctx.db.query<NonNullable<OwnResults['lastRun']>>(
      `select r.id, r.status, r.stage, r.started_at::text, r.finished_at::text, r.total, (r.cost_ai_usd + r.cost_apify_usd)::float8 as cost
       from content.decode_runs r where exists (select 1 from content.competitors s where s.is_self and s.id = any(r.competitor_ids))
       order by r.started_at desc limit 1`),
    ctx.db.query<OwnResults['baseline'][number]>(`select platform, median_reactions, posts from content.v_own_baseline order by platform`),
  ]);
  return { ready: self.rows[0]!.n > 0, lastRun: run.rows[0] ?? null, baseline: baseline.rows };
}

/** Median "x usual" per format in the latest own scrape vs the latest competitor Decode. */
async function formatStats(ctx: ModuleContext, self: boolean): Promise<FormatStat[]> {
  return (await ctx.db.query<FormatStat>(
    `select f.name, count(*)::int as posts, (percentile_cont(0.5) within group (order by p.vs_own_median))::numeric(10,2)::float8 as "vsUsual"
     from content.decoded_posts p join content.decode_formats f on f.id = p.format_id
     where p.run_id = (select r.id from content.decode_runs r
                       where r.decoded > 0 and ${self ? '' : 'not '}exists (select 1 from content.competitors s where s.is_self and s.id = any(r.competitor_ids))
                       order by r.started_at desc limit 1)
     group by f.name order by 3 desc nulls last limit 10`)).rows;
}

export async function getAnalytics(ctx: ModuleContext, range: AnalyticsRange): Promise<Analytics> {
  const repo = createRepo(ctx.db);
  const bucket = range === 90 ? 'week' : 'day';
  const [posts, series, yours, theirs, own] = await Promise.all([
    repo.performanceSince(range),
    repo.series(bucket, range === 90 ? 13 : range),
    formatStats(ctx, true), formatStats(ctx, false), getOwnResults(ctx),
  ]);
  const top = (f: (p: PostRow) => number) => posts.filter((p) => f(p) > 0).sort((a, b) => f(b) - f(a)).slice(0, 3);
  const engagement = posts.reduce((s, p) => s + n(p.engagement), 0);
  return {
    range,
    totals: {
      published: posts.length,
      reach: posts.reduce((s, p) => s + reachOf(p), 0),
      engagement,
      clicks: posts.reduce((s, p) => s + n(p.clicks), 0),
      engagementPerPost: posts.length ? Math.round(engagement / posts.length) : null,
      vsUsual: vsOf(posts),
    },
    series,
    posts,
    bestByUsual: top((p) => n(p.vs_usual)),
    bestByReach: top(reachOf),
    bestByEngagement: top((p) => n(p.engagement)),
    byPlatform: breakdown(posts, 'platform'),
    byPillar: breakdown(posts, 'pillar'),
    formats: { yours, theirs },
    own,
  };
}

const METRIC_FIELDS = ['impressions', 'reach', 'likes', 'comments', 'shares', 'saves', 'clicks', 'qualifiedEngagement'] as const;
export type MetricsInput = Partial<Record<(typeof METRIC_FIELDS)[number], unknown>>;

/** Hand-entered post metrics (e.g. copied from LinkedIn). Only for items that are live. */
export async function recordMetrics(ctx: ModuleContext, itemId: string, input: MetricsInput): Promise<{ ok: boolean; message: string }> {
  const repo = createRepo(ctx.db);
  const item = await repo.getItem(itemId);
  if (!item) return { ok: false, message: 'Item not found.' };
  if (!(LIVE_STATUSES as readonly string[]).includes(item.status)) return { ok: false, message: 'Metrics can only be added to published items.' };
  const m: Record<string, number | null> = {};
  for (const f of METRIC_FIELDS) {
    const v = input[f];
    if (v === undefined || v === null || v === '') { m[f] = null; continue; }
    const num = Number(v);
    if (!Number.isInteger(num) || num < 0) return { ok: false, message: `${f} must be a whole number ≥ 0` };
    m[f] = num;
  }
  if (Object.values(m).every((v) => v === null)) return { ok: false, message: 'Enter at least one number.' };
  await repo.insertMetrics({ contentItemId: itemId, ...m });
  return { ok: true, message: 'Metrics saved' };
}
