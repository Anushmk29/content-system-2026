'use client';
// The brand kit, one ruled section per part. Each section saves on its own, so the first-run setup
// (/content/setup) reuses them one step at a time. Every field is something the drafts or the
// creatives actually use; nothing here is decoration. BrandProof shows the saved kit as a post.
import { useMemo, useState, type ReactNode } from 'react';
import type { Brand, FontRow } from '@pratapai/content-pipeline';
import { useAction } from './actions';
import { CATEGORY, splitPosts } from './format';

type Saved = () => void;
const SAVE = '/content/api/brand';

/** Which parts of the kit are filled in, from what's saved. Drives the section and step status. */
export const kitDone = (k: Brand) => ({
  identity: !!k.name.trim(),
  voice: !!k.voice.trim(),
  audience: !!k.audience.trim() && k.pillars.length > 0,
  offers: k.offers.length > 0,
  look: k.hasLogo || !!k.headingFont || !!k.bodyFont || k.palette.length > 0,
  accounts: Object.values(k.ownHandles).some((h) => h?.trim()),
});

const anchor = (t: string) => t.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');

export function Card({ title, hint, done, children }: { title: string; hint?: ReactNode; done?: boolean; children: ReactNode }) {
  return (
    <section className="bk-sec" id={anchor(title)} data-todo={done === false || undefined}>
      <header className="bk-head">
        <h2>{title}</h2>
        {hint && <p>{hint}</p>}
        {done !== undefined && <span className="bk-state" data-done={done || undefined}>{done ? 'Saved' : 'Not set yet'}</span>}
      </header>
      <div className="bk-body">{children}</div>
    </section>
  );
}

function SaveRow({ a, onClick, label = 'Save', disabled }: { a: ReturnType<typeof useAction>; onClick: () => void; label?: string; disabled?: boolean }) {
  return (
    <span className="bk-save">
      <button type="button" className="btn btn-primary" disabled={a.pending || disabled} onClick={onClick}>{a.busy === 'save' ? 'Saving…' : label}</button>
      {a.feedback}
    </span>
  );
}

const save = async (a: ReturnType<typeof useAction>, body: unknown, onSaved?: Saved) => {
  if (await a.call('save', 'PATCH', SAVE, body)) onSaved?.();
};

/** Common brand values, offered as one-click chips so most people never type them. */
const VALUE_SUGGESTIONS = [
  'Honest numbers only', 'No hype', 'Practical over theoretical', 'Customer first', 'Transparency',
  'Quality over quantity', 'Plain language', 'Respect the reader’s time', 'Sustainability', 'Inclusive',
];

export function IdentitySection({ kit, onSaved, cta }: { kit: Brand; onSaved?: Saved; cta?: string }) {
  const a = useAction();
  const [name, setName] = useState(kit.name);
  const [tagline, setTagline] = useState(kit.tagline);
  const [values, setValues] = useState<string[]>(kit.values ?? []);
  const [own, setOwn] = useState('');
  const toggle = (v: string) => setValues(values.includes(v) ? values.filter((x) => x !== v) : [...values, v].slice(0, 8));
  const addOwn = () => { const v = own.trim(); if (v && !values.includes(v)) setValues([...values, v].slice(0, 8)); setOwn(''); };
  return (
    <Card title="Who you are" hint="Your name as it appears on posts, one line on what you do, and what you stand for." done={kitDone(kit).identity}>
      <label className="bk-field"><span className="bk-lab">Brand or your name</span>
        <input className="input bk-big" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Brew & Books" /></label>
      <label className="bk-field"><span className="bk-lab">What you do, in one line</span>
        <input className="input" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="e.g. bookkeeping for independent cafés" /></label>
      <div className="bk-field">
        <span className="bk-lab">What you stand for <span className="faint">(pick up to 8)</span></span>
        <div className="chips" role="group" aria-label="Brand values">
          {[...VALUE_SUGGESTIONS, ...values.filter((v) => !VALUE_SUGGESTIONS.includes(v))].map((v) => (
            <button key={v} type="button" className="chip" aria-pressed={values.includes(v)} onClick={() => toggle(v)}>{v}</button>
          ))}
        </div>
        <span className="bk-line">
          <input className="input" value={own} onChange={(e) => setOwn(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOwn(); } }}
            placeholder="Add your own, e.g. Local suppliers first" aria-label="Add your own value" style={{ flex: '1 1 240px' }} />
          <button type="button" className="btn btn-sm" disabled={!own.trim() || values.length >= 8} onClick={addOwn}>+ Add</button>
        </span>
        <span className="bk-note">Every draft, script and decision is checked against these.</span>
      </div>
      <SaveRow a={a} label={cta} disabled={!name.trim()} onClick={() => save(a, { name, tagline, values }, onSaved)} />
    </Card>
  );
}

