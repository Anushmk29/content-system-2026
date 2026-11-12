'use client';
// Examples: designs you like, kept as they are. Each one can be recreated with your words and
// brand ("Make one"), or picked on any post's creative panel.
import { useRef, useState, type FormEvent } from 'react';
import type { StyleRow } from '@pratapai/content-pipeline';
import { useAction } from './actions';

export function StyleUpload() {
  const a = useAction();
  const form = useRef<HTMLFormElement>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (await a.call('up', 'POST', '/content/api/styles', new FormData(e.currentTarget))) form.current?.reset();
  }

  return (
    <form ref={form} onSubmit={submit} className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
      <input className="input" name="name" placeholder="Name, e.g. Gold stat card" required style={{ width: 240 }} aria-label="Example name" />
      <input className="input" name="file" type="file" accept="image/png,image/jpeg,image/webp" multiple required
        aria-label="One image, or every page of a carousel" title="One image, or select every page of a carousel (in order)" />
      <button type="submit" className="btn btn-ink" disabled={!!a.busy}>{a.busy ? 'Saving…' : 'Save example'}</button>
      {a.feedback}
    </form>
  );
}

/** Platforms that take each kind of visual post: { image: [{id,label}], carousel: [...] }. */
export type VisualTargets = Record<'image' | 'carousel', { id: string; label: string }[]>;

export function StyleCard({ s, targets }: { s: StyleRow; targets: VisualTargets }) {
  const a = useAction();
  const [name, setName] = useState(s.name);
  const img = (page: number) => `/content/api/styles/${s.id}/image?page=${page}`;
  const frame = { width: '100%', aspectRatio: s.aspect.replace(':', '/'), objectFit: 'cover' as const, border: '1px solid var(--rule)', display: 'block' };
  return (
    <article style={{ borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: s.pages > 1 ? 'repeat(auto-fill, minmax(96px, 1fr))' : '1fr', gap: 6 }}>
        {Array.from({ length: Math.min(s.pages, 6) }, (_, i) => (
          <a key={i} href={img(i)} target="_blank" rel="noreferrer" title="Open full size">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img(i)} alt={`${s.name}, page ${i + 1}`} loading="lazy" style={frame} />
          </a>
        ))}
      </div>
      <p className="mono faint" style={{ fontSize: 11, margin: '6px 0 0' }}>
        {s.kind === 'carousel' ? `carousel · ${s.pages} pages` : 'single image'}{s.has_person ? ' · has a person (your photo goes in)' : ''}{s.starter ? ' · built in' : ''}
      </p>
      <MakeOne s={s} targets={targets} />
      <details style={{ marginTop: 8 }}>
        <summary className="mono" style={{ fontSize: 12, cursor: 'pointer' }}>What the AI copies</summary>
        <p style={{ fontSize: 13 }}>{s.style_prompt}</p>
      </details>
      <div className="row" style={{ gap: 6, marginTop: 10 }}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Example name" style={{ flex: 1 }} />
        <button type="button" className="btn btn-sm" disabled={a.pending || !name.trim() || name === s.name}
          onClick={() => a.call('rename', 'PATCH', `/content/api/styles/${s.id}`, { name })}>Rename</button>
        <button type="button" className="btn btn-sm btn-danger" disabled={a.pending}
          onClick={() => confirm(`Delete example "${s.name}"?${s.starter ? ' Built-in examples come back the next time this page opens.' : ''}`) && a.call('del', 'DELETE', `/content/api/styles/${s.id}`)}>Delete</button>
      </div>
      {a.feedback}
    </article>
  );
}

/** A topic → the AI writes the post and recreates this example with it, ready on Design / Approvals. */
function MakeOne({ s, targets }: { s: StyleRow; targets: VisualTargets }) {
  const a = useAction();
  const [kind, setKind] = useState<'image' | 'carousel'>(s.kind);
  const [platform, setPlatform] = useState(targets[s.kind][0]?.id ?? '');
  const [topic, setTopic] = useState('');
  const [itemId, setItemId] = useState<string | null>(null);
  const pickKind = (k: 'image' | 'carousel') => {
    setKind(k);
    if (!targets[k].some((t) => t.id === platform)) setPlatform(targets[k][0]?.id ?? '');
  };
  async function make() {
    setItemId(null);
    const d = await a.call('make', 'POST', `/content/api/styles/${s.id}`, { topic, platform, kind });
    if (d?.itemId) setItemId(d.itemId);
  }
  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
      <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic, e.g. 5 signs a business is ready for AI" aria-label="Topic" />
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="chips" role="group" aria-label="Image or carousel">
          {(['image', 'carousel'] as const).map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => pickKind(k)}>{k === 'image' ? 'Image' : 'Carousel'}</button>
          ))}
        </div>
        <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform" style={{ flex: '1 1 120px' }}>
          {targets[kind].map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <button type="button" className="btn btn-ink" disabled={a.pending || !topic.trim() || !platform} onClick={make}>
          {a.busy ? (kind === 'carousel' ? 'Writing and designing… (2–4 min)' : 'Writing and designing… (about a minute)') : 'Make one'}
        </button>
      </div>
      {a.feedback}
      {itemId && <a className="btn btn-sm" style={{ justifySelf: 'start' }} href={`/content/design?item=${itemId}`}>Open it on Design</a>}
    </div>
  );
}
