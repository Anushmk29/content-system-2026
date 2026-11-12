// Approvals — the review queue, oldest first. Open a draft to read it as it will appear,
// check its claims, edit, then decide. Keyboard: J/K move, A approve, C/R note.
import Link from 'next/link';
import { getContext, getOperatorConsole, listDesignQueue, humanScore, HUMAN_MIN, type OperatorConsole } from '@pratapai/content-pipeline';
import { params, type SearchParams } from '../data';
import { Hint, PageHead, KpiStrip, Section, Plat, Chip, NeedsDb } from '../ui/viz';
import { ItemDrawer } from '../ui/ItemDrawer';
import { ReviewKeys } from '../ui/actions';
import { ago, when, withParams, TONE } from '../ui/format';

const LANE_COLOR: Record<string, string> = { safe_auto: TONE.ok, review: TONE.warn, sensitive: TONE.danger };
const LANE: Record<string, { label: string; tip: string }> = {
  safe_auto: { label: 'Low risk', tip: 'No claims or sensitive topics found' },
  review: { label: 'Check', tip: 'Read it before approving, as usual' },
  sensitive: { label: 'Sensitive', tip: 'Touches a risky topic or claim: read it carefully' },
};

export default async function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  let data: OperatorConsole | null = null;
  let error: string | null = null;
  try { data = await getOperatorConsole(getContext()); } catch (e) { error = (e as Error).message; }
  const noVisual = new Set(data ? (await listDesignQueue(getContext()).catch(() => [])).filter((d) => d.stage === 'needs').map((d) => d.id) : []);
  if (!data) return (<><PageHead title="Approvals" /><NeedsDb error={error} /></>);

  const queue = [...data.approvalQueue].sort((a, b) =>
    new Date(a.item.updated_at ?? a.item.created_at).getTime() - new Date(b.item.updated_at ?? b.item.created_at).getTime());
  const itemHref = (id: string) => withParams('/content/approvals', sp, { item: id });
  const hrefFor = Object.fromEntries(queue.map((q) => [q.item.id, itemHref(q.item.id)]));
  const ageH = (q: (typeof queue)[number]) => (Date.now() - new Date(q.item.updated_at ?? q.item.created_at).getTime()) / 3_600_000;
  const unprovenOf = (q: (typeof queue)[number]) => q.claims.filter((c) => !c.proof_url).length;
  const ready = queue.filter((q) => !unprovenOf(q) && q.item.approval_lane !== 'sensitive').length;

  return (
    <>
      <PageHead title="Approvals"
        sub={queue.length ? 'Nothing goes out until you approve it.' : 'Nothing waiting on you.'}
        next={queue.length ? {
          text: `${queue.length} draft${queue.length === 1 ? '' : 's'} waiting. Start with the oldest.`,
          action: <Link href={itemHref(queue[0]!.item.id)} scroll={false} className="btn btn-primary">Review it →</Link>,
        } : { text: 'All clear. New drafts start on Ideas.', action: <Link href="/content/ideas" className="btn">Go to Ideas</Link> }}
        how={[
          <>Click <b>Review</b> on a post. It opens on the right exactly as it will appear.</>,
          <>Read it. Fix any words directly, or add a proof link to claims marked <b>unproven</b>.</>,
          <><b>Approve</b> sends it to the Calendar to go out. <b>Changes</b> or <b>Reject</b> need a short note saying why.</>,
          <>Nothing is ever posted without your approval.</>,
        ]}>
        <Hint label="Keyboard shortcuts"><kbd>J</kbd>/<kbd>K</kbd> move · <kbd>A</kbd> approve · <kbd>C</kbd> changes · <kbd>R</kbd> reject · <kbd>Esc</kbd> close</Hint>
      </PageHead>

      <KpiStrip items={[
        { label: 'Waiting', value: queue.length },
        { label: 'Oldest', value: queue.length ? Math.round(ageH(queue[0]!)) : null, unit: 'h' },
        { label: 'Over 24h', value: queue.filter((q) => ageH(q) > 24).length },
        { label: 'Claims need proof', value: queue.reduce((s, q) => s + unprovenOf(q), 0) },
        { label: 'Ready to approve', value: ready },
      ]} />

      <Section eyebrow="The queue" title={queue.length ? 'Waiting for you' : 'Queue is empty'}
        meta={queue.length ? 'Oldest first. Click Review to read a post exactly as it will appear.' : undefined}>
      {queue.length === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Drafts land here after the quality check.</p>
      ) : (
        <ul className="row-list">
          {queue.map((q, i) => {
            const { item } = q;
            const unproven = unprovenOf(q);
            const age = item.updated_at ?? item.created_at;
            const old = ageH(q) > 24;
            const human = humanScore([item.hook, item.body, item.cta].filter(Boolean).join('\n\n')).score;
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
                  <Chip color={LANE_COLOR[item.approval_lane ?? 'review'] ?? TONE.faint} title={LANE[item.approval_lane ?? 'review']?.tip}>{LANE[item.approval_lane ?? 'review']?.label ?? item.approval_lane}</Chip>
                  {human < HUMAN_MIN && <Chip color={TONE.warn} title={`Sounds human: ${human}/100. Under ${HUMAN_MIN} reads AI-written, so rewrite or edit it.`}>sounds AI-written</Chip>}
                  {unproven > 0 && <Chip color={TONE.danger} title="claims without a proof link">{unproven} unproven</Chip>}
                  {noVisual.has(item.id) && <Chip color={TONE.warn} title="A carousel or image post with no visual yet: make it on Design">no visual</Chip>}
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
