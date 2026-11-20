// Design — every carousel and image post, in one place to make its visual. The same creative panel
// as the post drawer (example → Make, or your own files); the visual is signed off with the copy on
// Approvals, so it can change until then.
import Link from 'next/link';
import { getContext, listDesignQueue, listStyles, type DesignRow, type DesignStage } from '@pratapai/content-pipeline';
import { params, type SearchParams } from '@/app/content/_lib/data';
import { PageHead, NeedsDb, Plat } from '@/app/content/_components/viz';
import { CreativePanel, MakeAll } from '@/app/content/_components/editors';
import type { ExampleOpt } from '@/app/content/_components/ExamplePicker';
import { ItemDrawer } from '@/app/content/_components/ItemDrawer';
import { RunModuleButton } from '@/app/content/_components/actions';
import { ago, shortDate, withParams } from '@/app/content/_lib/format';
import { carouselSlides } from '@pratapai/content-pipeline/core';

const STAGES: { key: DesignStage; label: string; title: string; description: string; empty: string }[] = [
  { key: 'needs', label: 'Create', title: 'Create your visuals', description: 'Choose a design example for each post, or upload your own media.', empty: 'Every post in your design queue has a visual.' },
  { key: 'made', label: 'Review', title: 'Review your visuals', description: 'Check each visual alongside the words before approving the post.', empty: 'Visuals appear here once they have been created or uploaded.' },
  { key: 'locked', label: 'Approved', title: 'Approved visuals', description: 'Your approved posts are ready to follow through to the calendar.', empty: 'Posts appear here after their words and visuals are approved.' },
];

export default async function DesignPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  let rows: DesignRow[] | null = null;
  let error: string | null = null;
  try { rows = await listDesignQueue((await getContext())); } catch (e) { error = (e as Error).message; }
  const styles = rows ? await listStyles((await getContext())).then((r) => r.map(({ id, name, kind, pages, has_person }) => ({ id, name, kind, pages, has_person }))).catch(() => []) : [];
  const head = (
    <PageHead title="Design" sub="Create the visual, review the post, then follow it to the calendar.">
      <Link href="/content/styles" className="btn">Design examples</Link>
    </PageHead>
  );
  if (!rows) return (<>{head}<NeedsDb error={error} /></>);
  const by = (k: DesignStage) => rows!.filter((r) => r.stage === k);
  const stage = STAGES.find((st) => st.key === sp.stage)
    ?? STAGES.find((st) => by(st.key).length > 0) ?? STAGES[0]!;
  const visible = by(stage.key);
  const stageHref = (key: DesignStage) => withParams('/content/design', sp, { stage: key, item: null });
  const itemHref = (id: string) => withParams('/content/design', sp, { stage: stage.key, item: id });

  return (
    <div className="design-page">
      {head}
      <nav className="dz-stages" aria-label="Design workflow">
        {STAGES.map((st) => <Link key={st.key} href={stageHref(st.key)} aria-current={stage.key === st.key ? 'step' : undefined}>
          <span>{st.label}</span><span className="dz-count">{by(st.key).length}</span>
        </Link>)}
      </nav>
      <section className="dz-stage" aria-labelledby="design-stage-title">
        <header className="dz-stage-head">
          <div><h2 id="design-stage-title">{stage.title}</h2><p>{stage.description}</p></div>
          <span className="dz-total">{visible.length} post{visible.length === 1 ? '' : 's'}</span>
        </header>
        {stage.key === 'needs' && visible.length > 1 && styles.length > 0 && <details className="dz-batch">
          <summary>Create all {visible.length} visuals with one example</summary>
          <MakeAll itemIds={visible.map((r) => r.id)} styles={styles} />
        </details>}
        {stage.key === 'made' && visible.length > 0 && <ApproveNext rows={visible} />}
        {visible.length === 0 ? <div className="dz-empty">
          <h3>{stage.key === 'needs' && rows.length > 0 ? 'Your visuals are ready' : 'Your queue is clear'}</h3>
          <p>{stage.empty}</p>
          {stage.key === 'needs' && by('made').length > 0
            ? <Link href={stageHref('made')} className="btn btn-primary">Review visuals</Link>
            : by('needs').length > 0 ? <Link href={stageHref('needs')} className="btn btn-primary">Create visuals</Link>
            : <Link href="/content/ideas" className="btn">Open ideas</Link>}
        </div> : <div className={`dz-grid${visible.length === 1 ? ' dz-grid-single' : ''}`}>
          {visible.map((r) => <DesignCard key={r.id} r={r} styles={styles} href={itemHref(r.id)} />)}
        </div>}
      </section>
      {sp.item && <ItemDrawer id={sp.item} closeHref={stageHref(stage.key)} linkFor={itemHref} />}
    </div>
  );
}

