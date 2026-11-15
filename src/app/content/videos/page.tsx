// Videos — every video Decode found (competitors' and yours), grouped by what it needs next:
// transcribe it, ask why it worked, then use the ideas. Decode transcribes the best ones
// automatically; this is the desk for the rest. Kept apart from Decode on purpose.
import type { ReactNode } from 'react';
import Link from 'next/link';
import { getContext, listVideos, type VideoRow } from '@pratapai/content-pipeline';
import { loadHealth, params, type SearchParams } from '@/app/content/_lib/data';
import { PageHead, KpiStrip, NeedsDb, Plat, Chip, Section, Notice } from '@/app/content/_components/viz';
import { ApiButton } from '@/app/content/_components/actions';
import { VideoThumbnail } from '@/app/content/_components/VideoThumbnail';
import { ago, compact, times, withParams, TONE } from '@/app/content/_lib/format';

// Each video sits in the one step it needs next; sections run in workflow order.
type Step = 'ideas' | 'analyse' | 'transcribe' | 'failed' | 'skipped';
const stepOf = (v: VideoRow): Step =>
  v.analysis ? (v.analysis.verdict === 'skip' ? 'skipped' : 'ideas')
  : v.state === 'done' ? 'analyse' : v.state === 'failed' ? 'failed' : 'transcribe';
const STEPS: { id: Step; eyebrow: string; title: string; meta: string }[] = [
  { id: 'ideas', eyebrow: 'Ready to use', title: 'Ideas from videos that worked', meta: 'Analysed and judged a fit. Pick an idea to send it to drafting.' },
  { id: 'analyse', eyebrow: 'Next step: analyse', title: 'Transcribed, not yet explained', meta: 'We have the words. Ask why it worked and get 2 ideas for us.' },
  { id: 'transcribe', eyebrow: 'Next step: transcribe', title: 'Not transcribed yet', meta: "Biggest beat over the creator's usual views first. Start with the top few." },
  { id: 'failed', eyebrow: 'Needs a retry', title: 'Transcription failed', meta: 'Retry, or read the reason under the video.' },
  { id: 'skipped', eyebrow: 'Parked', title: 'Not for us', meta: 'Analysed and judged a poor fit for the brand.' },
];
const FILTERS: [string, string][] = [['', 'All'], ['ideas', 'Ideas'], ['analyse', 'Analyse'], ['transcribe', 'Transcribe'], ['failed', 'Failed']];
const who = (v: VideoRow) => v.competitor ?? (v.handle ? `@${v.handle}` : '?');
const HERE = '/content/videos';

