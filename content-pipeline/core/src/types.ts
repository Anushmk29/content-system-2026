// Shared types — mirror the DB enums in db/schema.sql.
// Using const-object + union types (not TS `enum`) so the module runs under
// Node's native type-stripping with zero build step.

export const FUNNEL_STAGES = [
  'awareness', 'education', 'trust', 'consideration', 'conversion', 'retention',
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export const isFunnelStage = (x: unknown): x is FunnelStage =>
  typeof x === 'string' && (FUNNEL_STAGES as readonly string[]).includes(x);

export const PLATFORMS = [
  'blog', 'linkedin', 'x', 'instagram', 'facebook', 'reddit', 'email', 'youtube',
] as const;
export type Platform = (typeof PLATFORMS)[number];

export type ApprovalLane = 'safe_auto' | 'review' | 'sensitive';
export type ApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected' | 'changes_requested';

export const CONTENT_STATUSES = [
  'idea', 'draft', 'qc_passed', 'needs_approval', 'approved',
  'queued', 'published', 'performance_captured', 'archived',
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

// A single proof-backed claim (Bible §7 / §10.3 honest-numbers rule).
export interface Claim {
  claimText: string;
  proofUrl: string | null;   // null/empty => unproven => blocks publish
}

/** The 1-5 scale used by topic and lead scores: any value → an integer in [1,5] (garbage → 1). */
export function clamp1to5(n: unknown): number {
  const x = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(x)) return 1;
  return Math.min(5, Math.max(1, Math.round(x)));
}

/** Statuses whose copy and creative can still be edited (locked once approved). */
export const EDITABLE_STATUSES: readonly string[] = ['idea', 'draft', 'qc_passed', 'needs_approval'];

export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
