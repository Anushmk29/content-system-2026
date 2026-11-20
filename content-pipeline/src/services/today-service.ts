// "Today" — the dashboard home. Answers, in order: what is blocked, what is waiting on
// me, what goes out next, and are we on target. Every action names its fix.
import type { ModuleContext } from '../modules/module.ts';
import type { SystemHealth } from './health-service.ts';
import { createRepo, type ActivityRow } from '../db/repo.ts';
import { groupIdeas } from './board-service.ts';
import { brand, pillarSlugs } from '../brand.ts';
import { getOwnResults, type OwnResults } from './analytics-service.ts';
import { connectedPlatforms } from './calendar-sync-service.ts';
import { CONTENT_STATUSES, WEEKLY_POST_TARGET } from '../../core/src/index.ts';
import { isManual, MANUAL_PLATFORMS, SCRIPT_FORMATS } from '../prompts/platform-playbooks.ts';

interface PillarMix {
  pillar: string;
  count: number;
  share: number;   // actual % of signed-off ideas, last 30 days
  target: number;  // Bible target %
}

/** Per-pillar share of the given counts vs the brand's target mix, in the brand's pillar order. */
function pillarMix(rows: { pillar: string; count: number }[]): PillarMix[] {
  const total = rows.reduce((s, p) => s + p.count, 0);
  const byPillar = new Map(rows.map((p) => [p.pillar, p.count]));
  return pillarSlugs().map((pillar) => {
    const count = byPillar.get(pillar) ?? 0;
    const target = brand().pillars.find((p) => p.slug === pillar)?.target ?? 0;
    return { pillar, count, share: total ? Math.round((count / total) * 100) : 0, target };
  });
}

type ActionTone = 'danger' | 'warn' | 'brand' | 'info';

export interface TodayAction {
  kind: 'fix' | 'blocked' | 'approve' | 'topic' | 'draft' | 'signal' | 'task';
  tone: ActionTone;
  title: string;
  detail: string;
  itemId?: string;
  topicId?: string;
  moduleId?: string;
  todoId?: string;
  href?: string;
  at?: string;
}

interface UpNextRow {
  id: string;
  title: string;
  platform: string;
  status: string;
  at: string | null; // null = approved, no time yet
}

export interface Today {
  actions: TodayAction[];
  kpis: {
    publishedThisWeek: number;
    weeklyTarget: number;
    runwayDays: number;
    readyToSchedule: number;
    scheduled7d: number;
    blocked: number;
    oldestWaitingHours: number | null;
    /** Reach and engagement on posts that went live in the last 7 days. */
    reach7d: number;
    engagement7d: number;
    clicks7d: number | null;
    qualifiedEngagement7d: number | null;
    /** The 7-day post that most beat your usual (needs Own Results). */
    best7d: { id: string; title: string; platform: string; vsUsual: number } | null;
    cycleMedianDays: number | null;
  };
  own: OwnResults;
  upNext: UpNextRow[];
  funnel: { status: string; count: number }[]; // per idea, not per platform copy
  mix: PillarMix[];
  activity: ActivityRow[];
}

