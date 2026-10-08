// Approval-lane logic (Bible §10). THE CRITICAL CONTROL.
// Invariant: approval can only ESCALATE, never downgrade.
import type { ApprovalLane } from './types.ts';

// Severity ordering: safe_auto < review < sensitive.
const LANE_RANK: Record<ApprovalLane, number> = {
  safe_auto: 0,
  review: 1,
  sensitive: 2,
};

/**
 * Escalate-only merge of two lanes. Returns whichever is MORE restrictive.
 * Used everywhere a lane might change — it is impossible to lower a lane.
 */
export function escalateLane(current: ApprovalLane, proposed: ApprovalLane): ApprovalLane {
  return LANE_RANK[proposed] > LANE_RANK[current] ? proposed : current;
}

// Signals the QC agent extracts from a draft (Bible §10 / qc-checklist.md).
export interface ContentSignals {
  mentionsFaceOrVoice?: boolean;
  hasClientClaim?: boolean;
  hasMetric?: boolean;
  isControversialOpinion?: boolean;
  isCaseStudy?: boolean;
  isCompetitorComparison?: boolean;
}

/** Classify the approval lane from QC signals (Bible §10.1 logic). safe_auto is never proposed. */
export function classifyLane(signals: ContentSignals): ApprovalLane {
  const sensitive =
    signals.mentionsFaceOrVoice ||
    signals.hasClientClaim ||
    signals.hasMetric ||
    signals.isControversialOpinion ||
    signals.isCaseStudy ||
    signals.isCompetitorComparison;
  if (sensitive) return 'sensitive';

  // Everything else — new posts, blogs, positioning — defaults to the safer side.
  return 'review';
}
