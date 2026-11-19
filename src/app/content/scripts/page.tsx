// Scripts — everything you post by hand: video scripts (YouTube Shorts, Reels, LinkedIn video) and
// Reddit posts. Nothing posts these automatically: approve, film (videos), post, paste the link.
// The link lets your own-results refresh track its numbers like any other post.
import Link from 'next/link';
import { getContext, listScripts, type ScriptRow, type ScriptStage } from '@pratapai/content-pipeline';
import { params, type SearchParams } from '@/app/content/_lib/data';
import { PageHead, KpiStrip, NeedsDb, Section, Plat } from '@/app/content/_components/viz';
import { ApiButton, RunModuleButton } from '@/app/content/_components/actions';
import { UploadLink } from '@/app/content/scripts/_components/ScriptActions';
import { ItemDrawer } from '@/app/content/_components/ItemDrawer';
import { ago, compact, times, withParams, splitPosts, PLATFORM } from '@/app/content/_lib/format';

const STAGES: { key: ScriptStage; label: string; empty: string }[] = [
  { key: 'review', label: 'In review · approve first', empty: 'No scripts being drafted or reviewed.' },
  { key: 'to_film', label: 'To film or post', empty: 'Nothing waiting. Approved scripts and Reddit posts land here.' },
  { key: 'filmed', label: 'Filmed', empty: 'Mark a script filmed once you’ve recorded it.' },
  { key: 'uploaded', label: 'Posted', empty: 'Paste the link after posting; its numbers then show here.' },
];

export default async function ScriptsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  let rows: ScriptRow[] | null = null;
  let error: string | null = null;
  try { rows = await listScripts((await getContext())); } catch (e) { error = (e as Error).message; }
  const head = (next: { text: string; action?: React.ReactNode } | null) => (
    <PageHead title="Film & post" next={next}
      sub="Videos and Reddit posts you film and post yourself." />
  );
  if (!rows) return (<>{head(null)}<NeedsDb error={error} /></>);
  const by = (k: ScriptStage) => rows!.filter((r) => r.stage === k);
  const n = (k: ScriptStage) => by(k).length;
  const next = n('to_film') ? { text: `${n('to_film')} approved ${n('to_film') === 1 ? 'script is' : 'scripts are'} waiting for you to film or post.`, action: <a href="#to_film" className="btn btn-primary">Start ↓</a> }
    : n('filmed') ? { text: `Post ${n('filmed')} filmed video${n('filmed') === 1 ? '' : 's'}, then paste the link.`, action: <a href="#filmed" className="btn btn-primary">Post ↓</a> }
    : n('review') ? { text: `Approve ${n('review')} script${n('review') === 1 ? '' : 's'} first.`, action: <a href="#review" className="btn btn-primary">Review ↓</a> }
    : rows.length ? null : { text: 'Tick a video script or Reddit on an idea, then draft it.', action: <Link href="/content/ideas" className="btn">Go to Ideas</Link> };
  const itemHref = (id: string) => withParams('/content/scripts', sp, { item: id });

  return (
    <>
      {head(next)}
      <KpiStrip items={[
        { label: 'To film or post', value: by('to_film').length },
        { label: 'Filmed', value: by('filmed').length },
        { label: 'Posted', value: by('uploaded').length },
        { label: 'In review', value: by('review').length, href: '/content/approvals' },
      ]} />
      <ol className="flow" aria-label="How a script goes from draft to posted">
        <li title="Run the quality check on the new script."><b>Check</b></li>
        <li title="Read it, fix any words, approve it."><b>Approve</b></li>
        <li title="Record it (Reddit: just post it), then click “I filmed it”."><b>Film</b></li>
        <li title="Post it yourself and paste the link here."><b>Post</b></li>
        <li title="Its views show up with your own results."><b>Track</b></li>
      </ol>
      {rows.length === 0 && (
        <p className="empty">Nothing here yet.</p>
      )}
      {rows.length > 0 && STAGES.map((st) => (
        <Section key={st.key} id={st.key} eyebrow={`${st.label} · ${by(st.key).length}`}>
          {by(st.key).length === 0 ? <p className="empty">{st.empty}</p> : (
            <div className="scr-grid">
              {by(st.key).map((r) => <ScriptCard key={r.id} r={r} href={itemHref(r.id)} />)}
            </div>
          )}
        </Section>
      ))}
      {sp.item && <ItemDrawer id={sp.item} closeHref={withParams('/content/scripts', sp, { item: null })} linkFor={itemHref} />}
    </>
  );
}

