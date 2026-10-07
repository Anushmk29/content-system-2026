'use client';
// Decode — the competitor spy page body (docs/DESIGN-GUIDE.md §6–§6e). Polls the run every
// second while it works; each poll's new posts drive the counters and the fly-in. Selection
// (format filter ?f=, pinned post ?v=, grouping ?by=) lives in the URL without a server trip.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { DecodeView, DecodedPostRow, DecodeFormatRow, DecodeRunRow } from '@pratapai/content-pipeline';
import { KpiStrip, Section } from './viz';
import { LogScatter, Face, type ScatterPoint } from './LogScatter';
import { useAction } from './actions';
import { CATEGORY, NO_CATEGORY, PLATFORM, compact } from './format';

type Vars = CSSProperties & Record<`--${string}`, string>;
type By = 'format' | 'competitor' | 'platform' | 'post type' | 'length';
const BYS: By[] = ['format', 'competitor', 'platform', 'post type', 'length'];
const BEAT_COLOR: Record<string, string> = {
  hook: '#7c3aed', setup: '#b7791f', proof: '#2f5fb3', offer: '#c2410c', method: '#4d7c0f', benefit: '#2f8f4e', other: '#a3a29b', cta: '#111111',
};
const BEAT_LABEL = (t: string) => (t === 'offer' ? 'offer shows up' : t);
const NONE = 'none';
const DRIP = 120; // ms between cards of one poll's batch

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const byVs = (a: DecodedPostRow, b: DecodedPostRow) => (b.vs_own_median ?? -1) - (a.vs_own_median ?? -1) || b.reactions - a.reactions;
const lengthOf = (p: DecodedPostRow) => (p.post_type === 'video' && p.duration_s != null
  ? (p.duration_s < 30 ? 'video < 30s' : p.duration_s < 90 ? 'video 30–90s' : 'video 90s+')
  : p.caption.length < 280 ? 'short text' : p.caption.length < 1000 ? 'medium text' : 'long text');
