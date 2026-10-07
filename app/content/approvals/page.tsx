// Approvals — the review queue, oldest first. Open a draft to read it as it will appear,
// check its claims, edit, then decide. Keyboard: J/K move, A approve, C/R note.
import Link from 'next/link';
import { getContext, getOperatorConsole, type OperatorConsole } from '@pratapai/content-pipeline';
import { params, type SearchParams } from '../data';
import { PageHead, KpiStrip, Section, Plat, Chip, NeedsDb } from '../ui/viz';
import { ItemDrawer } from '../ui/ItemDrawer';
import { ReviewKeys } from '../ui/actions';
import { ago, when, withParams, TONE } from '../ui/format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LANE_COLOR: Record<string, string> = { safe_auto: TONE.ok, review: TONE.warn, sensitive: TONE.danger };

export default async function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  let data: OperatorConsole | null = null;
  let error: string | null = null;
  try { data = await getOperatorConsole(getContext()); } catch (e) { error = (e as Error).message; }
  if (!data) return (<><PageHead crumb="approvals" title="Read it, then sign it." /><NeedsDb error={error} /></>);

  const queue = [...data.approvalQueue].sort((a, b) =>
    new Date(a.item.updated_at ?? a.item.created_at).getTime() - new Date(b.item.updated_at ?? b.item.created_at).getTime());
  const itemHref = (id: string) => withParams('/content/approvals', sp, { item: id });
  const hrefFor = Object.fromEntries(queue.map((q) => [q.item.id, itemHref(q.item.id)]));
  const ageH = (q: (typeof queue)[number]) => (Date.now() - new Date(q.item.updated_at ?? q.item.created_at).getTime()) / 3_600_000;
  const unprovenOf = (q: (typeof queue)[number]) => q.claims.filter((c) => !c.proof_url).length;
  const ready = queue.filter((q) => !unprovenOf(q) && q.item.approval_lane !== 'sensitive').length;

  return (
    <>
      <PageHead crumb="approvals" title="Read it, then sign it."
        sub={queue.length ? `${queue.length} draft${queue.length === 1 ? '' : 's'} the QC Gate routed to you, oldest first. Open one to read it as it will appear.` : 'Nothing waiting on you.'}>
        <span className="faint mono" style={{ fontSize: 11 }}><kbd>J</kbd>/<kbd>K</kbd> move · <kbd>A</kbd> approve · <kbd>C</kbd> changes · <kbd>R</kbd> reject · <kbd>Esc</kbd> close</span>
      </PageHead>

      <KpiStrip items={[
        { label: 'Waiting', value: queue.length, sub: 'drafts in the queue' },
        { label: 'Oldest', value: queue.length ? Math.round(ageH(queue[0]!)) : null, unit: 'h', sub: 'since last update' },
        { label: 'Over 24h', value: queue.filter((q) => ageH(q) > 24).length },
        { label: 'Unproven claims', value: queue.reduce((s, q) => s + unprovenOf(q), 0), sub: 'block publishing' },
        { label: 'Ready to sign', value: ready, sub: 'all claims proven, not sensitive' },
      ]} />

      <Section eyebrow="The queue" title={queue.length ? 'Oldest first.' : 'Queue is empty.'}>
      {queue.length === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Drafts land here after the QC Gate routes them to a human. <Link href="/content/board">See the board</Link>.</p>
      ) : (
        <ul className="row-list">
          {queue.map((q, i) => {
            const { item } = q;
            const unproven = unprovenOf(q);
            const age = item.updated_at ?? item.created_at;
            const old = ageH(q) > 24;
            return (
              <li key={item.id}>
                <Link href={itemHref(item.id)} scroll={false} className="row" aria-current={sp.item === item.id || undefined}
                  style={{ textDecoration: 'none', padding: 14 }}>
                  <span className="mono faint" style={{ width: 20 }}>{i + 1}</span>
                  <Plat p={item.platform} />
                  <div className="grow">
                    <div className="t" style={{ fontWeight: 500 }}>{item.title}</div>
                    <div className="d">{(item.hook ?? item.body ?? '').slice(0, 140)}</div>
                  </div>
                  <Chip color={LANE_COLOR[item.approval_lane ?? 'review'] ?? TONE.faint}>{item.approval_lane ?? 'review'}</Chip>
                  {unproven > 0 && <Chip color={TONE.danger} title="claims without a proof link">{unproven} unproven</Chip>}
                  <span className="mono" style={{ width: 80, textAlign: 'right', fontSize: 11.5, color: old ? 'var(--warn)' : 'var(--faint)' }} title={when(age)}>{ago(age)}</span>
                  <span className="btn btn-sm">Review →</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      </Section>

      <ReviewKeys ids={queue.map((q) => q.item.id)} current={sp.item ?? null} hrefFor={hrefFor} />
      {sp.item && <ItemDrawer id={sp.item} closeHref={withParams('/content/approvals', sp, { item: null })} linkFor={itemHref} />}
    </>
  );
}
