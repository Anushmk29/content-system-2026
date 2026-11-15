'use client';
import { useState } from 'react';
import { useAction } from './actions';

export function ClaimEditor({ itemId, claim, hook, body, cta }: {
  itemId: string; claim: { id: string; claim_text: string; proof_url: string | null };
  hook: string; body: string; cta: string;
}) {
  // Claim edits change review state; reload so the next review controls appear together.
  const a = useAction({ reload: true });
  const [proof, setProof] = useState(claim.proof_url ?? '');
  const [originalCopy] = useState({ hook, body, cta });
  const [copy, setCopy] = useState(originalCopy);
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const changed = copy.hook !== originalCopy.hook || copy.body !== originalCopy.body || copy.cta !== originalCopy.cta;
  const path = `/content/api/items/${itemId}`;
  return (
    <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
      <p style={{ margin: 0, overflowWrap: 'anywhere' }}>{claim.claim_text}</p>
      {claim.proof_url
        ? <a href={claim.proof_url} target="_blank" rel="noreferrer" style={{ overflowWrap: 'anywhere' }}>Open saved proof ↗</a>
        : <span style={{ color: 'var(--danger)', fontSize: 12.5 }}>No proof — this claim blocks publishing.</span>}
      <form style={{ display: 'grid', gap: 8 }} onSubmit={(e) => {
        e.preventDefault();
        void a.call('proof', 'PATCH', path, { claim: { id: claim.id, action: 'proof', proofUrl: proof.trim() || null } });
      }}>
        <label style={{ display: 'grid', gap: 4 }}>Proof link
          <input className="input" type="url" maxLength={2048} placeholder="https://source.example/evidence" value={proof} onChange={(e) => setProof(e.target.value)} />
        </label>
        <div><button type="submit" className="btn" disabled={a.pending || proof.trim() === (claim.proof_url ?? '')}>
          {a.busy === 'proof' ? 'Saving…' : proof.trim() ? 'Save proof' : 'Clear proof'}
        </button></div>
      </form>
      <details>
        <summary style={{ cursor: 'pointer' }}>Correct or remove this claim</summary>
        <p style={{ fontSize: 12.5 }}>Change the copy so this claim is no longer made. Saving records your reason and returns the post to draft for fresh review.</p>
        <form style={{ display: 'grid', gap: 8 }} onSubmit={(e) => {
          e.preventDefault();
          void a.call('remove', 'PATCH', path, { claim: { id: claim.id, action: 'remove', copy, originalCopy, note, confirmed } });
        }}>
          <label style={{ display: 'grid', gap: 4 }}>Revised hook
            <input className="input" maxLength={20_000} value={copy.hook} onChange={(e) => setCopy({ ...copy, hook: e.target.value })} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>Revised body
            <textarea className="input" required maxLength={20_000} value={copy.body} onChange={(e) => setCopy({ ...copy, body: e.target.value })} style={{ minHeight: 180 }} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>Revised call to action
            <input className="input" maxLength={20_000} value={copy.cta} onChange={(e) => setCopy({ ...copy, cta: e.target.value })} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>What changed and why?
            <textarea className="input" required maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input type="checkbox" required checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I checked that this claim is no longer made anywhere in the revised post.
          </label>
          <div><button type="submit" className="btn btn-danger" disabled={a.pending || !changed || !copy.body.trim() || !confirmed || !note.trim()}>
            {a.busy === 'remove' ? 'Saving…' : 'Save corrected copy and remove claim'}
          </button></div>
        </form>
      </details>
      <span>{a.feedback}</span>
    </div>
  );
}
