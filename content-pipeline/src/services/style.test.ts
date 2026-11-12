import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createTestDb } from '../db/test-db.ts';
import type { ModuleContext } from '../modules/module.ts';
import { nearestAspect, createStyle, listStyles, getStyleImage, generateCreative, ensureStarterExamples, slidePrompt } from './style-service.ts';
import { saveBrand, setLogo, setPhotos } from './brand-service.ts';
import { setBrand, DEFAULT_BRAND } from '../brand.ts';
import { toSlides } from '../creative.ts';
import { STARTER_EXAMPLES } from '../starter-examples.ts';

const png = (w: number, h: number, bg = '#123') => sharp({ create: { width: w, height: h, channels: 3, background: bg } }).png().toBuffer();

/** A context whose LLM answers `reply(prompt)` and whose image model records every call. */
async function fakeCtx(reply: (prompt: string) => string) {
  const images: { prompt: string; refs: string[]; aspect?: string }[] = [];
  const texts: string[] = [];
  let spent = 0;
  const ctx = {
    db: await createTestDb(),
    logger: { warn() {}, info() {} },
    adapters: {
      claude: {
        configured: true,
        get spentUsd() { return spent; },
        async complete(p: string) { texts.push(p); spent += 0.01; return reply(p); },
        async generateImage(prompt: string, o?: { images?: string[]; aspectRatio?: string }) {
          images.push({ prompt, refs: o?.images ?? [], aspect: o?.aspectRatio }); spent += 0.04;
          return png(800, 1000, '#ffffff');
        },
      },
    },
  } as unknown as ModuleContext;
  return { ctx, images, texts };
}

test('nearestAspect picks the closest supported ratio', () => {
  assert.equal(nearestAspect(1080, 1350), '4:5');
  assert.equal(nearestAspect(1080, 1080), '1:1');
  assert.equal(nearestAspect(1600, 900), '16:9');
  assert.equal(nearestAspect(1080, 1920), '9:16');
});

test('createStyle: one vision call; every page kept as the example, no template or image call', async () => {
  const { ctx, images, texts } = await fakeCtx(() => '{"description":"Grey page, heavy black title top-left with gold accent words, person cut out bottom half","has_person":true}');
  const row = await createStyle(ctx, { name: ' Founder carousel ', images: [await png(1080, 1350), await png(1080, 1350, '#456')] });
  assert.equal(texts.length, 1);
  assert.equal(images.length, 0);
  assert.deepEqual([row.name, row.kind, row.pages, row.has_person, row.aspect], ['Founder carousel', 'carousel', 2, true, '4:5']);
  assert.ok((await getStyleImage(ctx, row.id, 1))!.length > 0, 'page 2 stored');
  assert.equal(await getStyleImage(ctx, row.id, 2), null);
});

test('ensureStarterExamples: the built-in examples are added once, for free', async () => {
  const { ctx, texts } = await fakeCtx(() => '{}');
  await ensureStarterExamples(ctx);
  await ensureStarterExamples(ctx);
  const rows = await listStyles(ctx);
  assert.equal(rows.length, STARTER_EXAMPLES.length);
  assert.equal(texts.length, 0);
  const journal = rows.find((r) => r.starter === 'journal-carousel')!;
  assert.deepEqual([journal.kind, journal.pages, journal.has_person], ['carousel', 2, true]);
});