export function VoiceSection({ kit, onSaved, cta }: { kit: Brand; onSaved?: Saved; cta?: string }) {
  const a = useAction();
  const [tab, setTab] = useState<'write' | 'samples' | 'import'>('write');
  const [voice, setVoice] = useState(kit.voice);
  const [editing, setEditing] = useState(!kit.voice.trim());
  const rules = voice.split('\n').map((l) => l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean);
  const [samples, setSamples] = useState(kit.voiceSamples.join('\n---\n'));
  const [platform, setPlatform] = useState('linkedin');
  const [handle, setHandle] = useState(kit.ownHandles.linkedin ?? '');
  const posts = splitPosts(samples);
  return (
    <Card title="Your voice" hint="How your posts should sound. Write it yourself, or let AI read posts you’ve already written." done={kitDone(kit).voice}>
      <div className="seg" role="tablist" aria-label="How to set your voice">
        {([['write', 'Write it'], ['samples', 'From my posts'], ['import', 'Import my posts']] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'write' && !editing && (
        <div className="bk-field">
          <span className="bk-lab">Voice guide <span className="faint">({rules.length} rules every draft follows)</span></span>
          <ul className="voice-rules">{rules.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <span><button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>Edit the guide</button></span>
        </div>
      )}
      {tab === 'write' && editing && (
        <label className="bk-field"><span className="bk-lab">Voice guide</span>
          <textarea className="input bk-voice" rows={9} value={voice} onChange={(e) => setVoice(e.target.value)}
            placeholder={'- Warm and plain, like talking to a friend over coffee.\n- Short sentences. One idea per paragraph.\n- Open with a real situation, never a question.\n- No hype words: “game-changer”, “unlock”, “revolutionise”.'} /></label>
      )}
      {tab === 'samples' && (<>
        <label className="bk-field"><span className="bk-lab">Paste 3–10 of your posts, with a line of --- between them</span>
          <textarea className="input" rows={10} value={samples} onChange={(e) => setSamples(e.target.value)} placeholder={'First post…\n---\nSecond post…\n---\nThird post…'} /></label>
        <span className="bk-save">
          <button type="button" className="btn" disabled={a.pending || posts.length < 3}
            onClick={async () => { const r = await a.call('voice', 'POST', '/content/api/brand/voice', { samples: posts }); if (r?.voice) { setVoice(r.voice); setEditing(true); setTab('write'); } }}>
            {a.busy === 'voice' ? 'Reading your posts…' : `Write my voice guide from ${posts.length} post${posts.length === 1 ? '' : 's'}`}
          </button>
          <span className="bk-note">About 1¢</span>
        </span>
      </>)}
      {tab === 'import' && (<>
        <p className="bk-note">We fetch your best posts from the last year, then you turn them into a voice guide. Takes a minute or two and costs a few cents.</p>
        <div className="bk-line">
          <select className="input" value={platform} onChange={(e) => { setPlatform(e.target.value); setHandle(kit.ownHandles[e.target.value as keyof Brand['ownHandles']] ?? ''); }} aria-label="Platform" style={{ width: 150 }}>
            <option value="linkedin">LinkedIn</option><option value="x">X</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="youtube">YouTube</option>
          </select>
          <input className="input" value={handle} onChange={(e) => setHandle(e.target.value)} style={{ flex: '1 1 240px' }}
            placeholder={platform === 'linkedin' ? 'Your LinkedIn page or profile link' : platform === 'facebook' ? 'Your Facebook page link' : '@yourhandle'} aria-label="Your account" />
          <button type="button" className="btn" disabled={a.pending || !handle.trim()}
            onClick={async () => { const r = await a.call('import', 'POST', '/content/api/brand/voice', { platform, handle }); if (r?.samples) { setSamples(r.samples.join('\n---\n')); setTab('samples'); } }}>
            {a.busy === 'import' ? 'Fetching your posts…' : 'Import posts'}
          </button>
        </div>
      </>)}
      <SaveRow a={a} label={cta} disabled={!voice.trim()} onClick={() => save(a, { voice, voiceSamples: posts }, onSaved)} />
    </Card>
  );
}

type PillarDraft = { label: string; description: string; target: number };

export function AudienceSection({ kit, onSaved, cta }: { kit: Brand; onSaved?: Saved; cta?: string }) {
  const a = useAction();
  const [audience, setAudience] = useState(kit.audience);
  const [beliefs, setBeliefs] = useState((kit.audienceBeliefs ?? []).join('\n'));
  const [pillars, setPillars] = useState<PillarDraft[]>(kit.pillars.length ? kit.pillars : [{ label: '', description: '', target: 0 }]);
  const set = (i: number, p: Partial<PillarDraft>) => setPillars(pillars.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const total = pillars.reduce((s, p) => s + (Number(p.target) || 0), 0);
  const filled = pillars.filter((p) => p.label.trim());
  return (
    <Card title="Audience and themes" hint="Who you write for, and the 2–6 themes every post belongs to. The share is how much of your content each theme should get." done={kitDone(kit).audience}>
      <label className="bk-field"><span className="bk-lab">Who you write for</span>
        <textarea className="input" rows={4} value={audience} onChange={(e) => setAudience(e.target.value)}
          placeholder="e.g. Owners of 1–3 independent cafés. Great at coffee, not at numbers. Worried about cash flow, short on time." /></label>
      <label className="bk-field"><span className="bk-lab">What they wrongly believe <span className="faint">(optional, one per line)</span></span>
        <textarea className="input" rows={3} value={beliefs} onChange={(e) => setBeliefs(e.target.value)}
          placeholder={'e.g. You need a big team to use AI\nAutomation is only for tech companies'} />
        <span className="bk-note">Each post’s angle flips one of these: what they think → what’s actually true.</span></label>
      <div className="bk-field">
        <span className="bk-lab">Themes</span>
        {/* The split itself: each theme's share of posts, as one bar. */}
        <div className="bk-split" aria-hidden>
          {pillars.map((p, i) => (Number(p.target) > 0
            ? <span key={i} style={{ flexGrow: Number(p.target), background: CATEGORY[i % CATEGORY.length] }} title={`${p.label || 'Theme'} ${p.target}%`} />
            : null))}
          {total < 100 && <span style={{ flexGrow: 100 - total }} />}
        </div>
        <ul className="row-list bk-rows">
          {pillars.map((p, i) => (
            <li key={i} className="row">
              <span className="dot" style={{ ['--c' as string]: CATEGORY[i % CATEGORY.length] }} />
              <input className="input" value={p.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Theme, e.g. Cash flow tips" aria-label="Theme name" style={{ flex: '1 1 140px' }} />
              <input className="input" value={p.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="What goes in it" aria-label="What goes in it" style={{ flex: '2 1 150px' }} />
              <label className="bk-pct">
                <input className="input" type="number" min={0} max={100} value={p.target} onChange={(e) => set(i, { target: Number(e.target.value) })} aria-label="Share of posts" />%
              </label>
              <button type="button" className="btn btn-sm" onClick={() => setPillars(pillars.filter((_, j) => j !== i))} disabled={pillars.length < 2} aria-label="Remove theme">×</button>
            </li>
          ))}
        </ul>
        <span className="bk-line">
          <button type="button" className="btn btn-sm" disabled={pillars.length >= 6} onClick={() => setPillars([...pillars, { label: '', description: '', target: 0 }])}>+ Add theme</button>
          <span className="bk-note" style={total === 100 ? undefined : { color: 'var(--warn)' }}>Shares add up to {total}%{total === 100 ? '' : '. Aim for 100.'}</span>
        </span>
      </div>
      <SaveRow a={a} label={cta} disabled={!audience.trim() || filled.length < 1}
        onClick={() => save(a, { audience, audienceBeliefs: beliefs.split('\n').map((x) => x.trim()).filter(Boolean), pillars: filled.map((p) => ({ ...p, slug: kit.pillars.find((k) => k.label === p.label)?.slug })) }, onSaved)} />
    </Card>
  );
}

type OfferDraft = { label: string; url: string; cta: string; primary: boolean };

export function OffersSection({ kit, onSaved, cta }: { kit: Brand; onSaved?: Saved; cta?: string }) {
  const a = useAction();
  const [offers, setOffers] = useState<OfferDraft[]>(kit.offers.length ? kit.offers : [{ label: '', url: '', cta: '', primary: true }]);
  const set = (i: number, o: Partial<OfferDraft>) => setOffers(offers.map((x, j) => (j === i ? { ...x, ...o } : o.primary ? { ...x, primary: false } : x)));
  return (
    <Card title="Offers" done={kitDone(kit).offers}
      hint="Where your posts send people: up to 3 links. The main one is the default; drafts pick another when it fits the topic better. Links get tracking added so you can see which posts bring clicks.">
      <ol className="bk-offers">
        {offers.map((o, i) => (
          <li key={i} data-main={o.primary || undefined}>
            <div className="bk-line">
              <input className="input" value={o.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Name, e.g. Free cash-flow review" aria-label="Offer name" style={{ flex: '1 1 200px', fontWeight: 500 }} />
              <label className="bk-main">
                <input type="radio" name="primary-offer" checked={o.primary} onChange={() => set(i, { primary: true })} /> Main offer
              </label>
              <button type="button" className="btn btn-sm" onClick={() => setOffers(offers.filter((_, j) => j !== i))} disabled={offers.length < 2} aria-label="Remove offer">×</button>
            </div>
            <input className="input mono" value={o.url} onChange={(e) => set(i, { url: e.target.value })} placeholder="https://…" aria-label="Link" style={{ fontSize: 12 }} />
            <input className="input" value={o.cta} onChange={(e) => set(i, { cta: e.target.value })} placeholder="What it is, e.g. A 20-minute call to find where your cash goes" aria-label="Call to action" />
          </li>
        ))}
      </ol>
      <span><button type="button" className="btn btn-sm" disabled={offers.length >= 3} onClick={() => setOffers([...offers, { label: '', url: '', cta: '', primary: false }])}>+ Add offer</button></span>
      <SaveRow a={a} label={cta} onClick={() => save(a, { offers: offers.filter((o) => o.label.trim() || o.url.trim()) }, onSaved)} />
    </Card>
  );
}

const CORNERS = [['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']] as const;

/** Google Fonts stylesheet for families the browser can preview (uploaded files can't be). */
function GoogleFonts({ families }: { families: string[] }) {
  if (!families.length) return null;
  return <link rel="stylesheet" href={`https://fonts.googleapis.com/css2?${families.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;800`).join('&')}&display=swap`} />;
}

export function LookSection({ kit, fonts, curated, onSaved, cta, photos }: { kit: Brand; fonts: FontRow[]; curated: readonly string[]; onSaved?: Saved; cta?: string; photos?: number }) {
  const a = useAction();
  const up = useAction();
  const [heading, setHeading] = useState(kit.headingFont ?? '');
  const [body, setBody] = useState(kit.bodyFont ?? '');
  const [corner, setCorner] = useState(kit.logoCorner);
  const [palette, setPalette] = useState<string[]>(kit.palette);
  const [logoV, setLogoV] = useState(0); // cache-buster after an upload
  const [photoN, setPhotoN] = useState(photos ?? 0);
  const [photoV, setPhotoV] = useState(0);
  const families = [...new Set([...fonts.map((f) => f.family), ...curated])];
  const uploaded = new Set(fonts.filter((f) => f.source === 'upload').map((f) => f.family));
  const hasLogo = kit.hasLogo || logoV > 0;
  const upload = async (path: string, key: string, files: FileList | null) => {
    if (!files?.length) return;
    const form = new FormData();
    for (const f of Array.from(files)) form.append('file', f);
    if (!(await up.call(key, 'POST', path, form))) return;
    if (key === 'logo') setLogoV(Date.now());
    if (key === 'photos') { setPhotoN(files.length); setPhotoV(Date.now()); }
    if (key === 'font') location.reload();
  };
  const fontPick = (label: string, value: string, set: (v: string) => void, weight: number) => (
    <label className="bk-field bk-font"><span className="bk-lab">{label}</span>
      <select className="input" value={value} onChange={(e) => set(e.target.value)}>
        <option value="">Like the example (default)</option>
        {families.map((f) => <option key={f} value={f}>{f}{uploaded.has(f) ? ' (uploaded)' : ''}</option>)}
      </select>
      <span className="bk-specimen" style={{ fontFamily: value ? `'${value}', var(--font-ui)` : undefined, fontWeight: value ? weight : undefined }}>
        {value ? (uploaded.has(value) ? `${value} is used on creatives; it can’t be previewed here.` : 'Aa Bb Cc 0123 The quick brown fox') : 'Uses the example’s own font'}
      </span>
    </label>
  );
  return (
    <Card title="Look" hint="Your logo, fonts and colours go on every creative made from an example." done={kitDone(kit).look}>
      <GoogleFonts families={[heading, body].filter((f) => f && !uploaded.has(f))} />
      <div className="bk-logo">
        <div className="bk-field">
          <span className="bk-lab">Logo</span>
          <div className="bk-logo-well">
            {hasLogo
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={`/content/api/brand/logo?v=${logoV}`} alt="Your logo" />
              : <span className="bk-note">No logo yet</span>}
          </div>
          <span className="bk-line">
            <label className="btn btn-sm">{hasLogo ? 'Replace logo' : 'Upload logo'}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload('/content/api/brand/logo', 'logo', e.target.files)} /></label>
            {hasLogo && <button type="button" className="btn btn-sm" onClick={async () => { await up.call('rm', 'DELETE', '/content/api/brand/logo'); setLogoV(0); }}>Remove</button>}
          </span>
          <span className="bk-note">A PNG with a transparent background looks best.</span>
        </div>
        {photos !== undefined && (
          <div className="bk-field">
            <span className="bk-lab">Your photos</span>
            <div className="bk-logo-well" style={{ display: 'flex', gap: 6 }}>
              {photoN > 0
                // eslint-disable-next-line @next/next/no-img-element
                ? Array.from({ length: photoN }, (_, i) => <img key={i} src={`/content/api/brand/photos?i=${i}&v=${photoV}`} alt={`Your photo ${i + 1}`} />)
                : <span className="bk-note">No photos yet</span>}
            </div>
            <span className="bk-line">
              <label className="btn btn-sm">{photoN ? 'Replace photos' : 'Upload 1–4 photos'}
                <input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => upload('/content/api/brand/photos', 'photos', e.target.files)} /></label>
              {photoN > 0 && <button type="button" className="btn btn-sm" onClick={async () => { if (await up.call('rm', 'DELETE', '/content/api/brand/photos')) setPhotoN(0); }}>Remove</button>}
            </span>
            <span className="bk-note">Used when a design has a person in it. A clear head-and-shoulders shot works best; without one, the person is left out.</span>
          </div>
        )}
        <fieldset className="bk-field bk-corner-set">
          <legend className="bk-lab">Logo corner</legend>
          <div className="bk-corner">
            {CORNERS.map(([k, l]) => (
              <button key={k} type="button" aria-pressed={corner === k} aria-label={l} title={l} onClick={() => setCorner(k)} />
            ))}
          </div>
          <span className="bk-note">{CORNERS.find(([k]) => k === corner)?.[1]}</span>
        </fieldset>
      </div>
      <div className="bk-fonts">
        {fontPick('Heading font', heading, setHeading, 800)}
        {fontPick('Body font', body, setBody, 400)}
      </div>
      <span className="bk-line">
        <label className="btn btn-sm">Upload your own font (.ttf / .otf)
          <input type="file" accept=".ttf,.otf,font/ttf,font/otf" multiple hidden onChange={(e) => upload('/content/api/brand/fonts', 'font', e.target.files)} /></label>
        {[...uploaded].map((f) => (
          <button key={f} type="button" className="btn btn-sm" title="Remove this font" onClick={() => confirm(`Remove ${f}?`) && up.call('rm', 'DELETE', `/content/api/brand/fonts?family=${encodeURIComponent(f)}`)}>{f} ×</button>
        ))}
        {up.feedback}
      </span>
      <div className="bk-field">
        <span className="bk-lab">Brand colours</span>
        <div className="bk-swatches">
          {palette.map((c, i) => (
            <span key={i} className="bk-swatch">
              <input type="color" value={c} onChange={(e) => setPalette(palette.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Colour ${i + 1}`} />
              <span className="mono">{c}</span>
              <button type="button" onClick={() => setPalette(palette.filter((_, j) => j !== i))} aria-label={`Remove colour ${c}`}>×</button>
            </span>
          ))}
          {palette.length < 6 && <button type="button" className="btn btn-sm" onClick={() => setPalette([...palette, '#111111'])}>+ Colour</button>}
        </div>
        <span className="bk-note">Text on a creative uses your darkest or lightest colour when it’s readable on the background.</span>
      </div>
      <SaveRow a={a} label={cta} onClick={() => save(a, { headingFont: heading || null, bodyFont: body || null, logoCorner: corner, palette }, onSaved)} />
    </Card>
  );
}

