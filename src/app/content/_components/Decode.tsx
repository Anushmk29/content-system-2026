'use client';
// Decode — the competitor spy page body (docs/development/DESIGN-GUIDE.md §6–§6f). Reads answer → why →
// evidence: the scan bar (steps, settings, who we watch), Make this next (the lime tile), What's
// working (ranked formats, gaps badged in), then the map and the post pane. While a run works
// the map comes first; sequential progress polls drive the progress bar and the fly-in.
// Selection (format ?f=, pinned post ?v=, grouping ?by=) lives in the URL without a server trip.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { CompetitorRow, DecodeView, DecodedPostRow, DecodeFormatRow, DecodeRunRow } from '@pratapai/content-pipeline';
import { Notice, Section } from './viz';
import { LogScatter, Face, type ScatterPoint } from './LogScatter';
import { Competitors } from './Competitors';
import { useAction } from './actions';
import { poll } from '@/app/content/_lib/poll';
import { median } from '@pratapai/content-pipeline/core';
import { CATEGORY, NO_CATEGORY, PLATFORM, compact, times } from '@/app/content/_lib/format';

type Vars = CSSProperties & Record<`--${string}`, string>;
type By = 'format' | 'competitor' | 'platform' | 'post type' | 'length';
const BYS: By[] = ['format', 'competitor', 'platform', 'post type', 'length'];
const BEAT_COLOR: Record<string, string> = {
  hook: '#7c3aed', setup: '#b7791f', proof: '#2f5fb3', offer: '#c2410c', method: '#4d7c0f', benefit: '#2f8f4e', other: '#a3a29b', cta: '#111111',
};
const BEAT_LABEL = (t: string) => (t === 'offer' ? 'offer shows up' : t);
const NONE = 'none';
const DRIP = 120; // ms between cards of one poll's batch
const THIN = 2;   // groups with fewer posts are faded and never recommended
const NETS = ['x', 'instagram', 'linkedin', 'facebook', 'youtube'] as const;
const STAGE: Record<string, string> = {
  scraping: 'collecting posts', transcribing: 'transcribing videos', judging: 'judging fit for you', sorting: 'sorting into formats',
};

const byVs = (a: DecodedPostRow, b: DecodedPostRow) => (b.hunt_score ?? -1) - (a.hunt_score ?? -1)
  || (b.vs_own_median ?? -1) - (a.vs_own_median ?? -1) || b.reactions - a.reactions;
const pretty = (s: string) => s.replace(/_/g, ' ');
const plural = (n: number, w: string) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;
const who = (p: DecodedPostRow) => p.competitor ?? (p.handle ? `@${p.handle}` : 'their');
const lengthOf = (p: DecodedPostRow) => (p.post_type === 'video' && p.duration_s != null
  ? (p.duration_s < 30 ? 'video < 30s' : p.duration_s < 90 ? 'video 30–90s' : 'video 90s+')
  : p.caption.length < 280 ? 'short text' : p.caption.length < 1000 ? 'medium text' : 'long text');
const toEvidence = () => requestAnimationFrame(() => document.getElementById('evidence')?.scrollIntoView({
  behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start',
}));

export type StyleOpt = { id: string; name: string };

