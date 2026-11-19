// Phases 1-6 of docs/plans/COST-VIDEO-ROADMAP.md: the pure pieces, plus the learning loop on real SQL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { huntScores, jevFit, type HuntInput } from './services/hunt-score.ts';
import { isoSeconds, channelQuery, toPost } from './adapters/youtube.ts';
import { parseBreakdowns, parseFormats } from './services/decode-service.ts';
import { parseAngles, chosenAngle, draftPieces } from './modules/draft-generator.module.ts';
import type { TopicRow } from './db/repo.ts';
import { scoreHookOptions, provenHooks } from './services/hook-service.ts';
import { parseDraftResponse } from './modules/draft-parse.ts';
import { createTestDb } from './db/test-db.ts';
import type { ModuleContext } from './modules/module.ts';

const post = (id: string, o: Partial<HuntInput> = {}): HuntInput => ({
  id, platform: 'x', views: 10_000, reactions: 300, comments: 50, shares: 20, breakout: 2, postedAt: null, jev: null, ...o,
});

test('hunt score: hand-checked demand, fit, paid', () => {
  const now = new Date('2026-10-07T00:00:00Z');
  const s = huntScores([
    post('a', { breakout: 8, views: 20_000 }),                       // top breakout, top reach, ER 1.85%
    post('b', { breakout: 1 }),                                       // ER 3.7%: best ER
    post('c', { breakout: 4, reactions: 5, comments: 0, shares: 0 }), // ER 0.05% → paid
  ], now);
  // a: 0.5·1 + 0.25·(ER pct: 1 of 2 below → 0.5) + 0.25·(reach pct 1) = 0.875
  assert.equal(s[0]!.demand, 0.875);
  assert.equal(s[0]!.hunt, 87.5, 'no Jev: hunt = 100·demand');
  assert.deepEqual(s.map((x) => x.paid), [false, false, true]);
  // fit: icp 3/3·0.4 + proof 0·0.2 + replicable 1·0.25 + fresh(posted now)·0.15 = 0.8, × (1 − 0.5 off-niche) = 0.4
  const fit = jevFit({
    icp_fit: { type: 'score', score: 3 }, proof: { type: 'score', score: 0 }, replicable: { type: 'noul', noul: 1 },
    lane: { type: 'choice', choice: 'x', probabilities: { off_niche: 0.5 } },
  }, now.toISOString(), now);
  assert.equal(Math.round(fit * 1000) / 1000, 0.4);
  const judged = huntScores([post('d', { breakout: 8, jev: { sponsored: { type: 'noul', noul: 0.9 } } })], now)[0]!;
  assert.equal(judged.paid, true, 'Jev sponsored ≥ 0.8 → paid');
});

test('youtube: durations, handles, video → post', () => {
  assert.equal(isoSeconds('PT1M30S'), 90);
  assert.equal(isoSeconds('PT2H'), 7200);
  assert.equal(isoSeconds('P0D'), 0);
  assert.equal(channelQuery('https://www.youtube.com/@acme/'), 'forHandle=%40acme');
  assert.equal(channelQuery('acme'), 'forHandle=%40acme');
  assert.equal(channelQuery('UC1234567890123456789012'), 'id=UC1234567890123456789012');
  const p = toPost({ id: 'abc', snippet: { title: 'T', description: 'D', publishedAt: '2026-10-01T00:00:00Z', channelTitle: 'Acme' },
    statistics: { viewCount: '1000', likeCount: '50', commentCount: '5' }, contentDetails: { duration: 'PT45S' } });
  assert.deepEqual([p.url, p.platform, p.postType, p.views, p.reactions, p.durationS, p.caption],
    ['https://youtu.be/abc', 'youtube', 'video', 1000, 50, 45, 'T\n\nD']);
});

test('skeletons: formats carry templates, posts carry technique / value / cta', () => {
  const f = parseFormats('{"formats":[{"name":"Tool List","description":"d","our_posts":1,"hook_template":"I tested [n] tools","value_template":"[n] numbered tools","cta_template":""}]}');
  assert.deepEqual([f[0]!.name, f[0]!.hookTemplate, f[0]!.valueTemplate, f[0]!.ctaTemplate], ['tool list', 'I tested [n] tools', '[n] numbered tools', null]);
  const b = parseBreakdowns('{"posts":[{"n":1,"format":1,"hook":"h","hook_technique":"how_to","value_structure":"steps","cta_type":"pitch","beats":[]}]}', 1).get(1)!;
  assert.deepEqual([b.hookTechnique, b.valueStructure, b.ctaType], ['how_to', 'steps', null], 'unknown cta type is dropped');
});

