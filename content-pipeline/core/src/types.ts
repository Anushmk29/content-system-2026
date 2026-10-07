// Shared types — mirror the DB enums in db/schema.sql.
// Using const-object + union types (not TS `enum`) so the module runs under
// Node's native type-stripping with zero build step.

export const PILLARS = [
  'practical_ai_for_operators',
  'proof_and_use_cases',
  'founder_build_notes',
  'ai_readiness_and_offer',
] as const;
export type Pillar = (typeof PILLARS)[number];

export const FUNNEL_STAGES = [
  'awareness', 'education', 'trust', 'consideration', 'conversion', 'retention',
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const PLATFORMS = [
  'blog', 'linkedin', 'x', 'instagram', 'facebook', 'reddit', 'email', 'youtube',
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const APPROVAL_LANES = ['safe_auto', 'review', 'sensitive'] as const;
export type ApprovalLane = (typeof APPROVAL_LANES)[number];

export const APPROVAL_STATUSES = [
  'not_required', 'pending', 'approved', 'rejected', 'changes_requested',
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

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
