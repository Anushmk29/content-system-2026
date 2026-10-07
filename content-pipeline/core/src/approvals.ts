// Approval-decision logic (Bible §10). The human decides in the dashboard; each button is a
// lifecycle event (lifecycle.ts), plus the approval_status it records.
import type { ContentStatus, ApprovalStatus } from './types.ts';
import { CONTENT_EVENTS } from './lifecycle.ts';

// The three buttons the approval queue offers.
export const APPROVAL_ACTIONS = ['approve', 'changes', 'reject'] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

export interface DecisionEffect {
  /** content_items.status after the decision. */
  status: ContentStatus;
  /** content_items.approval_status after the decision. */
  approvalStatus: ApprovalStatus;
}

// approve  → ready to publish (publisher still re-checks honest-numbers via v_publish_ready).
// changes  → back to draft for rework; the QC gate will re-evaluate it.
// reject   → archived; it leaves the active pipeline.
export const APPROVAL_STATUS_OF: Record<ApprovalAction, ApprovalStatus> = {
  approve: 'approved',
  changes: 'changes_requested',
  reject: 'rejected',
};

export function isApprovalAction(x: string): x is ApprovalAction {
  return (APPROVAL_ACTIONS as readonly string[]).includes(x);
}

/** Map an approval button to its status-machine effect, or null if unknown. */
export function effectOfDecision(action: string): DecisionEffect | null {
  return isApprovalAction(action)
    ? { status: CONTENT_EVENTS[action].to, approvalStatus: APPROVAL_STATUS_OF[action] }
    : null;
}