test('angles: parsed, clamped, strongest chosen unless picked', () => {
  const a = parseAngles('{"angles":[{"belief":"AI needs a team","truth":"one founder can ship it","strength":7,"proof_method":"our build log"},{"belief":"b","truth":"t","strength":42},{"truth":"no belief"}]}');
  assert.equal(a.length, 2);
  assert.equal(a[1]!.strength, 10);
  assert.equal(chosenAngle(a, null)!.belief, 'b');
  assert.equal(chosenAngle(a, 0)!.belief, 'AI needs a team');
});

test('drafts record their hook pattern; youtube short scripts parse', () => {
  const piece = { title: 'T', hook: 'H', body: 'B', cta: 'C' };
  const set = parseDraftResponse(JSON.stringify({ pillar: 'practical_ai_for_operators', funnelStage: 'awareness', claims: [],
    linkedin: { ...piece, hookPattern: 'contradiction' }, youtube: { ...piece, hookPattern: 'nonsense' } }), ['linkedin', 'youtube']);
  assert.equal(set.linkedin!.hookPattern, 'contradiction');
  assert.equal(set.youtube!.hookPattern, undefined);
});

test('drafts open with the best-scored hook option', () => {
  const opts = [
    { hook: 'Weak', pattern: 'question', contrast: 3, pattern_strength: 3, platform_fit: 3 },
    { hook: 'Strong', pattern: 'contradiction', contrast: 9, pattern_strength: 8, platform_fit: 8 },
  ];
  const set = parseDraftResponse(JSON.stringify({ pillar: 'practical_ai_for_operators', funnelStage: 'awareness', claims: [],
    linkedin: { title: 'T', hook: 'Weak', body: 'B', cta: 'C', hookOptions: opts } }), ['linkedin']);
  const topic = { id: 't', title: 'T', customer_language: null, source_detail: null } as unknown as TopicRow;
  const [item] = draftPieces(topic, set, ['linkedin'], []);
  assert.equal(item!.hook, 'Strong');
  assert.equal(item!.hookPattern, 'contradiction');
});

test('hook options: composite score + learned weight decides the order', () => {
  const opts = scoreHookOptions([
    { hook: 'A', pattern: 'question', contrast: 9, pattern_strength: 9, platform_fit: 9 },   // 9.0 − 3 = 6.0
    { hook: 'B', pattern: 'story', contrast: 6, pattern_strength: 6, platform_fit: 6 },      // 6.0 + 2 = 8.0
    { hook: '', pattern: 'story' },
  ], new Map([['question', -0.3], ['story', 0.2]]));
  assert.deepEqual(opts.map((o) => [o.hook, o.score]), [['B', 8], ['A', 6]]);
});

test('learning loop: our own results reorder the proven hooks', async () => {
  const db = await createTestDb();
  const ctx = { db, logger: { warn() {} } } as unknown as ModuleContext;
  // A competitor run with two hooks: a question (2x their usual) and a story (1.5x).
  const run = (await db.query<{ id: string }>(`insert into content.decode_runs (platforms, status) values ('{linkedin}', 'done') returning id`)).rows[0]!.id;
  for (const [url, hook, type, lift] of [['u1', 'Q?', 'question', 2], ['u2', 'Once…', 'story', 1.5]] as const) {
    await db.query(`insert into content.decoded_posts (run_id, platform, url, hook, hook_type, vs_own_median, posted_at) values ($1, 'linkedin', $2, $3, $4, $5, now())`,
      [run, url, hook, type, lift]);
  }
  assert.equal((await provenHooks(ctx, ['linkedin']))!.text.split('\n')[0]!.includes('"Q?"'), true, 'no results yet: lift order');
  // Our own baseline (median 100 likes) and 6 published story posts at 4x it.
  const self = (await db.query<{ id: string }>(`insert into content.competitors (name, is_self) values ('You', true) returning id`)).rows[0]!.id;
  const own = (await db.query<{ id: string }>(`insert into content.decode_runs (platforms, status, competitor_ids, total) values ('{linkedin}', 'done', $1, 1) returning id`, [[self]])).rows[0]!.id;
  await db.query(`insert into content.decoded_posts (run_id, competitor_id, platform, url, reactions) values ($1, $2, 'linkedin', 'own', 100)`, [own, self]);
  for (let i = 0; i < 6; i++) {
    const item = (await db.query<{ id: string }>(
      `insert into content.content_items (title, pillar, funnel_stage, platform, format, status, published_at, hook_pattern) values ('p', 'x', 'awareness', 'linkedin', 'founder_post', 'published', now(), 'story') returning id`)).rows[0]!.id;
    await db.query(`insert into content.metrics (content_item_id, likes) values ($1, 400)`, [item]);
  }
  const w = (await db.query<{ pattern: string; posts: number; weight: number }>(`select * from content.v_hook_pattern_weights`)).rows;
  assert.equal(w[0]!.pattern, 'story');
  assert.equal(Math.round(w[0]!.weight * 1000) / 1000, Math.round((Math.log(4) * 6 / 11) * 1000) / 1000, 'ln(4) shrunk by 6/(6+5)');
  assert.ok((await provenHooks(ctx, ['linkedin']))!.text.split('\n')[0]!.includes('"Once…"'), 'story now ranks first: 1.5 × (1 + 0.76) > 2');
});

