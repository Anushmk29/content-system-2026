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
import { humanScore, humanizeFeedback, HUMAN_MIN } from '../humanizer.ts';
import { reviseItem } from '../services/feedback-service.ts';
import { withCostScope } from '../cost-ledger.ts';

export const qcGateModule: Module = {
  id: 'qc_gate',
  title: 'QC + Risk Gate',
  description: 'Validates drafts, enforces honest-numbers, and assigns an escalate-only lane.',

  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const drafts = await createRepo(ctx.db).itemsByStatus('draft');
    let passed = 0, blocked = 0, signalFailures = 0;
    const failures: string[] = [];

    await mapLimit(drafts, MODEL_CONCURRENCY, async (item) => {
      try {
        const r = await qcItem(ctx, item);
        if (r.signalFailed) signalFailures++;
        if (r.outcome === 'blocked') blocked++;
        else passed++;
      } catch (e) {
        // One bad item (edited mid-run, DB hiccup) must not fail the rest; it stays a draft for next run.
        failures.push(`${item.id}: ${(e as Error).message}`);
      }
    });

    const message =
      `${passed} to approval, ${blocked} blocked for missing proof` +
      (signalFailures ? `; ${signalFailures} read on format rules only` : '') +
      (failures.length ? `; ${failures.length} failed` : '');
    const meta = { passed, blocked, signalFailures, failures, scanned: drafts.length };
    return failures.length ? { status: 'degraded', itemsProcessed: passed + blocked, message, meta } : ok(passed + blocked, message, meta);
  },
};

/** QC one draft: blocked (unproven claims, stays 'draft') or sent to approval. */
export async function qcItem(ctx: ModuleContext, item: ContentItemRow): Promise<{ outcome: 'blocked' | 'to_approval'; signalFailed: boolean }> {
  const repo = createRepo(ctx.db);
  const claimRows = await repo.claimsFor(item.id);
  const claims: Claim[] = claimRows.map((c) => ({ claimText: c.claim_text, proofUrl: c.proof_url }));

  // Honest-numbers rule: any unproven claim sends it back to draft; operator must attach proof.
  if (hasUnprovenClaims(claims)) return { outcome: 'blocked', signalFailed: false };

  item = await humanize(ctx, item);

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

/** content-humanizer: a draft that reads AI-written (under HUMAN_MIN) is rewritten once, through the
 *  same revise path as "Request changes". A failed rewrite keeps the original; the reviewer still sees the score. */
async function humanize(ctx: ModuleContext, item: ContentItemRow): Promise<ContentItemRow> {
  if (!ctx.env?.humanizeRewrite || !ctx.adapters.claude.configured) return item;
  const h = humanScore([item.hook, item.body, item.cta].filter(Boolean).join('\n\n'));
  if (h.score >= HUMAN_MIN) return item;
  // Once per post: a draft that keeps failing QC must not pay for a rewrite on every hourly run.
  const done = await ctx.db.query(`select 1 from content.cost_events where feature = 'humanize' and ref_type = 'content_item' and ref_id = $1 limit 1`, [item.id]);
  if (done.rowCount) return item;
  try {
    return await withCostScope({ feature: 'humanize', refType: 'content_item', refId: item.id },
      () => reviseItem(ctx, item, humanizeFeedback(h)));
  } catch (e) {
    ctx.logger.warn(`humanize ${item.id}: ${(e as Error).message}`);
    return item;
  }
}
