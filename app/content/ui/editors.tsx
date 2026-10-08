'use client';
// Interactive pieces of the item drawer / approvals / ideas pages. Each one is a
// thin form over an API route via useAction (refresh + feedback + login redirect handled there).
import { useState } from 'react';
import { useAction } from './actions';

// ---- approve / changes / reject ---------------------------------------------
export function ApprovalActions({ itemId, unproven = 0, reasons = [] }: { itemId: string; unproven?: number; reasons?: string[] }) {
  const a = useAction();
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [warn, setWarn] = useState<string | null>(null);
  function decide(action: 'approve' | 'changes' | 'reject') {
    if (action !== 'approve' && !note.trim() && !picked.length) { setWarn('Pick a reason or add a note, so the rewrite knows what to fix.'); return; }
    setWarn(null);
    a.call(action, 'PATCH', `/content/api/approvals/${itemId}`, { action, note: note || null, reasons: action === 'approve' ? [] : picked });
  }
  const toggle = (r: string) => setPicked(picked.includes(r) ? picked.filter((x) => x !== r) : [...picked, r]);
  return (
    <div>
      {unproven > 0 && (
        <p style={{ margin: '0 0 8px', fontSize: 12.5, color: 'var(--warn)' }}>
          {unproven} claim(s) without proof — approving is allowed, but it won&apos;t publish until each has a proof link.
        </p>
      )}
      {reasons.length > 0 && (
        <div className="chips" role="group" aria-label="What to fix" style={{ marginBottom: 8 }}>
          {reasons.map((r) => <button key={r} type="button" className="chip" aria-pressed={picked.includes(r)} onClick={() => toggle(r)}>{r}</button>)}
        </div>
      )}
      <textarea id="approval-note" className="input" placeholder="Anything else? (optional when you picked a reason above)"
        value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 52 }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" data-key="approve" className="btn btn-primary" disabled={a.pending} onClick={() => decide('approve')}>{a.busy === 'approve' ? '…' : 'Approve'} <kbd>A</kbd></button>
        <button type="button" data-key="changes" className="btn" disabled={a.pending} onClick={() => decide('changes')}>{a.busy === 'changes' ? '…' : 'Request changes'} <kbd>C</kbd></button>
        <button type="button" data-key="reject" className="btn btn-danger" disabled={a.pending} onClick={() => decide('reject')}>{a.busy === 'reject' ? '…' : 'Reject'} <kbd>R</kbd></button>
        {warn ? <span style={{ fontSize: 12.5, color: 'var(--warn)' }}>{warn}</span> : a.feedback}
      </div>
    </div>
  );
}

// ---- edit copy (pre-approval) -------------------------------------------------
export function CopyEditor({ itemId, hook, body, cta }: { itemId: string; hook: string; body: string; cta: string }) {
  const a = useAction();
  const [v, setV] = useState({ hook, body, cta });
  const dirty = v.hook !== hook || v.body !== body || v.cta !== cta;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label className="faint" style={{ fontSize: 12 }}>Hook
        <input className="input" value={v.hook} onChange={(e) => setV({ ...v, hook: e.target.value })} />
      </label>
      <label className="faint" style={{ fontSize: 12 }}>Body
        <textarea className="input" value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} style={{ minHeight: 220 }} />
      </label>
      <label className="faint" style={{ fontSize: 12 }}>Call to action
        <input className="input" value={v.cta} onChange={(e) => setV({ ...v, cta: e.target.value })} />
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" className="btn btn-brand" disabled={!dirty || a.pending} onClick={() => a.call('save', 'PATCH', `/content/api/items/${itemId}`, v)}>
          {a.busy ? 'Saving…' : 'Save copy'}
        </button>
        {dirty && <button type="button" className="btn" onClick={() => setV({ hook, body, cta })}>Revert</button>}
        <span className="faint" style={{ fontSize: 12 }}>{v.body.length} chars</span>
        {a.feedback}
      </div>
    </div>
  );
}

// ---- rewrite with a library hook ------------------------------------------------
interface HookOption { hook: string; pattern: string | null; contrast: number; patternStrength: number; platformFit: number; learned: number; score: number }

