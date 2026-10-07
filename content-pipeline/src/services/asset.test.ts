import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createTestDb } from '../db/test-db.ts';
import type { ModuleContext } from '../modules/module.ts';
import { publisherModule } from '../modules/publisher.module.ts';
import { settingsFor } from '../adapters/postiz.ts';
import { createStyle } from './style-service.ts';
import { creativeText, saveItemCreative, uploadItemAssets, removeItemAssets, listItemAssets, getItemAsset } from './asset-service.ts';

test('creativeText: carousel bodies become slides, X threads and plain posts use the hook', () => {
  const base = { title: 'Title', hook: 'The hook' };
  assert.equal(creativeText({ ...base, platform: 'linkedin', body: 'A\n---\nB' }), 'A\n---\nB');
  assert.equal(creativeText({ ...base, platform: 'linkedin', body: 'One long post' }), 'The hook');
  assert.equal(creativeText({ ...base, platform: 'x', body: 'tweet 1\n---\ntweet 2' }), 'The hook');
  assert.equal(creativeText({ ...base, platform: 'instagram', body: 'Only slide' }), 'Only slide');
  assert.equal(creativeText({ title: 'Title', hook: null, platform: 'facebook', body: null }), 'Title');
});

test('LinkedIn: several images go out as one swipeable document', () => {
  assert.deepEqual(settingsFor('linkedin', { images: 3, title: 'Cash flow' }), { __type: 'linkedin', post_as_images_carousel: true, carousel_name: 'Cash flow' });
  assert.deepEqual(settingsFor('linkedin-page', { images: 1 }), { __type: 'linkedin-page' });
});

test('a creative saved on a post is stored, served, locked on approval, and published on every platform', async () => {
  const db = await createTestDb();
  const sent: Array<{ platform: string; media?: Array<{ mime: string; name: string }>; title?: string }> = [];
  const ctx = {
    db, logger: { warn() {}, info() {} },
    env: { defaultUtmCampaign: 'test', postHourUtc: 4 },
    adapters: {
      claude: {
        spentUsd: 0,
        async complete() { return '{"style_prompt":"Navy poster with a coral circle top right, bold sans headline","palette":["#14183a"],"text_zones":[{"role":"headline","x":0.08,"y":0.2,"w":0.6,"h":0.1}]}'; },
        async generateImage() { return sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#14183a' } }).png().toBuffer(); },
      },
      postiz: { configured: true, async schedule(i: (typeof sent)[number]) { sent.push(i); return { postizId: `p${sent.length}` }; } },
    },
  } as unknown as ModuleContext;
  const upload = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#14183a' } }).png().toBuffer();
  const style = await createStyle(ctx, { name: 's', image: upload });

  const item = async (platform: string, body: string) => (await db.query<{ id: string }>(
    `insert into content.content_items (title, pillar, funnel_stage, platform, format, hook, body, status)
     values ('Cash flow', 'tips', 'education', $1, 'founder_post', 'Where cash goes', $2, 'draft') returning id`, [platform, body])).rows[0]!.id;
  const li = await item('linkedin', 'Slide one\n---\nSlide two\n---\nSlide three');
  const fb = await item('facebook', 'A plain post');

  const r = await saveItemCreative(ctx, li, { styleId: style.id });
  assert.equal(r.images.length, 3);
  const listed = await listItemAssets(ctx, li);
  assert.deepEqual(listed.map((a) => [a.idx, a.mime, a.source]), [[0, 'image/png', 'generated'], [1, 'image/png', 'generated'], [2, 'image/png', 'generated']]);
  assert.equal((await db.query<{ asset_url: string }>(`select asset_url from content.content_items where id = $1`, [li])).rows[0]!.asset_url, `/content/api/items/${li}/asset`);
  assert.deepEqual(await sharp((await getItemAsset(ctx, li, 0))!.bytes).metadata().then((m) => [m.width, m.height]), [1080, 1350]);

  // Regenerating replaces, never appends.
  await saveItemCreative(ctx, li, { styleId: style.id });
  assert.equal((await listItemAssets(ctx, li)).length, 3);

  // Own media: a WebP becomes PNG; a video can't be mixed with images.
  const webp = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } }).webp().toBuffer();
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(16)]);
  assert.deepEqual(await uploadItemAssets(ctx, fb, [webp]), { count: 1 });
  assert.equal((await listItemAssets(ctx, fb))[0]!.mime, 'image/png');
  await assert.rejects(uploadItemAssets(ctx, fb, [mp4, webp]), /one video on its own/);
  await uploadItemAssets(ctx, fb, [mp4]);
  assert.equal((await listItemAssets(ctx, fb))[0]!.mime, 'video/mp4');

  // Approved → the creative is locked with the copy, and the publisher sends it.
  await db.query(`update content.content_items set status = 'approved' where id in ($1, $2)`, [li, fb]);
  await assert.rejects(removeItemAssets(ctx, li), /locked/);
  const res = await publisherModule.run(ctx);
  assert.equal(res.itemsProcessed, 2, res.message);
  const byPlat = Object.fromEntries(sent.map((s) => [s.platform, s]));
  assert.deepEqual(byPlat.linkedin!.media!.map((m) => m.mime), ['image/png', 'image/png', 'image/png']);
  assert.equal(byPlat.linkedin!.title, 'Cash flow');
  assert.deepEqual(byPlat.facebook!.media!.map((m) => [m.mime, m.name.endsWith('.mp4')]), [['video/mp4', true]]);
});
