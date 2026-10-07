// Board — one card per idea (anchor + its platform copies), in the column where work is
// still owed. Filters live in the URL, so any view can be linked. Kanban or list.
import Link from 'next/link';
import { getContext, getIdeaBoard, loadBrand, pillarSlugs, type IdeaBoard, type IdeaCard } from '@pratapai/content-pipeline';
import { PLATFORMS } from '@pratapai/content-pipeline/core';
import { params, type SearchParams } from '../data';
import { PageHead, KpiStrip, Plat, StatusChip, Chip, NeedsDb } from '../ui/viz';
import { ItemDrawer } from '../ui/ItemDrawer';
import { ago, when, prettyPillar, withParams, STATUS_LABEL, STATUS_COLOR, PILLAR_COLOR, PLATFORM, TONE } from '../ui/format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NEXT_STEP: Record<string, string> = {
  idea: 'Draft it', draft: 'Waiting on QC Gate', qc_passed: 'Route to approval', needs_approval: 'Waiting on you',
  approved: 'Ready to schedule', queued: 'Scheduled in Postiz', published: 'Add results', performance_captured: 'Measured', archived: 'Archived',
};

export default async function BoardPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  let board: IdeaBoard | null = null;
  let error: string | null = null;
  try { board = await getIdeaBoard(getContext()); } catch (e) { error = (e as Error).message; }
  const pillars = pillarSlugs(await loadBrand(getContext()));
  if (!board) return (<><PageHead crumb="board" title="Every idea, by stage." /><NeedsDb error={error} /></>);

  const q = (sp.q ?? '').toLowerCase();
  const match = (i: IdeaCard) =>
    (!q || i.title.toLowerCase().includes(q)) &&
    (!sp.platform || i.pieces.some((p) => p.platform === sp.platform)) &&
    (!sp.pillar || i.pillar === sp.pillar) &&
    (!sp.stage || i.stage === sp.stage);
  const ideas = board.ideas.filter(match);
  const view = sp.view === 'list' ? 'list' : 'board';
  const itemHref = (id: string) => withParams('/content/board', sp, { item: id });
  const openFor = (i: IdeaCard) => itemHref(i.pieces.find((p) => p.status === i.stage)?.id ?? i.id);
  const columns = board.columns
    .filter((c) => (sp.stage ? c.status === sp.stage : c.status !== 'archived'))
    .map((c) => ({ ...c, ideas: c.ideas.filter(match) }));
  const filtered = Boolean(q || sp.platform || sp.pillar || sp.stage);
  const n = (...st: string[]) => board.ideas.filter((i) => st.includes(i.stage)).length;

  return (
    <>
      <PageHead crumb="board" title="Every idea, by stage."
        sub={`${ideas.length} idea${ideas.length === 1 ? '' : 's'}${filtered ? ' match the filter' : ''}. Each card is one idea with its platform copies, in the column where work is still owed.`}>
        <nav className="seg" aria-label="View">
          <Link href={withParams('/content/board', sp, { view: null, item: null })} aria-current={view === 'board' ? 'page' : undefined}>board</Link>
          <Link href={withParams('/content/board', sp, { view: 'list', item: null })} aria-current={view === 'list' ? 'page' : undefined}>list</Link>
        </nav>
      </PageHead>

      <KpiStrip items={[
        { label: 'In flight', value: n('idea', 'draft', 'qc_passed', 'needs_approval', 'approved', 'queued'), sub: 'not yet live' },
        { label: 'Drafts', value: n('draft'), href: '/content/board?stage=draft' },
        { label: 'In QC', value: n('qc_passed'), href: '/content/board?stage=qc_passed' },
        { label: 'Awaiting you', value: n('needs_approval'), href: '/content/approvals' },
        { label: 'Live', value: n('published', 'performance_captured'), href: '/content/board?stage=published' },
      ]} />

      <form className="toolbar" action="/content/board" method="get">
        {view === 'list' && <input type="hidden" name="view" value="list" />}
        <input className="input" name="q" defaultValue={sp.q ?? ''} placeholder="Search titles…" aria-label="Search" style={{ width: 240 }} />
        <select className="input" name="platform" defaultValue={sp.platform ?? ''} aria-label="Platform" style={{ width: 150 }}>
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM[p]?.label ?? p}</option>)}
        </select>
        <select className="input" name="pillar" defaultValue={sp.pillar ?? ''} aria-label="Theme" style={{ width: 210 }}>
          <option value="">All themes</option>
          {pillars.map((p) => <option key={p} value={p}>{prettyPillar(p)}</option>)}
        </select>
        <select className="input" name="stage" defaultValue={sp.stage ?? ''} aria-label="Stage" style={{ width: 170 }}>
          <option value="">All stages</option>
          {Object.entries(STATUS_LABEL).map(([s, l]) => <option key={s} value={s}>{l}</option>)}
        </select>
        <button type="submit" className="btn">Apply</button>
        {filtered && <Link href={view === 'list' ? '/content/board?view=list' : '/content/board'} className="btn">Clear</Link>}
      </form>

      {view === 'board' ? (
        <div className="kanban">
          {columns.map((c) => (
            <section key={c.status} className="col" aria-label={STATUS_LABEL[c.status]}>
              <div className="col-head">
                <span className="dot" style={{ '--c': STATUS_COLOR[c.status] ?? TONE.faint } as React.CSSProperties} />
                {STATUS_LABEL[c.status]}
                <span className="mono faint" style={{ marginLeft: 'auto' }}>{c.ideas.length}</span>
              </div>
              {c.ideas.map((i) => <IdeaCardView pillars={pillars} key={i.id} idea={i} href={openFor(i)} />)}
              {!c.ideas.length && <p className="empty" style={{ fontSize: 12 }}>—</p>}
            </section>
          ))}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
          <table className="table">
            <thead><tr><th>Idea</th><th>Platforms</th><th>Stage</th><th>Next step</th><th>Pillar</th><th>Updated</th></tr></thead>
            <tbody>
              {ideas.map((i) => (
                <tr key={i.id}>
                  <td><Link href={openFor(i)} scroll={false}>{i.title}</Link></td>
                  <td><span style={{ display: 'inline-flex', gap: 4 }}>{i.pieces.map((p) => <Plat key={p.id} p={p.platform} status={p.status} />)}</span></td>
                  <td><StatusChip status={i.stage} /></td>
                  <td className="muted">{NEXT_STEP[i.stage]}</td>
                  <td className="muted">{prettyPillar(i.pillar)}</td>
                  <td className="faint" title={when(i.updatedAt)}>{ago(i.updatedAt)}</td>
                </tr>
              ))}
              {!ideas.length && <tr><td colSpan={6} className="empty">No ideas match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {sp.item && <ItemDrawer id={sp.item} closeHref={withParams('/content/board', sp, { item: null })} linkFor={itemHref} />}
    </>
  );
}

function IdeaCardView({ idea, href, pillars }: { idea: IdeaCard; href: string; pillars: string[] }) {
  const pi = pillars.indexOf(idea.pillar ?? '');
  const waiting = idea.stage === 'needs_approval';
  return (
    <Link href={href} scroll={false} className="card" style={waiting ? { background: 'var(--hilite)' } : undefined}>
      <div className="t">{idea.title}</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
        {idea.pieces.map((p) => <Plat key={p.id} p={p.platform} status={p.status} />)}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {idea.pillar && <Chip color={PILLAR_COLOR[pi] ?? TONE.muted}>{prettyPillar(idea.pillar)}</Chip>}
        <span className="faint mono" style={{ fontSize: 11, marginLeft: 'auto' }} title={when(idea.updatedAt)}>{ago(idea.updatedAt)}</span>
      </div>
      <div className="mono" style={{ marginTop: 8, fontSize: 11, color: waiting ? 'var(--warn)' : 'var(--faint)' }}>→ {NEXT_STEP[idea.stage]}</div>
    </Link>
  );
}