export default async function VideosPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  let rows: VideoRow[] | null = null;
  let error: string | null = null;
  try { rows = await listVideos(getContext()); } catch (e) { error = (e as Error).message; }
  const tool = (await loadHealth()).adapters.find((a) => a.id === 'transcriber');
  const head = (next: { text: string; action?: React.ReactNode } | null = null) => (
    <PageHead title="Competitor videos" next={next}
      sub="What competitors' videos say, and why they worked." />
  );
  if (!rows) return (<>{head()}<NeedsDb error={error} /></>);
  const ready = tool?.state === 'ok';
  const creators = [...new Set(rows.map(who))].sort();
  const mine = sp.who ? rows.filter((v) => who(v) === sp.who) : rows;
  const count = (s: Step) => mine.filter((v) => stepOf(v) === s).length;
  const steps = sp.step ? STEPS.filter((s) => s.id === sp.step) : STEPS;
  // The one thing to do now: the furthest-along step that has work in it.
  const nx = (['ideas', 'analyse', 'failed', 'transcribe'] as Step[]).find((s) => count(s) > 0);
  const next = !nx ? null : {
    text: nx === 'ideas' ? `${count('ideas')} ideas from videos that worked are ready to use.`
      : nx === 'analyse' ? `Ask why ${count('analyse')} transcribed videos worked.`
      : nx === 'failed' ? `${count('failed')} transcriptions failed. Retry them.`
      : 'Transcribe the top videos first.',
    action: <a href={`#${nx}`} className="btn btn-primary">Go ↓</a>,
  };

  return (
    <>
      {head(next)}
      {!ready && (
        <div style={{ margin: '-8px 0 20px' }}>
          <Notice plain="Reading what videos say isn’t switched on yet, so new videos can’t be transcribed. Autonoetic Edge sets this up.">
            Transcriber {tool?.state ?? 'unconfigured'}: {tool?.message}. Install yt-dlp + faster-whisper on the server (see System).
          </Notice>
        </div>
      )}
      <KpiStrip items={[
        { label: 'Videos found', value: mine.length, sub: sp.who, href: withParams(HERE, sp, { step: null }) },
        { label: 'Ideas ready', value: count('ideas'), href: withParams(HERE, sp, { step: 'ideas' }) },
        { label: 'To analyse', value: count('analyse'), href: withParams(HERE, sp, { step: 'analyse' }) },
        { label: 'Failed', value: count('failed'), href: withParams(HERE, sp, { step: 'failed' }) },
        { label: 'To transcribe', value: count('transcribe'), href: withParams(HERE, sp, { step: 'transcribe' }) },
      ]} />
      <div className="toolbar">
        <span className="label">Step</span>
        <nav className="seg" aria-label="Filter by step">
          {FILTERS.map(([k, l]) => <Link key={k} href={withParams(HERE, sp, { step: k || null })} aria-current={(sp.step ?? '') === k ? 'page' : undefined}>{l}</Link>)}
        </nav>
        {creators.length > 1 && (<>
          <span className="label" style={{ marginLeft: 12 }}>Creator</span>
          <nav className="seg" aria-label="Filter by creator">
            <Link href={withParams(HERE, sp, { who: null })} aria-current={!sp.who ? 'page' : undefined}>All</Link>
            {creators.map((c) => <Link key={c} href={withParams(HERE, sp, { who: c })} aria-current={sp.who === c ? 'page' : undefined}>{c}</Link>)}
          </nav>
        </>)}
      </div>
      {mine.length === 0 ? <p className="empty">{rows.length ? 'Nothing for this creator.' : 'No videos yet. On Competitors, scan accounts who post reels, Shorts or video.'}</p>
        : steps.map((s) => {
          const list = mine.filter((v) => stepOf(v) === s.id).sort((a, b) => (b.vs_own_median ?? -1) - (a.vs_own_median ?? -1));
          if (!list.length) return sp.step ? <p key={s.id} className="empty">Nothing here right now.</p> : null;
          const body = <ul className="vids">{list.map((v) => <Video key={v.id} v={v} ready={ready} />)}</ul>;
          return (
            <Section key={s.id} id={s.id} eyebrow={s.eyebrow} title={`${s.title} · ${list.length}`} meta={s.meta}>
              {s.id === 'skipped' && !sp.step
                ? <details><summary className="faint" style={{ cursor: 'pointer', fontSize: 12.5 }}>Show {list.length}</summary>{body}</details>
                : body}
            </Section>
          );
        })}
    </>
  );
}

/** One video: thumbnail, who and when, the hook, the numbers, and the one action it needs. */
function Video({ v, ready }: { v: VideoRow; ready: boolean }) {
  const step = stepOf(v);
  const hot = (v.vs_own_median ?? 0) >= 1.5;
  const usual = `${times(v.vs_own_median)} their usual`;
  return (
    <li className="vid">
      <VideoThumbnail key={v.thumb ?? 'missing'} url={v.url} src={v.thumb} label={`Open ${who(v)} video`} duration={v.duration_s} />
      <div className="vid-body">
        <div className="vid-who">
          <Plat p={v.platform} /> <b>{who(v)}</b>
          {v.posted_at && <span className="faint">{ago(v.posted_at)}</span>}
          <a href={v.url} target="_blank" rel="noreferrer" className="mono faint">open ↗</a>
        </div>
        <div className="vid-hook">{v.hook ? `“${v.hook}”` : <span className="faint">No caption</span>}</div>
        <div className="vid-stats mono">
          <span>{v.views != null ? `${compact(v.views)} views` : '— views'}</span>
          {v.vs_own_median != null && (hot
            ? <Chip color={TONE.ok} title="Views vs this creator's median">{usual}</Chip>
            : <span className="faint" title="Views vs this creator's median">{usual}</span>)}
        </div>
        {v.transcript && (
          <details className="acc acc-sm">
            <summary>Transcript <span className="faint">· {v.lang ?? '?'}, {v.transcript.split(/\s+/).length} words</span></summary>
            <p className="acc-body pre">{v.transcript}</p>
          </details>
        )}
        {v.analysis && <Analysis v={v} />}
        {step === 'failed' && v.error && <div className="mono" style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>{v.error}</div>}
      </div>
      <div className="vid-act">
        {step === 'analyse' && <ApiButton path={`/content/api/videos/${v.id}`} body={{ analyze: true }} label="Why did it work?"
          busyLabel="analysing…" className="btn btn-sm btn-ink" />}
        {ready && step !== 'ideas' && step !== 'skipped' && (
          <ApiButton path={`/content/api/videos/${v.id}`} label={v.state === 'done' ? 'Re-transcribe' : v.state === 'failed' ? 'Retry' : 'Transcribe'}
            busyLabel="transcribing…" className={step === 'transcribe' && hot ? 'btn btn-sm btn-ink' : 'btn btn-sm'} />
        )}
      </div>
    </li>
  );
}

