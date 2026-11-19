// Creative Check — its own tab. Add a creative (copy + images or one MP4), check it before it goes
// out, apply fixes, re-check and compare. Separate from the posting pipeline on purpose: its own
// tables, API (/content/api/check) and job queue. Spec: docs/product/creative-check-prd.md.
import Link from 'next/link';
import { getContext, listCreatives, getCreative, compareChecks, MECHANISMS, CHECK_PLATFORMS, FUNNEL_STAGES, type CreativeListRow, type CreativeDetail } from '@pratapai/content-pipeline';
import { params, type SearchParams } from '@/app/content/_lib/data';
import { PageHead, NeedsDb, Chip } from '@/app/content/_components/viz';
import { StartCheck, Workspace, type Compare } from '@/app/content/check/_components/CreativeCheck';
import { ago, PLATFORM, TONE } from '@/app/content/_lib/format';

const LAST: Record<string, { label: string; color: string }> = {
  running: { label: 'checking', color: TONE.teal }, done: { label: 'checked', color: TONE.ok }, error: { label: 'failed', color: TONE.danger },
};

export default async function CheckPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  let list: CreativeListRow[] | null = null;
  let detail: CreativeDetail | null = null;
  let error: string | null = null;
  try {
    list = await listCreatives((await getContext()));
    const id = sp.new ? undefined : sp.c ?? list[0]?.id;
    if (id) detail = await getCreative((await getContext()), id).catch(() => null);
  } catch (e) { error = (e as Error).message; }

  const head = (
    <PageHead title="Creative Check"
      sub="Check a post before it goes out. Each fix points at a line or a second."
      how={[
        'Add a creative: its hook, caption and CTA, plus its images or one video.',
        'Check it. Facts like timing and cuts are measured by code; the AI reads the frames and words against your Brand Kit.',
        'Use a fix in one tap, or make the edit in your video tool, then re-check to see what got resolved.',
        'Nothing here touches your other posts. Copy the final words into the post when you’re happy.',
      ]} />
  );
  if (!list) return (<>{head}<NeedsDb error={error} /></>);

  // The check shown: ?run=<id>, else the newest. Compare it with the done check before it.
  const checks = detail?.checks ?? [];
  const shown = checks.find((c) => c.id === sp.run) ?? checks[0] ?? null;
  const before = shown ? checks.slice(checks.indexOf(shown) + 1).find((c) => c.status === 'done' && c.report) : undefined;
  const compare: Compare | null = shown?.report && before?.report ? { against: before.started_at, ...compareChecks(before.report, shown.report) } : null;

  return (
    <>
      {head}
      <div className="cc-layout">
        <aside className="cc-list" aria-label="Creatives">
          <Link href="/content/check?new=1" className="btn btn-primary btn-sm cc-newbtn" aria-current={!detail ? 'true' : undefined}>+ New check</Link>
          {list.length > 0 && <div className="label" style={{ margin: '16px 0 4px' }}>Your posts · {list.length}</div>}
          <ul className="row-list">
            {list.map((c) => (
              <li key={c.id}>
                <Link href={`/content/check?c=${c.id}`} className="row" aria-current={c.id === detail?.creative.id ? 'true' : undefined} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="grow">
                    <div className="t">{c.name}</div>
                    <div className="d">{PLATFORM[c.platform]?.label ?? c.platform} · {c.media.kind === 'none' ? 'copy only' : c.media.kind === 'video' ? 'video' : `${c.media.count} image${c.media.count === 1 ? '' : 's'}`} · {ago(c.updated_at)}</div>
                  </div>
                  {c.last && <Chip color={c.last.changed && c.last.status === 'done' ? TONE.warn : LAST[c.last.status]?.color ?? TONE.faint}>
                    {c.last.changed && c.last.status === 'done' ? 'changed' : LAST[c.last.status]?.label ?? c.last.status}
                  </Chip>}
                </Link>
              </li>
            ))}
            {list.length === 0 && <li className="empty">Posts you check show up here.</li>}
          </ul>
        </aside>
        <div className="cc-main">
          {detail
            ? <Workspace key={detail.creative.id} detail={detail} shownId={shown?.id ?? null} compare={compare}
                mechanisms={[...MECHANISMS]} platforms={[...CHECK_PLATFORMS]} stages={[...FUNNEL_STAGES]} />
            : <>{sp.c && !sp.new && <p className="cc-warn">That post no longer exists.</p>}
                <StartCheck platforms={[...CHECK_PLATFORMS]} stages={[...FUNNEL_STAGES]} first={list.length === 0} /></>}
        </div>
      </div>
    </>
  );
}
