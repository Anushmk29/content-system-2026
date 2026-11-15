import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../db/test-db.ts';
import { createRepo, type NewContentItem } from '../db/repo.ts';
import { createContentItems } from '../db/content-items.ts';
import type { ModuleContext } from '../modules/module.ts';
import type { SystemHealth } from './health-service.ts';
import { getIdeaBoard, editItemCopy, planItem, getItemDetail, getCalendar } from './board-service.ts';
import { getToday, weekStart, runwayDays } from './today-service.ts';
import { recordMetrics, getAnalytics } from './analytics-service.ts';

const db = await createTestDb();
const repo = createRepo(db);
const items = createContentItems(db);
const ctx = { db } as unknown as ModuleContext;
const health: SystemHealth = {
  overall: 'ok', checkedAt: new Date().toISOString(), adapters: [],
  database: { id: 'database', state: 'ok', message: '', checkedAt: '' }, modules: [],
};

const piece = (platform: string, format: string): NewContentItem =>
  ({ title: `idea-${platform}`, pillar: 'proof_and_use_cases', funnelStage: 'trust', platform, format, body: 'b' });

async function draftSet(claims: string[] = []): Promise<string[]> {
  const t = await db.query<{ id: string }>(`insert into content.topics (title, status) values ('t', 'selected') returning id`);
  return items.createDraftSet(t.rows[0]!.id, [piece('blog', 'article'), piece('linkedin', 'founder_post'), piece('x', 'thread')], claims);
}

async function approve(id: string) {
  await items.transition(id, { event: 'submit', lane: 'review' });
  await items.transition(id, { event: 'approve' });
}

test('board: one card per idea, sitting at its least-advanced piece', async () => {
  const [anchor, li, x] = await draftSet();
  await approve(li!);
  await items.transition(x!, { event: 'reject' });
  const board = await getIdeaBoard(ctx);
  const card = board.ideas.find((i) => i.id === anchor)!;
  assert.equal(card.pieces.length, 3);
  assert.equal(card.stage, 'draft', 'blog still draft; archived x ignored');
  assert.ok(board.columns.find((c) => c.status === 'draft')!.ideas.includes(card));
  const detail = await getItemDetail(ctx, li!);
  assert.equal(detail!.pieces.length, 3);
  assert.equal(detail!.approvals[0]!.decision, 'approved');
});

test('copy edits allowed before approval, refused after', async () => {
  const [a, b] = await draftSet();
  assert.equal((await editItemCopy(ctx, a!, { body: 'new body' })).ok, true);
  assert.equal((await repo.getItem(a!))!.body, 'new body');
  await approve(b!);
  assert.equal((await editItemCopy(ctx, b!, { body: 'sneaky' })).ok, false);
  assert.equal((await editItemCopy(ctx, a!, { body: 42 })).ok, false, 'non-text refused');
});

test('planning a time: only approved + not yet in Postiz, only in the future', async () => {
  const [a, b] = await draftSet();
  const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
  assert.equal((await planItem(ctx, a!, future)).ok, false, 'draft refused');
  await approve(b!);
  assert.equal((await planItem(ctx, b!, new Date(Date.now() - 1000).toISOString())).ok, false, 'past refused');
  assert.equal((await planItem(ctx, b!, future)).ok, true);
  await items.transition(b!, { event: 'schedule', postizId: 'p1', utmUrl: 'u', scheduledAt: future });
  assert.equal((await planItem(ctx, b!, future)).ok, false, 'already in Postiz');
});