const VERDICT: Record<string, { label: string; color: string }> = {
  use: { label: 'Good for us', color: TONE.ok }, adapt: { label: 'Adapt it', color: TONE.warn }, skip: { label: 'Not for us', color: TONE.faint },
};

/** Why the video worked, whether it suits us (Jev's call) and the two ideas built on it. Details fold into dropdowns. */
function Analysis({ v }: { v: VideoRow }) {
  const a = v.analysis!;
  const verdict = VERDICT[a.verdict] ?? VERDICT.adapt!;
  return (
    <details className="acc ana">
      <summary>
        <b>{a.ideas.length ? `${a.ideas.length} idea${a.ideas.length === 1 ? '' : 's'} for you` : 'Why it worked'}</b>
        {a.ideas.length > 0 && <span className="faint">· and why it worked</span>}
        <span className="acc-end">
          <Chip color={verdict.color}>{verdict.label}</Chip>
          {a.jev && <span className="faint mono" title="Jev: fits the brand / easy to adapt">fit {Math.round(a.jev.fitsBrand * 100)}% · adapt {Math.round(a.jev.adaptable * 100)}%</span>}
        </span>
      </summary>
      <div className="acc-body">
        <p className="ana-lead">{a.whyItWorked}</p>

        {a.ideas.length > 0 && (
          <section>
            <h4 className="ana-h">Ideas for us</h4>
            <div className="ana-ideas">
              {a.ideas.map((idea, i) => (
                <article key={i} className="ana-idea">
                  <span className="ana-num">Idea {i + 1}</span>
                  <h5>{idea.title}</h5>
                  <p className="ana-idea-hook">“{idea.hook}”</p>
                  {idea.cta && <p className="ana-cta"><span className="faint">Ends with:</span> {idea.cta}</p>}
                  {idea.beats.length > 0 && (
                    <details className="acc acc-sm">
                      <summary>Outline <span className="faint">· {idea.beats.length} steps</span></summary>
                      <ol className="acc-body">{idea.beats.map((b, j) => <li key={j}>{b}</li>)}</ol>
                    </details>
                  )}
                  {idea.why && (
                    <details className="acc acc-sm">
                      <summary>What it reuses</summary>
                      <p className="acc-body muted">{idea.why}</p>
                    </details>
                  )}
                  <div className="ana-go">
                    <ApiButton path={`/content/api/videos/${v.id}`} body={{ useIdea: i }} label="Write this idea →" busyLabel="writing + checking…" className="btn btn-primary" />
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        <div>
          <details className="acc">
            <summary><b>How it’s built</b> <span className="faint">· hook, {a.structure.length} beats, call to action</span></summary>
            <div className="acc-body ana-parts">
              {a.hook.text && <Part name={`Hook${a.hook.type ? ` · ${a.hook.type.replace(/_/g, ' ')}` : ''}`}>
                <p>“{a.hook.text}”</p>{a.hook.why && <p className="muted">{a.hook.why}</p>}
              </Part>}
              {a.structure.length > 0 && <Part name="Structure"><ol>{a.structure.map((b, i) => <li key={i}>{b.beat}</li>)}</ol></Part>}
              {a.cta.text && <Part name={`Call to action · ${a.cta.type}`}><p>“{a.cta.text}”</p></Part>}
              {a.retention.length > 0 && <Part name="Keeps people watching"><ul>{a.retention.map((r, i) => <li key={i}>{r}</li>)}</ul></Part>}
            </div>
          </details>
          <details className="acc">
            <summary><b>Fit for us</b> <span className="faint">· {a.adapt.length} to reuse, {a.avoid.length} to avoid</span></summary>
            <div className="acc-body ana-parts">
              <p>{a.verdictWhy}</p>
              <div className="ana-two">
                {a.adapt.length > 0 && <Part name="Reuse"><ul className="ana-do">{a.adapt.map((r, i) => <li key={i}>{r}</li>)}</ul></Part>}
                {a.avoid.length > 0 && <Part name="Avoid"><ul className="ana-dont">{a.avoid.map((r, i) => <li key={i}>{r}</li>)}</ul></Part>}
              </div>
            </div>
          </details>
        </div>
      </div>
    </details>
  );
}

function Part({ name, children }: { name: string; children: ReactNode }) {
  return <div className="ana-part"><div className="ana-name">{name}</div>{children}</div>;
}
