// Calendar — what goes out when. Planned, scheduled and published posts by day; drag an
// approved post onto a day to plan it (the scheduler honours that time). With
// CONTENT_POSTIZ_SYNC=1 this calendar drives Postiz directly: a planned post is booked there at
// once, and a post already in Postiz can be dragged to move it there too.
import { getContext, getCalendar, type CalendarData, type ContentItemRow } from '@pratapai/content-pipeline';
import { params, type SearchParams } from '@/app/content/_lib/data';
import { PageHead, KpiStrip, NeedsDb } from '@/app/content/_components/viz';
import { CalendarGrid, type CalItem } from '@/app/content/calendar/_components/CalendarGrid';
import { ItemDrawer } from '@/app/content/_components/ItemDrawer';
import { withParams } from '@/app/content/_lib/format';
import Link from 'next/link';

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
  if (!data) return (<><PageHead title="Calendar" /><NeedsDb error={error} /></>);

  const sync = getContext().env.postizSync;
  const toCal = (i: ContentItemRow, at: string | null): CalItem => ({
    id: i.id, title: i.title, platform: i.platform, format: i.format, status: i.status, at,
    movable: (i.status === 'approved' && !i.postiz_id)
      || (sync && i.status === 'queued' && !!i.postiz_id && !!at && new Date(at).getTime() > Date.now()),
  });
  const itemHref = (id: string) => withParams('/content/calendar', sp, { item: id });
  const now = Date.now();
  const ahead = data.dated.filter((i) => new Date(i.at).getTime() > now);

  return (
    <>
      <PageHead title="Calendar" sub="What goes out, and when."
        next={data.unplanned.length ? {
          text: `${data.unplanned.length} approved post${data.unplanned.length === 1 ? ' needs' : 's need'} a date. Open a post to choose a time, or drag it onto a day.`,
          action: <Link className="btn btn-primary" href={itemHref(data.unplanned[0]!.id)}>Plan a post</Link>,
        } : !ahead.length ? {
          text: 'Nothing is coming up in this view. Review your drafts to fill the calendar.',
          action: <Link className="btn" href="/content/approvals">Review drafts</Link>,
        } : null}
        how={[
          <>Approved posts without a time wait in <b>Unplanned</b>.</>,
          <>Drag one onto a day to set when it goes out. Click any post to read or change it.</>,
          <>Video scripts and Reddit posts aren’t posted automatically: those are on <b>Film &amp; post</b>.</>,
        ]} />
      <KpiStrip items={[
        { label: 'Upcoming', value: ahead.length },
        { label: 'Next 7 days', value: ahead.filter((i) => new Date(i.at).getTime() < now + 7 * DAY).length },
        { label: 'Unplanned', value: data.unplanned.length },
        { label: 'Published', value: data.dated.filter((i) => ['published', 'performance_captured'].includes(i.status)).length },
      ]} />
      <CalendarGrid view={view} anchor={anchor}
        items={data.dated.map((i) => toCal(i, i.at))}
        unplanned={data.unplanned.map((i) => toCal(i, null))} />
      {sp.item && <ItemDrawer id={sp.item} closeHref={withParams('/content/calendar', sp, { item: null })} linkFor={itemHref} />}
    </>
  );
}
