// Today — the home page. Only what needs the user: the "needs you" cards (urgent first, each with
// its one blue-pencil button), what goes out today, and three numbers for the week. Pipeline
// health, mix and activity sit folded at the bottom for when they're wanted.
import Link from 'next/link';
import { headers } from 'next/headers';
import { getContext, getToday, listTodos, type Today, type TodayAction } from '@pratapai/content-pipeline';
import { loadHealth, params, type SearchParams } from '@/app/content/_lib/data';
import { Section, Tile, Funnel, PillarBars, Plat, StatusChip, Dot, NeedsDb, PageHead } from '@/app/content/_components/viz';
import { ApiButton, RunModuleButton } from '@/app/content/_components/actions';
import { TodoTracker } from '@/app/content/_components/TodoTracker';
import { ItemDrawer } from '@/app/content/_components/ItemDrawer';
import { ago, when, shortDate, compact, times, RUN_COLOR, TONE, PLATFORM, withParams } from '@/app/content/_lib/format';

const KIND_LABEL: Record<TodayAction['kind'], string> = {
  fix: 'Fix', blocked: 'Blocked', approve: 'Approve', topic: 'Decide', draft: 'Run', signal: 'Run', task: 'Task',
};
/** Fixes and blocks carry engine messages (URLs, HTTP codes): say it plainly, fold the detail. */
function plainDetail(a: TodayAction): string | null {
  if (a.kind === 'fix') return 'Something stopped working. Try again, or ask Autonoetic Edge.';
  if (a.kind !== 'blocked') return null;
  const p = a.detail.split(' · ')[0]!;
  const where = PLATFORM[p]?.label ?? p;
  return a.detail.includes('proof') ? `Approved for ${where}, but a claim needs a proof link.` : `Approved for ${where}, but it couldn’t be scheduled.`;
}
/** Priority bands, most important first. The colour is the band's, not the engine's tone. */
const BANDS = [
  { id: 'now', tone: 'danger', label: 'Do first', hint: 'Only you can do these, and posts are waiting on them.' },
  { id: 'next', tone: 'warn', label: 'Next', hint: 'Ideas to pick and things to film or post.' },
  { id: 'later', tone: 'ok', label: 'When you have time', hint: 'Nothing is stuck on these.' },
] as const;
const PER_BAND = 4;
type Band = (typeof BANDS)[number]['id'] | 'tech';
/** Broken tools and posts stuck behind them are ours to fix, not the user's. */
function bandOf(a: TodayAction): Band {
  if (a.kind === 'fix' || (a.kind === 'blocked' && a.moduleId)) return 'tech';
  if (a.kind === 'blocked' || a.kind === 'approve') return 'now';
  if ((a.kind === 'topic' && a.topicId) || (a.kind === 'task' && a.href)) return 'next';
  return 'later';
}

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
  const head = (sub?: string) => <PageHead title="Today" sub={sub} />;

  if (!today) return (<>{head()}<NeedsDb error={error} /></>);
  const k = today.kpis;
  const byBand = (b: Band) => today!.actions.filter((a) => bandOf(a) === b);
  // Technical problems are ours to fix: admin sees them, the client never does.
  const admin = (await headers()).get('x-content-role') === 'admin';
  const tech = admin ? byBand('tech') : [];
  const yours = today.actions.length - byBand('tech').length;
  const urgent = byBand('now').length;
  const isToday = (at: string | null) => !!at && new Date(at).toDateString() === new Date().toDateString();
  const outToday = today.upNext.filter((u) => isToday(u.at));
  const nextUp = today.upNext.find((u) => u.at && !isToday(u.at));

  return (
    <>
      {head(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + (yours === 0 ? '. Nothing needs you right now.'
        : `. ${yours} thing${yours === 1 ? ' needs' : 's need'} you${urgent ? `, ${urgent} to do first` : ''}.`))}

      <Section eyebrow="Needs you" title={yours ? 'Needs you' : 'You’re clear'} id="needs-you"
        meta={yours ? 'Red first, then amber, then green.' : undefined}>
        {yours === 0 ? (
          <div className="attention" data-tone="info">
            {k.runwayDays < 3
              ? <>Nothing waits on you, but only {k.runwayDays} days of posts are ready. <Link href="/content/ideas" className="btn btn-primary btn-sm" style={{ marginLeft: 8 }}>Add an idea</Link></>
              : <>Nothing waits on you and the queue is healthy. <Link href="/content/analytics" className="btn btn-sm" style={{ marginLeft: 8 }}>See what worked</Link></>}
          </div>
        ) : (
          BANDS.map((b) => {
            const list = byBand(b.id);
            if (!list.length) return null;
            return (
              <div key={b.id} className="prio" data-tone={b.tone}>
                <h3><i aria-hidden />{b.label} <span className="n">{list.length}</span><span className="hint">{b.hint}</span></h3>
                <ul className="needs">
                  {list.slice(0, PER_BAND).map((a, i) => <NeedCard key={i} a={a} tone={b.tone} itemHref={itemHref} />)}
                  {list.length > PER_BAND && (
                    <li className="faint" style={{ fontSize: 12.5, padding: '4px 2px' }}>
                      {list.length - PER_BAND} more. <Link href={b.id === 'now' ? '/content/approvals' : '/content/ideas'}>See all</Link>
                    </li>
                  )}
                </ul>
              </div>
            );
          })
        )}
        {tech.length > 0 && (
          <details className="prio prio-tech" data-tone="info">
            <summary>
              <i aria-hidden />Technical problems <span className="n">{tech.length}</span>
              <span className="hint">Admin only. The client doesn’t see these.{tech.some((a) => a.kind === 'blocked') ? ` ${tech.filter((a) => a.kind === 'blocked').length} approved post(s) go out once they’re fixed.` : ''}</span>
            </summary>
            <ul className="needs">
              {tech.map((a, i) => <NeedCard key={i} a={a} tone="info" itemHref={itemHref} quiet />)}
            </ul>
          </details>
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

function NeedCard({ a, tone, itemHref, quiet }: { a: TodayAction; tone: string; itemHref: (id: string) => string; quiet?: boolean }) {
  return (
    <li className="attention" data-tone={tone}>
      <div className="what">
        <b>{a.kind === 'fix' ? a.title.replace(/ is error$/, ' isn’t working').replace(/ degraded$/, ' is having trouble') : a.title}</b>
        {plainDetail(a) ? (
          <span>{plainDetail(a)} <details className="tech"><summary>details</summary>{a.detail}</details></span>
        ) : <span title={a.detail}>{KIND_LABEL[a.kind]}: {a.detail}{a.at ? ` (${ago(a.at)})` : ''}</span>}
      </div>
      <ActionButtons a={a} itemHref={itemHref} quiet={quiet} />
    </li>
  );
}

/** Each card's buttons. The first one is the move that clears the card: blue pencil, full size. */
function ActionButtons({ a, itemHref, quiet }: { a: TodayAction; itemHref: (id: string) => string; quiet?: boolean }) {
  const P = quiet ? 'btn btn-sm' : 'btn btn-primary';
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
