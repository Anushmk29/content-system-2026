import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createTestDb } from '../db/test-db.ts';
import type { ModuleContext } from '../modules/module.ts';
import { renderTemplate, splitItems, parseTemplateReply } from '../template.ts';
import { toSlides } from '../creative.ts';
import { createStyle, listStyles, generateCreative, previewStyle, remakeTemplate } from './style-service.ts';

// Offline: Google Fonts unreachable → the renderer falls back to a system font.
globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;

const px = async (png: Buffer, x: number, y: number) => [...await sharp(png).extract({ left: x, top: y, width: 1, height: 1 }).removeAlpha().raw().toBuffer()];

// Navy frame; a red pill that only exists with a label; headline accent in yellow; one white row per item.
const HTML = (w = 1080, h = 1350, bg = '#102030') => `<div style="display:flex;flex-direction:column;position:relative;width:${w}px;height:${h}px;background:${bg};padding:80px">
  <div data-if="label" style="display:flex;position:absolute;top:40px;left:40px;width:200px;height:60px;background:#ff0000"><div style="font-size:20px;color:#fff">{{label}}</div></div>
  <div style="font-size:90px;font-weight:800;color:#ffffff;margin-top:120px">{{headline}}</div>
  <div style="display:flex;flex-direction:column;margin-top:40px">
    <div data-each="items" style="display:flex;height:80px;margin-bottom:20px;background:#ffffff;padding:10px"><div style="font-size:30px;color:#102030">{{item}}</div></div>
  </div>
  <div style="position:absolute;bottom:40px;right:40px;font-size:24px;color:#fff">{{page}} / {{total}}</div>
</div>`;
const T = { html: HTML(), w: 1080, h: 1350, fonts: ['Outfit'], accent: '#ffcc00', sample: { headline: 'Seven words in the example headline here', items: ['An item of twenty chars'] } };

