// Videos — every video Decode found (competitors' and yours), and whether we have its spoken
// words. Decode transcribes the best ones automatically; this is the log, the transcripts, and a
// button to (re)try any one. Kept apart from Decode on purpose: this is the video desk.
import Link from 'next/link';
import { getContext, listVideos, type VideoRow, type TranscriptState } from '@pratapai/content-pipeline';
import { loadHealth, params, type SearchParams } from '../data';
import { PageHead, KpiStrip, NeedsDb, Plat, Chip } from '../ui/viz';
import { ApiButton } from '../ui/actions';
import { ago, compact, times, TONE } from '../ui/format';

const STATE: Record<TranscriptState, { label: string; color: string }> = {
  done: { label: 'transcribed', color: TONE.ok },
  failed: { label: 'failed', color: TONE.danger },
  not_yet: { label: 'not yet', color: TONE.faint },
};
const FILTERS: [string, string][] = [['', 'All'], ['done', 'Transcribed'], ['failed', 'Failed'], ['not_yet', 'Not yet']];

export default async function VideosPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  let rows: VideoRow[] | null = null;
  let error: string | null = null;
  try { rows = await listVideos(getContext()); } catch (e) { error = (e as Error).message; }
  const tool = (await loadHealth()).adapters.find((a) => a.id === 'transcriber');
  const head = (
    <PageHead crumb="videos" title="What their videos actually say."
      sub="Every video Decode found. The best ones are transcribed on this server for free, so hooks and formats come from the spoken words, not just the caption.">
      <nav className="seg" aria-label="Filter">
        {FILTERS.map(([k, l]) => <Link key={k} href={k ? `/content/videos?state=${k}` : '/content/videos'} aria-current={(sp.state ?? '') === k ? 'page' : undefined}>{l}</Link>)}
      </nav>
    </PageHead>
  );
  if (!rows) return (<>{head}<NeedsDb error={error} /></>);
  const n = (s: TranscriptState) => rows!.filter((r) => r.state === s).length;
  const shown = sp.state ? rows.filter((r) => r.state === sp.state) : rows;
  const ready = tool?.state === 'ok';

  return (
    <>
      {head}
      {!ready && (
        <p className="mono" style={{ fontSize: 12, color: 'var(--warn)', margin: '-8px 0 20px' }}>
          Transcriber {tool?.state ?? 'unconfigured'}: {tool?.message}. Install yt-dlp + faster-whisper on the server (see System).
        </p>
      )}
      <KpiStrip items={[
        { label: 'Videos found', value: rows.length, sub: 'across all Decode runs' },
        { label: 'Transcribed', value: n('done'), sub: 'hooks read from speech', href: '/content/videos?state=done' },
        { label: 'Failed', value: n('failed'), sub: n('failed') ? 'retry, or check the reason' : 'none', href: '/content/videos?state=failed' },
        { label: 'Not yet', value: n('not_yet'), sub: 'past the per-run cap, or never tried', href: '/content/videos?state=not_yet' },
      ]} />
      {shown.length === 0 ? <p className="empty">{rows.length ? 'Nothing in this filter.' : 'No videos yet. Run a Decode on competitors who post reels, Shorts or video.'}</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Video</th><th>Length</th><th>Views</th><th>Their usual</th><th>Hunt</th><th>Transcript</th><th></th></tr></thead>
            <tbody>
              {shown.map((v) => (
                <tr key={v.id} style={{ verticalAlign: 'top' }}>
                  <td style={{ maxWidth: 460 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Plat p={v.platform} />
                      <b>{v.competitor ?? (v.handle ? `@${v.handle}` : '?')}</b>
                      <span className="faint" style={{ fontSize: 11.5 }}>{v.posted_at ? ago(v.posted_at) : ''}</span>
                      <a href={v.url} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 11 }}>open ↗</a>
                    </div>
                    {v.hook && <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>“{v.hook}”</div>}
                    {v.transcript && (
                      <details style={{ marginTop: 6 }}>
                        <summary className="faint" style={{ cursor: 'pointer', fontSize: 12 }}>Read transcript ({v.lang ?? '?'}, {v.transcript.split(/\s+/).length} words)</summary>
                        <p className="pre" style={{ fontSize: 12.5, whiteSpace: 'pre-wrap' }}>{v.transcript}</p>
                      </details>
                    )}
                    {v.analysis ? <Analysis v={v} /> : v.transcript && (
                      <div style={{ marginTop: 8 }}>
                        <ApiButton path={`/content/api/videos/${v.id}`} body={{ analyze: true }} label="Why did it work? + 2 ideas for us"
                          busyLabel="analysing…" className="btn btn-sm btn-ink" />
                      </div>
                    )}
                    {v.state === 'failed' && v.error && <div className="mono" style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>{v.error}</div>}
                  </td>
                  <td className="mono">{v.duration_s != null ? `${v.duration_s}s` : '—'}</td>
                  <td className="mono">{v.views != null ? compact(v.views) : '—'}</td>
                  <td className="mono">{times(v.vs_own_median)}</td>
                  <td className="mono">{v.hunt_score != null ? Math.round(v.hunt_score) : '—'}</td>
                  <td><Chip color={STATE[v.state].color}>{STATE[v.state].label}</Chip></td>
                  <td>{ready && (
                    <ApiButton path={`/content/api/videos/${v.id}`} label={v.state === 'done' ? 'Redo' : v.state === 'failed' ? 'Retry' : 'Transcribe'}
                      busyLabel="transcribing…" className="btn btn-sm" />
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const VERDICT: Record<string, { label: string; color: string }> = {
  use: { label: 'Good for us', color: TONE.ok }, adapt: { label: 'Adapt it', color: TONE.warn }, skip: { label: 'Not for us', color: TONE.faint },
};

/** Why the video worked, whether it suits us (Jev's call), and the two ideas built on it. */
function Analysis({ v }: { v: VideoRow }) {
  const a = v.analysis!;
  const verdict = VERDICT[a.verdict] ?? VERDICT.adapt!;
  return (
    <details open={a.verdict !== 'skip'} style={{ marginTop: 8 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12.5 }}>
        <Chip color={verdict.color}>{verdict.label}</Chip> <b>Why it worked</b>
        {a.jev && <span className="faint mono" style={{ fontSize: 11 }}> · Jev: fits {Math.round(a.jev.fitsBrand * 100)}%, adaptable {Math.round(a.jev.adaptable * 100)}%</span>}
      </summary>
      <div style={{ display: 'grid', gap: 6, fontSize: 12.5, marginTop: 6 }}>
        <p style={{ margin: 0 }}>{a.whyItWorked}</p>
        {a.hook.text && <p style={{ margin: 0 }}><span className="faint">Hook{a.hook.type ? ` (${a.hook.type.replace(/_/g, ' ')})` : ''}:</span> “{a.hook.text}” <span className="faint">— {a.hook.why}</span></p>}
        {a.structure.length > 0 && <p style={{ margin: 0 }}><span className="faint">Structure:</span> {a.structure.map((b) => b.beat).join(' → ')}</p>}
        {a.cta.text && <p style={{ margin: 0 }}><span className="faint">CTA ({a.cta.type}):</span> “{a.cta.text}”</p>}
        {a.retention.length > 0 && <p style={{ margin: 0 }}><span className="faint">Keeps people watching:</span> {a.retention.join('; ')}</p>}
        <p style={{ margin: 0 }}><span className="faint">For us:</span> {a.verdictWhy}</p>
        {a.adapt.length > 0 && <p style={{ margin: 0 }}><span className="faint">Reuse:</span> {a.adapt.join('; ')}</p>}
        {a.avoid.length > 0 && <p style={{ margin: 0 }}><span className="faint">Avoid:</span> {a.avoid.join('; ')}</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginTop: 4 }}>
          {a.ideas.map((idea, i) => (
            <div key={i} className="card attention" style={{ cursor: 'default', padding: 10 }}>
              <b>Idea {i + 1}: {idea.title}</b>
              <p style={{ margin: '6px 0' }}>“{idea.hook}”</p>
              {idea.beats.length > 0 && <ol style={{ margin: '0 0 6px', paddingLeft: 18 }}>{idea.beats.map((b, j) => <li key={j}>{b}</li>)}</ol>}
              {idea.cta && <p className="muted" style={{ margin: '0 0 6px' }}>Ends: {idea.cta}</p>}
              {idea.why && <p className="faint" style={{ margin: '0 0 8px' }}>Reuses: {idea.why}</p>}
              <ApiButton path={`/content/api/videos/${v.id}`} body={{ useIdea: i }} label="Use this idea →" className="btn btn-sm btn-ink" />
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