test('calendar recovers expired approvals without moving booked posts or manual scripts', async () => {
  const calendarDb = await createTestDb();
  const calendarItems = createContentItems(calendarDb);
  const topic = await calendarDb.query<{ id: string }>(`insert into content.topics (title, status) values ('calendar', 'selected') returning id`);
  const ids = await calendarItems.createDraftSet(topic.rows[0]!.id, [
    piece('linkedin', 'founder_post'), piece('x', 'thread'), piece('linkedin', 'founder_post'),
    piece('x', 'thread'), piece('youtube', 'short_script'),
  ], []);
  for (const id of ids) {
    await calendarItems.transition(id, { event: 'submit', lane: 'review' });
    await calendarItems.transition(id, { event: 'approve' });
  }
  const day = 86_400_000;
  const now = Date.now();
  const past = new Date(now - day).toISOString();
  const future = new Date(now + day).toISOString();
  await calendarDb.query('update content.content_items set scheduled_at = $2 where id = $1', [ids[1], past]);
  await calendarDb.query('update content.content_items set scheduled_at = $2 where id = $1', [ids[2], future]);
  await calendarItems.transition(ids[3]!, { event: 'schedule', postizId: 'booked', utmUrl: 'u', scheduledAt: past });
  const calendar = await getCalendar({ db: calendarDb } as unknown as ModuleContext, new Date(now - 2 * day), new Date(now + 2 * day));
  assert.deepEqual(calendar.unplanned.map((i) => i.id).sort(), ids.slice(0, 2).sort());
  assert.deepEqual(new Set(calendar.dated.map((i) => i.id)), new Set([ids[2], ids[3]]));
  const savedPlan = (await createRepo(calendarDb).getItem(ids[1]!))!.scheduled_at!;
  assert.equal(new Date(savedPlan).toISOString(), past, 'display recovery does not change the saved plan');
});

test('today: unproven claim on an approved item is blocked; mix counts ideas not copies', async () => {
  const ids = await draftSet(['saved 10 hours a week']);
  for (const id of ids) await approve(id);
  const today = await getToday(ctx, health);
  const blocked = today.actions.filter((a) => a.kind === 'blocked' && ids.includes(a.itemId!));
  assert.equal(blocked.length, 3);
  assert.match(blocked[0]!.detail, /no proof/);
  const proof = today.mix.find((m) => m.pillar === 'proof_and_use_cases')!;
  const anchors = await db.query<{ n: number }>(
    `select count(distinct coalesce(anchor_id, id))::int as n from content.content_items where status in ('approved','queued','published','performance_captured')`);
  assert.equal(proof.count, anchors.rows[0]!.n, 'one per anchor');
  assert.equal(today.funnel.reduce((s, f) => s + f.count, 0), (await getIdeaBoard(ctx)).ideas.length);
});

test('week starts Monday UTC; runway is days of content at target pace', () => {
  assert.equal(weekStart(new Date('2026-10-01T10:00Z')).toISOString(), '2026-09-28T00:00:00.000Z'); // Thu
  assert.equal(weekStart(new Date('2026-09-28T00:30Z')).toISOString(), '2026-09-28T00:00:00.000Z'); // Mon
  assert.equal(weekStart(new Date('2026-10-04T23:00Z')).toISOString(), '2026-09-28T00:00:00.000Z'); // Sun
  assert.equal(runwayDays(5, 5), 7);
  assert.equal(runwayDays(0, 5), 0);
});

