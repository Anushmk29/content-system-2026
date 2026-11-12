'use client';
// Creative Check tab (app/content/check): the creative's copy + media, the check button, and the
// report (PRD §10). Talks only to /content/api/check/*.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { CreativeDetail, CheckRow, CreativeCheckReport, Mechanism } from '@pratapai/content-pipeline';
import { useAction } from './actions';
import { ago, when } from './format';

type Report = CreativeCheckReport;
type Finding = Report['findings'][number];
type Rec = Report['recommendations'][number];
export interface Compare {
  against: string;
  resolved: Finding[]; stillOpen: Finding[]; new: Finding[];
  facts: { key: string; label: string; before: string; after: string }[];
}

const API = '/content/api/check';
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
const tc = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const STAGE: Record<string, string> = { queued: 'Waiting for a free slot…', reading: 'Reading frames…', listening: 'Listening…', checking: 'Checking against your brand and writing fixes…' };
const CLASS: Record<string, [string, string]> = { A: ['A · Observed', 'var(--ok)'], B: ['B · Interpretation', 'var(--info)'], C: ['C · Hypothesis', 'var(--violet)'], D: ['D · Insufficient', 'var(--faint)'] };
const PRIO: Record<string, string> = { critical: 'var(--danger)', high: 'var(--warn)', medium: 'var(--info)', low: 'var(--faint)' };
const RISK: Record<string, string> = { high: 'var(--danger)', medium: 'var(--warn)', low: 'var(--ok)' };
const CAT: Record<string, [string, string, string]> = {
  good: ['✓', 'Good', 'var(--ok)'], review: ['!', 'Needs review', 'var(--warn)'], insufficient: ['?', 'Insufficient evidence', 'var(--faint)'],
};
const VERDICT_LABEL: [string, string][] = [['useful', 'Useful'], ['not_useful', 'Not useful'], ['incorrect', 'Incorrect'], ['not_relevant', 'Not relevant to my audience'], ['skipped', 'Skipped']];
const EDITABLE_TARGETS = new Set(['hook', 'body', 'cta']);

const chip = (color: string, children: ReactNode, title?: string) =>
  <span className="chip" title={title} style={{ '--c': color } as React.CSSProperties}>{children}</span>;

// ---- start a check: paste the post, drop the media, one button ---------------------------

const GOAL: Record<string, string> = {
  awareness: 'Get noticed by new people', consideration: 'Make them trust or want it',
  conversion: 'Get a click, sign-up or sale', retention: 'Keep existing followers engaged',
};
const MEDIA_TYPES = 'image/png,image/jpeg,image/webp,video/mp4';

