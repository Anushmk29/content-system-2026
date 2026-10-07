// Bible Table 30 — what each reach×engagement quadrant means for next steps. Analytics stores
// the result on the item (content_items.performance_signal); readers prefer that stored value.
export type PerformanceSignal = 'repurpose' | 'awareness_only' | 'improve_hook' | 'archive';

export const HIGH_REACH = 1000;
// Engaged = beat your own usual (vs_usual ≥ 1, from own-account results); before those exist,
// a fixed bar on hand-entered qualified engagement.
export const HIGH_ENGAGEMENT = 20;

export function performanceSignal(r: {
  reach?: number | string | null; impressions?: number | string | null; qualified_engagement?: number | string | null;
  vs_usual?: number | string | null;
}): PerformanceSignal {
  const highReach = Number(r.reach ?? r.impressions ?? 0) >= HIGH_REACH;
  const engaged = r.vs_usual != null ? Number(r.vs_usual) >= 1 : Number(r.qualified_engagement ?? 0) >= HIGH_ENGAGEMENT;
  if (highReach && engaged) return 'repurpose';           // carousel, video, email
  if (highReach) return 'awareness_only';                 // reached people, nobody bit
  if (engaged) return 'improve_hook';                     // the few who saw it cared: re-format & repost
  return 'archive';
}

/** Posting cadence the dashboard measures against (posts per week, all platforms). */
export const WEEKLY_POST_TARGET = 5;