test('today separates ready approvals from confirmed schedules and missing metrics from zero', async () => {
  const isolatedDb = await createTestDb();
  const isolatedItems = createContentItems(isolatedDb);
  const isolatedRepo = createRepo(isolatedDb);
  const isolatedCtx = { db: isolatedDb } as unknown as ModuleContext;
  const now = new Date();
  const day = 86_400_000;
  const topic = await isolatedDb.query<{ id: string }>(`insert into content.topics (title, status) values ('schedule checks', 'selected') returning id`);
  const ids = await isolatedItems.createDraftSet(topic.rows[0]!.id, [
    piece('linkedin', 'founder_post'), piece('x', 'thread'), piece('linkedin', 'founder_post'),
    piece('x', 'thread'), piece('linkedin', 'founder_post'), piece('youtube', 'short_script'),
  ], []);
  for (const id of ids) {
    await isolatedItems.transition(id, { event: 'submit', lane: 'review' });
    await isolatedItems.transition(id, { event: 'approve' });
  }
  // A planned date on an approval is not a confirmed publishing slot.
  await isolatedDb.query('update content.content_items set scheduled_at = $2 where id = $1', [ids[0], new Date(now.getTime() + day).toISOString()]);
  for (const [index, days] of [[1, 2], [2, 8], [3, -1]] as const) {
    await isolatedItems.transition(ids[index]!, { event: 'schedule', postizId: `schedule-${index}`, utmUrl: 'u', scheduledAt: new Date(now.getTime() + days * day).toISOString() });
  }
  const unmeasured = await getToday(isolatedCtx, health, now);
  assert.equal(unmeasured.kpis.readyToSchedule, 2, 'only publish-ready, automatic approvals count');
  assert.equal(unmeasured.kpis.scheduled7d, 1, 'ignore planned approvals, past slots and slots beyond seven days');
  assert.equal(unmeasured.kpis.clicks7d, null);
  assert.equal(unmeasured.kpis.qualifiedEngagement7d, null);

  await isolatedItems.goLiveDue();
  assert.equal((await recordMetrics(isolatedCtx, ids[3]!, { clicks: 0, qualifiedEngagement: 0 })).ok, true);
  const measured = await getToday(isolatedCtx, health, now);
  assert.equal(measured.kpis.clicks7d, 0, 'a measured zero remains a number');
  assert.equal(measured.kpis.qualifiedEngagement7d, 0);
  const urgentTask = await isolatedRepo.createTodo({ title: 'Follow up on the winning post', priority: 2 });
  assert.ok((await getToday(isolatedCtx, health, now)).actions.some((a) => a.todoId === urgentTask.id));
  await isolatedRepo.updateTodo(urgentTask.id, { status: 'in_progress' });
  assert.ok((await getToday(isolatedCtx, health, now)).actions.some((a) => a.todoId === urgentTask.id), 'important work stays visible after starting it');
  await isolatedRepo.updateTodo(urgentTask.id, { status: 'done' });
  assert.ok(!(await getToday(isolatedCtx, health, now)).actions.some((a) => a.todoId === urgentTask.id), 'completed work leaves the daily actions');
});

test('metrics: only for live items, whole numbers; analytics picks them up', async () => {
  const [a] = await draftSet();
  assert.equal((await recordMetrics(ctx, a!, { reach: 10 })).ok, false, 'draft refused');
  await approve(a!);
  await items.transition(a!, { event: 'schedule', postizId: 'p2', utmUrl: 'u', scheduledAt: new Date(Date.now() - 60_000).toISOString() });
  await items.goLiveDue();
  assert.equal((await recordMetrics(ctx, a!, { reach: -1 })).ok, false);
  assert.equal((await recordMetrics(ctx, a!, {})).ok, false);
  assert.equal((await recordMetrics(ctx, a!, { reach: '1200', likes: 30, comments: 4, qualifiedEngagement: 7 })).ok, true);
  const an = await getAnalytics(ctx, 30);
  assert.equal(an.series.length, 30);
  assert.ok(an.posts.some((p) => p.id === a));
  assert.ok(an.totals.reach >= 1200);
  assert.equal(an.bestByEngagement[0]!.id, a);
  assert.equal(an.posts.find((p) => p.id === a)!.engagement, 34, 'likes + comments + shares');
  assert.equal(an.bestByUsual.length, 0, 'no "x your usual" before own results exist');
});

test('activity merges approvals and runs newest first', async () => {
  await repo.recordRun({ moduleId: 'research', status: 'ok', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 1, itemsProcessed: 0, message: 'm' });
  const feed = await repo.activity(50);
  assert.deepEqual(new Set(feed.map((f) => f.kind)), new Set(['approval', 'run']));
  assert.ok(feed.every((f, i) => i === 0 || feed[i - 1]!.at >= f.at));
});

test('client actions: logged newest first; a failed write never throws', async () => {
  const { logAction, getActions } = await import('./health-service.ts');
  await logAction(ctx, { role: 'client', method: 'LOGIN', path: '/content/login' });
  await logAction(ctx, { role: 'client', method: 'PATCH', path: '/content/api/items/x' });
  const rows = await getActions(ctx, 10);
  assert.deepEqual(rows.slice(0, 2).map((r) => r.method).sort(), ['LOGIN', 'PATCH']);
  await logAction({ db: { query: () => Promise.reject(new Error('down')) } } as unknown as ModuleContext, { role: 'client', method: 'POST', path: '/p' });
});
