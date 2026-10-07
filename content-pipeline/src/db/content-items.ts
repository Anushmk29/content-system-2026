// Content item lifecycle: the ONLY writer of content_items status / approval columns.
// Callers send an event; the status move is a compare-and-set against the legal `from`
// states (core CONTENT_EVENTS), and everything an event touches (status, approval
// columns, approval log) commits in one transaction or not at all.
import type { Db } from './client.ts';
import type { NewContentItem } from './repo.ts';
import { CONTENT_EVENTS, APPROVAL_STATUS_OF, type ApprovalLane, type ContentEvent } from '../../core/src/index.ts';

export type Transition =
  | { event: 'submit'; lane: ApprovalLane }
  | { event: 'auto_approve' }
  | { event: 'approve' | 'changes' | 'reject'; decidedBy?: string | null; note?: string | null }
  | { event: 'schedule'; postizId: string; utmUrl: string; scheduledAt: string }
  | { event: 'capture'; signal: string };

export class IllegalTransition extends Error {
  /** Current status, or null if the item doesn't exist. */
  readonly status: string | null;
  constructor(itemId: string, event: ContentEvent, status: string | null) {
    super(status == null ? `content item ${itemId} not found` : `can't ${event} a content item that is ${status}`);
    this.status = status;
  }
}

export function createContentItems(db: Db) {
  return {
    /** Anchor first (pieces[0]), children linked to it, every claim attached unproven to every
     *  piece, and the topic marked 'used' — all or nothing. Returns the new ids, anchor first. */
    createDraftSet: (topicId: string, pieces: NewContentItem[], claims: string[]) =>
      db.tx(async (q) => {
        const used = await q.query(
          `update content.topics set status = 'used' where id = $1 and status = 'selected'`, [topicId]);
        if (!used.rowCount) throw new Error(`topic ${topicId} is not 'selected' (already drafted?)`);
        const ids: string[] = [];
        for (const p of pieces) {
          const r = await q.query<{ id: string }>(
            `insert into content.content_items
               (topic_id, anchor_id, title, pillar, funnel_stage, platform, format,
                hook, cta, body, source_material, risk_level, owner, offer_idx, hook_ref, status)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'draft') returning id`,
            [topicId, ids[0] ?? null, p.title, p.pillar, p.funnelStage, p.platform, p.format,
             p.hook ?? null, p.cta ?? null, p.body ?? null, p.sourceMaterial ?? null, p.riskLevel ?? null, p.owner ?? null, p.offerIdx ?? null, p.hookRef ?? null],
          );
          ids.push(r.rows[0]!.id);
        }
        for (const id of ids) {
          for (const c of claims) {
            await q.query(`insert into content.claims (content_item_id, claim_text) values ($1,$2)`, [id, c]);
          }
        }
        return ids;
      }),

    /** Apply one lifecycle event. Throws IllegalTransition if the item isn't in a legal `from` state. */
    transition: (id: string, t: Transition) =>
      db.tx(async (q) => {
        const { from, to } = CONTENT_EVENTS[t.event];
        let set = '', params: unknown[] = [];
        switch (t.event) {
          case 'submit': set = `, approval_lane = $4, approval_status = 'pending'`; params = [t.lane]; break;
          case 'auto_approve': set = `, approval_lane = 'safe_auto', approval_status = 'not_required'`; break;
          case 'approve': case 'changes': case 'reject':
            // lane never changes on a human decision (escalate-only)
            set = `, approval_lane = coalesce(approval_lane, 'review'), approval_status = $4`;
            params = [APPROVAL_STATUS_OF[t.event]]; break;
          case 'schedule': set = `, postiz_id = $4, utm_url = $5, scheduled_at = $6`; params = [t.postizId, t.utmUrl, t.scheduledAt]; break;
          case 'capture': set = `, performance_signal = $4`; params = [t.signal]; break;
        }
        const r = await q.query<{ approval_lane: string; approval_status: string }>(
          `update content.content_items set status = $2 ${set}
            where id = $1 and status::text = any($3::text[])
            returning approval_lane, approval_status`,
          [id, to, from, ...params],
        );
        if (!r.rowCount) {
          const cur = await q.query<{ status: string }>(`select status from content.content_items where id = $1`, [id]);
          throw new IllegalTransition(id, t.event, cur.rows[0]?.status ?? null);
        }
        if (t.event === 'auto_approve' || t.event === 'approve' || t.event === 'changes' || t.event === 'reject') {
          const row = r.rows[0]!;
          await q.query(
            `insert into content.approvals (content_item_id, lane, decision, decided_by, note, decided_at)
             values ($1,$2,$3,$4,$5, now())`,
            [id, row.approval_lane, row.approval_status,
             t.event === 'auto_approve' ? 'safe_auto' : t.decidedBy ?? null,
             t.event === 'auto_approve' ? null : t.note ?? null],
          );
        }
      }),

    /** Queued items whose slot has passed → 'published' (Analytics picks them up).
     *  ponytail: trusts Postiz posted on time; read Postiz post status if posts start failing silently. */
    goLiveDue: () =>
      db.query(
        `update content.content_items set status = 'published', published_at = coalesce(scheduled_at, now())
          where status = 'queued' and coalesce(scheduled_at, updated_at) <= now()`,
      ).then((r) => r.rowCount),
  };
}
