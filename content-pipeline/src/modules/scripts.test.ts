import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../db/test-db.ts';
import { createRepo } from '../db/repo.ts';
import type { ModuleContext } from './module.ts';
import { draftTopic, scriptsFor } from './draft-generator.module.ts';
import { listScripts, markFilmed, markUploaded, postedUrl } from '../services/scripts-service.ts';
import { createContentItems } from '../db/content-items.ts';

const db = await createTestDb();
const prompts: string[] = [];
const ctx = {
  db, env: {}, logger: { warn() {}, info() {} },
  adapters: {
    claude: {
      configured: true, model: 'llm-test',
      async complete(p: string) {
        prompts.push(p);
        if (p.includes('Find 5 angles')) return '{"angles":[{"belief":"Reels need a studio","truth":"A phone and one idea is enough","strength":8}]}';
        if (p.includes('video script for each target')) {
          return JSON.stringify({
            instagram_reel: { title: 'Reel', hook: 'Stop filming like this', body: '[ON SCREEN: one idea]\nSay one thing.\n---\n[ON SCREEN: phone]\nUse your phone.', cta: 'Save this' },
            facebook_reel: { title: 'FB', hook: 'Last week a café owner asked me…', body: '[ON SCREEN: the question]\nShe asked…', cta: 'What would you do?' },
            claims: ['3x more views'],
          });
        }
        return JSON.stringify({ pillar: 'practical_ai_for_operators', funnelStage: 'awareness', claims: [],
          linkedin: { title: 'LI', hook: 'h', body: 'The written post.', cta: 'c' }, reddit: { title: 'R', hook: 'h', body: 'Value. TL;DR: x', cta: 'Thoughts?' } });
      },
    },
    jev: { configured: false, mode: 'off' },
  },
} as unknown as ModuleContext;

test('scripts: ticked targets become their own filming cards, in the voice, on the same angle; claims are gated', async () => {
  const topic = (await db.query<{ id: string }>(`insert into content.topics (title, status, platforms) values ('Filming on a phone', 'selected', '["linkedin","reddit","instagram_reel","facebook_reel"]') returning id`)).rows[0]!.id;
  const t = (await createRepo(db).selectedTopics()).find((x) => x.id === topic)!;
  assert.deepEqual(scriptsFor(t), ['instagram_reel', 'facebook_reel']);
  const ids = await draftTopic(ctx, t, { platforms: ['linkedin', 'reddit'], scripts: scriptsFor(t) });
  assert.equal(ids.length, 4);
  const sp = prompts.find((p) => p.includes('video script for each target'))!;
  assert.match(sp, /OUR TRUTH: A phone and one idea is enough/);
  assert.match(sp, /THE WRITTEN POST ON THIS TOPIC[\s\S]*The written post\./);
  const rows = (await db.query<{ platform: string; format: string; risk_level: string }>(
    `select platform::text, format::text, risk_level::text from content.content_items where topic_id = $1 order by created_at, platform`, [topic])).rows;
  assert.deepEqual(rows.map((r) => `${r.platform}/${r.format}`).sort(),
    ['facebook/reel_script', 'instagram/reel_script', 'linkedin/founder_post', 'reddit/reddit_answer']);
  assert.ok(rows.every((r) => r.risk_level === 'high'), 'a script claim makes the set high risk');
  const unproven = await db.query(`select 1 from content.claims where content_item_id = any($1::uuid[]) and claim_text = '3x more views'`, [ids]);
  assert.equal(unproven.rowCount, 4);
});

test('scripts desk: reels + reddit listed; reddit skips filming; links must be the right platform', async () => {
  const listed = await listScripts(ctx);
  assert.deepEqual(listed.map((r) => r.platform).sort(), ['facebook', 'instagram', 'reddit']);
  const items = createContentItems(db);
  const reel = listed.find((r) => r.platform === 'instagram')!;
  const reddit = listed.find((r) => r.platform === 'reddit')!;
  for (const r of [reel, reddit]) { await items.transition(r.id, { event: 'submit', lane: 'review' }); await items.transition(r.id, { event: 'approve' }); }
  assert.equal((await markFilmed(ctx, reddit.id, true)).ok, false);
  assert.equal((await markFilmed(ctx, reel.id, true)).ok, true);
  assert.equal((await markUploaded(ctx, reddit.id, 'https://www.instagram.com/p/abc/')).ok, false);
  assert.equal((await markUploaded(ctx, reddit.id, 'https://www.reddit.com/r/cafe/comments/abc/x/')).ok, true);
  assert.equal(postedUrl('instagram', 'http://instagram.com/reel/x'), null);   // https only
  assert.equal(postedUrl('linkedin', 'https://www.linkedin.com/posts/x'), 'https://www.linkedin.com/posts/x');
  assert.equal(postedUrl('youtube', 'https://youtube.com/shorts/dQw4w9WgXcQ'), 'https://youtu.be/dQw4w9WgXcQ');
});
