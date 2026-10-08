// QC + Risk Gate (Bible §10) — the critical control. Uses the tested core logic.
// Honest-numbers: any unproven claim sends the draft back. Then it classifies an
// escalate-only approval lane and sends the draft to a human.
import { mapLimit, MODEL_CONCURRENCY } from '../map-limit.ts';
import type { Module, ModuleContext, ModuleResult } from './module.ts';
import { ok } from './module.ts';
import { createRepo, type ContentItemRow } from '../db/repo.ts';
import { createContentItems } from '../db/content-items.ts';
import { classifyLane, escalateLane, type ApprovalLane, hasUnprovenClaims, type Claim } from '../../core/src/index.ts';
import { decide, canDecide } from './decide.ts';
import { QC_SIGNALS } from './decision-tasks.ts';
import type { QcSignals } from './qc-parse.ts';

export const qcGateModule: Module = {
  id: 'qc_gate',
  title: 'QC + Risk Gate',
  description: 'Validates drafts, enforces honest-numbers, and assigns an escalate-only lane.',

  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const drafts = await createRepo(ctx.db).itemsByStatus('draft');
    let passed = 0, blocked = 0, signalFailures = 0;

    await mapLimit(drafts, MODEL_CONCURRENCY, async (item) => {
      const r = await qcItem(ctx, item);
      if (r.signalFailed) signalFailures++;
      if (r.outcome === 'blocked') blocked++;
      else passed++;
    });

    const message =
      `${passed} to approval, ${blocked} blocked for missing proof` +
      (signalFailures ? `; ${signalFailures} read on format rules only` : '');
    return ok(passed + blocked, message, { passed, blocked, signalFailures, scanned: drafts.length });
  },
};

/** QC one draft: blocked (unproven claims, stays 'draft') or sent to approval. */
export async function qcItem(ctx: ModuleContext, item: ContentItemRow): Promise<{ outcome: 'blocked' | 'to_approval'; signalFailed: boolean }> {
  const repo = createRepo(ctx.db);
  const claimRows = await repo.claimsFor(item.id);
  const claims: Claim[] = claimRows.map((c) => ({ claimText: c.claim_text, proofUrl: c.proof_url }));

  // Honest-numbers rule: any unproven claim sends it back to draft; operator must attach proof.
  if (hasUnprovenClaims(claims)) return { outcome: 'blocked', signalFailed: false };

  // Content signals read from the draft itself (LLM / Jev). A failure falls back to
  // format-only signals — still a human lane.
  let read: Partial<QcSignals> = {};
  let signalFailed = false;
  try {
    // Nothing configured → format rules only (below), no log row.
    if (canDecide(ctx)) read = await decide(ctx, QC_SIGNALS, item.id, item);
  } catch (e) {
    signalFailed = true;
    ctx.logger.warn(`qc signals ${item.id}: ${(e as Error).message}`);
  }

  // OR-merge: a model can only ADD risk signals on top of the format rules.
  const proposed = classifyLane({
    hasMetric: claims.length > 0 || read.hasMetric,
    isCaseStudy: read.isCaseStudy,
    mentionsFaceOrVoice: read.mentionsFaceOrVoice,
    hasClientClaim: read.hasClientClaim,
    isControversialOpinion: read.isControversialOpinion,
    isCompetitorComparison: read.isCompetitorComparison,
  });
  // Never downgrades a lane the item already has (e.g. sent back with 'changes').
  const current = item.approval_lane as ApprovalLane | null;
  const lane = current ? escalateLane(current, proposed) : proposed;

  await createContentItems(ctx.db).transition(item.id, { event: 'submit', lane });
  return { outcome: 'to_approval', signalFailed };
}
