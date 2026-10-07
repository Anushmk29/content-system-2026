import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../db/test-db.ts';
import type { ModuleContext } from '../modules/module.ts';
import { normalise, bareHandle, type ScrapedPost, type DecodePlatform } from '../adapters/apify.ts';
import {
  saveCompetitor, runDecode, getDecodeRun, getDecodeView, stopDecode, useDecode, stealFormat, parseBreakdowns,
} from './decode-service.ts';
import { listHooks, rewriteWithHook } from './hook-service.ts';
import { selfCompetitor, startDecode, listCompetitors } from './decode-service.ts';
import { saveBrand } from './brand-service.ts';
import { getOwnResults } from './analytics-service.ts';
import { draftTopic } from '../modules/draft-generator.module.ts';
import { createRepo } from '../db/repo.ts';

test('normalise: X and Instagram actor shapes', () => {
  const x = normalise('x', {
    url: 'https://x.com/a/status/1', text: 'Hot take\n\nMore', likeCount: 120, replyCount: 9, retweetCount: 4, quoteCount: 1,
    viewCount: 5000, createdAt: 'Wed Sep 30 10:00:00 +0000 2026', author: { userName: 'acme' },
  })!;
  assert.deepEqual([x.reactions, x.comments, x.shares, x.views, x.handle, x.postType], [120, 9, 5, 5000, 'acme', 'text']);
  assert.ok(x.postedAt?.startsWith('2026-09-30'));
  const ig = normalise('instagram', {
    url: 'https://instagram.com/p/1', caption: 'c', likesCount: 50, commentsCount: 3, type: 'Video', videoViewCount: 900,
    videoDuration: 31.4, displayUrl: 'https://cdn/x.jpg', timestamp: '2026-09-01T00:00:00.000Z', ownerUsername: 'acme',
  })!;
  assert.deepEqual([ig.postType, ig.durationS, ig.views, ig.thumb], ['video', 31, 900, 'https://cdn/x.jpg']);
  assert.equal(normalise('facebook', { text: 'no url' }), null);
  assert.equal(bareHandle('https://www.instagram.com/acme/'), 'acme');
  assert.equal(bareHandle('@acme'), 'acme');
});

test('parseBreakdowns: clamps format numbers and normalises tags', () => {
  const m = parseBreakdowns('```json\n{"posts":[{"n":1,"format":7,"hook":"Hi","beats":[{"at":"¶1","tag":"Offer shows up","text":"pitch"},{"at":"¶2","tag":"weird","text":"x"}]}]}\n```', 3);
  assert.equal(m.get(1)!.format, null, 'format 7 of 3 is out of range');
  assert.deepEqual(m.get(1)!.beats.map((b) => b.tag), ['offer', 'other']);
});

