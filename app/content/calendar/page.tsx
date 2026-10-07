// Calendar — what goes out when. Planned, scheduled and published posts by day; drag an
// approved post onto a day to plan it (the scheduler honours that time).
import { getContext, getCalendar, type CalendarData, type ContentItemRow } from '@pratapai/content-pipeline';
import { params, type SearchParams } from '../data';
import { PageHead, KpiStrip, NeedsDb } from '../ui/viz';
import { CalendarGrid, type CalItem } from '../ui/CalendarGrid';
import { ItemDrawer } from '../ui/ItemDrawer';
import { withParams } from '../ui/format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY = 86_400_000;

export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const view = sp.view === 'week' ? 'week' : 'month';
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.d ?? '') ? sp.d! : null;
  const base = anchor ? new Date(`${anchor}T12:00:00Z`) : new Date();
  // Generous UTC window; the client grid buckets by the viewer's local day.
  const from = view === 'week' ? new Date(base.getTime() - 10 * DAY) : new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1) - 14 * DAY);
  const to = view === 'week' ? new Date(base.getTime() + 10 * DAY) : new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1) + 14 * DAY);

  let data: CalendarData | null = null;
  let error: string | null = null;
  try { data = await getCalendar(getContext(), from, to); } catch (e) { error = (e as Error).message; }
  if (!data) return (<><PageHead crumb="calendar" title="What goes out, and when." /><NeedsDb error={error} /></>);

  const toCal = (i: ContentItemRow, at: string | null): CalItem => ({
    id: i.id, title: i.title, platform: i.platform, status: i.status, at,
    movable: i.status === 'approved' && !i.postiz_id,
  });
  const itemHref = (id: string) => withParams('/content/calendar', sp, { item: id });
  const now = Date.now();
  const ahead = data.dated.filter((i) => new Date(i.at).getTime() > now);

  return (
    <>
      <PageHead crumb="calendar" title="What goes out, and when." sub="Planned, scheduled and published posts. Drag an approved post onto a day to set its time." />
      <KpiStrip items={[
        { label: 'Scheduled', value: ahead.length, sub: 'in this view, still to go out' },
        { label: 'Next 7 days', value: ahead.filter((i) => new Date(i.at).getTime() < now + 7 * DAY).length },
        { label: 'Unplanned', value: data.unplanned.length, sub: 'approved, no time yet' },
        { label: 'Published', value: data.dated.filter((i) => ['published', 'performance_captured'].includes(i.status)).length, sub: 'in this view' },
      ]} />
      <CalendarGrid view={view} anchor={anchor}
        items={data.dated.map((i) => toCal(i, i.at))}
        unplanned={data.unplanned.map((i) => toCal(i, null))} />
      {sp.item && <ItemDrawer id={sp.item} closeHref={withParams('/content/calendar', sp, { item: null })} linkFor={itemHref} />}
    </>
  );
}