test('decode run on YouTube: transcribe → Jev judge → hunt score → skeleton breakdown', async () => {
  const { runDecode, saveCompetitor, getDecodeRun } = await import('./services/decode-service.ts');
  const db = await createTestDb();
  const vid = (n: number, likes: number) => toPost({ id: `v${n}`, snippet: { title: `Video ${n}`, publishedAt: new Date().toISOString(), channelTitle: 'Acme' },
    statistics: { viewCount: String(likes * 20), likeCount: String(likes), commentCount: '3' }, contentDetails: { duration: 'PT40S' } });
  let transcribed = 0;
  const ctx = {
    db, env: {}, logger: { warn() {}, error() {}, info() {} },
    adapters: {
      apify: { configured: false },
      youtube: { configured: true, async scrape() { return { costUsd: 0, posts: [vid(1, 500), vid(2, 50), vid(3, 5)] }; } },
      transcriber: { configured: true, cap: 2, async healthCheck() { return { state: 'ok' }; }, async transcribe(url: string) { transcribed++; return { text: `spoken words of ${url}`, segments: [], lang: 'en', durationS: 40 }; } },
      jev: {
        configured: true, mode: 'shadow', model: 'typesafe/jev-1.13', minConfidence: 0.8, spentUsd: 0.0003,
        async decide(state: string) {
          return { model: 'typesafe/jev-1.13', answers: {
            lane: { type: 'choice', choice: 'adjacent', confidence: 0.9 }, icp_fit: { type: 'score', score: 2, confidence: 0.85 }, hook_type: { type: 'choice', choice: 'how_to', confidence: 0.9 },
            proof: { type: 'score', score: 1, confidence: 0.9 }, replicable: { type: 'noul', noul: 0.9 }, news_pegged: { type: 'noul', noul: 0.1 },
            sponsored: { type: 'noul', noul: state.includes('Video 3') ? 0.95 : 0.05 },
          } };
        },
      },
      claude: {
        configured: true, spentUsd: 0,
        async complete(prompt: string) {
          if (prompt.includes('FORMATS')) return '{"formats":[{"name":"tutorial","description":"d","our_posts":0,"hook_template":"How I [x]","value_template":"[3 steps]","cta_template":"Follow for [y]"}]}';
          const n = (prompt.match(/^### \d+/gm) ?? []).length;
          return JSON.stringify({ posts: Array.from({ length: n }, (_, i) => ({ n: i + 1, format: 1, hook: 'h', hook_technique: 'story', value_structure: 'steps', cta_type: 'follow', beats: [] })) });
        },
      },
    },
  } as unknown as ModuleContext;
  const c = await saveCompetitor(ctx, { name: 'Acme', handles: { youtube: '@acme' } });
  const runId = (await db.query<{ id: string }>(
    `insert into content.decode_runs (competitor_ids, platforms, post_cap) values ($1, '{youtube}', 10) returning id`, [[c.id]])).rows[0]!.id;
  await runDecode(ctx, runId);
  const r = (await getDecodeRun(ctx, runId))!;
  assert.equal(r.run.status, 'done', r.run.message ?? '');
  assert.equal(transcribed, 2, 'cap = 2 best videos');
  assert.equal(r.posts.filter((p) => p.text_source === 'transcript').length, 2);
  assert.ok(r.posts.every((p) => p.hunt_score != null && p.lane === 'adjacent'));
  assert.equal(r.posts.find((p) => p.url.endsWith('v3'))!.paid, true, 'Jev sponsored → paid');
  assert.equal(r.posts[0]!.hook_type, 'how_to', 'Jev hook type wins over the LLM');
  assert.equal(r.posts[0]!.value_structure, 'steps');
  assert.equal(r.formats[0]!.hook_template, 'How I [x]');
  assert.ok(r.run.jev_health != null && r.run.jev_health > 0.5);
  assert.equal((await db.query(`select 1 from content.decisions where task = 'competitor_post'`)).rowCount, 3);
  assert.equal((await db.query(`select 1 from content.transcripts`)).rowCount, 2);
});
