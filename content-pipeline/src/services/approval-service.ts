// Applies a human approval decision to a content item (Bible §10). Called by the
// dashboard approval route. The lifecycle module refuses illegal moves (e.g. approving an
// item already handed to Postiz) and writes status + approval + audit row together.
import type { ModuleContext } from '../modules/module.ts';
import { createRepo } from '../db/repo.ts';
import { createContentItems, IllegalTransition } from '../db/content-items.ts';
import { effectOfDecision, type ApprovalAction } from '../../core/src/index.ts';

export interface ApplyDecisionInput {
  itemId: string;
  action: ApprovalAction;
  decidedBy?: string | null;
  note?: string | null;
}

export interface ApplyDecisionResult {
  ok: boolean;
  /** A short human line shown back to the operator. */
  message: string;
  itemTitle?: string;
}

export async function applyApprovalDecision(
  ctx: ModuleContext,
  input: ApplyDecisionInput,
): Promise<ApplyDecisionResult> {
  const repo = createRepo(ctx.db);
  const item = await repo.getItem(input.itemId);
  if (!item) return { ok: false, message: `Item ${input.itemId} not found.` };

  const effect = effectOfDecision(input.action);
  if (!effect) return { ok: false, message: `Unknown action "${input.action}".`, itemTitle: item.title };

  // Idempotency: if the same decision already landed, don't double-write the log.
  if (item.approval_status === effect.approvalStatus && item.status === effect.status) {
    return { ok: true, message: `Already ${effect.approvalStatus}: ${item.title}`, itemTitle: item.title };
  }

  try {
    await createContentItems(ctx.db).transition(item.id, {
      event: input.action, decidedBy: input.decidedBy ?? null, note: input.note ?? null,
    });
  } catch (e) {
    if (e instanceof IllegalTransition) return { ok: false, message: `${e.message}: ${item.title}`, itemTitle: item.title };
    throw e;
  }

  const verb =
    input.action === 'approve' ? '✅ Approved'
    : input.action === 'reject' ? '❌ Rejected'
    : '✏️ Changes requested';
  return { ok: true, message: `${verb}: ${item.title}`, itemTitle: item.title };
}