/** Monday 00:00 UTC of the current week. */
export function weekStart(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

/** Days of content already signed off, at the weekly target's pace. */
export function runwayDays(readyOrScheduled: number, weeklyTarget: number): number {
  return Math.round((readyOrScheduled / (weeklyTarget / 7)) * 10) / 10;
}

const FIX_HINT: Record<string, string> = {
  postiz: '404 = wrong CONTENT_POSTIZ_API_URL (self-hosted Postiz usually serves it under /api); 401/403 = wrong CONTENT_POSTIZ_API_KEY. Then connect LinkedIn + X inside Postiz.',
  claude: 'Set CONTENT_OPENROUTER_API_KEY.',
  database: 'Check CONTENT_DATABASE_URL.',
};

/** A Postiz error turned into what to do about it. */
export function scheduleFix(error: string, platform: string): string {
  if (/no .*channel|none of the chosen/i.test(error)) return `${error}. Connect a ${platform} channel in Postiz, then retry.`;
  if (/Postiz S+ 40[13]/.test(error)) return `${error}. Check CONTENT_POSTIZ_API_KEY on Keys & settings.`;
  if (/Postiz S+ 404/.test(error)) return `${error}. Check CONTENT_POSTIZ_API_URL (self-hosted Postiz usually serves it under /api).`;
  return error;
}

/** Connections that are fine to leave unset: not a "fix" on Today. */
const OPTIONAL = ['jev', 'apify', 'youtube', 'transcriber'];

export async function getToday(ctx: ModuleContext, health: SystemHealth, now = new Date()): Promise<Today> {
  const repo = createRepo(ctx.db);
  const [items, ready, topics, selected, signals, todos, published, recent, cycle, liveMix, activity, own] = await Promise.all([
    repo.allItems(),
    repo.publishReady(),
    repo.reviewableTopics(),
    repo.selectedTopics(),
    repo.unprocessedResearchInputs(),
    repo.listTodos(),
    repo.publishedSince(weekStart(now).toISOString()),
    repo.performanceSince(7),
    repo.cycleMedianDays(),
    repo.liveMix(30),
    repo.activity(25),
    getOwnResults(ctx),
  ]);
  const best = recent.filter((p) => p.vs_usual != null).sort((a, b) => Number(b.vs_usual) - Number(a.vs_usual))[0];

  const actions: TodayAction[] = [];

  // 1 · broken integrations + modules (the reason things are stuck)
  for (const a of [health.database, ...health.adapters]) {
    if (a.state === 'error' || a.state === 'degraded' || (a.state === 'unconfigured' && !OPTIONAL.includes(a.id))) {
      actions.push({
        kind: 'fix', tone: a.state === 'error' ? 'danger' : 'warn',
        title: `${a.id} is ${a.state}`, detail: `${a.message} ${FIX_HINT[a.id] ?? ''}`.trim(), href: '/content/system',
      });
    }
  }
  for (const m of health.modules) {
    if (m.lastStatus === 'error' || m.lastStatus === 'degraded') {
      actions.push({
        kind: 'fix', tone: m.lastStatus === 'error' ? 'danger' : 'warn',
        title: `${m.title} ${m.lastStatus}`, detail: (m.error?.split('\n')[0] ?? m.message ?? '').trim(),
        moduleId: m.id, at: m.lastRunAt ?? undefined,
      });
    }
  }

  // 2 · approved but can't go out
  const readyIds = new Set(ready.map((r) => r.id));
  const publisher = health.modules.find((m) => m.id === 'publisher');
  const publisherBroken = publisher?.lastStatus === 'error' || publisher?.lastStatus === 'degraded';
  // The last scheduling run keeps each post's own failure; show that, not the "0 scheduled, 1 failed" summary.
  const lastFail = new Map<string, string>();
  const meta = await ctx.db.query<{ meta: { failures?: unknown[] } | null }>(
    `select meta from content.module_runs where module_id = 'publisher' order by started_at desc limit 1`).then((r) => r.rows[0]?.meta);
  for (const f of meta?.failures ?? []) if (f && typeof f === 'object') { const x = f as { id: string; error: string }; lastFail.set(x.id, x.error); }
  const channels = await connectedPlatforms(ctx);
  const noChannel = (platform: string) => channels !== null && !channels.includes(platform);
  let blocked = 0;
  // A YouTube Short is filmed by hand, never scheduled: it has its own prompts below.
  for (const it of items.filter((i) => i.status === 'approved' && !i.postiz_id && !isManual(i))) {
    if (!readyIds.has(it.id)) {
      blocked++;
      actions.push({ kind: 'blocked', tone: 'danger', title: it.title, detail: `${it.platform} · approved but a claim has no proof: add a proof link or edit the claim out`, itemId: it.id });
    } else if (noChannel(it.platform)) {
      blocked++;
      actions.push({ kind: 'blocked', tone: 'danger', title: it.title, detail: `${it.platform} · approved, but no ${it.platform} channel is connected in Postiz. Connect it in Postiz, then retry.`, itemId: it.id, moduleId: 'publisher' });
    } else if (lastFail.has(it.id) || publisherBroken) {
      blocked++;
      actions.push({ kind: 'blocked', tone: 'danger', title: it.title, detail: `${it.platform} · scheduling failed: ${scheduleFix(lastFail.get(it.id) ?? publisher?.message ?? 'see Postiz Scheduler', it.platform)}`, itemId: it.id, moduleId: 'publisher' });
    }
  }

  // 3 · waiting on a human decision (oldest first)
  const waiting = items.filter((i) => i.status === 'needs_approval')
    .sort((a, b) => new Date(a.updated_at ?? a.created_at).getTime() - new Date(b.updated_at ?? b.created_at).getTime());
  for (const it of waiting) {
    actions.push({ kind: 'approve', tone: 'warn', title: it.title, detail: `${it.platform} · ${it.approval_lane ?? 'review'} lane · needs your approval`, itemId: it.id, at: new Date(it.updated_at ?? it.created_at).toISOString() });
  }
  for (const t of topics) {
    actions.push({ kind: 'topic', tone: 'brand', title: t.title, detail: `score ${t.score_total}/25 · ${t.priority_band} · select to draft, or drop`, topicId: t.id });
  }

  // 4 · work the pipeline can do next if you press run
  const scripts = await ctx.db.query<{ to_film: string; filmed: string; to_post: string }>(
    `select count(*) filter (where filmed_at is null and (platform = 'youtube' or format::text = any($1))) as to_film,
            count(*) filter (where filmed_at is not null) as filmed,
            count(*) filter (where platform = 'reddit' and format::text <> all($1)) as to_post
     from content.content_items where status = 'approved' and (platform::text = any($2) or format::text = any($1))`,
    [SCRIPT_FORMATS, MANUAL_PLATFORMS]).then((r) => r.rows[0]);
  if (Number(scripts?.to_film)) actions.push({ kind: 'task', tone: 'brand', title: `${scripts!.to_film} video script(s) to film`, detail: 'Approved filming cards waiting for you; mark each filmed once recorded.', href: '/content/scripts' });
  if (Number(scripts?.filmed)) actions.push({ kind: 'task', tone: 'info', title: `${scripts!.filmed} filmed video(s) not posted yet`, detail: 'Post it, then paste the link so its views get tracked.', href: '/content/scripts' });
  if (Number(scripts?.to_post)) actions.push({ kind: 'task', tone: 'brand', title: `${scripts!.to_post} Reddit post(s) to post`, detail: 'Post it in the right subreddit by hand, then paste the link.', href: '/content/scripts' });
  const noAngle = selected.filter((t) => !t.angles?.length).length;
  if (noAngle) actions.push({ kind: 'topic', tone: 'info', title: `${noAngle} selected topic(s) without an angle`, detail: 'Pick the belief each post flips (Ideas → Find angles), or drafting uses the strongest one it finds.', href: '/content/ideas' });
  if (selected.length) actions.push({ kind: 'draft', tone: 'info', title: `${selected.length} selected topic(s) waiting to be drafted`, detail: 'Run Draft Generator, then QC Gate.', moduleId: 'draft_generator' });
  if (signals.length) actions.push({ kind: 'signal', tone: 'info', title: `${signals.length} signal(s) waiting`, detail: 'Run Research Collector, then Topic Scorer.', moduleId: 'research' });
  for (const t of todos.filter((t) => t.priority <= 2 && (t.status === 'open' || t.status === 'in_progress'))) {
    actions.push({ kind: 'task', tone: 'info', title: t.title, detail: `P${t.priority} task${t.detail ? ` · ${t.detail}` : ''}`, todoId: t.id });
  }

  // up next: timed items in the next 7 days + approved ones with no time yet
  const horizon = now.getTime() + 7 * 86_400_000;
  const upNext: UpNextRow[] = items
    .filter((i) => (i.status === 'approved' || i.status === 'queued') && !isManual(i))
    .map((i) => ({ id: i.id, title: i.title, platform: i.platform, status: i.status, at: i.scheduled_at ? new Date(i.scheduled_at).toISOString() : null }))
    .filter((r) => r.at === null || (new Date(r.at).getTime() >= now.getTime() - 3_600_000 && new Date(r.at).getTime() <= horizon))
    .sort((a, b) => (a.at ?? '9') < (b.at ?? '9') ? -1 : 1);
  const runwayCount = items.filter((i) => !isManual(i) && (i.status === 'queued' || (i.status === 'approved' && readyIds.has(i.id)))).length;

  const oldest = waiting[0];
  const ideas = groupIdeas(items);
  const funnel = CONTENT_STATUSES.map((status) => ({ status, count: ideas.filter((i) => i.stage === status).length }));

  const mix = pillarMix(liveMix);

  return {
    actions,
    kpis: {
      publishedThisWeek: published,
      weeklyTarget: WEEKLY_POST_TARGET,
      runwayDays: runwayDays(runwayCount, WEEKLY_POST_TARGET),
      readyToSchedule: items.filter((i) => !isManual(i) && i.status === 'approved' && !i.postiz_id && readyIds.has(i.id) && !noChannel(i.platform)).length,
      scheduled7d: upNext.filter((i) => i.status === 'queued' && i.at && new Date(i.at).getTime() >= now.getTime()).length,
      blocked,
      oldestWaitingHours: oldest ? Math.round((now.getTime() - new Date(oldest.updated_at ?? oldest.created_at).getTime()) / 3_600_000) : null,
      reach7d: recent.reduce((s, p) => s + (Number(p.reach ?? p.impressions) || 0), 0),
      engagement7d: recent.reduce((s, p) => s + (Number(p.engagement) || 0), 0),
      clicks7d: recent.some((p) => p.clicks != null) ? recent.reduce((s, p) => s + Number(p.clicks ?? 0), 0) : null,
      qualifiedEngagement7d: recent.some((p) => p.qualified_engagement != null) ? recent.reduce((s, p) => s + Number(p.qualified_engagement ?? 0), 0) : null,
      best7d: best ? { id: best.id, title: best.title, platform: best.platform, vsUsual: Number(best.vs_usual) } : null,
      cycleMedianDays: cycle == null ? null : Math.round(cycle * 10) / 10,
    },
    own,
    upNext, funnel, mix, activity,
  };
}