test('renderTemplate: data-if drops empty wrappers, data-each repeats, *accent* words coloured', async () => {
  const withLabel = await renderTemplate(T, { headline: 'Know your *floor*', label: 'PRICING', items: ['One', 'Two', 'Three'], page: 2, total: 4 });
  assert.deepEqual((await sharp(withLabel).metadata()).width, 1080);
  assert.deepEqual(await px(withLabel, 230, 90), [255, 0, 0], 'label pill drawn');
  const none = await renderTemplate(T, { headline: 'Know your floor' });
  assert.deepEqual(await px(none, 230, 90), [0x10, 0x20, 0x30], 'no label → the pill is gone, not an empty red box');
  // Items: rows of white at y ≈ 80 + 120 + headline + 40 … count the white rows down the left edge.
  const rows = async (png: Buffer) => {
    const { data, info } = await sharp(png).extract({ left: 990, top: 0, width: 1, height: 1350 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let n = 0, inRow = false;
    for (let y = 0; y < info.height; y++) { const white = data[y * 3]! > 240 && data[y * 3 + 2]! > 240; if (white && !inRow) n++; inRow = white; }
    return n;
  };
  assert.equal(await rows(withLabel), 3, 'one row per item');
  assert.equal(await rows(none), 0, 'no items → no rows');
  const { data } = await sharp(withLabel).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let yellow = 0;
  for (let i = 0; i < data.length; i += 3) if (data[i]! > 230 && data[i + 1]! > 180 && data[i + 1]! < 230 && data[i + 2]! < 60) yellow++;
  assert.ok(yellow > 200, 'the *floor* accent is drawn in the accent colour');
});

test('renderTemplate: long text shrinks and is flagged only when far too long', async () => {
  const notes: string[] = [];
  await renderTemplate(T, { headline: 'A headline a bit longer than the example one was' }, notes);
  assert.deepEqual(notes, []);
  await renderTemplate(T, { headline: 'word '.repeat(80) }, notes);
  assert.match(notes[0]!, /headline is much longer/);
});

test('splitItems, toSlides tags, parseTemplateReply', () => {
  assert.deepEqual(splitItems('Intro line\n- one\n• two\n3. three'), { body: 'Intro line', items: ['one', 'two', 'three'] });
  const [s] = toSlides('Kicker test\n\nBody\n\nkicker: Wanting it all is fine\nlabel: THE FIX', 'Go');
  assert.deepEqual([s!.headline, s!.body, s!.kicker, s!.label], ['Kicker test', 'Body', 'Wanting it all is fine', 'THE FIX']);
  const t = parseTemplateReply('Here you go\n{"fonts":["Outfit","bad;font"],"accent":"#8C7335","background":"none","sample":{"headline":"Hi *there*","items":["a",""]}}\n```html\n<div>{{headline}}</div>\n```', 1080, 1350);
  assert.deepEqual([t.fonts, t.accent, t.background, t.sample], [['Outfit'], '#8C7335', 'none', { headline: 'Hi *there*', items: ['a'] }]);
  assert.equal(parseTemplateReply('{}\n```html\n<img src="{{bg}}"/>\n```', 10, 10).background, 'image', '{{bg}} means it needs a picture');
  assert.throws(() => parseTemplateReply('{"fonts":[]}', 10, 10), /no html/);
});

test('template styles: built + checked on save, previewed, $0 at its shape, adapted once for a new shape, remade from a note', async () => {
  const prompts: string[] = [];
  let images = 0, spent = 0;
  const reply = (html: string) => `{"fonts":["Outfit"],"accent":"#ffcc00","background":"none","sample":{"headline":"Seven words in the example headline here","items":["An item"]}}\n\`\`\`html\n${html}\n\`\`\``;
  const ctx = {
    db: await createTestDb(), logger: { warn() {} },
    adapters: { claude: {
      get spentUsd() { return spent; },
      async complete(p: string) {
        prompts.push(p); spent += 0.05;
        if (p.startsWith('You are an art director')) return '{"style_prompt":"Navy editorial card, white heavy sans headline, white list rows","palette":["#102030"],"text_zones":[]}';
        if (p.includes('Rebuild this social-media design')) return reply(HTML(1080, 1350, '#000000')); // first try: wrong colour
        if (p.includes('Re-compose the same template for a 1600×900')) return reply(HTML(1600, 900));
        if (p.includes('The user looked at the template')) return reply(HTML(1080, 1350, '#004400'));
        return reply(HTML()); // the comparison round fixes the colour
      },
      async generateImage() { images++; throw new Error('no picture should be needed'); },
    } },
  } as unknown as ModuleContext;
  const upload = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#102030' } }).png().toBuffer();
  const row = await createStyle(ctx, { name: 'Navy list', image: upload });
  assert.equal(prompts.length, 3, 'analysis + template + one comparison round');
  assert.match(prompts[2]!, /Image 2 is our layout template rendered/, 'the check sees its own render next to the example');
  assert.equal(images, 0, 'drawn design → no image-model picture');
  const saved = (await listStyles(ctx))[0]!;
  assert.ok(saved.spec.tpl?.html.includes('#102030'), 'the corrected template is what is saved');
  assert.equal(saved.has_plate, false);
  assert.deepEqual(await px((await previewStyle(ctx, row.id))!, 500, 1300), [0x10, 0x20, 0x30], 'preview drawn from the template');

  prompts.length = 0;
  const ig = await generateCreative(ctx, { styleId: row.id, placement: 'instagram', text: 'Know your floor\n\n- one\n- two' });
  assert.equal(prompts.length, 0, 'saved template at its own shape → no AI calls');
  assert.equal(ig.background, 'template');
  assert.deepEqual(await px(ig.images[0]!, 500, 1300), [0x10, 0x20, 0x30]);

  const x1 = await generateCreative(ctx, { styleId: row.id, placement: 'x', text: 'Know your floor' });
  assert.equal(prompts.length, 1, 'new shape: one re-compose call');
  assert.deepEqual([(await sharp(x1.images[0]!).metadata()).width, x1.background], [1600, 'new-size']);
  await generateCreative(ctx, { styleId: row.id, placement: 'x', text: 'Again' });
  assert.equal(prompts.length, 1, 'then saved and free');

  prompts.length = 0;
  const r = await remakeTemplate(ctx, row.id, { note: 'make the background dark green' });
  assert.deepEqual(r.layouts, ['main']);
  assert.match(prompts[0]!, /make the background dark green/);
  const after = (await listStyles(ctx))[0]!.spec.tpl!;
  assert.ok(after.html.includes('#004400'));
  assert.equal(after.sizes, undefined, 'copies made for other shapes are dropped after a remake');
});
