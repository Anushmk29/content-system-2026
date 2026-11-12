// Design — every carousel and image post, in one place to make its visual. The same creative panel
// as the post drawer (example → Make, or your own files); the visual is signed off with the copy on
// Approvals, so it can change until then.
import Link from 'next/link';
import { getContext, listDesignQueue, listStyles, type DesignRow, type DesignStage } from '@pratapai/content-pipeline';
import { params, type SearchParams } from '../data';
import { PageHead, KpiStrip, NeedsDb, Section, Plat } from '../ui/viz';
import { CreativePanel, MakeAll } from '../ui/editors';
import type { ExampleOpt } from '../ui/ExamplePicker';
import { ItemDrawer } from '../ui/ItemDrawer';
import { RunModuleButton } from '../ui/actions';
import { ago, withParams, splitPosts } from '../ui/format';

const STAGES: { key: DesignStage; label: string; empty: string }[] = [
  { key: 'needs', label: 'Needs a visual', empty: 'Every carousel and image post has its visual.' },
  { key: 'made', label: 'Made · waiting for approval', empty: 'Nothing made yet that still waits for approval.' },
  { key: 'locked', label: 'Approved · locked with the copy', empty: 'No approved visuals waiting to go out.' },
];

export default async function DesignPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  let rows: DesignRow[] | null = null;
  let error: string | null = null;
  try { rows = await listDesignQueue(getContext()); } catch (e) { error = (e as Error).message; }
  const styles = rows ? await listStyles(getContext()).then((r) => r.map(({ id, name, kind, pages, has_person }) => ({ id, name, kind, pages, has_person }))).catch(() => []) : [];
  const head = (next: { text: string; action?: React.ReactNode } | null) => (
    <PageHead title="Design" next={next}
      sub="Posts that need an image or a carousel." />
  );
  if (!rows) return (<>{head(null)}<NeedsDb error={error} /></>);
  const by = (k: DesignStage) => rows!.filter((r) => r.stage === k);
  const n = (k: DesignStage) => by(k).length;
  const next = n('needs') ? { text: `${n('needs')} post${n('needs') === 1 ? ' needs' : 's need'} a visual.`, action: <a href="#needs" className="btn btn-primary">Make visuals ↓</a> }
    : n('made') ? { text: `${n('made')} visual${n('made') === 1 ? ' is' : 's are'} ready. Approve each with its words.`, action: <a href="#made" className="btn btn-primary">Approve ↓</a> }
    : rows.length ? null : { text: 'Pick Carousel or Image for a platform on an idea, then draft it.', action: <Link href="/content/ideas" className="btn">Go to Ideas</Link> };
  const itemHref = (id: string) => withParams('/content/design', sp, { item: id });

  return (
    <>
      {head(next)}
      <KpiStrip items={[
        { label: 'Needs a visual', value: by('needs').length },
        { label: 'Made', value: by('made').length, sub: 'to approve', href: '/content/approvals' },
        { label: 'Approved', value: by('locked').length, href: '/content/calendar' },
        { label: 'Examples', value: styles.length, href: '/content/styles' },
      ]} />
      {rows.length === 0 && (
        <p className="empty">Nothing here yet.</p>
      )}
      {rows.length > 0 && STAGES.map((st) => (
        <Section key={st.key} id={st.key} eyebrow={`${st.label} · ${by(st.key).length}`}>
          {st.key === 'needs' && <MakeAll itemIds={by('needs').map((r) => r.id)} styles={styles} />}
          {st.key === 'made' && by('made').length > 0 && <ApproveNext rows={by('made')} />}
          {by(st.key).length === 0 ? <p className="empty">{st.empty}</p> : (
            <div className="dz-grid">
              {by(st.key).map((r) => <DesignCard key={r.id} r={r} styles={styles} href={itemHref(r.id)} />)}
            </div>
          )}
        </Section>
      ))}
      {sp.item && <ItemDrawer id={sp.item} closeHref={withParams('/content/design', sp, { item: null })} linkFor={itemHref} />}
    </>
  );
}

/** What to do once visuals exist: approve each post (words + visual together). Drafts still wait for the QC run. */
function ApproveNext({ rows }: { rows: DesignRow[] }) {
  const ready = rows.filter((r) => r.status === 'needs_approval').length;
  const qc = rows.length - ready;
  return (
    <div className="next-step">
      <div>
        <b title="The words and the visual are approved together, then locked and put on the Calendar.">
          Approve {ready ? `${ready} post${ready === 1 ? '' : 's'}` : 'them'}{qc > 0 && ` · ${qc} need the quality check first`}
        </b>
      </div>
      {qc > 0 && <RunModuleButton id="qc_gate" label={`Check ${qc} now`} className="btn" />}
      {ready > 0 && <Link href="/content/approvals" className="btn btn-primary">Approve them one by one →</Link>}
    </div>
  );
}

/** One post: header, a preview of the visual (the made creative, or what its first slide will say),
 *  the slide text folded away, then the make/upload tools pinned to the bottom so cards line up. */
function DesignCard({ r, styles, href }: { r: DesignRow; styles: ExampleOpt[]; href: string }) {
  const image = r.format === 'quote_card';
  const slides = image ? [] : splitPosts(r.body ?? '');
  const first = image ? r.hook : slides[0];
  return (
    <article className="dz-card">
      <header>
        <div className="dz-meta">
          <Plat p={r.platform} />
          <span>{image ? 'Image' : `Carousel · ${slides.length} slide${slides.length === 1 ? '' : 's'}`}</span>
          <span style={{ marginLeft: 'auto' }}>{r.scheduled_at ? `goes out ${ago(r.scheduled_at)}` : ago(r.created_at)}</span>
        </div>
        <h3 className="dz-title" title={`${r.title}: edit the copy`}><Link href={href} scroll={false}>{r.title}</Link></h3>
      </header>
      {!r.assets.length && (
        <div className="dz-mock" data-p={r.platform}>
          <span className="dz-tag">{image ? 'Image' : `Slide 1 of ${slides.length}`} · no visual yet</span>
          <p>{first || 'No text yet. Open the copy to write it.'}</p>
        </div>
      )}
      {slides.length > 1 && (
        <details className="dz-slides">
          <summary>All {slides.length} slides’ text</summary>
          <ol>{slides.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </details>
      )}
      <div className="dz-foot">
        <CreativePanel itemId={r.id} platform={r.platform} assets={r.assets} styles={styles} editable={r.stage !== 'locked'} bare want={image ? 'image' : 'carousel'} />
        {r.stage === 'made' && r.status === 'needs_approval' && <Link href={href} scroll={false} className="btn btn-primary">Review and approve →</Link>}
      </div>
    </article>
  );
}