const x = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}x`);

export type StyleOpt = { id: string; name: string };

export function Decode({ view, initial, apifyReady, styles }: {
  view: DecodeView; initial: { f?: string; v?: string; by?: string }; apifyReady: boolean; styles: StyleOpt[];
}) {
  const [run, setRun] = useState<DecodeRunRow | null>(view.run);
  const [posts, setPosts] = useState<DecodedPostRow[]>(view.posts);
  const [formats, setFormats] = useState<DecodeFormatRow[]>(view.formats);
  const [fmt, setFmt] = useState<string | null>(initial.f ?? null);
  const [pin, setPin] = useState<string | null>(initial.v ?? null);
  const [by, setBy] = useState<By>(BYS.includes(initial.by as By) ? (initial.by as By) : 'format');
  const grid = useRef<HTMLDivElement>(null);
  const a = useAction();
  const live = run?.status === 'running';

  // ---- polling: only posts after the highest seq we hold ----
  const maxSeq = useRef(0);
  maxSeq.current = posts.reduce((m, p) => Math.max(m, p.seq), 0);
  useEffect(() => {
    if (!live || !run) return;
    const t = setInterval(async () => {
      const r = await fetch(`/content/api/decode/${run.id}?after=${maxSeq.current}`).then((res) => res.json()).catch(() => null);
      if (!r?.ok) return;
      setRun(r.run);
      setFormats(r.formats);
      // A batch lands in one poll; drip it in one card at a time so it reads as a stream.
      (r.posts as DecodedPostRow[]).forEach((p, i) => setTimeout(() =>
        setPosts((cur) => (cur.some((c) => c.id === p.id) ? cur : [...cur, p])), i * DRIP));
    }, 1000);
    return () => clearInterval(t);
  }, [live, run?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- selection ↔ URL (no navigation) ----
  useEffect(() => {
    const u = new URL(window.location.href);
    for (const [k, v] of [['f', fmt], ['v', pin], ['by', by === 'format' ? null : by]] as const) v ? u.searchParams.set(k, v) : u.searchParams.delete(k);
    window.history.replaceState(null, '', u);
  }, [fmt, pin, by]);

  const fIdx = useMemo(() => new Map(formats.map((f) => [f.id, f])), [formats]);
  const colorOf = (id: string | null) => (id && fIdx.has(id) ? CATEGORY[fIdx.get(id)!.idx % CATEGORY.length]! : NO_CATEGORY);
  const inFmt = (p: DecodedPostRow) => !fmt || (fmt === NONE ? !p.format_id : p.format_id === fmt);
  const ranked = useMemo(() => [...posts].sort(byVs), [posts]);
  const rankOf = useMemo(() => new Map(ranked.map((p, i) => [p.id, i + 1])), [ranked]);
  const shown = ranked.filter(inFmt);
  const newest = posts.reduce<DecodedPostRow | null>((m, p) => (!m || p.seq > m.seq ? p : m), null);
  const spot = posts.find((p) => p.id === pin) ?? (live ? newest : shown[0] ?? null);

  // ←/→ walk the ranking, Esc goes back to following
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'Escape') setPin(null);
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const i = shown.findIndex((p) => p.id === spot?.id);
      const next = shown[Math.min(shown.length - 1, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1)))];
      if (next) { setPin(next.id); e.preventDefault(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  const points: ScatterPoint[] = useMemo(() => posts.map((p) => ({
    id: p.id, x: p.reactions, y: p.comments + p.shares, seq: p.seq, thumb: p.thumb, text: p.hook ?? p.caption,
    color: colorOf(p.format_id), platformColor: PLATFORM[p.platform]?.color ?? NO_CATEGORY,
    tip: [`@${p.handle ?? p.competitor ?? '?'} · ${compact(p.reactions)} reactions · ${compact(p.comments + p.shares)} comments+shares`,
      p.format_id ? fIdx.get(p.format_id)?.name ?? '' : 'no clear format'],
  })), [posts, fIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = !run ? 'no run yet'
    : live && run.stage === 'scraping' ? `▸ scraping · ${run.total} posts`
    : live && run.stage === 'sorting' ? `▸ sorting into formats · ${run.total} posts`
    : live ? `▸ decoding · ${run.decoded.toLocaleString('en-US')} / ${run.total.toLocaleString('en-US')}`
    : `${shown.length} posts · median ${compact(median(shown.map((p) => p.reactions)) ?? 0)} reactions · ${x(median(shown.flatMap((p) => p.vs_own_median ?? [])))} their usual`;

  async function start(body: Record<string, unknown>) {
    const d = await a.call('start', 'POST', '/content/api/decode', body);
    if (!d?.run) return;
    if (!body.resumeRunId) { setPosts([]); setFormats([]); setPin(null); setFmt(null); }
    setRun(d.run);
  }
  async function stop() {
    if (run && await a.call('stop', 'PATCH', `/content/api/decode/${run.id}`)) setRun({ ...run, status: 'stopped' });
  }

  return (
    <>
      <KpiStrip items={[
        { label: 'Posts decoded', value: run?.decoded ?? 0, sub: run ? `of ${run.total.toLocaleString('en-US')} scraped` : 'no run yet' },
        { label: 'Competitors', value: new Set(posts.map((p) => p.competitor_id)).size || (run?.competitor_ids.length ?? 0) },
        { label: 'Sorted into a format', value: posts.filter((p) => p.format_id).length, denom: `${formats.length} formats` },
        { label: 'Median reactions', value: Math.round(median(posts.map((p) => p.reactions)) ?? 0) },
        { label: 'AI + Apify cost · est', value: (run?.cost_ai_usd ?? 0) + (run?.cost_apify_usd ?? 0), money: true,
          sub: run ? `$${run.cost_ai_usd.toFixed(2)} ai + $${run.cost_apify_usd.toFixed(2)} apify` : undefined },
      ]} />

      <Section eyebrow="Inside the archive" title="every post they made, in one picture"
        meta={<RunBar run={run} live={live} apifyReady={apifyReady} competitors={view.competitors.filter((c) => c.active).length}
          busy={a.busy} feedback={a.feedback} onStart={start} onStop={stop} />}>
        <div className="band">
          <div>
            <div className="pane-head"><span className="label">Top posts</span><span className="tick" style={{ position: 'static' }}>vs their usual</span></div>
            <TopGrid gridRef={grid} posts={shown.slice(0, 12)} spotId={spot?.id ?? null} onPick={setPin} />
          </div>
          <div>
            <LogScatter points={points} origin={grid}
              match={fmt ? (id) => inFmt(posts.find((p) => p.id === id)!) : null}
              matchColor={fmt ? (fmt === NONE ? NO_CATEGORY : colorOf(fmt)) : null}
              spotId={spot?.id ?? null} onPick={setPin} status={status}
              label={`${posts.length} competitor posts plotted by reactions and comments plus shares`} />
            <div className="legend">
              <button type="button" aria-pressed={!fmt} onClick={() => setFmt(null)}><span className="dot" style={{ '--c': 'var(--ink)' } as Vars} />all formats ({posts.length})</button>
              {formats.map((f) => (
                <button key={f.id} type="button" aria-pressed={fmt === f.id} onClick={() => setFmt(fmt === f.id ? null : f.id)}>
                  <span className="dot" style={{ '--c': colorOf(f.id) } as Vars} />{f.name} ({posts.filter((p) => p.format_id === f.id).length})
                </button>
              ))}
              <button type="button" aria-pressed={fmt === NONE} onClick={() => setFmt(fmt === NONE ? null : NONE)}>
                <span className="dot" style={{ '--c': NO_CATEGORY } as Vars} />no clear format ({posts.filter((p) => !p.format_id).length})
              </button>
            </div>
            <table className="sr-only">
              <caption>Top posts by performance against each competitor’s usual</caption>
              <tbody>{ranked.slice(0, 50).map((p) => <tr key={p.id}><td>{p.handle}</td><td>{p.platform}</td><td>{p.reactions} reactions</td><td>{p.comments + p.shares} comments+shares</td><td>{x(p.vs_own_median)} their usual</td></tr>)}</tbody>
            </table>
          </div>
          <PostPane post={spot} rank={spot ? rankOf.get(spot.id)! : 0} of={posts.length} pinned={!!pin}
            format={spot?.format_id ? fIdx.get(spot.format_id) ?? null : null} color={colorOf(spot?.format_id ?? null)} styles={styles} />
        </div>
      </Section>

      <FormatsWin posts={posts} formats={formats} by={by} setBy={setBy} fmt={fmt} setFmt={setFmt} colorOf={colorOf} styles={styles} />
      <Gaps posts={posts} formats={formats} colorOf={colorOf} styles={styles} />
    </>
  );
}

// ---- run controls: ⏸ stop while running, ▶ decode otherwise ----------------------
function RunBar({ run, live, apifyReady, competitors, busy, feedback, onStart, onStop }: {
  run: DecodeRunRow | null; live: boolean; apifyReady: boolean; competitors: number; busy: string | null;
  feedback: React.ReactNode; onStart: (b: Record<string, unknown>) => void; onStop: () => void;
}) {
  const [platforms, setPlatforms] = useState<string[]>(['x', 'instagram', 'linkedin', 'facebook']);
  const [days, setDays] = useState(90);
  const [cap, setCap] = useState(10);
  const resumable = run && (run.status === 'stopped' || run.status === 'error');
  return (
    <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
      <span>
        {run ? `${run.platforms.join(' · ')} · last ${run.lookback_days} days · up to ${run.post_cap} posts per account · ${run.status}` : 'no run yet'}
        {run?.message && <span style={{ color: run.status === 'error' ? 'var(--danger)' : 'var(--warn)' }}> · {run.message}</span>}
      </span>
      <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {feedback}
        {live ? (
          <button type="button" className="btn btn-ink btn-sm" disabled={busy === 'stop'} onClick={onStop}>⏸ stop</button>
        ) : (
          <>
            {['x', 'instagram', 'linkedin', 'facebook'].map((p) => (
              <label key={p} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                <input type="checkbox" checked={platforms.includes(p)} onChange={(e) => setPlatforms(e.target.checked ? [...platforms, p] : platforms.filter((q) => q !== p))} />
                {PLATFORM[p]?.glyph ?? p}
              </label>
            ))}
            <label>days <input className="input" type="number" min={7} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 64, padding: '2px 6px' }} /></label>
            <label>cap <input className="input" type="number" min={5} max={500} value={cap} onChange={(e) => setCap(Number(e.target.value))} style={{ width: 64, padding: '2px 6px' }} /></label>
            {resumable && <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => onStart({ resumeRunId: run.id })}>resume</button>}
            <button type="button" className="btn btn-lime btn-sm" disabled={!!busy || !apifyReady || !competitors || !platforms.length}
              title={!apifyReady ? 'Add CONTENT_APIFY_TOKEN to .env first' : !competitors ? 'Add a competitor first' : undefined}
              onClick={() => onStart({ platforms, lookbackDays: days, postCap: cap })}>{busy === 'start' ? '…' : '▶ decode'}</button>
          </>
        )}
      </span>
    </span>
  );
}

// ---- top posts grid: re-sorts as results land (FLIP, 400ms) ----------------------
function TopGrid({ gridRef, posts, spotId, onPick }: {
  gridRef: React.Ref<HTMLDivElement>; posts: DecodedPostRow[]; spotId: string | null; onPick: (id: string) => void;
}) {
  const cells = useRef(new Map<string, HTMLElement>());
  const prev = useRef(new Map<string, [number, number]>());
  useLayoutEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, [number, number]>();
    cells.current.forEach((el, id) => {
      next.set(id, [el.offsetLeft, el.offsetTop]);
      const p = prev.current.get(id);
      if (!reduce && p && (p[0] !== el.offsetLeft || p[1] !== el.offsetTop)) {
        el.animate([{ transform: `translate(${p[0] - el.offsetLeft}px, ${p[1] - el.offsetTop}px)` }, { transform: 'none' }],
          { duration: 400, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    });
    prev.current = next;
  });
  return (
    <div className="topgrid" ref={gridRef} style={{ position: 'relative', minHeight: 120 }}>
      {!posts.length && <p className="empty" style={{ fontSize: 12, gridColumn: '1 / -1' }}>Top posts land here as they’re decoded.</p>}
      {posts.map((p) => (
        <button key={p.id} type="button" aria-current={p.id === spotId || undefined} title={`@${p.handle} · ${x(p.vs_own_median)} their usual`}
          ref={(el) => { if (el) cells.current.set(p.id, el); else cells.current.delete(p.id); }} onClick={() => onPick(p.id)}>
          <Face p={{ thumb: p.thumb, text: p.hook ?? p.caption, platformColor: PLATFORM[p.platform]?.color ?? NO_CATEGORY }} />
          <span className="x">{x(p.vs_own_median)}</span>
        </button>
      ))}
    </div>
  );
}

// ---- inside the post -------------------------------------------------------------
function PostPane({ post, rank, of, pinned, format, color, styles }: {
  post: DecodedPostRow | null; rank: number; of: number; pinned: boolean; format: DecodeFormatRow | null; color: string; styles: StyleOpt[];
}) {
  const a = useAction();
  if (!post) return <div className="post-pane"><div className="label">Inside the post</div><p className="empty">Pick a point on the map.</p></div>;
  const len = post.beats.reduce((s, b) => s + Math.max(b.text.length, 12), 0) || 1;
  const vs = post.vs_own_median;
  const tags = [...new Set(post.beats.map((b) => b.tag))];
  return (
    <div className="post-pane">
      <div className="fade" key={post.id}>
        <div className="pane-head">
          <span className="label">Inside the post</span>
          <span className="tick" style={{ position: 'static', color: 'var(--ink-2)' }}>#{rank} of {of.toLocaleString('en-US')}</span>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <span style={{ width: 80, height: 100, flexShrink: 0 }}>
            <Face p={{ thumb: post.thumb, text: post.hook ?? post.caption, platformColor: PLATFORM[post.platform]?.color ?? NO_CATEGORY }} words={14} />
          </span>
          <div style={{ minWidth: 0, display: 'grid', gap: 5, alignContent: 'start' }}>
            <b style={{ fontSize: 14 }}>@{post.handle ?? post.competitor}</b>
            <span className="mono faint" style={{ fontSize: 11 }}>
              {[post.posted_at?.slice(0, 10), post.platform, post.post_type, post.duration_s != null ? `${post.duration_s}s` : null].filter(Boolean).join(' · ')}
            </span>
            <span className="chip" style={{ '--c': color, whiteSpace: 'normal' } as Vars}>{format?.name ?? 'no clear format'}</span>
            <a className="mono" href={post.url} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>original post ↗</a>
          </div>
        </div>
        <p className="hook">{post.hook ?? (post.caption.slice(0, 220) || '(no text)')}</p>
        <div className="trio">
          <div><span className="label">Reactions</span><b>{compact(post.reactions)}</b></div>
          <div><span className="label">Comments + shares</span><b>{compact(post.comments + post.shares)}</b></div>
          <div><span className="label">Views</span><b>{post.views == null ? '—' : compact(post.views)}</b></div>
        </div>
        <span className="pill" style={{ '--c': vs != null && vs > 1 ? 'var(--ok)' : 'var(--muted)' } as Vars}>{x(vs)} their usual</span>
        {pinned && <span className="faint mono" style={{ fontSize: 10.5, marginLeft: 8 }}>pinned · esc to follow</span>}

        <div className="label" style={{ marginTop: 18 }}>Post anatomy</div>
        {post.beats.length ? (
          <>
            <div className="anat">{post.beats.map((b, i) => <span key={i} title={BEAT_LABEL(b.tag)} style={{ width: `${(Math.max(b.text.length, 12) / len) * 100}%`, background: BEAT_COLOR[b.tag] }} />)}</div>
            <div className="mono faint" style={{ fontSize: 10.5, display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
              {tags.map((t) => <span key={t}><span style={{ color: BEAT_COLOR[t] }}>■</span> {BEAT_LABEL(t)}</span>)}
            </div>
            <ul className="beats">
              {post.beats.map((b, i) => (
                <li key={i} style={{ '--c': BEAT_COLOR[b.tag] } as Vars}>
                  <span className="label">{b.at} · {BEAT_LABEL(b.tag)}</span>{b.text}
                </li>
              ))}
            </ul>
          </>
        ) : <p className="empty">Not broken down yet.</p>}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
          <MakeMine key={post.id} target={{ postId: post.id }} platform={post.platform} styles={styles} />
          <button type="button" className="btn btn-sm btn-lime-o" disabled={a.pending} onClick={() => a.call('use', 'POST', '/content/api/decode/use', { postId: post.id, mode: 'use' })}>add to ideas</button>
          <button type="button" className="btn btn-sm btn-lime-o" disabled={a.pending} onClick={() => a.call('counter', 'POST', '/content/api/decode/use', { postId: post.id, mode: 'counter' })}>
            {a.busy === 'counter' ? 'thinking…' : 'counter-angle →'}
          </button>
        </div>
        <div style={{ marginTop: 6 }}>{a.feedback}</div>
        {post.caption && <details style={{ marginTop: 14 }}><summary className="label" style={{ cursor: 'pointer' }}>Raw caption</summary><p className="pre" style={{ fontSize: 12.5 }}>{post.caption}</p></details>}
      </div>
    </div>
  );
}

// ---- which formats win -------------------------------------------------------------
interface Group { key: string; name: string; desc: string; color: string; posts: DecodedPostRow[]; med: number | null; medVs: number | null; formatId?: string }

function groupPosts(posts: DecodedPostRow[], formats: DecodeFormatRow[], by: By, colorOf: (id: string | null) => string): Group[] {
  const keyOf = (p: DecodedPostRow) => by === 'format' ? p.format_id ?? NONE : by === 'competitor' ? p.competitor ?? p.handle ?? '?'
    : by === 'platform' ? p.platform : by === 'post type' ? p.post_type : lengthOf(p);
  const groups = new Map<string, DecodedPostRow[]>();
  for (const p of posts) groups.set(keyOf(p), [...(groups.get(keyOf(p)) ?? []), p]);
  const fmts = new Map(formats.map((f) => [f.id, f]));
  return [...groups].map(([key, ps], i): Group => {
    const f = fmts.get(key);
    return {
      key, posts: ps, formatId: f?.id,
      name: by === 'format' ? f?.name ?? 'no clear format' : by === 'platform' ? PLATFORM[key]?.label ?? key : key,
      desc: by === 'format' ? f?.description ?? 'posts that didn’t fit a recurring structure' : `${ps.length} posts`,
      color: by === 'format' ? colorOf(f?.id ?? null) : by === 'platform' ? PLATFORM[key]?.color ?? NO_CATEGORY : CATEGORY[i % CATEGORY.length]!,
      med: median(ps.map((p) => p.reactions)), medVs: median(ps.flatMap((p) => p.vs_own_median ?? [])),
    };
  }).sort((a, b) => (b.medVs ?? -1) - (a.medVs ?? -1));
}

function FormatsWin({ posts, formats, by, setBy, fmt, setFmt, colorOf, styles }: {
  posts: DecodedPostRow[]; formats: DecodeFormatRow[]; by: By; setBy: (b: By) => void;
  fmt: string | null; setFmt: (f: string | null) => void; colorOf: (id: string | null) => string; styles: StyleOpt[];
}) {
  const groups = groupPosts(posts, formats, by, colorOf);
  const cur = by === 'format' ? groups.find((g) => g.key === (fmt ?? '')) : undefined;
  const scope = cur?.posts ?? posts;
  return (
    <Section eyebrow="Follow the evidence" title="Which formats win?"
      meta={`all competitors · all platforms · comparing ${by} · ${posts.length.toLocaleString('en-US')} posts · ranked by median vs their usual`}>
      <nav className="seg" aria-label="Compare by" style={{ marginBottom: 14 }}>
        {BYS.map((b) => <button key={b} type="button" aria-current={by === b ? 'page' : undefined} onClick={() => setBy(b)}>{b}</button>)}
      </nav>
      {!groups.length ? <p className="empty">Nothing decoded yet.</p> : (
        <div className="win">
          <ul className="row-list rank">
            {groups.map((g) => {
              const selected = by === 'format' && fmt === g.key;
              const body = (
                <>
                  <span className="dot" style={{ '--c': g.color, marginTop: 6 } as Vars} />
                  <div className="grow">
                    <div className="t" style={{ fontWeight: 600 }}>{g.name}</div>
                    <div className="d">{g.desc}</div>
                  </div>
                  {g.formatId && <FormatActions formatId={g.formatId} styles={styles} />}
                  <span className="mono" style={{ fontSize: 11.5, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {g.posts.length} posts<br /><span className="faint">{x(g.medVs)} · {compact(g.med ?? 0)}</span>
                  </span>
                </>
              );
              return (
                <li key={g.key}>
                  {by === 'format'
                    ? <div className="row" role="button" tabIndex={0} aria-current={selected || undefined} style={{ cursor: 'pointer' }}
                        onClick={() => setFmt(selected ? null : g.key)} onKeyDown={(e) => { if (e.key === 'Enter') setFmt(selected ? null : g.key); }}>{body}</div>
                    : <div className="row">{body}</div>}
                </li>
              );
            })}
          </ul>
          <div className="stats">
            <div><span className="label">Matching posts</span><b>{scope.length.toLocaleString('en-US')}</b><span className="faint mono" style={{ fontSize: 11 }}>{cur?.name ?? 'all formats'}</span></div>
            <div><span className="label">Median reactions</span><b>{compact(median(scope.map((p) => p.reactions)) ?? 0)}</b></div>
            <div><span className="label">Median vs their usual</span><b>{x(median(scope.flatMap((p) => p.vs_own_median ?? [])))}</b></div>
          </div>
        </div>
      )}
    </Section>
  );
}

function FormatActions({ formatId, styles }: { formatId: string; styles: StyleOpt[] }) {
  const a = useAction();
  return (
    <span className="acts" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <MakeMine target={{ formatId }} styles={styles} />
      <button type="button" className="btn btn-sm btn-lime-o" disabled={a.pending} onClick={() => a.call('use', 'POST', '/content/api/decode/use', { formatId, mode: 'use' })}>add to ideas</button>
      <button type="button" className="btn btn-sm btn-lime-o" disabled={a.pending} onClick={() => a.call('counter', 'POST', '/content/api/decode/use', { formatId, mode: 'counter' })}>
        {a.busy === 'counter' ? 'thinking…' : 'counter-angle →'}
      </button>
      {a.feedback}
    </span>
  );
}

// ---- what they do that we don't ----------------------------------------------------------
function Gaps({ posts, formats, colorOf, styles }: { posts: DecodedPostRow[]; formats: DecodeFormatRow[]; colorOf: (id: string | null) => string; styles: StyleOpt[] }) {
  const gaps = groupPosts(posts, formats, 'format', colorOf)
    .filter((g) => g.formatId && fmtOurs(formats, g.formatId) === 0 && g.posts.length > 0);
  if (!formats.length) return null;
  return (
    <Section eyebrow="Follow the gaps" title="What they do that we don't."
      meta="formats that work for competitors that you haven’t posted yet · strongest first · our count is the LLM's estimate from recent titles">
      {!gaps.length ? <p className="empty">No gaps — we already use every format they do.</p> : (
        <ul className="row-list rank">
          {gaps.map((g) => (
            <li key={g.key}>
              <div className="row">
                <span className="dot" style={{ '--c': g.color, marginTop: 6 } as Vars} />
                <div className="grow"><div className="t" style={{ fontWeight: 600 }}>{g.name}</div><div className="d">{g.desc}</div></div>
                <FormatActions formatId={g.formatId!} styles={styles} />
                <span className="mono" style={{ fontSize: 11.5, textAlign: 'right' }}>{g.posts.length} posts<br /><span className="faint">{x(g.medVs)} their usual</span></span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
const fmtOurs = (formats: DecodeFormatRow[], id: string) => formats.find((f) => f.id === id)?.our_post_count ?? 0;

// ---- make my version: their structure, our post --------------------------------------
const TARGETS = [['linkedin', 'LinkedIn'], ['x', 'X'], ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['blog', 'Blog']] as const;

export function MakeMine({ target, platform, styles }: { target: { postId?: string; formatId?: string }; platform?: string; styles: StyleOpt[] }) {
  const a = useAction();
  const [on, setOn] = useState<string[]>(() => [...new Set(['linkedin', platform ?? 'linkedin'])]);
  const [style, setStyle] = useState('');
  const [done, setDone] = useState(false);
  const toggle = (p: string) => setOn((cur) => (cur.includes(p) ? cur.filter((c) => c !== p) : [...cur, p]));
  async function go() {
    setDone(false);
    setDone(!!(await a.call('steal', 'POST', '/content/api/decode/use', { ...target, mode: 'steal', platforms: on, styleId: style || undefined })));
  }
  return (
    <details className="make-mine">
      <summary className="btn btn-sm btn-lime">make my version</summary>
      <div className="make-pop">
        <fieldset>
          <legend className="label">Write it for</legend>
          {TARGETS.map(([p, l]) => (
            <label key={p}><input type="checkbox" checked={on.includes(p)} onChange={() => toggle(p)} /> {l}</label>
          ))}
        </fieldset>
        <label className="make-style">
          <span className="label">Picture</span>
          <select value={style} onChange={(e) => setStyle(e.target.value)}>
            <option value="">Text only</option>
            {styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <p className="faint">Same structure and hook pattern, your topic, voice and offer. Their numbers, names and claims are never copied. Takes about a minute.</p>
        <button type="button" className="btn btn-sm btn-lime" disabled={a.pending || !on.length} onClick={go}>
          {a.busy === 'steal' ? 'Writing your version…' : 'Write my version'}
        </button>
        {a.feedback}
        {done && <a href="/content/approvals" style={{ fontSize: 12.5 }}>Open Approvals</a>}
      </div>
    </details>
  );
}
