// Scripts — YouTube Short filming cards. Nothing posts these automatically: approve a script,
// film it, upload it to YouTube, paste the link. The link lets your own-results refresh track
// its views like any other post.
import Link from 'next/link';
import { getContext, listScripts, type ScriptRow, type ScriptStage } from '@pratapai/content-pipeline';
import { params, type SearchParams } from '../data';
import { PageHead, KpiStrip, NeedsDb, Section } from '../ui/viz';
import { ApiButton } from '../ui/actions';
import { UploadLink } from '../ui/ScriptActions';
import { ItemDrawer } from '../ui/ItemDrawer';
import { ago, compact, times, withParams, splitPosts } from '../ui/format';

const STAGES: { key: ScriptStage; label: string; empty: string }[] = [
  { key: 'to_film', label: 'To film', empty: 'Nothing to film. Approved Short scripts land here.' },
  { key: 'filmed', label: 'Filmed', empty: 'Mark a script filmed once you’ve recorded it.' },
  { key: 'uploaded', label: 'Uploaded', empty: 'Paste the YouTube link after uploading; its views then show here.' },
  { key: 'review', label: 'In review', empty: 'No scripts being drafted or reviewed.' },
];

export default async function ScriptsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  let rows: ScriptRow[] | null = null;
  let error: string | null = null;
  try { rows = await listScripts(getContext()); } catch (e) { error = (e as Error).message; }
  const head = (
    <PageHead crumb="scripts" title="Shorts to film."
      sub="YouTube Short scripts are filmed by you, never posted automatically. Approve one, film it, upload it, then paste the link so its views are tracked." />
  );
  if (!rows) return (<>{head}<NeedsDb error={error} /></>);
  const by = (k: ScriptStage) => rows!.filter((r) => r.stage === k);
  const itemHref = (id: string) => withParams('/content/scripts', sp, { item: id });

  return (
    <>
      {head}
      <KpiStrip items={[
        { label: 'To film', value: by('to_film').length, sub: 'approved, waiting for you' },
        { label: 'Filmed', value: by('filmed').length, sub: 'upload, then paste the link' },
        { label: 'Uploaded', value: by('uploaded').length, sub: 'tracked with your own results' },
        { label: 'In review', value: by('review').length, sub: 'drafts and approvals', href: '/content/approvals' },
      ]} />
      {rows.length === 0 && (
        <p className="empty">No Short scripts yet. In Decode, open a post or a format → <b>Make my version</b> → tick <b>YouTube Short</b>.</p>
      )}
      {rows.length > 0 && STAGES.map((st) => (
        <Section key={st.key} eyebrow={st.label} meta={`${by(st.key).length} script${by(st.key).length === 1 ? '' : 's'}`}>
          {by(st.key).length === 0 ? <p className="empty">{st.empty}</p> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
              {by(st.key).map((r) => <ScriptCard key={r.id} r={r} href={itemHref(r.id)} />)}
            </div>
          )}
        </Section>
      ))}
      {sp.item && <ItemDrawer id={sp.item} closeHref={withParams('/content/scripts', sp, { item: null })} linkFor={itemHref} />}
    </>
  );
}

/** The filming card: the spoken hook, each beat (on-screen text + lines), the closing line. */
function ScriptCard({ r, href }: { r: ScriptRow; href: string }) {
  const beats = splitPosts(r.body ?? '');
  return (
    <article className="card" style={{ cursor: 'default' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <b className="grow" style={{ fontSize: 14 }}>{r.title}</b>
        <span className="faint" style={{ fontSize: 11.5 }}>{ago(r.filmed_at ?? r.created_at)}</span>
      </div>
      {r.hook && <p style={{ margin: '8px 0', fontWeight: 600 }}>🎙 “{r.hook}”</p>}
      <ol style={{ margin: '0 0 8px', paddingLeft: 20, display: 'grid', gap: 6, fontSize: 12.5 }}>
        {beats.map((b, i) => <li key={i} className="pre" style={{ whiteSpace: 'pre-wrap' }}>{b}</li>)}
      </ol>
      {r.cta && <p className="muted" style={{ fontSize: 12.5, margin: '0 0 10px' }}>Ends with: “{r.cta}”</p>}
      {r.stage === 'uploaded' && (
        <p className="mono" style={{ fontSize: 12, margin: '0 0 10px' }}>
          {r.published_url && <a href={r.published_url} target="_blank" rel="noreferrer">on YouTube ↗</a>}
          {' · '}{r.views != null ? `${compact(r.views)} views` : 'views after your next results refresh'}
          {r.vs_usual != null && ` · ${times(r.vs_usual)} your usual`}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {r.stage === 'to_film' && <ApiButton path={`/content/api/scripts/${r.id}`} method="PATCH" body={{ filmed: true }} label="✓ Filmed" className="btn btn-sm btn-ink" />}
        {r.stage === 'filmed' && <>
          <UploadLink id={r.id} />
          <ApiButton path={`/content/api/scripts/${r.id}`} method="PATCH" body={{ filmed: false }} label="Back to film" className="btn btn-sm" />
        </>}
        {r.stage === 'review' && <Link href="/content/approvals" className="btn btn-sm">In {r.status.replace('_', ' ')} →</Link>}
        <Link href={href} scroll={false} className="btn btn-sm">Open / edit</Link>
      </div>
    </article>
  );
}