/** What to do once visuals exist: approve each post (words + visual together). Drafts still wait for the QC run. */
function ApproveNext({ rows }: { rows: DesignRow[] }) {
  const ready = rows.filter((r) => r.status === 'needs_approval').length;
  const qc = rows.length - ready;
  return (
    <div className="next-step">
      <div>
        <b>{ready > 0 ? `${ready} post${ready === 1 ? ' is' : 's are'} ready for approval` : 'Run the quality check before approval'}</b>
        <p>{qc > 0 ? `${qc} post${qc === 1 ? ' needs' : 's need'} a quality check. The words and visual are approved together.` : 'Open a post below to review its words and visual together.'}</p>
      </div>
      <div className="cr-row">
        {qc > 0 && <RunModuleButton id="qc_gate" label="Run quality check" className="btn btn-primary" />}
        {ready > 0 && <Link href="/content/approvals" className="btn btn-primary">Open approvals</Link>}
      </div>
    </div>
  );
}

/** One post: header, a preview of the visual (the made creative, or what its first slide will say),
 *  the slide text folded away, then the make/upload tools pinned to the bottom so cards line up. */
function DesignCard({ r, styles, href }: { r: DesignRow; styles: ExampleOpt[]; href: string }) {
  const image = r.format === 'quote_card';
  const slides = image ? [] : carouselSlides(r.body ?? '', r.format === 'carousel');
  // Fewer images than slides = an incomplete carousel (max 10 images per post).
  const short = !image && r.assets.length > 0 && r.assets.length < Math.min(slides.length, 10);
  const first = image ? r.hook : slides[0];
  return (
    <article className="dz-card">
      <header>
        <div className="dz-meta">
          <Plat p={r.platform} />
          <span>{image ? 'Image' : `Carousel · ${slides.length} slide${slides.length === 1 ? '' : 's'}`}</span>
          {short && <span className="dz-status" data-stage="needs" title="Make the visual again to get every slide">Only {r.assets.length} of {Math.min(slides.length, 10)} slides made</span>}
          <span className="dz-status" data-stage={r.stage}>{r.stage === 'needs' ? 'Needs visual' : r.stage === 'locked' ? 'Approved' : r.status === 'needs_approval' ? 'Ready to approve' : 'Needs quality check'}</span>
        </div>
        <h3 className="dz-title" title={`${r.title}: edit the copy`}><Link href={href} scroll={false}>{r.title}</Link></h3>
      </header>
      {!r.assets.length && (
        <div className="dz-mock" data-p={r.platform}>
          <span className="dz-tag">{image ? 'Post text' : `Slide 1 of ${slides.length}`} · text preview</span>
          <p>{first || 'No text yet. Open the copy to write it.'}</p>
        </div>
      )}
      {slides.length > 1 && (
        <details className="dz-slides">
          <summary>Read all {slides.length} slides</summary>
          <ol>{slides.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </details>
      )}
      <div className="dz-foot">
        <CreativePanel itemId={r.id} platform={r.platform} assets={r.assets} styles={styles} editable={r.stage !== 'locked'} job={{ startedAt: r.creative_started_at, error: r.creative_error }} bare want={image ? 'image' : 'carousel'} />
        {r.stage === 'made' && <Link href={href} scroll={false} className="btn btn-primary">{r.status === 'needs_approval' ? 'Review and approve' : 'Review copy and visual'}</Link>}
        {r.stage === 'locked' && <Link href={`/content/calendar?item=${r.id}`} className="btn btn-primary">Open in calendar</Link>}
      </div>
      <footer className="dz-card-footer">
        <Link href={href} scroll={false}>{r.stage === 'locked' ? 'View post' : 'Edit post text'}</Link>
        <span>{r.scheduled_at ? `Planned ${shortDate(r.scheduled_at)}` : `Created ${ago(r.created_at)}`}</span>
      </footer>
    </article>
  );
}