export function HookPicker({ itemId, hooks }: { itemId: string; hooks: { id: string; label: string }[] }) {
  const a = useAction();
  const swap = useAction();
  const [id, setId] = useState(hooks[0]?.id ?? '');
  const [options, setOptions] = useState<HookOption[]>([]);
  const [applied, setApplied] = useState('');
  return (
    <div>
      <div className="hook-pick">
        <select className="input" value={id} onChange={(e) => setId(e.target.value)} aria-label="Post style to copy">
          {hooks.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
        </select>
        <button type="button" className="btn" disabled={!id || a.pending} onClick={async () => {
          const d = await a.call('hook', 'PATCH', `/content/api/items/${itemId}`, { hookId: id });
          const opts: HookOption[] = Array.isArray(d?.options) ? d.options : [];
          setOptions(opts);
          setApplied(opts[0]?.hook ?? '');
        }}>
          {a.busy ? 'Rewriting…' : 'Rewrite'}
        </button>
        {a.feedback}
      </div>
      {options.length > 1 && (
        <div style={{ marginTop: 10 }}>
          <p className="faint" style={{ margin: '0 0 6px', fontSize: 12.5 }}>Done — the best first line is already in the post above. Prefer another? Click it.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {options.map((o, i) => {
              const on = o.hook === applied;
              return (
                <button key={i} type="button" className="btn" aria-pressed={on} disabled={swap.pending || on}
                  title={`score ${o.score} · ${o.pattern ?? 'other'} · contrast ${o.contrast} · pattern ${o.patternStrength} · platform ${o.platformFit}`}
                  style={{ textAlign: 'left', justifyContent: 'flex-start', whiteSpace: 'normal', fontWeight: on ? 600 : 400, borderColor: on ? 'var(--ink)' : undefined, opacity: 1 }}
                  onClick={async () => {
                    const d = await swap.call(`s${i}`, 'PATCH', `/content/api/items/${itemId}`, { swapHook: o.hook, pattern: o.pattern });
                    if (d) setApplied(o.hook);
                  }}>
                  {on ? '✓ ' : ''}{o.hook}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {swap.feedback}
    </div>
  );
}

// ---- plan a posting time ------------------------------------------------------
export function PlanTime({ itemId, current }: { itemId: string; current: string | null }) {
  const a = useAction();
  const local = (iso: string) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const [at, setAt] = useState(current ? local(current) : '');
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} style={{ width: 230 }} aria-label="Posting time" />
      <button type="button" className="btn" disabled={!at || a.pending} onClick={() => a.call('plan', 'PATCH', `/content/api/items/${itemId}`, { plannedAt: new Date(at).toISOString() })}>
        {a.busy ? '…' : 'Set time'}
      </button>
      {a.feedback}
    </div>
  );
}

// ---- manual metrics -----------------------------------------------------------
const FIELDS = [['impressions', 'Impressions'], ['reach', 'Reach'], ['likes', 'Likes'], ['comments', 'Comments'],
  ['shares', 'Shares'], ['saves', 'Saves'], ['clicks', 'Clicks'], ['qualifiedEngagement', 'Qualified eng.']] as const;

export function MetricsForm({ itemId }: { itemId: string }) {
  const a = useAction();
  const [v, setV] = useState<Record<string, string>>({});
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await a.call('m', 'POST', '/content/api/metrics', { itemId, ...v })) setV({}); }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
        {FIELDS.map(([k, label]) => (
          <label key={k} className="faint" style={{ fontSize: 12 }}>{label}
            <input className="input mono" inputMode="numeric" pattern="[0-9]*" value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <button type="submit" className="btn btn-brand" disabled={a.pending || !Object.values(v).some(Boolean)}>{a.busy ? 'Saving…' : 'Save metrics'}</button>
        <span className="faint" style={{ fontSize: 12 }}>Copy the numbers from the platform. Each save is a new snapshot.</span>
        {a.feedback}
      </div>
    </form>
  );
}

// ---- capture a signal ---------------------------------------------------------
/** Sentence starters: pick one, finish the line. Most signals are one of these shapes. */
const STARTERS = [
  'A customer asked: ', 'A mistake I keep seeing: ', 'Something we learned this week: ',
  'People believe … but actually ', 'A result we got: ', 'Trend worth a take: ',
];
const CHANNELS = ['client', 'reddit', 'linkedin', 'x', 'own idea'];

export function AddSignal({ pillars = [] }: { pillars?: { slug: string; label: string }[] }) {
  const a = useAction();
  const [text, setText] = useState('');
  const [channel, setChannel] = useState('');
  const start = (s: string) => setText(text.trim() ? `${text.trim()} ${s}` : s);
  return (
    <form id="capture" onSubmit={async (e) => {
      e.preventDefault();
      if (text.trim() && await a.call('s', 'POST', '/content/api/signals', { rawText: text, channel: channel || null })) { setText(''); setChannel(''); }
    }}>
      <textarea className="input" placeholder="A question a customer asked, a trend, a result… e.g. “A clinic owner asked how to cut no-shows without hiring staff”"
        value={text} onChange={(e) => setText(e.target.value)} aria-label="Signal" style={{ minHeight: 80 }} />
      <div className="chips" style={{ marginTop: 8 }} role="group" aria-label="Start from">
        {STARTERS.map((s) => <button key={s} type="button" className="chip" onClick={() => start(s)}>{s.replace(/: $|s$/, '')}</button>)}
        {pillars.map((p) => <button key={p.slug} type="button" className="chip" onClick={() => start(`${p.label}: `)}>{p.label}</button>)}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="chips" role="group" aria-label="Where it came from">
          {CHANNELS.map((c) => <button key={c} type="button" className="chip" aria-pressed={channel === c} onClick={() => setChannel(channel === c ? '' : c)}>{c}</button>)}
        </span>
        <button type="submit" className="btn btn-primary" disabled={!text.trim() || a.pending}>{a.busy ? '…' : '+ Capture signal'}</button>
        {a.feedback}
      </div>
    </form>
  );
}

// ---- creative on a post: make from a saved style, attach own media, remove -------------
export function CreativePanel({ itemId, platform, assets, styles, editable }: {
  itemId: string; platform: string; editable: boolean;
  assets: Array<{ idx: number; mime: string; source: string; created_at: string }>;
  styles: Array<{ id: string; name: string }>;
}) {
  const a = useAction();
  const [styleId, setStyleId] = useState(styles[0]?.id ?? '');
  const [fresh, setFresh] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const url = `/content/api/items/${itemId}/asset`;
  const v = encodeURIComponent(assets[0]?.created_at ?? '');
  const make = async () => {
    setWarnings([]);
    const r = await a.call('make', 'POST', url, { styleId, fresh });
    if (r?.warnings) setWarnings(r.warnings);
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const form = new FormData();
    for (const f of Array.from(files)) form.append('file', f);
    setWarnings([]);
    await a.call('up', 'POST', url, form);
  };
  const busy = a.pending;
  return (
    <div className="cr">
      {assets.length > 0 ? (
        <div className="cr-strip" data-p={platform}>
          {assets.map((x) => x.mime.startsWith('video/')
            ? <video key={x.idx} src={`${url}?i=${x.idx}&v=${v}`} controls preload="metadata" />
            // eslint-disable-next-line @next/next/no-img-element
            : <a key={x.idx} href={`${url}?i=${x.idx}&v=${v}`} target="_blank" rel="noreferrer" title={`Open slide ${x.idx + 1} full size`}><img src={`${url}?i=${x.idx}&v=${v}`} alt={`Slide ${x.idx + 1}`} loading="lazy" /></a>)}
        </div>
      ) : (
        <p className="empty">
          {editable ? 'No creative yet. Make one from a saved style, or attach your own image or video.'
            : platform === 'instagram' ? 'No creative. It goes out with plain text slides.' : 'No creative. It goes out as text only.'}
        </p>
      )}
      {assets.length > 0 && <p className="cr-meta">{assets.length} {assets[0]!.mime.startsWith('video/') ? 'video' : assets.length === 1 ? 'image' : 'slides'} · {assets[0]!.source === 'upload' ? 'your own' : 'made from a style'}{editable ? '' : ' · locked with the approved copy'}</p>}
      {editable && (
        <div className="cr-tools">
          {styles.length > 0 ? (
            <div className="cr-row">
              <select className="input" value={styleId} onChange={(e) => setStyleId(e.target.value)} aria-label="Style" style={{ flex: '1 1 180px' }}>
                {styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button type="button" className="btn btn-ink" disabled={busy || !styleId} onClick={make}>
                {a.busy === 'make' ? 'Making…' : assets.length ? 'Make again' : 'Make creative'}
              </button>
            </div>
          ) : <p className="cr-meta">No styles saved yet. <a href="/content/styles">Save one on Styles</a> to make creatives here.</p>}
          {styles.length > 0 && (
            <label className="cr-check">
              <input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} />
              Add a new picture about this post (a few cents; otherwise the saved design is reused for free)
            </label>
          )}
          <div className="cr-row">
            <label className="btn btn-sm" aria-disabled={busy}>{a.busy === 'up' ? 'Uploading…' : 'Use my own image or video'}
              <input type="file" accept="image/png,image/jpeg,image/webp,video/mp4" multiple hidden disabled={busy} onChange={(e) => { upload(e.target.files); e.target.value = ''; }} /></label>
            {assets.length > 0 && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => confirm('Remove the creative from this post?') && a.call('rm', 'DELETE', url)}>Remove</button>}
            {a.feedback}
          </div>
          {warnings.length > 0 && <ul className="cr-warn">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
