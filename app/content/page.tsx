// Today — the home page. Answers, top to bottom: what's waiting on me, what goes out next,
// is the pipeline flowing, and what happened. Every row has its one-click next step.
import Link from 'next/link';
import { getContext, getToday, listTodos, type Today, type TodayAction } from '@pratapai/content-pipeline';
import { loadHealth, params, type SearchParams } from './data';
import { KpiStrip, Section, Tile, Funnel, PillarBars, Plat, StatusChip, Dot, NeedsDb, PageHead } from './ui/viz';
import { ApiButton, RunModuleButton } from './ui/actions';
import { TodoTracker } from './ui/TodoTracker';
import { ItemDrawer } from './ui/ItemDrawer';
import { ago, when, shortDate, compact, RUN_COLOR, TONE, withParams } from './ui/format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<TodayAction['kind'], string> = {
  fix: 'Fix', blocked: 'Blocked', approve: 'Approve', topic: 'Decide', draft: 'Run', signal: 'Run', task: 'Task',
};
const MAX_ACTIONS = 9;

export default async function TodayPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const ctx = getContext();
  const health = await loadHealth();
  let today: Today | null = null;
  let todos: Awaited<ReturnType<typeof listTodos>> = [];
  let error: string | null = null;
  try {
    [today, todos] = await Promise.all([getToday(ctx, health), listTodos(ctx)]);
  } catch (e) {
    error = (e as Error).message;
  }
  const itemHref = (id: string) => withParams('/content', sp, { item: id });
  const head = (sub?: string) => <PageHead crumb="today" title="Here's what needs you." sub={sub} />;

  if (!today) return (<>{head()}<NeedsDb error={error} /></>);
  const k = today.kpis;
  const urgent = today.actions.filter((a) => a.tone === 'danger' || a.tone === 'warn').length;

  return (
    <>
      {head(today.actions.length === 0 ? 'Nothing needs you right now.'
        : `${today.actions.length} thing${today.actions.length === 1 ? '' : 's'} need you${urgent ? `, ${urgent} of them urgent` : ''}. Work top to bottom.`)}

      <KpiStrip items={[
        { label: 'Needs you', value: today.actions.length, sub: k.oldestWaitingHours != null ? `oldest approval ${k.oldestWaitingHours}h` : 'approval queue empty', href: '#needs-you' },
        { label: 'Published this week', value: k.publishedThisWeek, denom: `${k.weeklyTarget} target`, sub: k.cycleMedianDays != null ? `idea → live ${k.cycleMedianDays}d median` : undefined },
        { label: 'Queue runway', value: k.runwayDays, unit: 'days', sub: k.runwayDays < 3 ? 'running low, draft more' : 'of signed-off content', href: '/content/calendar' },
        { label: 'Blocked', value: k.blocked, sub: k.blocked ? 'approved but can’t go out' : 'nothing stuck', href: '/content/board?stage=approved' },
        { label: 'Reach · 7d', value: compact(k.reach7d), sub: `${compact(k.engagement7d)} likes, comments & shares`, href: '/content/analytics?range=7' },
        k.best7d
          ? { label: 'Best this week', value: `${k.best7d.vsUsual.toFixed(1)}x`, sub: `your usual · ${k.best7d.title.slice(0, 40)}`, href: itemHref(k.best7d.id) }
          : { label: 'Best this week', value: '—', sub: today.own.baseline.length ? 'no results on this week’s posts yet' : 'needs your own results' },
      ]} />
      <OwnResultsLine own={today.own} />

      <Section eyebrow="Work top to bottom" title="What's waiting on you" id="needs-you"
        meta={today.actions.length ? `${today.actions.length} open · urgent first` : undefined}>
        {today.actions.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {k.runwayDays < 3
              ? <>You&apos;re clear, but runway is {k.runwayDays} days. Capture a signal on <Link href="/content/ideas">Ideas</Link> or run the pipeline to draft more.</>
              : 'You’re clear and the queue is healthy. Check Analytics for what to repurpose.'}
          </p>
        ) : (
          <ul className="row-list">
            {today.actions.slice(0, MAX_ACTIONS).map((a, i) => (
              <li key={i} className="row" style={{ flexWrap: 'wrap' }}>
                <Dot color={TONE[a.tone as keyof typeof TONE] ?? TONE.ink} pulse={a.tone === 'danger'} />
                <div className="grow">
                  <div className="t"><span className="label" style={{ marginRight: 8 }}>{KIND_LABEL[a.kind]}</span>{a.title}</div>
                  <div className="d" title={a.detail}>{a.detail}{a.at ? ` · ${ago(a.at)}` : ''}</div>
                </div>
                <ActionButtons a={a} itemHref={itemHref} />
              </li>
            ))}
            {today.actions.length > MAX_ACTIONS && (
              <li className="faint mono" style={{ fontSize: 11.5, padding: '8px 10px' }}>+{today.actions.length - MAX_ACTIONS} more — see Approvals, Ideas and System.</li>
            )}
          </ul>
        )}
      </Section>

      <div className="bento" style={{ marginTop: 40 }}>
        <Tile span={2} title="Up next" hint="next 7 days" link={{ href: '/content/calendar', label: 'calendar' }}>
          {today.upNext.length === 0 ? <p className="empty">Nothing scheduled. Approve drafts to fill the queue.</p> : (
            <ul className="row-list">
              {today.upNext.slice(0, 6).map((u) => (
                <li key={u.id}>
                  <Link href={itemHref(u.id)} scroll={false} className="row" aria-current={sp.item === u.id || undefined} style={{ textDecoration: 'none' }}>
                    <span className="mono" style={{ width: 118, fontSize: 11.5, color: u.at ? 'var(--ink-2)' : 'var(--warn)' }} title={when(u.at)}>
                      {u.at ? shortDate(u.at) : 'no time yet'}
                    </span>
                    <Plat p={u.platform} />
                    <span className="grow t">{u.title}</span>
                    <StatusChip status={u.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Tile>
        <Tile span={2} title="Pipeline" hint="one per idea" link={{ href: '/content/board', label: 'board' }}>
          <Funnel stages={today.funnel} />
        </Tile>
        <Tile span={2} title="Content mix" hint="vs target">
          <PillarBars mix={today.mix} />
        </Tile>
        <Tile span={2} title="Pipeline steps" link={{ href: '/content/system', label: 'system' }}>
          <ul className="row-list">
            {health.modules.map((m) => (
              <li key={m.id} className="row" title={m.error ?? m.message ?? m.description} style={{ padding: '7px 4px' }}>
                <Dot color={RUN_COLOR[m.lastStatus] ?? RUN_COLOR.never!} pulse={m.lastStatus === 'error'} />
                <span className="grow t" style={{ fontSize: 13 }}>{m.title}</span>
                <span className="faint mono" style={{ fontSize: 11 }}>{m.lastRunAt ? ago(m.lastRunAt) : 'never'}</span>
              </li>
            ))}
          </ul>
        </Tile>
        <Tile span={2} title="Activity">
          {today.activity.length === 0 ? <p className="empty">No activity yet.</p> : (
            <ul className="timeline">
              {today.activity.slice(0, 14).map((e, i) => (
                <li key={i} style={{ '--c': e.kind === 'run' ? RUN_COLOR[e.status] ?? 'var(--faint)' : 'var(--violet)' } as React.CSSProperties}>
                  <span className="faint mono" style={{ fontSize: 11 }} title={when(e.at)}>{ago(e.at)} · </span>
                  {e.kind === 'run' && <><b>{moduleTitle(health, e.title)}</b> <span className="muted">{e.status}</span>{e.detail ? <div className="faint" style={{ fontSize: 12 }}>{e.detail}</div> : null}</>}
                  {e.kind === 'approval' && <><span className="muted">{e.status.replace('_', ' ')}</span> {e.item_id ? <Link href={itemHref(e.item_id)} scroll={false}>{e.title}</Link> : e.title}{e.actor ? <span className="faint"> · {e.actor}</span> : null}</>}
                </li>
              ))}
            </ul>
          )}
        </Tile>
        <Tile span={2} title="Tasks">
          <div id="tasks"><TodoTracker initial={todos} /></div>
        </Tile>
      </div>

      {sp.item && <ItemDrawer id={sp.item} closeHref={withParams('/content', sp, { item: null })} linkFor={itemHref} />}
    </>
  );
}

function ActionButtons({ a, itemHref }: { a: TodayAction; itemHref: (id: string) => string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {a.itemId && <Link href={itemHref(a.itemId)} scroll={false} className="btn btn-sm">{a.kind === 'approve' ? 'Review' : 'Open'} →</Link>}
      {a.topicId && <>
        <ApiButton path={`/content/api/topics/${a.topicId}`} method="PATCH" body={{ decision: 'selected' }} label="Select" className="btn btn-sm btn-ink" />
        <ApiButton path={`/content/api/topics/${a.topicId}`} method="PATCH" body={{ decision: 'dropped' }} label="Drop" className="btn btn-sm" />
      </>}
      {a.moduleId && <RunModuleButton id={a.moduleId} label={a.kind === 'fix' || a.kind === 'blocked' ? 'Retry' : 'Run'} />}
      {a.href && <Link href={a.href} className="btn btn-sm">Fix →</Link>}
      {a.todoId && <Link href="#tasks" className="btn btn-sm">View</Link>}
    </span>
  );
}

/** Own-account results: when they were last refreshed, and the button that does it now. */
function OwnResultsLine({ own }: { own: Today['own'] }) {
  const r = own.lastRun;
  if (!own.ready && !r) {
    return <p className="own-line">Add your own accounts in <Link href="/content/brand">Brand kit</Link> to see each post against your usual.</p>;
  }
  return (
    <div className="own-line">
      <span>
        {r?.status === 'running' ? `Refreshing your results (${r.stage})…`
          : r ? `Your results: refreshed ${ago(r.finished_at ?? r.started_at)} from ${r.total} of your posts · $${r.cost.toFixed(2)}${r.status === 'error' ? ' · last refresh failed' : ''}`
          : 'Your results haven’t been pulled yet.'}
        {own.baseline.length > 0 && ` · your usual: ${own.baseline.map((b) => `${compact(b.median_reactions)} on ${b.platform}`).join(', ')}`}
      </span>
      {r?.status !== 'running' && <ApiButton path="/content/api/decode" body={{ self: true }} label="Refresh my results" className="btn btn-sm" />}
    </div>
  );
}

function moduleTitle(health: { modules: { id: string; title: string }[] }, id: string): string {
  return health.modules.find((m) => m.id === id)?.title ?? id;
}