const FORMAT_LABEL: Record<string, string> = { reel_script: 'Reel script', short_script: 'Short video script' };

/** What the card asks of you right now, as a numbered step. */
/** One beat → its on-screen text, b-roll notes and spoken lines. */
function scene(text: string) {
  const tag = (re: RegExp) => [...text.matchAll(re)].map((m) => m[1]!.trim());
  const spoken = text.replace(/\[(ON SCREEN|B-ROLL):[^\]]*\]/gi, '').split('\n').map((l) => l.trim()).filter(Boolean);
  return { screen: tag(/\[ON SCREEN:\s*([^\]]*)\]/gi), broll: tag(/\[B-ROLL:\s*([^\]]*)\]/gi), spoken };
}

/** The filming card: the opening line, the script folded by scene (closing line last), one button for the next step. */
function ScriptCard({ r, href }: { r: ScriptRow; href: string }) {
  const beats = splitPosts(r.body ?? '').map(scene);
  const video = r.platform !== 'reddit';
  return (
    <article className="scr">
      <header className="scr-head">
        <Plat p={r.platform} />
        <span className="scr-kind">{FORMAT_LABEL[r.format] ?? (video ? 'Video script' : 'Post you publish')}</span>
        <span className="faint scr-age">{ago(r.filmed_at ?? r.created_at)}</span>
      </header>
      <h3 className="scr-title">{r.title}</h3>

      {r.hook && (
        <div className="scr-hook">
          <span className="scr-lab">{video ? 'Opening line' : 'First line'}</span>
          <p>“{r.hook}”</p>
        </div>
      )}

      {beats.length > 0 && (
        <details className="acc acc-sm">
          <summary>{video ? 'Full script' : 'Full post'} <span className="faint">· {beats.length} {video ? `scene${beats.length === 1 ? '' : 's'}` : `part${beats.length === 1 ? '' : 's'}`}</span></summary>
          <ol className="scr-scenes">
            {beats.map((b, i) => (
              <li key={i}>
                <span className="scr-num">{video ? `Scene ${i + 1}` : `Part ${i + 1}`}</span>
                {b.screen.map((s, j) => <p key={`s${j}`} className="scr-screen"><span>On screen</span>{s}</p>)}
                {b.broll.map((s, j) => <p key={`b${j}`} className="scr-broll"><span>Show</span>{s}</p>)}
                {b.spoken.length > 0 && <div className="scr-say">{video && <span className="scr-lab">Say</span>}{b.spoken.map((l, j) => <p key={j}>{l}</p>)}</div>}
              </li>
            ))}
          </ol>
          {r.cta && <p className="scr-cta"><span className="scr-lab">Ends with</span>“{r.cta}”</p>}
        </details>
      )}
      {r.cta && !beats.length && <p className="scr-cta"><span className="scr-lab">Ends with</span>“{r.cta}”</p>}

      {r.stage === 'uploaded' && (
        <p className="mono scr-stats">
          {r.published_url && <a href={r.published_url} target="_blank" rel="noreferrer">on {PLATFORM[r.platform]?.label ?? r.platform} ↗</a>}
          {' · '}{r.views != null ? `${compact(r.views)} views` : 'views after your next results refresh'}
          {r.vs_usual != null && ` · ${times(r.vs_usual)} your usual`}
        </p>
      )}

      <footer className="scr-foot">
        {r.stage === 'to_film' && r.platform === 'reddit' && <UploadLink id={r.id} platform={r.platform} />}
        {r.stage === 'to_film' && video && <ApiButton path={`/content/api/scripts/${r.id}`} method="PATCH" body={{ filmed: true }} label="✓ I filmed it" className="btn btn-primary" />}
        {r.stage === 'filmed' && <>
          <UploadLink id={r.id} platform={r.platform} />
          <ApiButton path={`/content/api/scripts/${r.id}`} method="PATCH" body={{ filmed: false }} label="Not filmed yet" className="btn btn-sm" />
        </>}
        {r.stage === 'review' && r.status === 'needs_approval' && <Link href={href} scroll={false} className="btn btn-primary">Review and approve →</Link>}
        {r.stage === 'review' && r.status !== 'needs_approval' && <RunModuleButton id="qc_gate" label="Run the check" className="btn btn-primary" />}
        {!(r.stage === 'review' && r.status === 'needs_approval') && <Link href={href} scroll={false} className="btn">{r.stage === 'review' ? 'Edit the words' : 'Open'}</Link>}
      </footer>
    </article>
  );
}