export function StartCheck({ platforms, stages, first }: { platforms: string[]; stages: string[]; first: boolean }) {
  const { call, busy, feedback } = useAction();
  const router = useRouter();
  const [f, setF] = useState({ name: '', platform: 'instagram', funnelStage: 'awareness', hook: '', body: '', cta: '', proof: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const empty = !f.hook.trim() && !f.body.trim() && !files.length;
  const video = files.find((x) => x.type === 'video/mp4');
  const pick = (list: FileList | null) => {
    const all = Array.from(list ?? []).filter((x) => MEDIA_TYPES.includes(x.type) && x.type);
    const v = all.find((x) => x.type === 'video/mp4');
    setFiles(v ? [v] : all.slice(0, 10)); // one video, or up to 10 images
  };

  const go = async () => {
    const name = f.name.trim() || f.hook.trim().slice(0, 60) || video?.name || 'Untitled post';
    const d = await call('new', 'POST', API, { ...f, name });
    const id = d?.creative?.id as string | undefined;
    if (!id) return;
    if (files.length) {
      const fd = new FormData();
      files.forEach((x) => fd.append('file', x));
      if (!await call('media', 'POST', `${API}/${id}/media`, fd)) { router.push(`/content/check?c=${id}`); return; }
    }
    await call('run', 'POST', `${API}/${id}/run`, { fresh: false });
    router.push(`/content/check?c=${id}`);
  };
  const step = busy === 'new' ? 'Saving…' : busy === 'media' ? 'Uploading…' : busy === 'run' ? 'Starting the check…' : null;

  return (
    <div className="cc-start">
      <form className="cc-pane" onSubmit={(e) => { e.preventDefault(); if (!empty) void go(); }}>
        <h2 className="cc-start-title">{first ? 'Check your first post' : 'Check a new post'}</h2>
        <p className="muted" style={{ margin: '0 0 8px', fontSize: 13.5 }}>Paste what you plan to post and add its video or images. You get the fixes before anyone sees it.</p>

        <label className={`cc-drop${over ? ' is-over' : ''}${files.length ? ' has-files' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}>
          <input type="file" multiple accept={MEDIA_TYPES} className="sr-only" onChange={(e) => pick(e.target.files)} />
          {files.length
            ? <><b>{video ? `🎬 ${video.name}` : `🖼 ${files.length} image${files.length === 1 ? '' : 's'}`}</b><span className="muted">Click to change · <button type="button" className="linkish" onClick={(e) => { e.preventDefault(); setFiles([]); }}>remove</button></span></>
            : <><b>Drop a video or images here</b><span className="muted">or click to choose · one MP4 (Reel, Short) or up to 10 images (carousel) · optional</span></>}
        </label>

        <label className="label" htmlFor="cs-hook">Opening line <span className="cc-hint">the first words people read or hear</span></label>
        <input id="cs-hook" className="input" value={f.hook} onChange={(e) => setF({ ...f, hook: e.target.value })} placeholder="e.g. Most founders waste their first 3 seconds" />
        <label className="label" htmlFor="cs-body">Caption <span className="cc-hint">the post text · for a carousel, put a line of --- between slides</span></label>
        <textarea id="cs-body" className="input" rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Paste the caption here" />
        <label className="label" htmlFor="cs-cta">Call to action <span className="cc-hint">what you ask people to do</span></label>
        <input id="cs-cta" className="input" value={f.cta} onChange={(e) => setF({ ...f, cta: e.target.value })} placeholder="e.g. Comment GUIDE and I’ll send it" />
        <details className="cc-proof">
          <summary>Add proof <span className="cc-hint">optional · makes the fixes stronger and checks your claims</span></summary>
          <textarea id="cs-proof" className="input" rows={3} value={f.proof} onChange={(e) => setF({ ...f, proof: e.target.value })} maxLength={4000}
            placeholder="Numbers, results, reviews or deadlines you can show, e.g. ‘312 students since 2024’, a client’s words, ‘offer ends 30 Nov’" />
        </details>

        <div className="cc-start-row">
          <label><span className="label">Posting on</span>
            <select className="input" value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>{platforms.map((p) => <option key={p} value={p}>{label(p)}</option>)}</select></label>
          <label><span className="label">The goal</span>
            <select className="input" value={f.funnelStage} onChange={(e) => setF({ ...f, funnelStage: e.target.value })}>{stages.map((s) => <option key={s} value={s}>{GOAL[s] ?? label(s)}</option>)}</select></label>
          <label><span className="label">Name <span className="cc-hint">optional</span></span>
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Monday Reel" maxLength={200} /></label>
        </div>

        <div className="cc-actions">
          <button className="btn btn-primary" disabled={empty || busy !== null}>{step ?? 'Check this post'}</button>
          <span className="faint" style={{ fontSize: 12.5 }}>{empty ? 'Add an opening line, a caption or some media to start.' : video ? 'About a minute for a video.' : 'About 30 seconds.'}</span>
          {feedback}
        </div>
      </form>

      <div className="cc-gets" aria-label="What you get back">
        <div className="label">What you get back</div>
        {[
          ['1', 'The top 3 fixes', 'Rewritten opening lines, captions and CTAs. Tap “Use this” to swap one in.'],
          ['2', 'Where people may scroll away', 'A timeline of the video, red where attention is at risk. Click to jump to that second.'],
          ['3', 'What’s persuading, and what’s risky', 'The triggers the post uses, and claims that need proof before you publish.'],
        ].map(([n, t, d]) => <div key={n} className="cc-get"><span className="cc-get-n">{n}</span><div><b>{t}</b><p>{d}</p></div></div>)}
        <p className="faint" style={{ fontSize: 12 }}>Nothing here touches your other posts. When you’re happy, copy the final words into the post.</p>
      </div>
    </div>
  );
}

// ---- workspace ---------------------------------------------------------------------------

export function Workspace({ detail, shownId, compare, mechanisms, platforms, stages }: {
  detail: CreativeDetail; shownId: string | null; compare: Compare | null; mechanisms: Mechanism[]; platforms: string[]; stages: string[];
}) {
  const { creative: c, media, checks, hash } = detail;
  const router = useRouter();
  const { call, busy, feedback } = useAction();
  const [copy, setCopy] = useState({ name: c.name, platform: c.platform, funnelStage: c.funnel_stage, hook: c.hook, body: c.body, cta: c.cta, proof: c.proof });
  const dirty = copy.name !== c.name || copy.platform !== c.platform || copy.funnelStage !== c.funnel_stage || copy.hook !== c.hook || copy.body !== c.body || copy.cta !== c.cta || copy.proof !== c.proof;
  // A fix applied on the server changes the copy: take it, unless the creator has unsaved edits.
  useEffect(() => { if (!dirty) setCopy({ name: c.name, platform: c.platform, funnelStage: c.funnel_stage, hook: c.hook, body: c.body, cta: c.cta, proof: c.proof }); }, [c.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const video = useRef<HTMLVideoElement>(null);
  const seek = (t: number) => { if (video.current) { video.current.currentTime = t; video.current.focus(); } };

  const latest = checks[0];
  const running = latest?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(t);
  }, [running, router]);

  const shown = checks.find((x) => x.id === shownId) ?? null;
  const lastDone = checks.find((x) => x.status === 'done');
  const changed = !!lastDone && lastDone.input_hash !== hash;
  const isVideo = media[0]?.mime === 'video/mp4';
  const src = (i: number) => `${API}/${c.id}/media?i=${i}&v=${encodeURIComponent(c.updated_at)}`;

  const save = () => call('save', 'PATCH', `${API}/${c.id}`, copy);
  const run = (fresh = false) => call('run', 'POST', `${API}/${c.id}/run`, { fresh });
  const upload = (files: FileList | null) => {
    if (!files) return;
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append('file', f);
    void call('media', 'POST', `${API}/${c.id}/media`, fd);
  };

  return (
    <div className="cc-work">
      <section className="cc-pane">
        <div className="cc-pane-head">
          <input className="input cc-name" value={copy.name} onChange={(e) => setCopy({ ...copy, name: e.target.value })} aria-label="Creative name" maxLength={200} />
          <select className="input" value={copy.platform} onChange={(e) => setCopy({ ...copy, platform: e.target.value })} aria-label="Platform">{platforms.map((p) => <option key={p} value={p}>{label(p)}</option>)}</select>
          <select className="input" value={copy.funnelStage} onChange={(e) => setCopy({ ...copy, funnelStage: e.target.value })} aria-label="Goal">{stages.map((s) => <option key={s} value={s}>Goal: {GOAL[s] ?? label(s)}</option>)}</select>
        </div>
        <label className="label" htmlFor="cc-hook">Opening line</label>
        <input id="cc-hook" className="input" value={copy.hook} onChange={(e) => setCopy({ ...copy, hook: e.target.value })} placeholder="The first line or the first thing said" />
        <label className="label" htmlFor="cc-body">Caption</label>
        <textarea id="cc-body" className="input" rows={6} value={copy.body} onChange={(e) => setCopy({ ...copy, body: e.target.value })} placeholder="The post text. For a carousel, separate slides with a line of ---" />
        <label className="label" htmlFor="cc-cta">Call to action</label>
        <input id="cc-cta" className="input" value={copy.cta} onChange={(e) => setCopy({ ...copy, cta: e.target.value })} placeholder="What you ask people to do" />
        <label className="label" htmlFor="cc-proof">Proof <span className="cc-hint">what you can show is true · claims that match it count as backed</span></label>
        <textarea id="cc-proof" className="input" rows={3} value={copy.proof} onChange={(e) => setCopy({ ...copy, proof: e.target.value })} maxLength={4000}
          placeholder="Numbers, results, reviews or deadlines you can show, e.g. ‘312 students since 2024’, a client’s words, ‘offer ends 30 Nov’" />
        <div className="cc-actions">
          <button className="btn btn-sm" onClick={save} disabled={!dirty || busy !== null}>{busy === 'save' ? 'Saving…' : dirty ? 'Save copy' : 'Saved'}</button>
          <label className="btn btn-sm">
            {media.length ? 'Replace media' : 'Add images or a video'}
            <input type="file" multiple accept="image/png,image/jpeg,image/webp,video/mp4" className="sr-only" onChange={(e) => upload(e.target.files)} />
          </label>
          {media.length > 0 && <button className="btn btn-sm" onClick={() => call('media', 'POST', `${API}/${c.id}/media`, new FormData())}>Remove media</button>}
          <button className="btn btn-sm btn-danger" style={{ marginLeft: 'auto' }}
            onClick={async () => { if (confirm(`Delete “${c.name}” and its checks?`) && await call('del', 'DELETE', `${API}/${c.id}`)) router.push('/content/check'); }}>Delete</button>
        </div>
        {isVideo && <video ref={video} className="cc-video" src={src(0)} controls preload="metadata" />}
        {!isVideo && media.length > 0 && (
          <div className="cc-thumbs">{media.map((m) => <img key={m.idx} src={src(m.idx)} alt={`Slide ${m.idx + 1}`} />)}</div>
        )}
      </section>

      <section className="cc-pane">
        <div className="cc-pane-head">
          <h2 style={{ margin: 0, fontSize: 18 }}>Creative Check</h2>
          <span className="muted" style={{ fontSize: 13 }} role="status">
            {running ? STAGE[latest!.stage] ?? 'Checking…'
              : !lastDone ? 'Not checked yet'
              : changed ? 'Content changed since the last check'
              : `Checked ${ago(lastDone.finished_at ?? lastDone.started_at)}`}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            {!running && (!lastDone || changed) && <button className="btn btn-primary btn-sm" disabled={dirty || busy !== null} title={dirty ? 'Save the copy first' : undefined} onClick={() => run()}>{lastDone ? 'Re-check' : 'Check this post'}</button>}
            {!running && lastDone && !changed && <button className="btn btn-sm" disabled={busy !== null} onClick={() => run(true)}>Run again anyway</button>}
          </span>
        </div>
        {feedback}
        {latest?.status === 'error' && <p className="cc-error">The last check failed: {latest.message}</p>}
        {shown?.report
          ? <ReportView check={shown} creativeId={c.id} stale={shown.input_hash !== hash} compare={compare} mechanisms={mechanisms} seek={isVideo ? seek : null} call={call} busy={busy} />
          : !running && latest?.status !== 'error' && <p className="empty">Not checked yet. Press <b>Check this post</b> above. About 30 seconds for text, a minute for a video.</p>}
        {running && <div className="cc-running" aria-hidden><span /><span /><span /></div>}
        {checks.length > 1 && (
          <details className="cc-history">
            <summary>History · {checks.length} checks</summary>
            <ul>{checks.map((x) => (
              <li key={x.id}>
                <a href={`/content/check?c=${c.id}&run=${x.id}`} aria-current={x.id === shown?.id ? 'true' : undefined}>{when(x.started_at)}</a>
                {' '}{x.status === 'done' ? '' : `· ${x.status}`}{x.input_hash !== hash ? ' · older content' : ''}{x.cost_usd > 0 ? ` · $${x.cost_usd.toFixed(3)}` : ''}
              </li>
            ))}</ul>
          </details>
        )}
      </section>
    </div>
  );
}

// ---- report ------------------------------------------------------------------------------

type Call = ReturnType<typeof useAction>['call'];

function ReportView({ check, creativeId, stale, compare, mechanisms, seek, call, busy }: {
  check: CheckRow; creativeId: string; stale: boolean; compare: Compare | null; mechanisms: Mechanism[];
  seek: ((t: number) => void) | null; call: Call; busy: string | null;
}) {
  const r = check.report!;
  const [filter, setFilter] = useState<string | null>(null);
  const mech = new Map(mechanisms.map((m) => [m.id, m]));
  const recsFor = (f: Finding) => r.recommendations.filter((x) => x.findingIds.includes(f.id));
  const top = r.top3.map((id) => r.recommendations.find((x) => x.id === id)).filter((x): x is Rec => !!x);
  const rest = r.recommendations.filter((x) => !r.top3.includes(x.id));
  const at = (f: Finding) => 'start' in f.at
    ? <TimeChip t={f.at.start} end={f.at.end} seek={seek} />
    : chip('var(--muted)', f.at.field === 'slide' ? `slide ${f.at.slide}` : f.at.field);
  const recProps = { check, creativeId, stale, call, busy };

  return (
    <div className="cc-report">
      {stale && <p className="cc-warn">This check is for an earlier version: the content changed since. Re-check to see what got better.</p>}
      <p className="cc-summary">{r.summary}</p>
      {r.proof && r.proof.backed + r.proof.needed > 0 && (
        <div className="chips" style={{ marginTop: 8 }}>
          {r.proof.backed > 0 && chip('var(--ok)', `✓ ${r.proof.backed} claim${r.proof.backed === 1 ? '' : 's'} backed by your proof`)}
          {r.proof.needed > 0 && <a href="#cc-proof" className="chip" style={{ '--c': 'var(--warn)', textDecoration: 'none' } as React.CSSProperties}
            onClick={() => document.getElementById('cc-proof')?.focus()}>! {r.proof.needed} need{r.proof.needed === 1 ? 's' : ''} proof · add it</a>}
        </div>
      )}

      {top.length > 0 && (<>
        <h3>Top fixes</h3>
        <div className="cc-cards">{top.map((x) => <RecCard key={x.id} rec={x} {...recProps} />)}</div>
      </>)}

      <h3>Parts of the post</h3>
      <div className="chips">{Object.entries(r.categories).map(([k, v]) => {
        const [ico, word, color] = CAT[v]!;
        return <span key={k}>{chip(color, <><b aria-hidden>{ico}</b> {label(k)}: {word}</>)}</span>;
      })}</div>

      {r.attention.length > 0 && (<>
        <h3>Attention risk <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>estimated from the content, not measured on viewers</span></h3>
        <div className="cc-strip" role="list">
          {r.attention.map((s, i) => (
            <button key={i} role="listitem" className="cc-seg" disabled={!seek}
              style={{ flexGrow: Math.max(0.2, s.end - s.start), '--c': RISK[s.risk] } as React.CSSProperties}
              title={`${tc(s.start)}–${tc(s.end)} · ${s.risk} risk${s.reasons.length ? `: ${s.reasons.join(', ')}` : ''} · ${CLASS[s.evidence]![0]}`}
              onClick={() => seek?.(s.start)}>
              <span>{s.risk === 'high' ? '▲' : s.risk === 'medium' ? '●' : ''}</span>
            </button>
          ))}
        </div>
        <ul className="cc-seglist">{r.attention.filter((s) => s.risk !== 'low').map((s, i) => (
          <li key={i}><TimeChip t={s.start} end={s.end} seek={seek} /> {chip(RISK[s.risk]!, `${s.risk} risk`)} {s.reasons.join(', ')} <span className="faint">· {CLASS[s.evidence]![0]}</span></li>
        ))}</ul>
      </>)}

      {r.firstGlance && (<>
        <h3>First glance <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>B · Interpretation</span></h3>
        <dl className="cc-facts">
          <dt>Focal point</dt><dd>{r.firstGlance.focus}</dd>
          <dt>Readability</dt><dd>{r.firstGlance.readability}</dd>
          <dt>Clutter</dt><dd>{r.firstGlance.clutter}</dd>
        </dl>
      </>)}

      <h3>Findings</h3>
      <div className="chips" style={{ marginBottom: 10 }}>
        {[null, 'hook', 'visual', 'message', 'story', 'cta', 'audience', 'psychology'].map((k) => (
          <button key={k ?? 'all'} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}
            style={{ '--c': filter === k ? 'var(--ink)' : undefined, cursor: 'pointer' } as React.CSSProperties}>
            {k ? label(k) : 'All'} · {r.findings.filter((f) => !k || f.category === k).length}
          </button>
        ))}
      </div>
      {r.findings.filter((f) => !filter || f.category === filter).map((f) => (
        <article key={f.id} className="cc-card">
          <div className="cc-card-head">
            {chip(PRIO[f.priority]!, f.priority)} {chip(CLASS[f.evidence]![1], CLASS[f.evidence]![0])} {at(f)} <span className="faint">{label(f.category)}</span>
          </div>
          <b>{f.title}</b>
          {f.detail && <p>{f.detail}</p>}
          {f.quote && <blockquote>“{f.quote}”</blockquote>}
          {f.mechanisms.length > 0 && <div className="chips">{f.mechanisms.map((id) => mech.get(id) && <MechanismChip key={id} m={mech.get(id)!} />)}</div>}
          <details className="cc-why">
            <summary>Why this?</summary>
            <dl className="cc-facts">
              <dt>Evidence</dt><dd>{f.quote ? `“${f.quote}”` : 'start' in f.at ? `At ${tc(f.at.start)}${f.at.end !== undefined ? `–${tc(f.at.end)}` : ''} in the video` : `In the ${f.at.field}`} · {CLASS[f.evidence]![0]}</dd>
              <dt>Reading</dt><dd>{f.detail || '—'}</dd>
              {f.mechanisms.map((id) => mech.get(id)).filter((m): m is Mechanism => !!m).map((m) => (
                <Fragment key={m.id}><dt>Science</dt><dd>{m.name}: {m.pattern} Science {m.science}{m.scienceNote ? ` (${m.scienceNote})` : ''} · for ads/social {m.adLink}. {m.source}</dd></Fragment>
              ))}
              {recsFor(f).map((x) => (
                <Fragment key={x.id}><dt>Uncertain</dt><dd>{x.uncertainty || '—'}</dd><dt>Test it</dt><dd>{x.experiment}</dd></Fragment>
              ))}
            </dl>
          </details>
        </article>
      ))}
      {r.findings.length === 0 && <p className="empty">No findings the check could support.</p>}

      {rest.length > 0 && (<>
        <h3>More recommendations</h3>
        <div className="cc-cards">{rest.map((x) => <RecCard key={x.id} rec={x} {...recProps} />)}</div>
      </>)}

      <h3>Psychological triggers</h3>
      {r.triggers.length === 0 ? <p className="empty">None detected.</p> : (
        <ul className="cc-triggers">{r.triggers.map((t, i) => (
          <li key={i}>
            <b>{label(t.name)}</b> {chip(CLASS[t.class]![1], CLASS[t.class]![0])} {t.proof && chip(t.proof.status === 'backed' ? 'var(--ok)' : 'var(--warn)', t.proof.status === 'backed' ? '✓ Backed' : '! Needs proof', t.proof.quote)} {t.at && <span className="faint">{t.at}</span>}
            <div className="muted">Present as: {t.evidence}</div>
            {t.role && <div>Role: {t.role}</div>}
            {t.benefit && <div>Benefit: {t.benefit}</div>}
            {t.risk && <div className={t.proof?.status === 'backed' && !t.risk.includes('Needs proof') ? 'muted' : 'cc-risk'}>{t.proof?.status === 'backed' ? '' : 'Risk: '}{t.risk}</div>}
            {t.suggestion && <div>Try: {t.suggestion}</div>}
          </li>
        ))}</ul>
      )}

      <h3>Measured facts <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>A · Observed, computed by code</span></h3>
      <dl className="cc-facts">{r.facts.map((f) => <Fragment key={f.key}><dt>{f.label}</dt><dd><b>{f.value}</b> <span className="muted">{f.meaning}</span></dd></Fragment>)}</dl>

      {r.transcript.length > 0 && (
        <details className="cc-why"><summary>Transcript · {r.transcript.length} segments</summary>
          <ul className="cc-seglist">{r.transcript.map((s, i) => <li key={i}><TimeChip t={s.start} seek={seek} /> {s.text}</li>)}</ul>
        </details>
      )}

      {compare && (<>
        <h3>Compared with the check of {when(compare.against)}</h3>
        <div className="cc-compare">
          <div><div className="label">Resolved · {compare.resolved.length}</div>{compare.resolved.map((f) => <div key={f.id}>✓ {f.title}</div>)}</div>
          <div><div className="label">Still open · {compare.stillOpen.length}</div>{compare.stillOpen.map((f) => <div key={f.id}>• {f.title}</div>)}</div>
          <div><div className="label">New · {compare.new.length}</div>{compare.new.map((f) => <div key={f.id}>+ {f.title}</div>)}</div>
        </div>
        {compare.facts.length > 0 && <ul className="cc-seglist">{compare.facts.map((f) => <li key={f.key}>{f.label}: {f.before} → <b>{f.after}</b></li>)}</ul>}
        <p className="faint" style={{ fontSize: 12 }}>This shows what changed in the content, not how it will perform. Test the versions to know.</p>
      </>)}

      {r.limitations.length > 0 && (<>
        <h3>Limits of this check</h3>
        <ul className="cc-limits">{r.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </>)}
      <p className="faint mono" style={{ fontSize: 11 }}>{r.version.mode} · {r.version.model ?? 'model'} · prompt {r.version.promptVersion}{check.cost_usd > 0 ? ` · $${check.cost_usd.toFixed(3)}` : ''}</p>
    </div>
  );
}

function TimeChip({ t, end, seek }: { t: number; end?: number; seek: ((t: number) => void) | null }) {
  const text = `${tc(t)}${end !== undefined ? `–${tc(end)}` : ''}`;
  return seek
    ? <button className="chip" style={{ cursor: 'pointer', '--c': 'var(--ink)' } as React.CSSProperties} onClick={() => seek(t)} aria-label={`Play from ${text}`}>▶ {text}</button>
    : chip('var(--muted)', text);
}

function MechanismChip({ m }: { m: Mechanism }) {
  return (
    <details className="cc-mech">
      <summary className="chip" style={{ '--c': 'var(--violet)', cursor: 'pointer' } as React.CSSProperties}>{m.name}</summary>
      <div className="cc-mech-body">
        <p>{m.pattern}</p>
        <p><b>Science:</b> {m.science}{m.scienceNote ? ` (${m.scienceNote})` : ''} · <b>Shown for ads/social:</b> {m.adLink}</p>
        <p className="faint">{m.source}</p>
      </div>
    </details>
  );
}

function RecCard({ rec, check, creativeId, stale, call, busy }: { rec: Rec; check: CheckRow; creativeId: string; stale: boolean; call: Call; busy: string | null }) {
  const fb = check.feedback[rec.id];
  const [note, setNote] = useState(fb?.note ?? '');
  const canApply = EDITABLE_TARGETS.has(rec.target) && !stale;
  const rate = (verdict: string) => call(`fb-${rec.id}`, 'PATCH', `${API}/${creativeId}`, { feedback: { checkId: check.id, recId: rec.id, verdict, note } });
  return (
    <article className="cc-card">
      <div className="cc-card-head">{chip(PRIO[rec.priority]!, rec.priority)} {chip('var(--muted)', rec.at)} <span className="faint">{label(rec.target)}</span></div>
      {rec.problem && <b>{rec.problem}</b>}
      <p>{rec.change}</p>
      {rec.replacements.map((text, i) => (
        <div key={i} className="cc-replace">
          <span>“{text}”</span>
          {canApply && <button className="btn btn-sm btn-primary" disabled={busy !== null}
            onClick={() => call(`apply-${rec.id}`, 'PATCH', `${API}/${creativeId}`, { apply: { checkId: check.id, recId: rec.id, replacement: i } })}>Use this</button>}
        </div>
      ))}
      <details className="cc-why">
        <summary>Why, and how to test it</summary>
        <dl className="cc-facts">
          {rec.why && <><dt>Why</dt><dd>{rec.why}</dd></>}
          {rec.direction && <><dt>Expected</dt><dd>{rec.direction}</dd></>}
          {rec.uncertainty && <><dt>Uncertain</dt><dd>{rec.uncertainty}</dd></>}
          <dt>Test it</dt><dd>{rec.experiment}</dd>
        </dl>
      </details>
      <div className="cc-fb">
        {fb && <span className="faint" style={{ fontSize: 12 }}>You said: {fb.verdict === 'applied' ? 'applied' : VERDICT_LABEL.find(([v]) => v === fb.verdict)?.[1]}</span>}
        <details>
          <summary className="linkish" style={{ fontSize: 12 }}>Rate this fix</summary>
          <div className="chips" style={{ marginTop: 6 }}>
            {VERDICT_LABEL.map(([v, l]) => <button key={v} className="btn btn-sm" aria-pressed={fb?.verdict === v} disabled={busy !== null} onClick={() => rate(v)}>{l}</button>)}
          </div>
          <input className="input" style={{ marginTop: 6 }} placeholder="Optional note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
        </details>
      </div>
    </article>
  );
}