export function Decode({ view, initial, apifyReady, youtubeReady, styles }: {
  view: DecodeView; initial: { f?: string; v?: string; by?: string }; apifyReady: boolean; youtubeReady: boolean; styles: StyleOpt[];
}) {
  const [lane, setLane] = useState<string | null>(null);
  const [hookType, setHookType] = useState<string | null>(null);
  const [hidePaid, setHidePaid] = useState(true);
  const [run, setRun] = useState<DecodeRunRow | null>(view.run);
  const [posts, setPosts] = useState<DecodedPostRow[]>(view.posts);
  const [formats, setFormats] = useState<DecodeFormatRow[]>(view.formats);
  const [fmt, setFmt] = useState<string | null>(initial.f ?? null);
  const [pin, setPin] = useState<string | null>(initial.v ?? null);
  const [by, setBy] = useState<By>(BYS.includes(initial.by as By) ? (initial.by as By) : 'format');
  const map = useRef<HTMLDivElement>(null);
  const a = useAction();
  const live = run?.status === 'running';
  // Make this next fades in only when a run finishes in front of you, never on page load.
  const sawLive = useRef(false);
  if (live) sawLive.current = true;

  // ---- polling: only posts after the highest seq we hold ----
  const maxSeq = useRef(0);
  maxSeq.current = posts.reduce((m, p) => Math.max(m, p.seq), 0);
  useEffect(() => {
    if (!live || !run) return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const stop = poll(async (signal) => {
      const r = await fetch(`/content/api/decode/${run.id}?after=${maxSeq.current}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) }).then((res) => res.json()).catch(() => null);
      if (signal.aborted || !r?.ok) return;
      setRun(r.run);
      setFormats(r.formats);
      // A finished run tears down this effect; keep its last batch before cancelling animations.
      if (r.run.status !== 'running') {
        setPosts((cur) => [...cur, ...(r.posts as DecodedPostRow[]).filter((p) => !cur.some((c) => c.id === p.id))]);
        return;
      }
      // A batch lands in one poll; drip it in one card at a time so it reads as a stream.
      (r.posts as DecodedPostRow[]).forEach((p, i) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          setPosts((cur) => (cur.some((c) => c.id === p.id) ? cur : [...cur, p]));
        }, i * DRIP);
        timers.add(timer);
      });
    }, 1000);
    return () => { stop(); timers.forEach(clearTimeout); };
  }, [live, run?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- selection ↔ URL (no navigation) ----
  useEffect(() => {
    const u = new URL(window.location.href);
    for (const [k, v] of [['f', fmt], ['v', pin], ['by', by === 'format' ? null : by]] as const) v ? u.searchParams.set(k, v) : u.searchParams.delete(k);
    window.history.replaceState(null, '', u);
  }, [fmt, pin, by]);

  const fIdx = useMemo(() => new Map(formats.map((f) => [f.id, f])), [formats]);
  const colorOf = (id: string | null) => (id && fIdx.has(id) ? CATEGORY[fIdx.get(id)!.idx % CATEGORY.length]! : NO_CATEGORY);
  const inFmt = (p: DecodedPostRow) => (!fmt || (fmt === NONE ? !p.format_id : p.format_id === fmt))
    && (!lane || p.lane === lane) && (!hookType || p.hook_type === hookType) && (!hidePaid || !p.paid);
  const ranked = useMemo(() => [...posts].sort(byVs), [posts]);
  const rankOf = useMemo(() => new Map(ranked.map((p, i) => [p.id, i + 1])), [ranked]);
  const shown = ranked.filter(inFmt);
  const newest = posts.reduce<DecodedPostRow | null>((m, p) => (!m || p.seq > m.seq ? p : m), null);
  const spot = posts.find((p) => p.id === pin) ?? (live ? newest : shown[0] ?? null);
  const groups = groupPosts(posts, formats, 'format', colorOf);

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
    tip: [`${who(p)} · ${compact(p.reactions)} reactions · ${compact(p.comments + p.shares)} comments+shares`,
      p.format_id ? fIdx.get(p.format_id)?.name ?? '' : 'no clear format'],
  })), [posts, fIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = !run ? 'no scan yet'
    : live && run.stage === 'decoding' ? `▸ reading posts · ${run.decoded.toLocaleString('en-US')} / ${run.total.toLocaleString('en-US')}`
    : live ? `▸ ${STAGE[run.stage] ?? 'working'} · ${run.total} posts`
    : `${plural(shown.length, 'post')} · median ${compact(median(shown.map((p) => p.reactions)) ?? 0)} reactions · ${times(median(shown.flatMap((p) => p.vs_own_median ?? [])))} their usual`;

  async function start(body: Record<string, unknown>) {
    const d = await a.call('start', 'POST', '/content/api/decode', body);
    if (!d?.run) return;
    if (!body.resumeRunId) { setPosts([]); setFormats([]); setPin(null); setFmt(null); }
    setRun(d.run);
  }
  async function stop() {
    if (run && await a.call('stop', 'PATCH', `/content/api/decode/${run.id}`)) setRun({ ...run, status: 'stopped' });
  }

  const counts = (id: string | null) => posts.filter((p) => (id === NONE ? !p.format_id : p.format_id === id)).length;
  const evidence = (
    <Section id="evidence" eyebrow="The evidence" title="Every post, plotted"
      meta="Click a square to read that post. ← and → step through the ranking; Esc goes back to following the newest.">
      <div className="band">
        <div ref={map}>
          <LogScatter points={points} origin={map}
            match={fmt ? (id) => inFmt(posts.find((p) => p.id === id)!) : null}
            matchColor={fmt ? (fmt === NONE ? NO_CATEGORY : colorOf(fmt)) : null}
            spotId={spot?.id ?? null} onPick={setPin} status={status}
            label={`${posts.length} competitor posts plotted by reactions and comments plus shares`} />
          <div className="legend">
            <button type="button" aria-pressed={!fmt} onClick={() => setFmt(null)}><span className="dot" style={{ '--c': 'var(--ink)' } as Vars} />all formats ({posts.length})</button>
            {formats.filter((f) => counts(f.id) > 0).map((f) => (
              <button key={f.id} type="button" aria-pressed={fmt === f.id} onClick={() => setFmt(fmt === f.id ? null : f.id)}>
                <span className="dot" style={{ '--c': colorOf(f.id) } as Vars} />{f.name} ({counts(f.id)})
              </button>
            ))}
            {counts(NONE) > 0 && (
              <button type="button" aria-pressed={fmt === NONE} onClick={() => setFmt(fmt === NONE ? null : NONE)}>
                <span className="dot" style={{ '--c': NO_CATEGORY } as Vars} />no clear format ({counts(NONE)})
              </button>
            )}
          </div>
          <Filters posts={posts} lane={lane} setLane={setLane} hookType={hookType} setHookType={setHookType} hidePaid={hidePaid} setHidePaid={setHidePaid} />
          {/* A table ignores width: 1px, so the wrapper does the clipping. */}
          <div className="sr-only"><table>
            <caption>Top posts by performance against each competitor’s usual</caption>
            <tbody>{ranked.slice(0, 50).map((p) => <tr key={p.id}><td>{p.handle}</td><td>{p.platform}</td><td>{p.reactions} reactions</td><td>{p.comments + p.shares} comments+shares</td><td>{times(p.vs_own_median)} their usual</td></tr>)}</tbody>
          </table></div>
        </div>
        <PostPane post={spot} rank={spot ? rankOf.get(spot.id)! : 0} of={posts.length} pinned={!!pin}
          format={spot?.format_id ? fIdx.get(spot.format_id) ?? null : null} color={colorOf(spot?.format_id ?? null)} styles={styles} />
      </div>
    </Section>
  );
  const wins = <FormatsWin posts={posts} formats={formats} by={by} setBy={setBy} fmt={fmt} setFmt={setFmt} colorOf={colorOf} styles={styles}
    onShow={(id) => { setFmt(id); toEvidence(); }} />;

  return (
    <>
      <ScanBar run={run} live={live} apifyReady={apifyReady} youtubeReady={youtubeReady} competitors={view.competitors}
        busy={a.busy} feedback={a.feedback} onStart={start} onStop={stop} />
      {run?.jev_health != null && run.jev_health < 0.8 && (
        <div className="dc-warn">
          <Notice plain={<>Fit scores are unsure, so ranking leans on reach. <a className="btn btn-sm" href="/content/brand">Improve Brand kit →</a></>}>
            Jev health {run.jev_health.toFixed(2)} (aim ≥ 0.80). The fit questions are built from the Brand kit audience and pillar wording; rankings still use demand.
          </Notice>
        </div>
      )}
      {!posts.length && !live ? (
        <p className="empty" style={{ marginTop: 24 }}>
          {view.competitors.some((c) => c.active)
            ? 'Nothing scanned yet. Press ▶ scan competitors.'
            : 'Add a competitor above to start.'}
        </p>
      ) : live ? <>{evidence}{wins}</> : (
        <>
          <Next groups={groups} formats={formats} ranked={ranked} styles={styles} fade={sawLive.current}
            onShowFormat={(id) => { setFmt(id); toEvidence(); }} onShowPost={(id) => { setPin(id); toEvidence(); }} />
          {wins}
          {evidence}
        </>
      )}
    </>
  );
}

// ---- scan bar: Watch → Scan → Read → Make, settings, progress, who we watch -------------
function ScanBar({ run, live, apifyReady, youtubeReady, competitors, busy, feedback, onStart, onStop }: {
  run: DecodeRunRow | null; live: boolean; apifyReady: boolean; youtubeReady: boolean; competitors: CompetitorRow[]; busy: string | null;
  feedback: React.ReactNode; onStart: (b: Record<string, unknown>) => void; onStop: () => void;
}) {
  const can = (p: string) => (p === 'youtube' ? youtubeReady : apifyReady);
  const lastNets = (run?.platforms ?? []).filter(can);
  const [platforms, setPlatforms] = useState<string[]>(lastNets.length ? lastNets : NETS.filter(can));
  const [days, setDays] = useState(run?.lookback_days ?? 90);
  const [cap, setCap] = useState(run?.post_cap ?? 10);
  const [watch, setWatch] = useState(competitors.length === 0);
  const active = competitors.filter((c) => c.active).length;
  const ready = platforms.some(can);
  const resumable = run && (run.status === 'stopped' || run.status === 'error');
  const cost = run ? run.cost_ai_usd + run.cost_apify_usd + (run.cost_jev_usd ?? 0) : 0;
  const steps = [
    { k: 'Watch', s: active ? 'done' : 'now', sub: active ? plural(active, 'competitor') : 'add who to watch' },
    { k: 'Scan', s: !active ? 'todo' : live && run?.stage === 'scraping' ? 'now' : run?.total ? 'done' : 'now', sub: run?.total ? plural(run.total, 'post') : 'collect their posts' },
    { k: 'Read', s: live && run?.stage !== 'scraping' ? 'now' : run?.decoded ? 'done' : 'todo',
      sub: live ? (run!.stage === 'decoding' ? `reading ${run!.decoded} / ${run!.total}` : STAGE[run!.stage] ?? 'working') : run?.decoded ? `${run.decoded} sorted + broken down` : 'AI sorts and breaks down' },
    { k: 'Make', s: !live && run?.decoded ? 'now' : 'todo', sub: !live && run?.decoded ? 'pick one below' : 'your version of what works' },
  ];
  return (
    <div className="dc-bar">
      <ol className="dc-steps">
        {steps.map((st, i) => (
          <li key={st.k} data-s={st.s} aria-current={st.s === 'now' ? 'step' : undefined}>
            <span className="n">{st.s === 'done' ? '✓' : i + 1}</span><b>{st.k}</b><span className="sub">{st.sub}</span>
          </li>
        ))}
      </ol>
      {live && run && (
        <div className="dc-progress" role="progressbar" aria-label="Posts read" aria-valuemin={0} aria-valuemax={run.total} aria-valuenow={run.decoded}>
          <i style={{ width: `${run.total ? Math.round((run.decoded / run.total) * 100) : 0}%` }} />
        </div>
      )}
      <div className="dc-run">
        <span>
          {run
            ? <span title={`${run.platforms.map((p) => PLATFORM[p]?.label ?? p).join(', ')} · last ${run.lookback_days} days · up to ${run.post_cap} posts per account · $${run.cost_ai_usd.toFixed(2)} AI + $${run.cost_apify_usd.toFixed(2)} Apify + $${(run.cost_jev_usd ?? 0).toFixed(3)} Jev`}>
                last scan {new Date(run.started_at).toISOString().slice(0, 10)} · ${cost.toFixed(2)}</span>
            : 'no scan yet'}
          {run?.message && <span style={{ color: run.status === 'error' ? 'var(--danger)' : 'var(--warn)' }}> · {run.message}</span>}
          {' · '}
          <button type="button" className="linkish" aria-expanded={watch} onClick={() => setWatch(!watch)}>
            {active ? 'edit competitors' : 'add competitors'}
          </button>
        </span>
        <span className="dc-go">
          {feedback}
          {live ? (
            <button type="button" className="btn btn-ink btn-sm" disabled={busy === 'stop'} onClick={onStop}>⏸ stop</button>
          ) : (
            <>
              <details className="make-mine">
                <summary className="btn btn-sm">scan settings</summary>
                <div className="make-pop">
                  <fieldset>
                    <legend className="label">Platforms</legend>
                    {NETS.map((p) => (
                      <label key={p} title={can(p) ? undefined : 'Not switched on yet'} style={{ opacity: can(p) ? 1 : 0.5 }}>
                        <input type="checkbox" disabled={!can(p)} checked={platforms.includes(p)}
                          onChange={(e) => setPlatforms(e.target.checked ? [...platforms, p] : platforms.filter((q) => q !== p))} /> {PLATFORM[p]?.label ?? p}
                      </label>
                    ))}
                  </fieldset>
                  <label className="make-style"><span className="label">Look back (days)</span>
                    <input className="input" type="number" min={7} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
                  <label className="make-style"><span className="label">Posts per account, at most</span>
                    <input className="input" type="number" min={5} max={500} value={cap} onChange={(e) => setCap(Number(e.target.value))} /></label>
                </div>
              </details>
              {resumable && <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => onStart({ resumeRunId: run.id })}>resume</button>}
              <button type="button" className="btn btn-lime btn-sm" disabled={!!busy || !ready || !active}
                title={!ready ? 'Competitor scanning isn’t switched on yet: Autonoetic Edge sets it up' : !active ? 'Add a competitor first' : undefined}
                onClick={() => onStart({ platforms: platforms.filter(can), lookbackDays: days, postCap: cap })}>
                {busy === 'start' ? '…' : run ? '▶ scan again' : '▶ scan competitors'}
              </button>
            </>
          )}
        </span>
      </div>
      {watch && (
        <div className="dc-watch">
          <div className="pane-head"><span className="label">Who we watch</span></div>
          <Competitors list={competitors} />
        </div>
      )}
    </div>
  );
}

// ---- make this next: the answer, first ------------------------------------------------
function Next({ groups, formats, ranked, styles, fade, onShowFormat, onShowPost }: {
  groups: Group[]; formats: DecodeFormatRow[]; ranked: DecodedPostRow[]; styles: StyleOpt[]; fade: boolean;
  onShowFormat: (id: string) => void; onShowPost: (id: string) => void;
}) {
  const solid = groups.filter((g) => g.formatId && g.posts.length >= THIN);
  const untried = solid.filter((g) => fmtOurs(formats, g.formatId!) === 0);
  const pick = [...untried, ...solid.filter((g) => !untried.includes(g))].slice(0, 2);
  const best = ranked.find((p) => !p.paid) ?? null;
  if (!pick.length && !best) return null;
  return (
    <Section eyebrow="Start here" title="Make this next"
      meta="The strongest formats you haven’t posted yet, and their best post. “make my version” writes your own post on the same structure and sends it to Approvals.">
      <div className={`next${fade ? ' fade' : ''}`}>
        {pick.map((g, i) => {
          return (
            <article key={g.key} className="next-card" data-top={i === 0 || undefined} style={{ '--c': g.color } as Vars}>
              <div className="next-tag"><span className="dot" />{fmtOurs(formats, g.formatId!) === 0 ? 'new to you' : 'you use this'}</div>
              <h3>{g.name}</h3>
              <p className="next-why"><b>{times(g.medVs)}</b> their usual · {plural(g.posts.length, 'post')}</p>
              <p className="d">{g.desc}</p>
              <div className="next-acts">
                <MakeMine target={{ formatId: g.formatId }} styles={styles} />
                <More target={{ formatId: g.formatId }} />
                <button type="button" className="linkish" onClick={() => onShowFormat(g.key)}>see examples ↓</button>
              </div>
            </article>
          );
        })}
        {best && (
          <article className="next-card" data-top={!pick.length || undefined} style={{ '--c': PLATFORM[best.platform]?.color ?? 'var(--ink)' } as Vars}>
            <div className="next-tag"><span className="dot" />their best post · {PLATFORM[best.platform]?.label ?? best.platform}</div>
            <h3 className="next-hook">“{best.hook ?? (best.caption.slice(0, 160) || 'no text')}”</h3>
            <p className="next-why"><b>{times(best.vs_own_median)}</b> {who(best)}’s usual · {compact(best.reactions)} reactions</p>
            <div className="next-acts">
              <MakeMine target={{ postId: best.id }} platform={best.platform} styles={styles} />
              <Recreate post={best} styles={styles} />
              <More target={{ postId: best.id }} />
              <button type="button" className="linkish" onClick={() => onShowPost(best.id)}>read it ↓</button>
            </div>
          </article>
        )}
      </div>
    </Section>
  );
}

/** The quieter actions, folded: keep it as an idea, or argue the other side. Both land in Ideas. */
function More({ target }: { target: { postId?: string; formatId?: string } }) {
  const a = useAction();
  return (
    <details className="make-mine dc-more">
      <summary className="btn btn-sm" aria-label="More actions" title="More actions">⋯</summary>
      <div className="make-pop">
        <button type="button" className="btn btn-sm" disabled={a.pending} onClick={() => a.call('use', 'POST', '/content/api/decode/use', { ...target, mode: 'use' })}>Save to Ideas</button>
        <button type="button" className="btn btn-sm" disabled={a.pending} onClick={() => a.call('counter', 'POST', '/content/api/decode/use', { ...target, mode: 'counter' })}>
          {a.busy === 'counter' ? 'Thinking…' : 'Write a counter-angle'}
        </button>
        <p className="faint">Save it for later, or get an idea that argues the other side. Both go to Ideas.</p>
        {a.feedback}
      </div>
    </details>
  );
}

/** Topic-lane / opening chips (from Jev + the breakdown) and the paid filter, folded. */
function Filters({ posts, lane, setLane, hookType, setHookType, hidePaid, setHidePaid }: {
  posts: DecodedPostRow[]; lane: string | null; setLane: (v: string | null) => void;
  hookType: string | null; setHookType: (v: string | null) => void; hidePaid: boolean; setHidePaid: (v: boolean) => void;
}) {
  const count = (k: 'lane' | 'hook_type') => [...posts.reduce((m, p) => (p[k] ? m.set(p[k]!, (m.get(p[k]!) ?? 0) + 1) : m), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1]);
  const lanes = count('lane'), hooks = count('hook_type'), paid = posts.filter((p) => p.paid).length;
  if (!lanes.length && !hooks.length && !paid) return null;
  const on = +!!lane + +!!hookType;
  return (
    <details className="more-filters" open={on > 0 || undefined}>
      <summary>more filters{on ? ` · ${on} on` : ''}</summary>
      <div className="legend" style={{ marginTop: 6 }}>
        {lanes.map(([k, n]) => (
          <button key={`l${k}`} type="button" aria-pressed={lane === k} onClick={() => setLane(lane === k ? null : k)}>topic: {pretty(k)} ({n})</button>
        ))}
        {hooks.map(([k, n]) => (
          <button key={`h${k}`} type="button" aria-pressed={hookType === k} onClick={() => setHookType(hookType === k ? null : k)}>opens with: {pretty(k)} ({n})</button>
        ))}
        {paid > 0 && <button type="button" aria-pressed={hidePaid} onClick={() => setHidePaid(!hidePaid)}>hide paid ({paid})</button>}
      </div>
    </details>
  );
}

// ---- inside the post -------------------------------------------------------------
function PostPane({ post, rank, of, pinned, format, color, styles }: {
  post: DecodedPostRow | null; rank: number; of: number; pinned: boolean; format: DecodeFormatRow | null; color: string; styles: StyleOpt[];
}) {
  if (!post) return <div className="post-pane"><div className="label">Inside the post</div><p className="empty">Click a square on the map to read the post.</p></div>;
  const len = post.beats.reduce((s, b) => s + Math.max(b.text.length, 12), 0) || 1;
  const vs = post.vs_own_median;
  const tags = [...new Set(post.beats.map((b) => b.tag))];
  return (
    <div className="post-pane">
      <div className="fade" key={post.id}>
        <div className="pane-head">
          <span className="label">Inside the post</span>
          <span className="tick" style={{ position: 'static', color: 'var(--ink-2)' }}>
            #{rank} of {of.toLocaleString('en-US')}{pinned ? ' · pinned, esc to follow' : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <span style={{ width: 80, height: 100, flexShrink: 0 }}>
            <Face p={{ thumb: post.thumb, text: post.hook ?? post.caption, platformColor: PLATFORM[post.platform]?.color ?? NO_CATEGORY }} words={14} />
          </span>
          <div style={{ minWidth: 0, display: 'grid', gap: 5, alignContent: 'start' }}>
            <b style={{ fontSize: 14 }}>{who(post)}</b>
            <span className="mono faint" style={{ fontSize: 11 }}>
              {[post.posted_at?.slice(0, 10), PLATFORM[post.platform]?.label ?? post.platform, post.post_type, post.duration_s != null ? `${post.duration_s}s` : null].filter(Boolean).join(' · ')}
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
        <span className="pill" style={{ '--c': vs != null && vs > 1 ? 'var(--ok)' : 'var(--muted)' } as Vars}>{times(vs)} {who(post)}’s usual</span>
        {post.hunt_score != null && (
          <span className="pill" style={{ '--c': 'var(--violet)', marginLeft: 6 } as Vars}
            title={`How worth borrowing this is for you, 0–100: demand ${post.demand ?? '—'} · fit ${post.fit ?? 'not judged'}`}>fit score {Math.round(post.hunt_score)}</span>
        )}
        {post.paid && <span className="pill" style={{ '--c': 'var(--danger)', marginLeft: 6 } as Vars} title="Low engagement for its reach, or Jev says sponsored: likely bought reach. Kept out of hooks and steal.">paid</span>}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
          <MakeMine key={post.id} target={{ postId: post.id }} platform={post.platform} styles={styles} />
          <Recreate key={`r${post.id}`} post={post} styles={styles} />
          <More key={`m${post.id}`} target={{ postId: post.id }} />
        </div>

        <details className="breakdown">
          <summary className="label">How it’s built</summary>
        {(post.lane || post.hook_type || post.value_structure || post.cta_type || post.text_source === 'transcript') && (
          <div className="mono faint" style={{ fontSize: 11, marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
            {post.lane && <span>topic: {pretty(post.lane)}</span>}
            {post.hook_type && <span>opens with: {pretty(post.hook_type)}</span>}
            {post.value_structure && <span>body: {pretty(post.value_structure)}</span>}
            {post.cta_type && <span>ends with: {pretty(post.cta_type)}</span>}
            {post.text_source === 'transcript' && <span>· read from the spoken transcript</span>}
          </div>
        )}

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
        {post.caption && <><div className="label" style={{ marginTop: 14 }}>Full caption</div><p className="pre" style={{ fontSize: 12.5 }}>{post.caption}</p></>}
        </details>
      </div>
    </div>
  );
}

// ---- what's working: ranked groups, gaps badged in ---------------------------------------
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
      desc: by === 'format' ? f?.description ?? 'posts that didn’t fit a recurring structure' : plural(ps.length, 'post'),
      color: by === 'format' ? colorOf(f?.id ?? null) : by === 'platform' ? PLATFORM[key]?.color ?? NO_CATEGORY : CATEGORY[i % CATEGORY.length]!,
      med: median(ps.map((p) => p.reactions)), medVs: median(ps.flatMap((p) => p.vs_own_median ?? [])),
    };
  }).sort((a, b) => (b.medVs ?? -1) - (a.medVs ?? -1));
}

function FormatsWin({ posts, formats, by, setBy, fmt, setFmt, colorOf, styles, onShow }: {
  posts: DecodedPostRow[]; formats: DecodeFormatRow[]; by: By; setBy: (b: By) => void;
  fmt: string | null; setFmt: (f: string | null) => void; colorOf: (id: string | null) => string; styles: StyleOpt[]; onShow: (id: string) => void;
}) {
  const groups = groupPosts(posts, formats, by, colorOf);
  const top = Math.max(...groups.map((g) => g.medVs ?? 0), 0.01);
  const cur = by === 'format' ? groups.find((g) => g.key === (fmt ?? '')) : undefined;
  const scope = cur?.posts ?? posts;
  return (
    <Section eyebrow="What’s working" title="Which formats win?"
      meta={`Ranked by how far each ${by} beats the competitor’s usual (${plural(posts.length, 'post')}). Faded rows rest on one post, too few to judge. Click a format to see it on the map.`}>
      <nav className="seg" aria-label="Compare by" style={{ marginBottom: 14 }}>
        {BYS.map((b) => <button key={b} type="button" aria-current={by === b ? 'page' : undefined} onClick={() => setBy(b)}>{b}</button>)}
      </nav>
      {!groups.length ? <p className="empty">Nothing decoded yet.</p> : (
        <div className="win">
          <ul className="row-list rank">
            {groups.map((g) => {
              const selected = by === 'format' && fmt === g.key;
              const untried = by === 'format' && g.formatId && fmtOurs(formats, g.formatId) === 0;
              const body = (
                <>
                  <span className="dot" style={{ '--c': g.color, marginTop: 6 } as Vars} />
                  <div className="grow" title={g.desc}>
                    <div className="t" style={{ fontWeight: 600 }}>
                      {g.name}{untried && <span className="pill" style={{ '--c': 'var(--ok)', marginLeft: 8, fontWeight: 400 } as Vars}>new to you</span>}
                    </div>
                    <span className="bar" style={{ '--c': g.color } as Vars}><i style={{ width: `${Math.round(((g.medVs ?? 0) / top) * 100)}%` }} /></span>
                  </div>
                  {g.formatId && <FormatActions formatId={g.formatId} styles={styles} />}
                  <span className="rank-n"><b>{times(g.medVs)}</b><span className="faint">{plural(g.posts.length, 'post')}</span></span>
                </>
              );
              return (
                <li key={g.key} data-thin={g.posts.length < THIN || undefined}>
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
            <div><span className="label">Median vs their usual</span><b>{times(median(scope.flatMap((p) => p.vs_own_median ?? [])))}</b></div>
            {cur?.formatId && (() => {
              const f = formats.find((x) => x.id === cur.formatId);
              return f && (f.hook_template || f.value_template || f.cta_template) ? (
                <div><span className="label">Skeleton</span>
                  <span style={{ fontSize: 12.5, display: 'grid', gap: 4 }}>
                    {f.hook_template && <span><span className="faint">opens</span> {f.hook_template}</span>}
                    {f.value_template && <span><span className="faint">body</span> {f.value_template}</span>}
                    {f.cta_template && <span><span className="faint">ends</span> {f.cta_template}</span>}
                  </span>
                </div>
              ) : null;
            })()}
            {cur && <button type="button" className="linkish" style={{ justifySelf: 'start', fontSize: 12.5 }} onClick={() => onShow(cur.key)}>see these on the map ↓</button>}
          </div>
        </div>
      )}
    </Section>
  );
}

function FormatActions({ formatId, styles }: { formatId: string; styles: StyleOpt[] }) {
  return (
    <span className="acts" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <MakeMine target={{ formatId }} styles={styles} />
      <More target={{ formatId }} />
    </span>
  );
}
const fmtOurs = (formats: DecodeFormatRow[], id: string) => formats.find((f) => f.id === id)?.our_post_count ?? 0;

// ---- recreate: their structure and design (or one of our examples), our words and brand ----
// Mirrors POST_FORMATS (pipeline): which platforms take an image / a carousel post.
const VISUAL_TARGETS = {
  image: [['linkedin', 'LinkedIn'], ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['x', 'X']],
  carousel: [['linkedin', 'LinkedIn'], ['instagram', 'Instagram']],
} as const;

export function Recreate({ post, styles }: { post: DecodedPostRow; styles: StyleOpt[] }) {
  const a = useAction();
  const hasImages = post.post_type === 'image' || post.post_type === 'carousel';
  const [kind, setKind] = useState<'image' | 'carousel'>(post.post_type === 'image' ? 'image' : 'carousel');
  const platformsFor = (k: 'image' | 'carousel') => VISUAL_TARGETS[k].map(([p]) => p as string);
  const [platform, setPlatform] = useState<string>(platformsFor(kind).includes(post.platform) ? post.platform : 'linkedin');
  // 'theirs' = their own images; '' = only the images added here; otherwise an example id.
  const [from, setFrom] = useState(hasImages ? 'theirs' : styles[0]?.id ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [save, setSave] = useState(false);
  const [done, setDone] = useState(false);
  const pickKind = (k: 'image' | 'carousel') => { setKind(k); if (!platformsFor(k).includes(platform)) setPlatform('linkedin'); };
  const ready = !!from || files.length > 0;
  async function go() {
    setDone(false);
    const form = new FormData();
    form.set('postId', post.id); form.set('mode', 'steal'); form.set('kind', kind); form.append('platforms', platform);
    if (from === 'theirs') form.set('fromPost', '1'); else if (from) form.set('styleId', from);
    for (const f of files) form.append('file', f);
    if (save && (from === 'theirs' || files.length)) form.set('saveAsExample', `@${post.handle ?? post.competitor ?? 'their'} ${kind}`);
    setDone(!!(await a.call('recreate', 'POST', '/content/api/decode/use', form)));
  }
  return (
    <details className="make-mine">
      <summary className="btn btn-sm btn-lime-o">recreate as {post.post_type === 'video' ? 'image / carousel' : 'mine'}</summary>
      <div className="make-pop">
        <fieldset>
          <legend className="label">Make</legend>
          {(['image', 'carousel'] as const).map((k) => (
            <label key={k}><input type="radio" name={`k${post.id}`} checked={kind === k} onChange={() => pickKind(k)} /> {k === 'image' ? 'Image' : 'Carousel'}</label>
          ))}
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform">
            {VISUAL_TARGETS[kind].map(([p, l]) => <option key={p} value={p}>{l}</option>)}
          </select>
        </fieldset>
        <label className="make-style">
          <span className="label">Design</span>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {hasImages && <option value="theirs">Their design (from this post)</option>}
            <option value="">Only the images I add</option>
            {styles.map((s) => <option key={s.id} value={s.id}>Example: {s.name}</option>)}
          </select>
        </label>
        <label className="make-style">
          <span className="label">Add images</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            aria-label="More slides or images to copy the design from" />
        </label>
        {(from === 'theirs' || files.length > 0) && (
          <label><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Save these images as an example</label>
        )}
        <p className="faint">{post.post_type === 'video' ? 'Videos aren’t recreated: their structure becomes an image or carousel in the design you pick. ' : ''}Their structure and design, your words, colours, logo and face. Their names and claims are never copied. Takes 1–4 minutes.</p>
        <button type="button" className="btn btn-sm btn-lime" disabled={a.pending || !ready} onClick={go}>
          {a.busy === 'recreate' ? 'Writing and designing…' : 'Recreate it'}
        </button>
        {a.feedback}
        {done && <a href="/content/design" style={{ fontSize: 12.5 }}>Open Design</a>}
      </div>
    </details>
  );
}

// ---- make my version: their structure, our post --------------------------------------
const TARGETS = [['linkedin', 'LinkedIn'], ['x', 'X'], ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['blog', 'Blog'], ['youtube', 'YouTube Short']] as const;

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