// ---- one full run on real SQL with fake Apify + LLM -------------------------
const db = await createTestDb();
let spent = 0;
let stopAfterFirstBatch = false;
const post = (url: string, reactions: number): ScrapedPost => ({
  url, platform: 'x', postType: 'text', handle: null, thumb: null, postedAt: new Date().toISOString(),
  durationS: null, reactions, comments: 1, shares: 0, views: null, caption: `post ${url}\n\nbody`,
});
const ctx = {
  db,
  adapters: {
    apify: {
      configured: true,
      async scrape(p: DecodePlatform, handle: string) {
        // acme posts big numbers, tiny posts small ones: "their usual" must be per competitor.
        const big = handle === 'acme';
        return { costUsd: 0.25, posts: [1, 2, 3, 4, 5].map((i) => post(`https://x.com/${handle}/${i}`, big ? i * 1000 : i * 10)) };
      },
    },
    claude: {
      configured: true,
      get spentUsd() { return spent; },
      async complete(prompt: string) {
        spent += 0.01;
        if (prompt.includes('PROVEN HOOK PATTERNS')) {
          hookPrompt = prompt;
          return JSON.stringify({ pillar: 'practical_ai_for_operators', funnelStage: 'awareness', claims: [],
            linkedin: { title: 'LI', hook: 'A hot take', body: 'b', cta: 'c', hookFrom: 1 } });
        }
        if (prompt.includes('Rewrite this')) return '{"hook":"New hook","body":"rewritten"}';
        if (prompt.includes('FORMATS')) return '{"formats":[{"name":"hot take","description":"a strong opinion","our_posts":0},{"name":"list","description":"n tips","our_posts":2}]}';
        if (prompt.includes('counter-angle')) return 'They skip the cost of maintenance.';
        if (prompt.includes('FORMAT TO COPY')) {
          stealPrompt = prompt;
          const piece = (t: string) => ({ title: t, hook: 'Most teams get this wrong', body: `${t} body`, cta: 'Book a call' });
          return JSON.stringify({ pillar: 'practical_ai_for_operators', funnelStage: 'awareness', linkedin: piece('LI'), x: piece('X'), claims: [] });
        }
        if (stopAfterFirstBatch) { stopAfterFirstBatch = false; await stopDecode(ctx, runId); }
        const n = (prompt.match(/^### \d+/gm) ?? []).length;
        return JSON.stringify({ posts: Array.from({ length: n }, (_, i) => ({ n: i + 1, format: 1, hook: 'Hot take', beats: [{ at: '¶1', tag: 'hook', text: 'opens' }] })) });
      },
    },
  },
  env: { allowSafeAuto: false },
  logger: { warn() {}, error() {}, info() {} },
} as unknown as ModuleContext;
let runId = '';
let stealPrompt = '';
let hookPrompt = '';

test('decode run: scrape → per-competitor median → formats → batched breakdown, stoppable and resumable', async () => {
  await saveCompetitor(ctx, { name: 'Acme', handles: { x: 'acme', linkedin: '' } });
  await saveCompetitor(ctx, { name: 'Tiny', handles: { x: '@tiny' } });
  await saveCompetitor(ctx, { name: 'Off', handles: { x: 'off' }, active: false });
  const comps = (await getDecodeView(ctx)).competitors.filter((c) => c.active);
  assert.deepEqual(comps[0]!.handles, { x: 'acme' }, 'empty handles are dropped');

  runId = (await db.query<{ id: string }>(
    `insert into content.decode_runs (competitor_ids, platforms, post_cap) values ($1, '{x}', 50) returning id`, [comps.map((c) => c.id)])).rows[0]!.id;

  stopAfterFirstBatch = true;
  await runDecode(ctx, runId);
  let r = (await getDecodeRun(ctx, runId))!;
  assert.equal(r.run.status, 'stopped');
  assert.equal(r.run.decoded, 8, 'one batch of 8 before the stop took effect');
  assert.equal(r.run.total, 10);

  await db.query(`update content.decode_runs set status = 'running' where id = $1`, [runId]);
  await runDecode(ctx, runId);
  r = (await getDecodeRun(ctx, runId))!;
  assert.equal(r.run.status, 'done');
  assert.equal(r.run.decoded, 10);
  assert.deepEqual(r.posts.map((p) => p.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(r.run.cost_apify_usd, 0.5);
  assert.ok(Math.abs(r.run.cost_ai_usd - 0.03) < 1e-9, `ai cost ${r.run.cost_ai_usd}`);
  assert.equal(r.formats.length, 2);
  assert.equal(r.formats[1]!.our_post_count, 2);

  // Each competitor's best post is 5/3 ≈ 1.67x ITS OWN median, regardless of account size.
  const best = r.posts.filter((p) => p.url.endsWith('/5'));
  assert.deepEqual(best.map((p) => p.vs_own_median), [1.67, 1.67]);
  assert.equal(r.posts[0]!.vs_own_median, 1.67, 'best performers are decoded first');
  assert.match(r.posts[0]!.posted_at!, /^\d{4}-\d{2}-\d{2}T/, 'dates reach the client as ISO strings, not Date objects');

  assert.equal((await getDecodeRun(ctx, runId, 8))!.posts.length, 2, 'poll returns only posts after the cursor');
});

test('useDecode: use + counter-angle become Ideas signals', async () => {
  const fmt = (await getDecodeRun(ctx, runId))!.formats[0]!;
  await useDecode(ctx, { formatId: fmt.id, mode: 'use' });
  await useDecode(ctx, { formatId: fmt.id, mode: 'counter' });
  const rows = (await db.query<{ raw_text: string; channel: string }>(`select raw_text, channel from content.research_inputs order by created_at`)).rows;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((s) => s.channel === 'decode'));
  assert.match(rows[0]!.raw_text, /Use the "hot take" format/);
  assert.match(rows[1]!.raw_text, /skip the cost of maintenance/);
});

test('stealFormat: copies the structure into drafts for only the chosen platforms, through QC', async () => {
  const fmt = (await getDecodeRun(ctx, runId))!.formats[0]!;
  const r = await stealFormat(ctx, { formatId: fmt.id, platforms: ['x', 'linkedin', 'tiktok'] });
  assert.deepEqual([r.items, r.toApproval, r.needProof], [2, 2, 0]);
  assert.match(stealPrompt, /Their beats, in order:\n- ¶1 hook: opens/);
  assert.match(stealPrompt, /Write the LinkedIn post \(anchor\) first, then repurpose it into the X thread\./);
  assert.doesNotMatch(stealPrompt, /"instagram":/);
  const items = (await db.query<{ platform: string; status: string; anchor: boolean }>(
    `select platform, status, anchor_id is null as anchor from content.content_items where topic_id = $1 order by created_at`, [r.topicId])).rows;
  assert.deepEqual(items, [
    { platform: 'linkedin', status: 'needs_approval', anchor: true },
    { platform: 'x', status: 'needs_approval', anchor: false },
  ]);
  await assert.rejects(stealFormat(ctx, { formatId: fmt.id, platforms: ['tiktok'] }), /at least one platform/);
  const refs = (await db.query(`select hook_ref from content.content_items where topic_id = $1 and hook_ref is not null`, [r.topicId])).rows;
  assert.equal(refs.length, 2, 'stolen posts point at the post they copied');
});

test('hook library: ranked best first, used by drafting, rewrite locked after approval', async () => {
  const hooks = await listHooks(ctx);
  assert.ok(hooks.length > 0);
  assert.ok(hooks.every((h, i) => i === 0 || hooks[i - 1]!.lift >= h.lift), 'best first');
  assert.equal(new Set(hooks.map((h) => h.url)).size, hooks.length, 'one row per post');

  const repo = createRepo(db);
  const topicId = await repo.insertTopic({ title: 'Hooks topic', source: 'decode', status: 'selected' });
  const ids = await draftTopic(ctx, (await repo.selectedTopics()).find((t) => t.id === topicId)!, { platforms: ['linkedin'] });
  assert.match(hookPrompt, /PROVEN HOOK PATTERNS[^\n]*\n\[1\] x · [\d.]+x their usual · "Hot take"/, 'no LinkedIn hooks → any platform');
  const best = (await listHooks(ctx, { days: 90, minLift: 1, limit: 1 }))[0]!;
  const ref = await db.query<{ hook_ref: string }>(`select hook_ref from content.content_items where id = $1`, [ids[0]]);
  assert.equal(ref.rows[0]!.hook_ref, best.id);

  assert.deepEqual(await rewriteWithHook(ctx, ids[0]!, hooks.at(-1)!.id), { ok: true, message: 'Rewritten with that hook' });
  const after = (await repo.getItem(ids[0]!))!;
  assert.deepEqual([after.hook, after.body, after.hook_ref], ['New hook', 'rewritten', hooks.at(-1)!.id]);
  await db.query(`update content.content_items set status = 'approved' where id = $1`, [ids[0]]);
  assert.equal((await rewriteWithHook(ctx, ids[0]!, best.id)).ok, false);
});

test('own results: hidden "You" row, own median = your usual, published posts get their numbers', async () => {
  const self0 = await selfCompetitor(ctx);
  await assert.rejects(startDecode(ctx, { self: true }), /own accounts in Brand Kit/);
  await saveBrand(ctx, { ownHandles: { x: 'me' } });
  const self = await selfCompetitor(ctx);
  assert.equal(self.id, self0.id, 'one self row, updated in place');
  assert.deepEqual(self.handles, { x: 'me' });
  assert.ok(!(await listCompetitors(ctx)).some((c) => c.id === self.id), 'not listed as a competitor');

  // Postiz gave a twitter.com URL with a query; the scrape has x.com/me/5.
  const item = (await db.query<{ id: string }>(
    `insert into content.content_items (title, pillar, funnel_stage, platform, format, status, published_url, published_at)
     values ('Mine', 'practical_ai_for_operators', 'awareness', 'x', 'thread', 'published', 'https://twitter.com/me/5/?s=20', now()) returning id`)).rows[0]!.id;
  const run = (await db.query<{ id: string }>(
    `insert into content.decode_runs (competitor_ids, platforms, post_cap) values ($1, '{x}', 50) returning id`, [[self.id]])).rows[0]!.id;
  await runDecode(ctx, run);

  assert.notEqual((await getDecodeView(ctx)).run?.id, run, 'own runs stay off the Decode page');
  const perf = await db.query(`select likes, engagement, vs_usual from content.v_content_performance where id = $1`, [item]);
  assert.deepEqual(perf.rows[0], { likes: 50, engagement: 51, vs_usual: 1.67 }, '50 likes over a 30 median');
  const own = await getOwnResults(ctx);
  assert.equal(own.ready, true);
  assert.deepEqual(own.baseline, [{ platform: 'x', median_reactions: 30, posts: 5 }]);
  assert.equal(own.lastRun?.id, run);
  assert.ok((await listHooks(ctx)).some((h) => h.self && h.source === 'You'), 'own hooks join the library');
});
