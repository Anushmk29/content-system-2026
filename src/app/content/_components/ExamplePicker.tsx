'use client';
// Pick the example a creative is made from, by its picture: a button showing the chosen one,
// opening a grid of every example (the ones made for this kind of post first) plus "add a new one".
import { useRef, useState, type FormEvent } from 'react';
import { useAction } from './actions';

export type ExampleOpt = { id: string; name: string; kind?: 'image' | 'carousel'; pages?: number; has_person?: boolean };

const thumb = (id: string) => `/content/api/styles/${id}/image?page=0`;
const kindLabel = (e: ExampleOpt) => (e.kind === 'carousel' ? `Carousel · ${e.pages ?? 2} pages` : 'Single image');

/** The default for a post: the first example made for its kind, else the first one. */
export const firstFor = (examples: ExampleOpt[], want?: 'image' | 'carousel') =>
  (want && examples.find((e) => e.kind === want))?.id ?? examples[0]?.id ?? '';

export function ExamplePicker({ examples, value, onChange, want, disabled = false }: {
  examples: ExampleOpt[]; value: string; onChange: (id: string) => void;
  /** What the post is: its examples are listed first. */
  want?: 'image' | 'carousel';
  disabled?: boolean;
}) {
  const dlg = useRef<HTMLDialogElement>(null);
  const cur = examples.find((e) => e.id === value);
  const fits = want ? examples.filter((e) => e.kind === want) : examples;
  const others = want ? examples.filter((e) => e.kind !== want) : [];
  const pick = (id: string) => { onChange(id); dlg.current?.close(); };
  const tiles = (list: ExampleOpt[]) => (
    <div className="xp-grid">
      {list.map((e) => (
        <button key={e.id} type="button" className="xp-tile" aria-pressed={e.id === value} onClick={() => pick(e.id)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumb(e.id)} alt="" loading="lazy" />
          {e.kind === 'carousel' && <span className="xp-stack" aria-hidden />}
          <b>{e.name}</b>
          <span className="xp-meta">{kindLabel(e)}{e.has_person ? ' · your face' : ''}</span>
        </button>
      ))}
    </div>
  );
  return (
    <>
      <button type="button" className="xp-current" disabled={disabled} onClick={() => dlg.current?.showModal()} aria-label={`Example: ${cur?.name ?? 'none'}. Change`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {cur && <img src={thumb(cur.id)} alt="" />}
        <span className="xp-txt"><b>{cur?.name ?? 'Pick an example'}</b>{cur && <span className="xp-meta">{kindLabel(cur)}</span>}</span>
        <span className="xp-change">Change</span>
      </button>
      <dialog ref={dlg} className="xp-dlg" aria-label="Choose a design example" onClick={(e) => { if (e.target === dlg.current) dlg.current?.close(); }}>
        <div className="xp-head">
          <b>Pick a design{want ? ` for this ${want}` : ''}</b>
          <a href="/content/styles" className="linkish">Manage examples →</a>
          <button type="button" className="btn btn-sm" onClick={() => dlg.current?.close()}>Close</button>
        </div>
        {want && <p className="xp-sec">Made for {want === 'carousel' ? 'carousels: each page copies its own example page' : 'single images'}</p>}
        {fits.length ? tiles(fits) : <p className="faint" style={{ fontSize: 12.5 }}>None yet. Add one below.</p>}
        {others.length > 0 && <>
          <p className="xp-sec">{want === 'carousel' ? 'Single images: every page of the carousel copies this one design' : 'Carousels: the image copies their first page'}</p>
          {tiles(others)}
        </>}
        <AddExample onAdded={pick} />
      </dialog>
    </>
  );
}

/** Save new example images without leaving the post; the new one is picked straight away. */
function AddExample({ onAdded }: { onAdded: (id: string) => void }) {
  const a = useAction();
  const form = useRef<HTMLFormElement>(null);
  const [n, setN] = useState(0);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = await a.call('add', 'POST', '/content/api/styles', new FormData(e.currentTarget));
    if (d?.style?.id) { form.current?.reset(); setN(0); onAdded(d.style.id); }
  }
  return (
    <form ref={form} onSubmit={submit} className="xp-add">
      <p className="xp-sec">Add a new example</p>
      <p className="faint" style={{ margin: 0, fontSize: 12 }}>A post you like: one image, or every page of a carousel (select them in order). It’s kept for every post after this.</p>
      <div className="cr-row">
        <input className="input" name="name" placeholder="Name, e.g. Bold tips carousel" required aria-label="Example name" style={{ flex: '1 1 180px' }} />
        <label className="btn btn-sm cr-upload">{n ? `${n} image${n === 1 ? '' : 's'} chosen` : 'Choose images'}
          <input name="file" type="file" aria-label="Choose design example images" accept="image/png,image/jpeg,image/webp" multiple onChange={(e) => setN(e.target.files?.length ?? 0)} /></label>
        <button type="submit" className="btn btn-ink btn-sm" disabled={a.pending || !n}>{a.busy ? 'Saving…' : 'Save and use'}</button>
      </div>
      {a.feedback}
    </form>
  );
}
