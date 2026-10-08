// Applies a human approval decision to a content item (Bible §10). Called by the
// dashboard approval route. The lifecycle module refuses illegal moves (e.g. approving an
// item already handed to Postiz) and writes status + approval + audit row together.
import type { ModuleContext } from '../modules/module.ts';
import { createRepo } from '../db/repo.ts';
import { createContentItems, IllegalTransition } from '../db/content-items.ts';
import { effectOfDecision, type ApprovalAction } from '../../core/src/index.ts';
import { randomUUID } from 'node:crypto';
import { feedbackText, reviseItem, refreshLessons } from './feedback-service.ts';
import { withCostScope } from '../cost-ledger.ts';

interface ApplyDecisionInput {
  itemId: string;
  action: ApprovalAction;
  decidedBy?: string | null;
  note?: string | null;
  /** One-click reasons (prompts/feedback.ts CHANGE_REASONS); joined with the note. */
  reasons?: unknown;
}

interface ApplyDecisionResult {
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

  const feedback = feedbackText(input.reasons, input.note);
  const effect = effectOfDecision(input.action);
  if (!effect) return { ok: false, message: `Unknown action "${input.action}".`, itemTitle: item.title };

  // Idempotency: if the same decision already landed, don't double-write the log.
  if (item.approval_status === effect.approvalStatus && item.status === effect.status) {
    return { ok: true, message: `Already ${effect.approvalStatus}: ${item.title}`, itemTitle: item.title };
  }

  try {
    await createContentItems(ctx.db).transition(item.id, {
      event: input.action, decidedBy: input.decidedBy ?? null, note: feedback || null,
    });
  } catch (e) {
    if (e instanceof IllegalTransition) return { ok: false, message: `${e.message}: ${item.title}`, itemTitle: item.title };
    throw e;
  }

  // Changes: rewrite this one post from the feedback (flagged). A failed rewrite keeps the old
  // text in draft for a hand edit, as before.
  let revised = '';
  if (input.action === 'changes' && feedback && ctx.env?.reviseOnChanges) {
    try {
      await withCostScope({ feature: 'revise', refType: 'content_item', refId: item.id }, () => reviseItem(ctx, item, feedback));
      revised = ' — rewritten with your feedback';
    }
    catch (e) { revised = ` — couldn't rewrite (${(e as Error).message}); edit it by hand`; }
  }
  // Every note teaches the next drafts (re-learned every few notes; never blocks the decision).
  if (input.action !== 'approve' && feedback) {
    void withCostScope({ feature: 'feedback_learn', refType: 'op', refId: randomUUID() }, () => refreshLessons(ctx));
  }

  const verb =
    input.action === 'approve' ? '✅ Approved'
    : input.action === 'reject' ? '❌ Rejected'
    : '✏️ Changes requested';
  return { ok: true, message: `${verb}: ${item.title}${revised}`, itemTitle: item.title };
}