const NETS = [['linkedin', 'LinkedIn', 'Page or profile link'], ['x', 'X', '@handle'], ['instagram', 'Instagram', '@handle'], ['facebook', 'Facebook', 'Page link'], ['youtube', 'YouTube', '@handle or channel link']] as const;

function AccountsSection({ kit }: { kit: Brand }) {
  const a = useAction();
  const [h, setH] = useState<Record<string, string>>({ ...kit.ownHandles });
  return (
    <Card title="Your accounts" hint="Your own profiles, so we can measure how your posts do against your usual and learn from your best ones." done={kitDone(kit).accounts}>
      <div className="bk-accounts">
        {NETS.map(([k, label, ph]) => (
          <label key={k} className="bk-field"><span className="bk-lab">{label}</span>
            <input className="input mono" style={{ fontSize: 12 }} placeholder={ph} value={h[k] ?? ''} onChange={(e) => setH({ ...h, [k]: e.target.value })} /></label>
        ))}
      </div>
      <SaveRow a={a} onClick={() => save(a, { ownHandles: h })} />
    </Card>
  );
}

// Relative luminance, to pick readable text on the preview tile the way the renderer does.
const lum = (hex: string) => {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

/** The saved kit as a post: name, line, a creative tile in the brand's look, and the main offer. */
export function BrandProof({ kit, fonts = [] }: { kit: Brand; fonts?: FontRow[] }) {
  const v = useMemo(() => Date.now(), [kit]); // new logo after every refresh
  const bg = kit.palette[0] ?? '#111111';
  const ink = [...kit.palette.slice(1), '#111111', '#ffffff'].sort((p, q) => contrast(bg, q) - contrast(bg, p))[0]!;
  const uploaded = new Set(fonts.filter((f) => f.source === 'upload').map((f) => f.family));
  const fam = (f: string | null) => (f ? `'${f}', var(--font-ui)` : undefined);
  const offer = kit.offers.find((o) => o.primary) ?? kit.offers[0];
  const theme = kit.pillars[0]?.label;
  return (
    <aside className="bk-proof" aria-label="Preview of a post">
      <div className="bk-proof-cap">
        <b>Preview</b>
        <span>Updates as you save</span>
      </div>
      <GoogleFonts families={[kit.headingFont, kit.bodyFont].filter((f): f is string => !!f && !uploaded.has(f))} />
      <div className="bk-post">
        <div className="bk-who">
          {kit.hasLogo
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={`/content/api/brand/logo?v=${v}`} alt="" />
            : <span className="bk-av" aria-hidden>{(kit.name.trim()[0] ?? '?').toUpperCase()}</span>}
          <div style={{ minWidth: 0 }}>
            <b>{kit.name || 'Your name'}</b>
            <small>{kit.tagline || 'What you do, in one line'}</small>
          </div>
        </div>
        <div className="bk-tile" style={{ background: bg, color: ink }} data-corner={kit.logoCorner}>
          <span className="bk-tile-h" style={{ fontFamily: fam(kit.headingFont) }}>{theme ?? 'Your first theme goes here'}</span>
          <span className="bk-tile-b" style={{ fontFamily: fam(kit.bodyFont) }}>{kit.pillars[0]?.description || kit.tagline || 'A line of supporting text'}</span>
          {kit.hasLogo
            // eslint-disable-next-line @next/next/no-img-element
            ? <img className="bk-tile-logo" src={`/content/api/brand/logo?v=${v}`} alt="" />
            : <span className="bk-tile-logo bk-tile-nologo" style={{ borderColor: ink }} aria-hidden />}
        </div>
        <p className="bk-cta">{offer ? <>{offer.cta || offer.label} <u>{offer.url.replace(/^https?:\/\//, '') || 'your link'}</u></> : 'No offer yet, so posts end without a link.'}</p>
      </div>
      <dl className="bk-facts">
        <dt>Themes</dt>
        <dd>{kit.pillars.length ? kit.pillars.map((p, i) => <span key={p.slug} className="chip" style={{ ['--c' as string]: CATEGORY[i % CATEGORY.length] }}>{p.label} {p.target}%</span>) : 'None yet'}</dd>
        <dt>Colours</dt>
        <dd>{kit.palette.length ? kit.palette.map((c, i) => <i key={i} className="bk-chip-c" style={{ background: c }} title={c} />) : 'From each style'}</dd>
        <dt>Fonts</dt>
        <dd>{kit.headingFont || kit.bodyFont ? [kit.headingFont, kit.bodyFont].filter(Boolean).join(' and ') : 'From each style'}</dd>
      </dl>
    </aside>
  );
}

/** Rules the system learned from review notes. Shown so the founder can see (and veto) what it learned. */
export function LearnedSection({ kit }: { kit: Brand }) {
  const a = useAction();
  const rules = kit.learnedRules ?? [];
  return (
    <Card title="Learned from your feedback" hint="Every time you ask for changes or reject a post, your note is remembered. Every few notes they become standing rules that every new draft follows.">
      {rules.length === 0
        ? <p className="bk-note">Nothing learned yet. Use the reason chips when you ask for changes on a post; after a few notes the rules show up here.</p>
        : (
          <ul className="row-list bk-rows">
            {rules.map((r, i) => (
              <li key={i} className="row">
                <span className="grow t" style={{ whiteSpace: 'normal' }}>{r}</span>
                <button type="button" className="btn btn-sm" disabled={a.pending} aria-label={`Forget: ${r}`}
                  onClick={() => save(a, { learnedRules: rules.filter((_, j) => j !== i) })}>Forget</button>
              </li>
            ))}
          </ul>
        )}
      {a.feedback}
    </Card>
  );
}

const PARTS: [keyof ReturnType<typeof kitDone>, string][] = [
  ['identity', 'Who you are'], ['voice', 'Your voice'], ['audience', 'Audience and themes'],
  ['offers', 'Offers'], ['look', 'Look'], ['accounts', 'Your accounts'],
];

/** How much of the kit is set, and a jump to the next part to fill. Every draft and decision reads the kit. */
function KitMeter({ kit }: { kit: Brand }) {
  const done = kitDone(kit);
  const left = PARTS.filter(([k]) => !done[k]);
  return (
    <div className={left.length ? 'attention kit-meter' : 'kit-meter'}>
      <div className="kit-bar" aria-hidden>{PARTS.map(([k]) => <span key={k} data-done={done[k] || undefined} />)}</div>
      <p style={{ margin: 0 }}>
        <b>{PARTS.length - left.length} of {PARTS.length} parts set.</b>{' '}
        Every draft, script and decision is written from this kit{left.length ? ', so the gaps show up in the posts.' : '.'}
      </p>
      {left.length > 0 && <a href={`#${anchor(left[0]![1])}`} className="btn btn-primary btn-sm">Fill in: {left[0]![1]}</a>}
    </div>
  );
}

/** The whole kit on one page (/content/brand). */
export function BrandKit({ kit, fonts, curated, photos }: { kit: Brand; fonts: FontRow[]; curated: readonly string[]; photos?: number }) {
  return (
    <div className="bk-page">
      <div className="bk-sheet">
        <KitMeter kit={kit} />
        <IdentitySection kit={kit} />
        <VoiceSection kit={kit} />
        <AudienceSection kit={kit} />
        <OffersSection kit={kit} />
        <LookSection kit={kit} fonts={fonts} curated={curated} photos={photos} />
        <AccountsSection kit={kit} />
        <LearnedSection kit={kit} />
      </div>
      <BrandProof kit={kit} fonts={fonts} />
    </div>
  );
}
