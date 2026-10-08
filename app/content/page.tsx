// Today — the home page. Only what needs the user: the "needs you" cards (urgent first, each with
// its one blue-pencil button), what goes out today, and three numbers for the week. Pipeline
// health, mix and activity sit folded at the bottom for when they're wanted.
import Link from 'next/link';
import { getContext, getToday, listTodos, type Today, type TodayAction } from '@pratapai/content-pipeline';
import { loadHealth, params, type SearchParams } from './data';
import { Section, Tile, Funnel, PillarBars, Plat, StatusChip, Dot, NeedsDb, PageHead } from './ui/viz';
import { ApiButton, RunModuleButton } from './ui/actions';
import { TodoTracker } from './ui/TodoTracker';
import { ItemDrawer } from './ui/ItemDrawer';
import { ago, when, shortDate, compact, times, RUN_COLOR, TONE, withParams } from './ui/format';

const KIND_LABEL: Record<TodayAction['kind'], string> = {
  fix: 'Fix', blocked: 'Blocked', approve: 'Approve', topic: 'Decide', draft: 'Run', signal: 'Run', task: 'Task',
};
const MAX_ACTIONS = 9;
const TONE_ATTR: Record<string, string | undefined> = { danger: 'danger', warn: 'warn', info: 'info' };

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
  const head = (sub?: string) => <PageHead crumb="today" title="Today" sub={sub} />;

  if (!today) return (<>{head()}<NeedsDb error={error} /></>);
  const k = today.kpis;
  const urgent = today.actions.filter((a) => a.tone === 'danger' || a.tone === 'warn').length;
  const isToday = (at: string | null) => !!at && new Date(at).toDateString() === new Date().toDateString();
  const outToday = today.upNext.filter((u) => isToday(u.at));
  const nextUp = today.upNext.find((u) => u.at && !isToday(u.at));

  return (
    <>
      {head(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + (today.actions.length === 0 ? '. Nothing needs you right now.'
        : `. ${today.actions.length} thing${today.actions.length === 1 ? ' needs' : 's need'} you${urgent ? `, ${urgent} urgent` : ''}.`))}

      <Section eyebrow="Needs you" title={today.actions.length ? 'Work top to bottom' : 'You’re clear'} id="needs-you"
        meta={today.actions.length ? `${today.actions.length} open, urgent first${k.oldestWaitingHours != null ? `; oldest approval waiting ${k.oldestWaitingHours}h` : ''}` : undefined}>
        {today.actions.length === 0 ? (
          <div className="attention" data-tone="info">
            {k.runwayDays < 3
              ? <>Nothing waits on you, but only {k.runwayDays} days of posts are ready. <Link href="/content/ideas" className="btn btn-primary btn-sm" style={{ marginLeft: 8 }}>Add an idea</Link></>
              : <>Nothing waits on you and the queue is healthy. <Link href="/content/analytics" className="btn btn-sm" style={{ marginLeft: 8 }}>See what worked</Link></>}
          </div>
        ) : (
          <ul className="needs">
            {today.actions.slice(0, MAX_ACTIONS).map((a, i) => (
              <li key={i} className="attention" data-tone={TONE_ATTR[a.tone]}>
                <div className="what">
                  <b>{a.title}</b>
                  <span title={a.detail}>{KIND_LABEL[a.kind]}: {a.detail}{a.at ? ` (${ago(a.at)})` : ''}</span>
                </div>
                <ActionButtons a={a} itemHref={itemHref} />
              </li>
            ))}
            {today.actions.length > MAX_ACTIONS && (
              <li className="faint" style={{ fontSize: 12.5, padding: '4px 2px' }}>{today.actions.length - MAX_ACTIONS} more on Approvals, Ideas and Scripts.</li>
            )}
          </ul>
        )}
      </Section>

      <Section eyebrow="Going out today" meta={<Link href="/content/calendar">Full calendar</Link>}>
        {outToday.length === 0 ? (
          <p className="empty">Nothing goes out today.{nextUp
            ? <> Next: <Link href={itemHref(nextUp.id)} scroll={false}>{nextUp.title}</Link> on {shortDate(nextUp.at!)}.</>
            : ' Approve drafts to fill the queue.'}</p>
        ) : (
          <ul className="row-list">
            {outToday.map((u) => (
              <li key={u.id}>
                <Link href={itemHref(u.id)} scroll={false} className="row" aria-current={sp.item === u.id || undefined} style={{ textDecoration: 'none' }}>
                  <span className="mono" style={{ width: 64, fontSize: 11.5 }} title={when(u.at)}>{u.at ? new Date(u.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                  <Plat p={u.platform} />
                  <span className="grow t">{u.title}</span>
                  <StatusChip status={u.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="quiet-kpis" aria-label="This week">
        <Link href="/content/analytics?range=7"><b>{k.publishedThisWeek}/{k.weeklyTarget}</b>published this week</Link>
        <Link href="/content/calendar" style={k.runwayDays < 3 ? { color: 'var(--warn)' } : undefined}><b>{k.runwayDays}</b>days of posts ready</Link>
        <Link href="/content/analytics?range=7"><b>{compact(k.reach7d)}</b>reach in 7 days</Link>
        {k.best7d && <Link href={itemHref(k.best7d.id)} scroll={false}><b>{times(k.best7d.vsUsual)}</b>your usual: {k.best7d.title.slice(0, 40)}</Link>}
      </div>
      <OwnResultsLine own={today.own} />

      <div className="bento" style={{ marginTop: 24 }}>
        <Tile span={4} title="Your tasks">
          <div id="tasks"><TodoTracker initial={todos} /></div>
        </Tile>
      </div>

      <details className="more">
        <summary>Pipeline health: flow, content mix, steps and activity</summary>
        <div className="bento" style={{ marginTop: 16 }}>
          <Tile span={2} title="Up next" hint="next 7 days" link={{ href: '/content/calendar', label: 'calendar' }}>
            {today.upNext.length === 0 ? <p className="empty">Nothing scheduled.</p> : (
              <ul className="row-list">
                {today.upNext.slice(0, 6).map((u) => (
                  <li key={u.id}>
                    <Link href={itemHref(u.id)} scroll={false} className="row" style={{ textDecoration: 'none' }}>
                      <span className="mono" style={{ width: 118, fontSize: 11.5, color: u.at ? 'var(--ink-2)' : 'var(--warn)' }} title={when(u.at)}>{u.at ? shortDate(u.at) : 'no time yet'}</span>
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
          <Tile span={4} title="Activity">
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
        </div>
      </details>

      {sp.item && <ItemDrawer id={sp.item} closeHref={withParams('/content', sp, { item: null })} linkFor={itemHref} />}
    </>
  );
}

/** Each card's buttons. The first one is the move that clears the card: blue pencil, full size. */
function ActionButtons({ a, itemHref }: { a: TodayAction; itemHref: (id: string) => string }) {
  const P = 'btn btn-primary';
  return (
    <span className="acts">
      {a.itemId && <Link href={itemHref(a.itemId)} scroll={false} className={P}>{a.kind === 'approve' ? 'Review and approve' : 'Open the post'}</Link>}
      {a.topicId && <>
        <ApiButton path={`/content/api/topics/${a.topicId}`} method="PATCH" body={{ decision: 'selected' }} label="Draft this idea" className={P} />
        <ApiButton path={`/content/api/topics/${a.topicId}`} method="PATCH" body={{ decision: 'dropped' }} label="Drop" className="btn" />
      </>}
      {a.moduleId && <RunModuleButton id={a.moduleId} label={a.kind === 'fix' || a.kind === 'blocked' ? 'Retry' : 'Run it now'} className={a.itemId || a.topicId ? 'btn' : P} />}
      {a.href && <Link href={a.href} className={a.itemId || a.topicId || a.moduleId ? 'btn' : P}>{a.kind === 'fix' ? 'Fix it' : 'Go there'}</Link>}
      {a.todoId && <Link href="#tasks" className="btn">See the task</Link>}
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
