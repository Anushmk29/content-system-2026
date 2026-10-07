// "Today" — the dashboard home. Answers, in order: what is blocked, what is waiting on
// me, what goes out next, and are we on target. Every action names its fix.
import type { ModuleContext } from '../modules/module.ts';
import type { SystemHealth } from './health-service.ts';
import { createRepo, type ActivityRow } from '../db/repo.ts';
import { groupIdeas } from './board-service.ts';
import { pillarMix, type PillarMix } from './overview-service.ts';
import { getOwnResults, type OwnResults } from './analytics-service.ts';
import { CONTENT_STATUSES, WEEKLY_POST_TARGET } from '../../core/src/index.ts';

export type ActionTone = 'danger' | 'warn' | 'brand' | 'info';

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

export interface UpNextRow {
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
    blocked: number;
    oldestWaitingHours: number | null;
    /** Reach and engagement on posts that went live in the last 7 days. */
    reach7d: number;
    engagement7d: number;
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
  claude: 'Set CONTENT_OPENROUTER_API_KEY or CONTENT_ANTHROPIC_API_KEY.',
  database: 'Check CONTENT_DATABASE_URL.',
};

export async function getToday(ctx: ModuleContext, health: SystemHealth, now = new Date()): Promise<Today> {
  const repo = createRepo(ctx.db);
  const [items, ready, topics, selected, signals, todos, published, recent, cycle, liveMix, activity, own] = await Promise.all([
    repo.allItems(),
    repo.publishReady(),
    repo.reviewableTopics(),
    repo.selectedTopics(),
    repo.unprocessedResearchInputs(),
    repo.listTodos('open'),
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
    if (a.state === 'error' || a.state === 'degraded' || (a.state === 'unconfigured' && a.id !== 'jev' && a.id !== 'apify')) {
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
  let blocked = 0;
  for (const it of items.filter((i) => i.status === 'approved' && !i.postiz_id)) {
    if (!readyIds.has(it.id)) {
      blocked++;
      actions.push({ kind: 'blocked', tone: 'danger', title: it.title, detail: `${it.platform} · approved but a claim has no proof: add a proof link or edit the claim out`, itemId: it.id });
    } else if (publisherBroken) {
      blocked++;
      actions.push({ kind: 'blocked', tone: 'danger', title: it.title, detail: `${it.platform} · approved but scheduling failed: ${publisher?.message ?? 'see Postiz Scheduler'}`, itemId: it.id, moduleId: 'publisher' });
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
  if (selected.length) actions.push({ kind: 'draft', tone: 'info', title: `${selected.length} selected topic(s) waiting to be drafted`, detail: 'Run Draft Generator, then QC Gate.', moduleId: 'draft_generator' });
  if (signals.length) actions.push({ kind: 'signal', tone: 'info', title: `${signals.length} signal(s) waiting`, detail: 'Run Research Collector, then Topic Scorer.', moduleId: 'research' });
  for (const t of todos.filter((t) => t.priority <= 2)) {
    actions.push({ kind: 'task', tone: 'info', title: t.title, detail: `P${t.priority} task${t.detail ? ` · ${t.detail}` : ''}`, todoId: t.id });
  }

  // up next: timed items in the next 7 days + approved ones with no time yet
  const horizon = now.getTime() + 7 * 86_400_000;
  const upNext: UpNextRow[] = items
    .filter((i) => (i.status === 'approved' || i.status === 'queued'))
    .map((i) => ({ id: i.id, title: i.title, platform: i.platform, status: i.status, at: i.scheduled_at ? new Date(i.scheduled_at).toISOString() : null }))
    .filter((r) => r.at === null || (new Date(r.at).getTime() >= now.getTime() - 3_600_000 && new Date(r.at).getTime() <= horizon))
    .sort((a, b) => (a.at ?? '9') < (b.at ?? '9') ? -1 : 1);
  const runwayCount = items.filter((i) => i.status === 'queued' || (i.status === 'approved' && readyIds.has(i.id))).length;

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
      blocked,
      oldestWaitingHours: oldest ? Math.round((now.getTime() - new Date(oldest.updated_at ?? oldest.created_at).getTime()) / 3_600_000) : null,
      reach7d: recent.reduce((s, p) => s + (Number(p.reach ?? p.impressions) || 0), 0),
      engagement7d: recent.reduce((s, p) => s + (Number(p.engagement) || 0), 0),
      best7d: best ? { id: best.id, title: best.title, platform: best.platform, vsUsual: Number(best.vs_usual) } : null,
      cycleMedianDays: cycle == null ? null : Math.round(cycle * 10) / 10,
    },
    own,
    upNext, funnel, mix, activity,
  };
}
