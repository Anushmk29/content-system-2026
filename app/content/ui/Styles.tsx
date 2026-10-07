'use client';
// Style library: upload an example (multipart, so not useAction's JSON path) and manage saved styles.
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { StyleRow, LayoutSpec } from '@pratapai/content-pipeline';
import { useAction, toLogin } from './actions';

export function StyleUpload() {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/content/api/styles', { method: 'POST', body: new FormData(e.currentTarget) });
      const d = await res.json().catch(() => ({}));
      if (res.status === 401) toLogin();
      else if (!res.ok || d.ok === false) setMsg({ text: d.error ?? `error ${res.status}`, bad: true });
      else { setMsg({ text: d.message, bad: !d.style?.has_plate }); form.current?.reset(); router.refresh(); }
    } catch (err) {
      setMsg({ text: (err as Error).message, bad: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <form ref={form} onSubmit={submit} className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
      <input className="input" name="name" placeholder="Style name, e.g. Gold stat card" required style={{ width: 240 }} aria-label="Style name" />
      <input className="input" name="file" type="file" accept="image/png,image/jpeg,image/webp" multiple required
        aria-label="Example image, or every slide of a carousel" title="One image, or select all slides of a carousel (in order)" />
      <button type="submit" className="btn btn-ink" disabled={busy}>{busy ? 'Analysing and rebuilding the layout… (2–4 minutes)' : 'Analyse & save'}</button>
      {msg && <span role="status" style={{ fontSize: 12.5, color: msg.bad ? 'var(--danger)' : 'var(--ok)' }}>{msg.text}</span>}
    </form>
    </>
  );
}

/** Changes whenever a template is remade, so the browser fetches the new preview. */
function tplVersion(s: StyleRow): string {
  let h = 0;
  for (const c of JSON.stringify([s.spec.tpl?.html, ...Object.values(s.spec.layouts ?? {}).map((l) => l.tpl?.html)])) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

export function StyleCard({ s, placements }: { s: StyleRow; placements: PlacementOpt[] }) {
  const a = useAction();
  const [name, setName] = useState(s.name);
  const img = (kind: string) => `/content/api/styles/${s.id}/image?kind=${kind}`;
  const layouts: [string, Pick<LayoutSpec, 'kind' | 'tpl'>][] = s.spec.layouts
    ? Object.entries(s.spec.layouts).sort(([a], [b]) => (a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b)))
    : [['main', { kind: 'cover', tpl: s.spec.tpl }]];
  const hasTpl = layouts.some(([, l]) => l.tpl);
  const v = tplVersion(s);
  // A layout template is shown drawn with the example's own words; older styles show their blank picture.
  const shown = (id: string, l: Pick<LayoutSpec, 'tpl'>) => (l.tpl ? `${img('preview')}&layout=${id}&v=${v}` : `${img('plate')}&layout=${id}`);
  const frame = { width: '100%', aspectRatio: s.aspect.replace(':', '/'), objectFit: 'cover' as const, border: '1px solid var(--rule)' };
  return (
    <article style={{ borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <figure style={{ margin: 0 }}>
          <img src={img('source')} alt={`${s.name} example`} style={frame} />
          <figcaption className="mono faint" style={{ fontSize: 11 }}>example</figcaption>
        </figure>
        <figure style={{ margin: 0 }}>
          {layouts[0]![1].tpl || s.has_plate
            ? <img src={shown('main', layouts[0]![1])} alt={`${s.name} template`} style={frame} />
            : <div className="muted" style={{ aspectRatio: s.aspect.replace(':', '/'), display: 'grid', placeItems: 'center', background: 'var(--paper-2)', fontSize: 12 }}>no template</div>}
          <figcaption className="mono faint" style={{ fontSize: 11 }}>{layouts[0]![1].tpl ? 'your template, with the example’s words' : 'blank template (older method)'}</figcaption>
        </figure>
      </div>
      {s.spec.layouts && (
        <div style={{ marginTop: 8 }}>
          <div className="mono faint" style={{ fontSize: 11 }}>carousel · {s.spec.sequence?.length ?? 0} slides · {layouts.length} layouts</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 4 }}>
            {layouts.map(([id, l]) => (
              <figure key={id} style={{ margin: 0 }}>
                <img src={shown(id, l)} alt={`${l.kind} layout template`} style={frame} />
                <figcaption className="mono faint" style={{ fontSize: 11 }}>{l.kind}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
      <TemplateFix id={s.id} layouts={layouts} hasTpl={hasTpl} />
      <div className="row" style={{ gap: 6, marginTop: 10 }}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Style name" style={{ flex: 1 }} />
        <button type="button" className="btn btn-sm" disabled={a.pending || !name.trim() || name === s.name}
          onClick={() => a.call('rename', 'PATCH', `/content/api/styles/${s.id}`, { name })}>Rename</button>
        <button type="button" className="btn btn-sm btn-danger" disabled={a.pending}
          onClick={() => confirm(`Delete style "${s.name}"?`) && a.call('del', 'DELETE', `/content/api/styles/${s.id}`)}>Delete</button>
      </div>
      <div style={{ display: 'flex', gap: 4, margin: '8px 0' }}>
        {s.spec.palette.map((c) => <span key={c} title={c} style={{ width: 18, height: 18, background: c, border: '1px solid var(--rule)' }} />)}
        <span className="mono faint" style={{ fontSize: 11, marginLeft: 6 }}>{s.aspect} · {s.spec.mood}</span>
      </div>
      <details>
        <summary className="mono" style={{ fontSize: 12, cursor: 'pointer' }}>Saved style prompt</summary>
        <p style={{ fontSize: 13 }}>{s.style_prompt}</p>
        {s.spec.typography && <p className="muted" style={{ fontSize: 12 }}><b>Type:</b> {s.spec.typography}</p>}
        {s.spec.layout && <p className="muted" style={{ fontSize: 12 }}><b>Layout:</b> {s.spec.layout}</p>}
        {s.spec.structure && <p className="muted" style={{ fontSize: 12 }}><b>Structure:</b> {s.spec.structure}</p>}
      </details>
      <CreatePanel styleId={s.id} placements={placements} slides={s.spec.sequence?.length} />
      {a.feedback}
    </article>
  );
}

/** Fix a template from a plain-words note, or rebuild it (older styles get exact fonts and layout this way). */
function TemplateFix({ id, layouts, hasTpl }: { id: string; layouts: [string, Pick<LayoutSpec, 'kind' | 'tpl'>][]; hasTpl: boolean }) {
  const a = useAction();
  const [note, setNote] = useState('');
  const [layout, setLayout] = useState('');
  const url = `/content/api/styles/${id}`;
  if (!hasTpl) {
    return (
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <span className="muted" style={{ fontSize: 12.5 }}>Saved with the older method: plain fonts, no labels or diagrams.</span>
        <button type="button" className="btn btn-sm" disabled={a.pending}
          onClick={() => a.call('rebuild', 'POST', url, {})}>{a.busy ? 'Rebuilding… (2–4 minutes)' : 'Rebuild with exact fonts and layout'}</button>
        {a.feedback}
      </div>
    );
  }
  return (
    <details style={{ marginTop: 8 }}>
      <summary className="mono" style={{ fontSize: 12, cursor: 'pointer' }}>Fix the template</summary>
      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Compare it with the example. Say what’s off and the template is remade from your note.</p>
        {layouts.length > 1 && (
          <select className="input" value={layout} onChange={(e) => setLayout(e.target.value)} aria-label="Which layout">
            <option value="">All layouts</option>
            {layouts.map(([lid, l]) => <option key={lid} value={lid}>{l.kind} layout</option>)}
          </select>
        )}
        <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-label="What to fix"
          placeholder="e.g. The headline should be two colours. Keep the boxed diagram. The body text is too big." />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn btn-ink btn-sm" disabled={a.pending || !note.trim()}
            onClick={async () => { if (await a.call('fix', 'POST', url, { note, layout })) setNote(''); }}>{a.busy === 'fix' ? 'Remaking… (1–3 minutes)' : 'Remake with this note'}</button>
          <button type="button" className="btn btn-sm" disabled={a.pending}
            onClick={() => confirm('Rebuild the template from the example, from scratch?') && a.call('rebuild', 'POST', url, { layout })}>{a.busy === 'rebuild' ? 'Rebuilding… (2–4 minutes)' : 'Rebuild from scratch'}</button>
          {a.feedback}
        </div>
      </div>
    </details>
  );
}

export interface PlacementOpt { id: string; label: string; w: number; h: number }

/** Make creatives from a saved style: pick where it's going, write the slides, download the PNGs. */
export function CreatePanel({ styleId, placements, slides }: { styleId: string; placements: PlacementOpt[]; slides?: number }) {
  const a = useAction();
  const draft = useAction();
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(slides ?? 5);
  const [pdf, setPdf] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [placement, setPlacement] = useState(placements[0]?.id ?? 'instagram');
  const [text, setText] = useState('');
  const [cta, setCta] = useState('');
  const [fresh, setFresh] = useState(false);
  const [brief, setBrief] = useState('');
  const [images, setImages] = useState<string[]>([]);

  async function make() {
    const d = await a.call('gen', 'POST', `/content/api/styles/${styleId}/generate`, { placement, text, cta, fresh, brief },
      (d) => `${d.images.length} image${d.images.length === 1 ? '' : 's'} · ${d.background === 'template' ? 'saved template, $0' : `${d.background === 'fresh' ? 'new visual' : 'new size saved for next time'}, $${Number(d.costUsd).toFixed(3)}`}`);
    if (d) { setImages(d.images); setPdf(d.pdf ?? null); setWarnings(d.warnings ?? []); }
  }

  async function write() {
    const d = await draft.call('draft', 'POST', `/content/api/styles/${styleId}/draft`, { topic, slides: count },
      (d) => `Drafted ${d.text.split(/^\s*---\s*$/m).length} slides · $${Number(d.costUsd).toFixed(3)} — edit below, then make`);
    if (d) { setText(d.text); if (d.cta) setCta(d.cta); }
  }

  return (
    <details style={{ marginTop: 8 }}>
      <summary className="mono" style={{ fontSize: 12, cursor: 'pointer' }}>Create with this style</summary>
      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        <select className="input" value={placement} onChange={(e) => setPlacement(e.target.value)} aria-label="Where it will be posted">
          {placements.map((p) => <option key={p.id} value={p.id}>{p.label} · {p.w}×{p.h}</option>)}
        </select>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Or give a topic and let AI write the slides" aria-label="Topic" style={{ flex: 1, minWidth: 180 }} />
          <input className="input" type="number" min={1} max={10} value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Number of slides" style={{ width: 64 }} />
          <button type="button" className="btn btn-sm" disabled={draft.pending || !topic.trim()} onClick={write}>{draft.busy ? 'Writing…' : 'Write slides'}</button>
        </div>
        {draft.feedback}
        <textarea className="input" rows={6} value={text} onChange={(e) => setText(e.target.value)} aria-label="Slide text"
          placeholder={'Headline with *highlighted* words\n\nOptional body text\n- list lines fill a diagram or list\nlabel: SECTION TAG\nkicker: small line above the headline\n---\nNext slide headline\n\nBody'} />
        <input className="input" value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Button text, e.g. Book a call (last slide)" aria-label="Button text" />
        <label className="mono" style={{ fontSize: 12, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} />
          Add a new visual about the topic (~4¢; off = reuse the template, free)
        </label>
        {fresh && <input className="input" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="What the visual should show (default: the headline)" aria-label="Visual brief" />}
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ink" disabled={a.pending || !text.trim()} onClick={make}>{a.busy ? 'Making…' : 'Make creative'}</button>
          {a.feedback}
        </span>
        {images.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 6 }}>
            {images.map((src, i) => (
              <a key={i} href={src} download={`creative-${placement}-${i + 1}.png`} title="Download">
                <img src={src} alt={`Slide ${i + 1}`} style={{ width: '100%', display: 'block', border: '1px solid var(--rule)' }} />
              </a>
            ))}
          </div>
        )}
        {warnings.length > 0 && (
          <ul role="status" style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--danger)' }}>
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
        {pdf && <a className="btn btn-sm" href={pdf} download={`carousel-${placement}.pdf`} style={{ justifySelf: 'start' }}>Download as PDF (LinkedIn document)</a>}
      </div>
    </details>
  );
}
