// Scripts tab (Short filming track) and Videos tab (transcript log + retry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './db/test-db.ts';
import type { ModuleContext } from './modules/module.ts';
import { listScripts, markFilmed, markUploaded, postedUrl, youtubeUrl } from './services/scripts-service.ts';
import { listVideos, transcribeVideo } from './services/videos-service.ts';

test('youtubeUrl: every link shape → youtu.be/<id>', () => {
  for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3', 'https://youtube.com/shorts/dQw4w9WgXcQ?si=x', 'https://youtu.be/dQw4w9WgXcQ']) {
    assert.equal(youtubeUrl(u), 'https://youtu.be/dQw4w9WgXcQ');
  }
  assert.equal(youtubeUrl('https://vimeo.com/123'), null);
  for (const url of ['https://evil.test/youtube.com/watch?v=dQw4w9WgXcQ', 'ftp://youtube.com/watch?v=dQw4w9WgXcQ',
    'https://notyoutube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com/watch?v=dQw4w9WgXcQextra', 'https://youtu.be/dQw4w9WgXcQ/extra']) {
    assert.equal(youtubeUrl(url), null, url);
  }
  for (const [platform, url] of [['instagram', 'https://evilinstagram.com/post'], ['linkedin', 'https://notlinkedin.com/post'],
    ['facebook', 'https://facebookXcom/post'], ['reddit', 'https://reddit.com.evil.test/post']]) {
    assert.equal(postedUrl(platform!, url), null, url);
  }
  assert.equal(postedUrl('instagram', 'https://www.instagram.com/p/abc/'), 'https://www.instagram.com/p/abc/');
});

test('scripts: review → to film → filmed → uploaded (published, with its link)', async () => {
  const db = await createTestDb();
  const ctx = { db } as unknown as ModuleContext;
  const id = (await db.query<{ id: string }>(
    `insert into content.content_items (title, pillar, funnel_stage, platform, format, status, hook, body)
     values ('Short', 'x', 'awareness', 'youtube', 'short_script', 'needs_approval', 'Stop doing X', '[ON SCREEN: 1]\nline\n---\n[ON SCREEN: 2]\nline') returning id`)).rows[0]!.id;
  const stage = async () => (await listScripts(ctx))[0]!.stage;
  assert.equal(await stage(), 'review');
  assert.equal((await markFilmed(ctx, id, true)).ok, false, 'not approved yet');
  assert.equal((await markUploaded(ctx, id, 'https://youtu.be/dQw4w9WgXcQ')).ok, false);
  await db.query(`update content.content_items set status = 'approved' where id = $1`, [id]);
  assert.equal(await stage(), 'to_film');
  assert.equal((await markFilmed(ctx, id, true)).ok, true);
  assert.equal(await stage(), 'filmed');
  assert.equal((await markUploaded(ctx, id, 'not a link')).ok, false);
  assert.equal((await markUploaded(ctx, id, 'https://youtube.com/shorts/dQw4w9WgXcQ')).ok, true);
  const r = (await listScripts(ctx))[0]!;
  assert.deepEqual([r.stage, r.status, r.published_url], ['uploaded', 'published', 'https://youtu.be/dQw4w9WgXcQ']);
  assert.ok(r.published_at);
});

test('videos: log shows transcribed / failed / not yet; retry fixes a failure', async () => {
  const db = await createTestDb();
  let fail = true;
  const ctx = { db, adapters: { transcriber: { configured: true, cap: 5,
    async healthCheck() { return { state: 'ok' }; },
    async transcribe() { if (fail) throw new Error('Command failed\nERROR: [youtube] private video'); return { text: 'hello there', segments: [], lang: 'en', durationS: 30 }; } } } } as unknown as ModuleContext;
  const run = (await db.query<{ id: string }>(`insert into content.decode_runs (platforms) values ('{youtube}') returning id`)).rows[0]!.id;
  const ids: string[] = [];
  for (const u of ['https://youtu.be/aaaaaaaaaaa', 'https://youtu.be/bbbbbbbbbbb']) {
    ids.push((await db.query<{ id: string }>(`insert into content.decoded_posts (run_id, platform, post_type, url) values ($1, 'youtube', 'video', $2) returning id`, [run, u])).rows[0]!.id);
  }
  await db.query(`insert into content.decoded_posts (run_id, platform, post_type, url) values ($1, 'x', 'text', 'https://x.com/a/1')`, [run]);
  assert.equal((await listVideos(ctx)).length, 2, 'text posts are not videos');
  const r1 = await transcribeVideo(ctx, ids[0]!);
  assert.equal(r1.ok, false);
  assert.match(r1.message, /ERROR: \[youtube\] private video/, 'the error line, not the generic first line');
  const states = async () => Object.fromEntries((await listVideos(ctx)).map((v) => [v.url.slice(-1), v.state]));
  assert.deepEqual(await states(), { a: 'failed', b: 'not_yet' });
  fail = false;
  assert.equal((await transcribeVideo(ctx, ids[0]!)).ok, true);
  const v = (await listVideos(ctx)).find((x) => x.url.endsWith('a'))!;
  assert.deepEqual([v.state, v.transcript, v.error], ['done', 'hello there', null]);
});
