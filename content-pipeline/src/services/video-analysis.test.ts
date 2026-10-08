import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../db/test-db.ts';
import type { ModuleContext } from '../modules/module.ts';
import type { JevAnswer } from '../adapters/jev.ts';
import { analyzeVideo, analyzeRunVideos, parseVideoAnalysis, useVideoIdea } from './video-analysis-service.ts';

const db = await createTestDb();
const IDEA = (t: string) => ({ title: t, hook: `${t} hook`, beats: ['problem', 'fix'], cta: 'Comment FIX', platforms: ['instagram_reel'], why: 'same contrarian hook' });
const REPLY = JSON.stringify({
  whyItWorked: 'It names a costly mistake in the first second, then pays it off with one fix.',
  hook: { text: 'You are losing money on this', type: 'contradiction', why: 'a cost the viewer feels' },
  structure: [{ beat: 'the mistake', purpose: 'tension' }, { beat: 'the fix', purpose: 'payoff' }],
  cta: { text: 'Comment FIX', type: 'comment' }, retention: ['open loop'], verdict: 'use', verdictWhy: 'our audience has this problem',
  adapt: ['the cost-first hook'], avoid: ['their income screenshot'], ideas: [IDEA('One'), IDEA('Two')],
});

function ctxWith(jev: Record<string, JevAnswer> | null, reply = REPLY) {
  const prompts: string[] = [];
  const ctx = {
    db, env: {}, logger: { warn() {}, info() {} },
    adapters: {
      claude: { configured: true, model: 'llm-test', complete: async (p: string) => { prompts.push(p); return reply; } },
      jev: { configured: jev !== null, decide: async () => ({ model: 'jev-test', answers: jev }) },
    },
  } as unknown as ModuleContext;
  return { ctx, prompts };
}

async function video(url: string, transcript = 'You are losing money on this. Here is the fix.'): Promise<{ id: string; run: string }> {
  const run = (await db.query<{ id: string }>(`insert into content.decode_runs default values returning id`)).rows[0]!.id;
  const id = (await db.query<{ id: string }>(
    `insert into content.decoded_posts (run_id, platform, post_type, url, reactions, caption, vs_own_median)
     values ($1, 'instagram', 'video', $2, 900, 'caption', 6) returning id`, [run, url])).rows[0]!.id;
  if (transcript) await db.query(`insert into content.transcripts (norm_url, text) values (content.norm_url($1), $2)`, [url, transcript]);
  return { id, run };
}

test('parseVideoAnalysis: needs a reason and two ideas; cleans the rest', () => {
  const a = parseVideoAnalysis(REPLY);
  assert.equal(a.ideas.length, 2);
  assert.equal(a.hook.type, 'contradiction');
  assert.throws(() => parseVideoAnalysis(JSON.stringify({ whyItWorked: 'x', ideas: [IDEA('only one')] })), /incomplete/);
});

test('analyse: reads the transcript, Jev overrules the verdict when clear, cached; ideas become signals', async () => {
  const v = await video('https://www.instagram.com/reel/AAA/');
  const yes = (p: number): JevAnswer => ({ type: 'noul', noul: p });
  const { ctx, prompts } = ctxWith({ fits_brand: yes(0.1), adaptable: yes(0.9), risky: yes(0.2) });
  const r = await analyzeVideo(ctx, v.id);
  assert.ok(r.ok, r.message);
  assert.equal(r.analysis!.verdict, 'skip', 'Jev says the audience would not care');
  assert.match(prompts[0]!, /TRANSCRIPT:\nYou are losing money on this/);
  assert.match(prompts[0]!, /exactly TWO ideas/);
  assert.equal((await analyzeVideo(ctx, v.id)).message, 'Already analysed');
  assert.equal(prompts.length, 1);

  assert.equal((await useVideoIdea(ctx, v.id, 1)).ok, true);
  const sig = (await db.query<{ raw_text: string; channel: string }>(`select raw_text, channel from content.research_inputs order by created_at desc limit 1`)).rows[0]!;
  assert.match(sig.raw_text, /^\[Video idea\] Two\. Hook: "Two hook"\. Beats: problem → fix\. CTA: Comment FIX\./);
  assert.equal(sig.channel, 'decode');
  assert.equal((await useVideoIdea(ctx, v.id, 5)).ok, false);
});

test('analyse: no transcript → asks to transcribe; a run analyses its best untouched videos', async () => {
  const bare = await video('https://www.instagram.com/reel/BBB/', '');
  assert.match((await analyzeVideo(ctxWith(null).ctx, bare.id)).message, /Transcribe it first/);
  const v = await video('https://www.instagram.com/reel/CCC/');
  assert.equal(await analyzeRunVideos(ctxWith(null).ctx, v.run), 1);
  assert.equal(await analyzeRunVideos(ctxWith(null).ctx, v.run), 0, 'already analysed');
});