test('generateCreative: copy fitted once, cover first then sent with every page, face only when the design has a person', async () => {
  const { ctx, images, texts } = await fakeCtx((p) => p.startsWith('A designer')
    ? '{"pages":[["title: Cash flow, fixed","subtitle: Three habits"],["title: Habit one","item 1: Count it weekly"],["title: Book a call"]]}'
    : '{"description":"Grey page, heavy black title, person bottom half","has_person":true}');
  await saveBrand(ctx, { name: 'Acme', palette: ['#0a7f5a'] });
  await setLogo(ctx, await png(400, 100, '#ff0000'));
  await setPhotos(ctx, [await png(600, 600, '#00ff00')]);
  const ex = await createStyle(ctx, { name: 'ex', images: [await png(1080, 1350), await png(1080, 1350, '#456')] });
  texts.length = 0;

  const r = await generateCreative(ctx, { styleId: ex.id, placement: 'instagram', text: 'Cash flow, fixed\n---\nHabit one\n\nCount it weekly\n---\nBook a call', cta: 'DM AUDIT', brief: 'cash flow' });
  assert.equal(texts.length, 1, 'one copy-fitting call for all pages');
  assert.equal(images.length, 3);
  assert.equal(r.images.length, 3);
  assert.deepEqual(images.map((c) => c.refs.length), [2, 3, 3], 'page + face; then page + our cover + face');
  assert.ok(images.every((c) => c.refs.length <= 4 && c.aspect === '4:5'));
  assert.match(images[0]!.prompt, /title: Cash flow, fixed/);
  assert.match(images[2]!.prompt, /call to action: "DM AUDIT"/);
  assert.match(images[1]!.prompt, /Reference image 2 is the cover/);
  assert.match(images[0]!.prompt, /LAST reference image/);
  assert.match(images[0]!.prompt, /#0a7f5a/);
  // Sized to the placement, our logo stamped bottom-right.
  const meta = await sharp(r.images[0]!).metadata();
  assert.deepEqual([meta.width, meta.height], [1080, 1350]);
  const px = await sharp(r.images[0]!).extract({ left: 1080 - 60, top: 1350 - 60, width: 1, height: 1 }).raw().toBuffer();
  assert.deepEqual([...px].slice(0, 3), [255, 0, 0]);

  // One-off references (Decode) work without a saved example.
  images.length = 0;
  await generateCreative(ctx, { refs: [await png(500, 500)], placement: 'x', text: 'One image' });
  assert.deepEqual([images.length, images[0]!.aspect], [1, '16:9']);
  await assert.rejects(generateCreative(ctx, { placement: 'x', text: 'nothing to copy' }), /pick an example/);
  setBrand(DEFAULT_BRAND);
});

test('slidePrompt: no photo saved → the person is left out; no person → no face instructions', () => {
  const base = { description: 'd', words: 'title: "Hi"', i: 0, n: 1, brand: { name: 'Acme', palette: [], headingFont: null, bodyFont: null }, hasLogo: false };
  assert.match(slidePrompt({ ...base, refs: { cover: false, photo: false }, hasPerson: true }), /Leave the person out/);
  assert.doesNotMatch(slidePrompt({ ...base, refs: { cover: false, photo: false }, hasPerson: false }), /person/);
  assert.match(slidePrompt({ ...base, refs: { cover: false, photo: false }, hasPerson: false }), /single social-media post image/);
});

test('toSlides: headline/body split, Swipe until the last slide', () => {
  const s = toSlides('73%\n\nof SMBs waste hours\n---\nFix it\n---\nBook a call', 'DM "AUDIT"');
  assert.deepEqual(s.map((x) => [x.headline, x.body, x.cta]), [
    ['73%', 'of SMBs waste hours', 'Swipe →'], ['Fix it', undefined, 'Swipe →'], ['Book a call', undefined, 'DM "AUDIT"'],
  ]);
});


test('toPdf: one page per slide, valid xref offsets', async () => {
  const { toPdf } = await import('../creative.ts');
  const png = await sharp({ create: { width: 40, height: 50, channels: 3, background: '#123456' } }).png().toBuffer();
  const s = (await toPdf([png, png, png])).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'));
  assert.match(s, /\/Count 3/);
  const xref = Number(s.match(/startxref\n(\d+)/)![1]);
  assert.ok(s.startsWith('xref', xref), 'startxref points at the xref table');
  const offsets = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.equal(offsets.length, 11);
  offsets.forEach((o, i) => assert.ok(s.startsWith(`${i + 1} 0 obj`, o), `object ${i + 1} at its xref offset`));
});

