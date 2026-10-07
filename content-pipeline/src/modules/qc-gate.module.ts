// QC + Risk Gate (Bible §10) — the critical control. Uses the tested core logic.
// Honest-numbers: any unproven claim sends the draft back. Then it classifies an
// escalate-only approval lane. Earned safe_auto (Bible §17 phase 6, off by default):
// when CONTENT_ALLOW_SAFE_AUTO=true, template-based content derived from already-
// approved work skips human review and is auto-approved straight to the publish queue.
import type { Module, ModuleContext, ModuleResult } from './module.ts';
import { ok } from './module.ts';
import { createRepo, type ContentItemRow } from '../db/repo.ts';
import { createContentItems } from '../db/content-items.ts';
import { classifyLane, escalateLane, type ApprovalLane, hasUnprovenClaims, type Claim, APPROVED_STATUSES } from '../../core/src/index.ts';
import { decide, canDecide } from './decide.ts';
import { QC_SIGNALS } from './decision-tasks.ts';
import type { QcSignals } from './qc-parse.ts';

const TEMPLATE_FORMATS = new Set(['quote_card', 'stat_graphic']);

export const qcGateModule: Module = {
  id: 'qc_gate',
  title: 'QC + Risk Gate',
  description: 'Validates drafts, enforces honest-numbers, assigns an escalate-only lane, and auto-approves earned safe_auto items.',

  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const drafts = await createRepo(ctx.db).itemsByStatus('draft');
    let passed = 0, blocked = 0, autoApproved = 0, signalFailures = 0;

    for (const item of drafts) {
      const r = await qcItem(ctx, item);
      if (r.signalFailed) signalFailures++;
      if (r.outcome === 'blocked') blocked++;
      else if (r.outcome === 'auto_approved') autoApproved++;
      else passed++;
    }

    const message =
      `${passed} to approval, ${autoApproved} auto-approved (safe_auto), ${blocked} blocked for missing proof` +
      (signalFailures ? `; ${signalFailures} read on format rules only` : '');
    return ok(passed + autoApproved + blocked, message, { passed, autoApproved, blocked, signalFailures, scanned: drafts.length });
  },
};

/** QC one draft: blocked (unproven claims, stays 'draft'), sent to approval, or auto-approved. */
export async function qcItem(ctx: ModuleContext, item: ContentItemRow): Promise<{ outcome: 'blocked' | 'to_approval' | 'auto_approved'; signalFailed: boolean }> {
  const repo = createRepo(ctx.db);
  const claimRows = await repo.claimsFor(item.id);
  const claims: Claim[] = claimRows.map((c) => ({ claimText: c.claim_text, proofUrl: c.proof_url }));

  // Honest-numbers rule: any unproven claim sends it back to draft; operator must attach proof.
  if (hasUnprovenClaims(claims)) return { outcome: 'blocked', signalFailed: false };

  // Is this derived from already-approved/published work? (safe_auto precondition)
  let derivedFromApproved = false;
  if (item.anchor_id) {
    const anchor = await repo.getItem(item.anchor_id);
    derivedFromApproved = anchor != null && (APPROVED_STATUSES as readonly string[]).includes(anchor.status);
  }

  // Content signals read from the draft itself (LLM / Jev). A failure falls back to
  // format-only signals — still a human lane unless safe_auto was separately earned.
  let read: Partial<QcSignals> = {};
  let signalFailed = false;
  try {
    // Nothing configured → format rules only (below), no log row.
    if (canDecide(ctx, QC_SIGNALS)) read = await decide(ctx, QC_SIGNALS, item.id, item);
  } catch (e) {
    signalFailed = true;
    ctx.logger.warn(`qc signals ${item.id}: ${(e as Error).message}`);
  }

  // OR-merge: a model can only ADD risk signals on top of the format rules.
  const proposed = classifyLane(
    {
      hasMetric: claims.length > 0 || read.hasMetric,
      isCaseStudy: item.format === 'video' || read.isCaseStudy,
      mentionsFaceOrVoice: item.format === 'video' || item.format === 'reel_script' || read.mentionsFaceOrVoice,
      hasClientClaim: read.hasClientClaim,
      isControversialOpinion: read.isControversialOpinion,
      isCompetitorComparison: read.isCompetitorComparison,
      isNewPositioning: read.isNewPositioning,
      isTemplateBased: TEMPLATE_FORMATS.has(item.format),
      derivedFromApprovedContent: derivedFromApproved,
    },
    ctx.env.allowSafeAuto, // earned automation flag (Bible §17 phase 6)
  );
  // Never downgrades a lane the item already has (e.g. sent back with 'changes'); a first
  // pass has no lane yet, so the classification stands (else safe_auto could never be earned).
  const current = item.approval_lane as ApprovalLane | null;
  const lane = current ? escalateLane(current, proposed) : proposed;

  const items = createContentItems(ctx.db);
  if (lane === 'safe_auto') {
    // Earned: auto-approve straight to the publish queue (still re-checked by v_publish_ready).
    await items.transition(item.id, { event: 'auto_approve' });
    return { outcome: 'auto_approved', signalFailed };
  }
  await items.transition(item.id, { event: 'submit', lane });
  return { outcome: 'to_approval', signalFailed };
}
