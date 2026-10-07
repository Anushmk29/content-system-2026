import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createTestDb } from '../db/test-db.ts';
import type { ModuleContext } from '../modules/module.ts';
import { nearestAspect, parseStyle, createStyle, listStyles, getStyleImage, generateCreative } from './style-service.ts';
import { toSlides, layoutZones, fitText } from '../creative.ts';

test('nearestAspect picks the closest supported ratio', () => {
  assert.equal(nearestAspect(1080, 1350), '4:5');
  assert.equal(nearestAspect(1080, 1080), '1:1');
  assert.equal(nearestAspect(1600, 900), '16:9');
  assert.equal(nearestAspect(1080, 1920), '9:16');
});

test('parseStyle: clamps zones, drops bad hex, requires a prompt', () => {
  const s = parseStyle('Sure!\n```json\n{"style_prompt":"Dark editorial poster, gold accents, heavy sans headline","palette":["#0b0b0c","gold"],"text_zones":[{"role":"headline","x":-1,"y":0.1,"w":2,"h":0.2},"junk"]}\n```');
  assert.deepEqual(s.spec.palette, ['#0b0b0c']);
  assert.deepEqual(s.spec.text_zones, [{ role: 'headline', x: 0, y: 0.1, w: 1, h: 0.2 }]);
  assert.throws(() => parseStyle('{"palette":[]}'), /style_prompt/);
});

