// Resolve one post's claims without bypassing proof or human approval.
import type { ModuleContext } from '../modules/module.ts';
import { createRepo, type ClaimRow, type ContentItemRow } from '../db/repo.ts';
import { createContentItems } from '../db/content-items.ts';

const textCopy = (value: unknown): { hook: string; body: string; cta: string } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Send the hook, body and call to action.');
  const c = value as Record<string, unknown>;
  for (const k of ['hook', 'body', 'cta']) {
    if (typeof c[k] !== 'string' || c[k].length > 20_000) throw new Error(`${k} must be text under 20000 chars`);
  }
  return c as { hook: string; body: string; cta: string };
};

export async function updateClaim(ctx: ModuleContext, itemId: string, input: unknown, decidedBy: string | null = null): Promise<{ ok: boolean; message: string }> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Send a claim update.');
  const p = input as Record<string, unknown>;
  if (typeof p.id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(p.id)) throw new Error('Choose a valid claim.');
  if (p.action !== 'proof' && p.action !== 'remove') throw new Error('Choose whether to save proof or remove a corrected claim.');

  let proof: string | null = null;
  if (p.action === 'proof') {
    if (p.proofUrl !== null && typeof p.proofUrl !== 'string') throw new Error('Proof must be a web link.');
    proof = typeof p.proofUrl === 'string' ? p.proofUrl.trim() || null : null;
    if (proof) {
      let url: URL;
      try { url = new URL(proof); } catch { throw new Error('Use a full proof link starting with https:// or http://'); }
      if (proof.length > 2048 || !/^https?:\/\//i.test(proof) || /[\s\u0000-\u001f\u007f]/.test(proof) || !['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
        throw new Error('Use a full web link without a username or password (2048 characters max).');
      }
    }
  }
  const copy = p.action === 'remove' ? textCopy(p.copy) : null;
  const original = p.action === 'remove' ? textCopy(p.originalCopy) : null;
  if (copy && !copy.body.trim()) throw new Error('The revised post needs a body.');
  if (p.action === 'remove' && (p.confirmed !== true || typeof p.note !== 'string' || !p.note.trim() || p.note.length > 1000)) {
    throw new Error('Confirm the claim was removed from the copy and explain what changed (1000 characters max).');
  }

  return ctx.db.tx(async (db) => {
    // Use the same row lock as scheduling so a claim cannot change as a post is booked.
    const item = (await db.query<ContentItemRow>('select * from content.content_items where id = $1 for update', [itemId])).rows[0];
    if (!item) throw new Error('Not found.');
    if (!['draft', 'needs_approval', 'approved'].includes(item.status) || item.postiz_id) {
      return { ok: false, message: 'Claims are locked once a post has been sent for publishing.' };
    }
    const claim = (await db.query<ClaimRow>('select * from content.claims where id = $1 and content_item_id = $2 for update', [p.id, itemId])).rows[0];
    if (!claim) throw new Error('Not found.');
    if (p.action === 'proof' && proof === claim.proof_url) return { ok: true, message: proof ? 'This proof is already saved.' : 'This claim already has no proof.' };

    if (copy && original) {
      const keys = ['hook', 'body', 'cta'] as const;
      if (keys.some((k) => original[k] !== (item[k] ?? ''))) throw new Error('The post changed while you were editing. Reload it before resolving this claim.');
      if (keys.every((k) => copy[k] === original[k])) throw new Error('Correct the post copy before removing its claim.');
      const normal = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
      if (normal([copy.hook, copy.body, copy.cta].join('\n')).includes(normal(claim.claim_text))) {
        throw new Error('The revised post still contains this claim. Remove or correct it first.');
      }
      // shortcut: paraphrased claims need the operator's confirmation; add semantic checks if manual review proves insufficient.
    }
    const note = p.action === 'remove'
      ? `Claim removed after copy correction: ${claim.claim_text}\nReason: ${(p.note as string).trim()}`
      : `${proof ? 'Proof saved' : 'Proof cleared'} for claim: ${claim.claim_text}${proof ? `\n${proof}` : ''}`;
    if (item.status !== 'draft') {
      await createContentItems(db).transition(itemId, { event: 'changes', decidedBy, note });
    } else {
      await db.query(`insert into content.approvals (content_item_id, lane, decision, decided_by, note, decided_at)
        values ($1, $2, 'changes_requested', $3, $4, now())`, [itemId, item.approval_lane ?? 'review', decidedBy, note]);
    }
    if (copy) {
      const saved = await createRepo(db).updateItemCopy(itemId, copy);
      if (!saved) throw new Error('The post is no longer editable. Reload it before resolving this claim.');
      await db.query('delete from content.claims where id = $1 and content_item_id = $2', [p.id, itemId]);
    } else {
      await db.query('update content.claims set proof_url = $3, verified = false where id = $1 and content_item_id = $2', [p.id, itemId, proof]);
    }
    await db.query('update content.content_items set updated_at = now() where id = $1', [itemId]);
    return { ok: true, message: copy ? 'Corrected copy saved and claim removed. Send this post for review.' : proof ? 'Proof saved. Resolve any other claims, then send this post for review.' : 'Proof cleared. Add evidence before sending this post for review.' };
  });
}