test('createStyle analyses once, saves prompt + plate, never needs the source again', async () => {
  const calls = { vision: 0, image: 0 };
  let spent = 0;
  const ctx = {
    db: await createTestDb(),
    logger: { warn() {} },
    adapters: {
      claude: {
        get spentUsd() { return spent; },
        async complete(_p: string, o?: { images?: string[] }) {
          calls.vision++; spent += 0.02;
          assert.match(o!.images![0]!, /^data:image\/png;base64,/);
          return '{"style_prompt":"Minimal beige studio backdrop with soft shadow and bold serif headline zone","palette":["#eee"],"text_zones":[]}';
        },
        async generateImage(p: string, o?: { aspectRatio?: string }) {
          calls.image++; spent += 0.04;
          assert.match(p, /REMOVE all text/);
          assert.equal(o!.aspectRatio, '4:5');
          return sharp({ create: { width: 8, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
        },
      },
    },
  } as unknown as ModuleContext;
  const upload = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#123' } }).jpeg().toBuffer();
  const row = await createStyle(ctx, { name: ' Beige studio ', image: upload });
  assert.deepEqual(calls, { vision: 3, image: 1 }, 'analysis + a layout template attempt (unusable here) + plate check');
  assert.equal(row.name, 'Beige studio');
  assert.equal(row.has_plate, true);
  assert.ok(Math.abs(row.analysis_cost_usd - 0.10) < 1e-9);
  assert.equal((await listStyles(ctx))[0]!.style_prompt.startsWith('Minimal beige'), true);
  const src = await getStyleImage(ctx, row.id, 'source');
  assert.equal((await sharp(src!).metadata()).format, 'png', 'source stored normalised to png');
});

test('toSlides: headline/body split, Swipe until the last slide', () => {
  const s = toSlides('73%\n\nof SMBs waste hours\n---\nFix it\n---\nBook a call', 'DM "AUDIT"');
  assert.deepEqual(s.map((x) => [x.headline, x.body, x.cta]), [
    ['73%', 'of SMBs waste hours', 'Swipe →'], ['Fix it', undefined, 'Swipe →'], ['Book a call', undefined, 'DM "AUDIT"'],
  ]);
});

test('layoutZones grows a zone down to the next one; fitText shrinks long text to fit', () => {
  const z = layoutZones([{ role: 'headline', x: 0.1, y: 0.2, w: 0.6, h: 0.1 }, { role: 'cta', x: 0.1, y: 0.8, w: 0.4, h: 0.07 }]);
  assert.ok(Math.abs(z.headline!.maxH - 0.29) < 1e-9, 'headline may take half the column down to the CTA');
  assert.ok(z.body!.y > 0.3, 'missing body zone goes under the headline');
  const narrow = layoutZones([{ role: 'headline', x: 0.08, y: 0.2, w: 0.2, h: 0.1 }, { role: 'body', x: 0.09, y: 0.34, w: 0.58, h: 0.1 }]);
  assert.equal(narrow.headline!.w, 0.58, 'a short example headline ("73%") does not cap our headline width');
  const short = fitText('73%', 600, 150, 120), long = fitText('A much longer headline that cannot possibly fit at the largest size', 600, 300, 120);
  assert.equal(short.size, 120);
  assert.ok(long.size < 120 && long.lines.length * long.size * 1.2 <= 300);
});

test('generateCreative: saved template is free; a new shape is made once, then free; fresh = one call', async () => {
  const calls = { image: 0, vision: 0 };
  const db = await createTestDb();
  const ctx = {
    db, logger: { warn() {} },
    adapters: { claude: {
      spentUsd: 0,
      async complete(p: string) {
        calls.vision++;
        return p.includes('empty social-media post template')
          ? '{"text_zones":[{"role":"headline","x":0.1,"y":0.3,"w":0.5,"h":0.15},{"role":"cta","x":0.1,"y":0.8,"w":0.3,"h":0.1}]}'
          : '{"style_prompt":"Navy gradient poster with coral circle top right","palette":["#14183a","#ffffff"],"text_zones":[{"role":"headline","x":0.08,"y":0.2,"w":0.6,"h":0.1}]}';
      },
      async generateImage() { calls.image++; return sharp({ create: { width: 160, height: 90, channels: 3, background: '#14183a' } }).png().toBuffer(); },
    } },
  } as unknown as ModuleContext;
  const upload = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#14183a' } }).png().toBuffer();
  const style = await createStyle(ctx, { name: 's', image: upload });
  Object.assign(calls, { image: 0, vision: 0 });

  const ig = await generateCreative(ctx, { styleId: style.id, placement: 'instagram', text: 'One\n---\nTwo\n---\nThree' });
  assert.deepEqual(calls, { image: 0, vision: 0 }, 'saved template reused, no AI call');
  assert.equal(ig.background, 'template');
  assert.equal(ig.images.length, 3);
  assert.deepEqual(await sharp(ig.images[0]!).metadata().then((m) => [m.width, m.height]), [1080, 1350]);

  const x1 = await generateCreative(ctx, { styleId: style.id, placement: 'x', text: 'A\n---\nB' });
  assert.deepEqual(calls, { image: 1, vision: 2 }, 'new shape: one re-compose + check + zone read, shared by both slides');
  assert.equal(x1.background, 'new-size');
  assert.deepEqual(await sharp(x1.images[1]!).metadata().then((m) => [m.width, m.height]), [1600, 900]);
  const x2 = await generateCreative(ctx, { styleId: style.id, placement: 'x', text: 'C' });
  assert.deepEqual(calls, { image: 1, vision: 2 }, 'second X post reuses the saved 16:9 template');
  assert.equal(x2.background, 'template');

  const fresh = await generateCreative(ctx, { styleId: style.id, placement: 'instagram', text: 'D', fresh: true, brief: 'CRM' });
  assert.deepEqual(calls, { image: 2, vision: 2 });
  assert.equal(fresh.background, 'fresh');
  assert.equal((await listStyles(ctx))[0]!.use_count, 4);
});

test('button text contrasts with the button, not the whole image', async () => {
  // Dark poster, yellow pill bottom-left: the CTA must come out dark, the headline light.
  const { renderCreative, inkOn } = await import('../creative.ts');
  assert.equal(inkOn(0.82, ['#14183a', '#ffffff']), '#14183a');
  assert.equal(inkOn(0.1, ['#14183a', '#ffffff']), '#ffffff');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="100%" height="100%" fill="#14183a"/><rect x="90" y="1080" width="420" height="96" fill="#ffd066"/></svg>';
  const bg = await sharp(Buffer.from(svg)).png().toBuffer();
  const spec = { palette: ['#14183a', '#ffffff'], typography: 'bold sans', layout: '', mood: '', avoid: '',
    text_zones: [{ role: 'headline', x: 0.08, y: 0.2, w: 0.6, h: 0.1 }, { role: 'cta', x: 90 / 1080, y: 1080 / 1350, w: 420 / 1080, h: 96 / 1350 }] };
  const out = await renderCreative(bg, spec, 'instagram', { headline: 'Hi', cta: 'MMMMMMMM' });
  // Middle of the pill: some pixels must now be dark text, not white.
  const { channels } = await sharp(await sharp(out).extract({ left: 150, top: 1100, width: 300, height: 56 }).toBuffer()).stats();
  assert.ok(channels[0]!.min < 80, 'dark CTA text drawn on the yellow pill');

  // Plain background + spec.button: we draw the pill, keeping its example proportions on 16:9.
  const plain = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#14183a' } }).png().toBuffer();
  const x = await renderCreative(plain, { ...spec, button: { color: '#ffd066', ratio: 1.25 } }, 'x', { headline: 'Hi', cta: 'Go' });
  // scale = min(1600, 900/1.25 = 720) → pill 280×68 at x=0.083·1600=133, y=0.8·900=720.
  const px = await sharp(x).extract({ left: 153, top: 754, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.deepEqual([...px], [0xff, 0xd0, 0x66], 'pill drawn in the sampled button colour');
  const outside = await sharp(x).extract({ left: 133 + 300, top: 754, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.deepEqual([...outside], [0x14, 0x18, 0x3a], 'pill not stretched to the 16:9 width');
});

test('a template with leftovers is remade once, with the problems named', async () => {
  const prompts: string[] = [];
  let checks = 0;
  const ctx = {
    db: await createTestDb(), logger: { warn() {} },
    adapters: { claude: {
      spentUsd: 0,
      async complete(p: string) {
        if (!p.includes('EMPTY background template')) return '{"style_prompt":"Navy gradient poster with coral circle top right","text_zones":[]}';
        return ++checks === 1 ? '{"clean":false,"issues":"arrow inside the button"}' : '{"clean":true}';
      },
      async generateImage(p: string) { prompts.push(p); return sharp({ create: { width: 8, height: 10, channels: 3, background: '#000' } }).png().toBuffer(); },
    } },
  } as unknown as ModuleContext;
  const upload = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#123' } }).png().toBuffer();
  await createStyle(ctx, { name: 'x', image: upload });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1]!, /arrow inside the button/);
});

test('parseCarousel: same-design slides share a layout; missing entries reuse a kind; ids are unique', async () => {
  const { parseCarousel } = await import('./style-service.ts');
  const z = [{ role: 'headline', x: 0.1, y: 0.2, w: 0.6, h: 0.1 }];
  const raw = JSON.stringify({
    style_prompt: 'Navy gradient carousel with coral accents and heavy sans headlines',
    structure: 'Hook, three tips, CTA',
    slides: [
      { kind: 'cover', same_layout_as: null, text_zones: z },
      { kind: 'content', same_layout_as: null, text_zones: z },
      { kind: 'content', same_layout_as: 1, text_zones: z },
      { kind: 'content', same_layout_as: null, text_zones: z }, // a second content design
      { kind: 'cta', same_layout_as: 9, text_zones: z },        // bad index → own layout
    ],
  });
  const { spec, roots } = parseCarousel(raw, 6);                // 6th slide missing → reuses the layout of its kind (last = cta)
  assert.deepEqual(spec.sequence, ['main', 'content', 'content', 'content-2', 'cta', 'cta']);
  assert.deepEqual(roots, { main: 0, content: 1, 'content-2': 3, cta: 4 });
  assert.equal(spec.structure, 'Hook, three tips, CTA');
  assert.deepEqual(spec.text_zones, z, 'top-level zones = main layout, so single-post code paths still work');
});

test('pickLayouts: cover first, CTA last, middle by what the text looks like', async () => {
  const { pickLayouts } = await import('./style-service.ts');
  const L = (kind: string) => ({ kind, text_zones: [] }) as never;
  const slides = toSlides('Hook\n---\n73%\n\nof teams\n---\nSteps\n\n- one\n- two\n---\nPlain idea\n---\nBook a call');
  assert.deepEqual(pickLayouts(slides, { main: L('cover'), content: L('content'), stat: L('stat'), cta: L('cta') }),
    ['main', 'stat', 'content', 'content', 'cta']);
  assert.deepEqual(pickLayouts(slides, { main: L('cover'), list: L('list') }),
    ['main', 'list', 'list', 'list', 'list'], 'no cover/cta layouts → any middle layout');
  assert.deepEqual(pickLayouts(slides), ['main', 'main', 'main', 'main', 'main'], 'single-post style');
});

test('carousel style: one analysis call, one template per layout, each slide drawn on its own layout', async () => {
  const calls = { vision: 0, image: 0 };
  // Each mock template takes the colour of the slide it was made from, so a slide's pixels show which layout it used.
  const colourOf = async (url: string) => (await sharp(Buffer.from(url.split(',')[1]!, 'base64')).stats()).dominant;
  const zone = { role: 'headline', x: 0.1, y: 0.2, w: 0.6, h: 0.1 };
  const ctx = {
    db: await createTestDb(), logger: { warn() {} },
    adapters: { claude: {
      spentUsd: 0,
      async complete(p: string, o?: { images?: string[] }) {
        calls.vision++;
        if (p.includes('EMPTY background template')) return '{"clean":true}';
        if (p.includes('empty social-media post template')) return JSON.stringify({ text_zones: [zone] });
        assert.equal(o!.images!.length, 4, 'all slides in ONE vision call');
        return JSON.stringify({ style_prompt: 'Flat colour carousel with heavy sans headlines and generous margins', slides: [
          { kind: 'cover', text_zones: [zone] },
          { kind: 'content', text_zones: [zone] },
          { kind: 'content', same_layout_as: 1 },
          { kind: 'cta', text_zones: [zone, { role: 'cta', x: 0.1, y: 0.8, w: 0.4, h: 0.08 }] },
        ] });
      },
      async generateImage(_p: string, o?: { images?: string[] }) {
        calls.image++;
        const c = await colourOf(o!.images![0]!);
        return sharp({ create: { width: 80, height: 100, channels: 3, background: c } }).png().toBuffer();
      },
    } },
  } as unknown as ModuleContext;
  const slide = (bg: string) => sharp({ create: { width: 1080, height: 1350, channels: 3, background: bg } }).png().toBuffer();
  const style = await createStyle(ctx, { name: 'c', images: [await slide('#ff0000'), await slide('#00ff00'), await slide('#00ff00'), await slide('#0000ff')] });
  assert.deepEqual(calls, { vision: 7, image: 3 }, '1 analysis + 3 layouts × (layout template attempt, unusable here + plate check)');
  const saved = (await listStyles(ctx))[0]!;
  assert.deepEqual(Object.keys(saved.spec.layouts!).sort(), ['content', 'cta', 'main']);
  assert.match(saved.spec.layouts!.cta!.button!.color, /^#0.0.f/, 'button sampled per layout (dominant colour is binned)');
  assert.ok(await getStyleImage(ctx, style.id, 'plate', 'cta'), 'each layout template viewable');

  Object.assign(calls, { vision: 0, image: 0 });
  // Which colour channel dominates the top-left corner: 0 red (cover), 1 green (content), 2 blue (cta).
  const px = async (png: Buffer) => { const [r, g, b] = await sharp(png).extract({ left: 5, top: 5, width: 1, height: 1 }).removeAlpha().raw().toBuffer(); return [r!, g!, b!].indexOf(Math.max(r!, g!, b!)); };
  const ig = await generateCreative(ctx, { styleId: style.id, placement: 'instagram', text: 'Hook\n---\nIdea one\n---\nIdea two\n---\nBook a call', cta: 'Go' });
  assert.deepEqual(calls, { vision: 0, image: 0 }, 'all layouts saved at this shape → $0');
  assert.deepEqual(ig.layouts, ['main', 'content', 'content', 'cta']);
  assert.deepEqual(await Promise.all(ig.images.map(px)), [0, 1, 1, 2]);

  const x = await generateCreative(ctx, { styleId: style.id, placement: 'x', text: 'Hook\n---\nBook a call', cta: 'Go' });
  assert.deepEqual(calls, { vision: 4, image: 2 }, 'new shape: only the 2 layouts used, each re-composed + checked + zones read');
  assert.deepEqual(await Promise.all(x.images.map(px)), [0, 2], 're-composed from each layout\'s own template');
});

test('a divider under the text caps the column, a graphic beside it does not; badges are drawn with the step number', async () => {
  const head = { role: 'headline', x: 0.08, y: 0.3, w: 0.5, h: 0.08 };
  assert.ok(Math.abs(layoutZones([head, { role: 'graphic', x: 0.08, y: 0.84, w: 0.84, h: 0.01 }]).limit - 0.82) < 1e-9);
  assert.ok(Math.abs(layoutZones([head, { role: 'graphic', x: 0.65, y: 0.5, w: 0.3, h: 0.3 }]).limit - 0.92) < 1e-9);

  const { renderCreative } = await import('../creative.ts');
  const plain = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#f4efe6' } }).png().toBuffer();
  const spec = { palette: ['#111111', '#f4efe6'], typography: '', layout: '', mood: '', avoid: '', align: 'left' as const, headline_font: 'serif' as const,
    text_zones: [{ role: 'number', x: 90 / 1080, y: 200 / 1350, w: 150 / 1080, h: 150 / 1350 }, head], badge: { color: '#e63946', ratio: 1.25 } };
  const at = async (png: Buffer, x: number, y: number) => [...await sharp(png).extract({ left: x, top: y, width: 1, height: 1 }).removeAlpha().raw().toBuffer()];
  const with2 = await renderCreative(plain, spec, 'instagram', { headline: 'Tip', number: 2 });
  assert.deepEqual(await at(with2, 100, 210), [0xe6, 0x39, 0x46], 'badge square drawn in the sampled colour');
  const { channels } = await sharp(await sharp(with2).extract({ left: 130, top: 240, width: 70, height: 70 }).toBuffer()).stats();
  assert.ok(channels[1]!.max > 200, 'light step number drawn on the red badge');
  const cover = await renderCreative(plain, spec, 'instagram', { headline: 'Tip' });
  assert.deepEqual(await at(cover, 100, 210), [0xf4, 0xef, 0xe6], 'no number (cover) → no badge');
});

test('text adapts to its length: example column when it fits, wider into open space when long, cut + flagged when impossible', async () => {
  const { freeRegion, planText, renderCreative } = await import('../creative.ts');
  // Cream template: red circle bottom-right (x 0.72-0.94, y 0.58-0.76), divider line across at y=0.8.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="100%" height="100%" fill="#f4efe6"/><circle cx="900" cy="900" r="120" fill="#e63946"/><rect x="90" y="1080" width="900" height="4" fill="#111"/></svg>';
  const bg = await sharp(Buffer.from(svg)).png().toBuffer();
  const room = (await freeRegion(bg, { x: 0.09, y: 0.21 }))!;
  assert.ok(Math.abs(room(0.08, 0.5, 0.2) - 0.6) < 0.03, 'narrow column: open down to the divider');
  assert.ok(room(0.08, 0.9, 0.2) < 0.4, 'wide column: stopped by the circle');

  const zones = layoutZones([{ role: 'headline', x: 0.08, y: 0.2, w: 0.45, h: 0.08 }]);
  const short = planText({ headline: 'Fix it', body: 'One line.' }, zones, 1080, 1350, false, room);
  assert.deepEqual([short.x, short.w, short.overflow], [0.08, 0.45, false], 'short text keeps the example column');
  const long = planText({ headline: 'Your follow-up is broken', body: 'Most buyers pick whoever answers first. '.repeat(6) }, zones, 1080, 1350, false, room);
  assert.equal(long.overflow, false);
  assert.ok(long.w > 0.45, 'long body widens the column instead of shrinking to tiny text');
  const huge = planText({ headline: 'Headline', body: 'word '.repeat(600) }, zones, 1080, 1350, false, room);
  assert.equal(huge.overflow, true);
  assert.ok(huge.body.lines.at(-1)!.endsWith('…'));

  const notes: string[] = [];
  const spec = { palette: ['#111111'], typography: '', layout: '', mood: '', avoid: '', text_zones: [{ role: 'headline', x: 0.08, y: 0.2, w: 0.45, h: 0.08 }] };
  const out = await renderCreative(bg, spec, 'instagram', { headline: 'Headline', body: 'word '.repeat(600) }, undefined, notes);
  assert.match(notes[0]!, /too long/);
  const below = await sharp(await sharp(out).extract({ left: 90, top: 1090, width: 600, height: 150 }).toBuffer()).stats();
  assert.ok(below.channels[0]!.min > 200, 'nothing drawn below the divider');
});

test('a longer button label grows the pill instead of shrinking the text', async () => {
  const { renderCreative } = await import('../creative.ts');
  const plain = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#111111' } }).png().toBuffer();
  const spec = { palette: ['#111111', '#ffffff'], typography: '', layout: '', mood: '', avoid: '', button: { color: '#e63946', ratio: 1.25 },
    text_zones: [{ role: 'headline', x: 0.08, y: 0.2, w: 0.6, h: 0.1 }, { role: 'cta', x: 0.08, y: 0.8, w: 0.25, h: 0.06 }] };
  const out = await renderCreative(plain, spec, 'instagram', { headline: 'Hi', cta: 'Book your free AI readiness call' });
  const px = [...await sharp(out).extract({ left: Math.round(0.08 * 1080 + 0.25 * 1080 + 60), top: Math.round(0.8 * 1350 + 6), width: 1, height: 1 }).removeAlpha().raw().toBuffer()];
  assert.deepEqual(px, [0xe6, 0x39, 0x46], 'pill extends past the example width');
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

test('draftCarousel: topic → slide text in the editor format, following the saved structure', async () => {
  const { draftCarousel } = await import('./style-service.ts');
  let prompt = '';
  const ctx = {
    db: await createTestDb(), logger: { warn() {} },
    adapters: { claude: {
      spentUsd: 0,
      async complete(p: string) {
        if (!p.includes('Write a social-media carousel')) return '{"style_prompt":"Flat navy poster with heavy sans headline and coral accent","text_zones":[]}';
        prompt = p;
        return '{"slides":[{"headline":"Stop losing leads","body":""},{"headline":"73%","body":"of leads go cold in a day"},{"headline":"Fix it"}],"cta":"Book a call"}';
      },
      async generateImage() { return sharp({ create: { width: 8, height: 10, channels: 3, background: '#000' } }).png().toBuffer(); },
    } },
  } as unknown as ModuleContext;
  const upload = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#123' } }).png().toBuffer();
  const style = await createStyle(ctx, { name: 'x', image: upload });
  const d = await draftCarousel(ctx, { styleId: style.id, topic: 'lead follow-up', slides: 3 });
  assert.match(prompt, /lead follow-up/);
  assert.match(prompt, /exactly 3 slides/);
  assert.equal(d.text, 'Stop losing leads\n---\n73%\n\nof leads go cold in a day\n---\nFix it');
  assert.equal(d.cta, 'Book a call');
});
