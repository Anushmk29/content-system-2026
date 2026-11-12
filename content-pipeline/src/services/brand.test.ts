import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { PGlite } from '@electric-sql/pglite';
import { createTestDb } from '../db/test-db.ts';
import type { ModuleContext } from '../modules/module.ts';
import { DEFAULT_BRAND, brand, setBrand, offerFor, slugify } from '../brand.ts';
import { brandSystem } from '../prompts/brand-context.ts';
import { buildDraftPrompt } from '../prompts/draft.ts';
import { parseDraftResponse } from '../modules/draft-parse.ts';
import { topicQuestions } from '../modules/decision-tasks.ts';
import { loadBrand, saveBrand, cleanPatch, setLogo, setPhotos, getPhotos } from './brand-service.ts';
import { fontInfo } from '../fonts.ts';

const ctxWith = async (): Promise<ModuleContext> =>
  ({ db: await createTestDb(), logger: { warn() {} }, adapters: {} } as unknown as ModuleContext);

test('nothing saved → the built-in brand; the drafting prompt keeps the fixed rules', async () => {
  const ctx = await ctxWith();
  const b = await loadBrand(ctx);
  assert.equal(b.saved, false);
  assert.equal(b.name, DEFAULT_BRAND.name);
  const sys = brandSystem();
  assert.match(sys, /PRATAP AI/);
  assert.match(sys, /HONEST-NUMBERS RULE/);
  assert.match(sys, /practical_ai_for_operators/);
});

test('a saved kit drives prompts, pillar parsing, Jev choices and the offer link', async () => {
  const ctx = await ctxWith();
  const b = await saveBrand(ctx, {
    name: 'Brew & Books', tagline: 'bookkeeping for cafés', audience: 'Independent café owners.\nBusy, not finance people.',
    voice: '- Warm and plain.', voiceSamples: ['Our first post about cash flow and coffee beans.'],
    pillars: [{ label: 'Cash flow tips', description: 'Money in, money out', target: 60 }, { label: 'Café stories', target: 40 }],
    offers: [{ label: 'Free review', url: 'https://brew.example/review', cta: 'Book a free review' },
             { label: 'Course', url: 'https://brew.example/course', cta: 'Join the course', primary: true }],
  });
  assert.equal(b.saved, true);
  assert.deepEqual(b.pillars.map((p) => p.slug), ['cash_flow_tips', 'cafe_stories']);
  assert.deepEqual(b.offers.map((o) => o.primary), [false, true]);

  const sys = brandSystem();
  assert.match(sys, /Brew & Books \(bookkeeping for cafés\)/);
  assert.match(sys, /Independent café owners/);
  assert.match(sys, /<example>\nOur first post/);
  assert.match(sys, /\[1\] Course \(primary/);
  assert.doesNotMatch(sys, /PRATAP|SME/);
  assert.match(buildDraftPrompt({ topicTitle: 't' }), /"offer": the \[index\]/);
  assert.deepEqual(Object.keys((topicQuestions().pillar as { criteria: object }).criteria), ['cash_flow_tips', 'cafe_stories']);

  const piece = { title: 't', hook: 'h', body: 'b', cta: 'c' };
  const draft = (pillar: string, offer?: unknown) => JSON.stringify({ pillar, funnelStage: 'awareness', linkedin: piece, blog: piece, x: piece, instagram: piece, facebook: piece, claims: [], offer });
  assert.equal(parseDraftResponse(draft('cafe_stories', 0)).offer, 0);
  assert.equal(parseDraftResponse(draft('cafe_stories', 7)).offer, undefined); // out of range → primary
  assert.throws(() => parseDraftResponse(draft('practical_ai_for_operators')), /not one of cash_flow_tips/);

  assert.equal(offerFor(0)!.label, 'Free review');
  assert.equal(offerFor(null)!.label, 'Course');

  // A later partial save keeps the rest; onboarding is stamped once.
  const again = await saveBrand(ctx, { tagline: 'books for cafés', onboarded: true });
  assert.equal(again.name, 'Brew & Books');
  assert.equal(again.pillars.length, 2);
  assert.ok(again.onboardedAt);
  setBrand(DEFAULT_BRAND);
  assert.equal((await loadBrand(ctx)).tagline, 'books for cafés');
});

test('cleanPatch rejects what would break a post', () => {
  assert.throws(() => cleanPatch({ name: '  ' }), /can’t be empty/);
  assert.throws(() => cleanPatch({ offers: [{ label: 'X', url: 'brew.example' }] }), /https:\/\//);
  assert.deepEqual(cleanPatch({ palette: ['#ABCDEF', 'red', '#123'] }).palette, ['#abcdef']);
  assert.equal(cleanPatch({ offers: [{ label: 'A', url: 'https://a.io' }, { label: 'B', url: 'https://b.io' }] }).offers![0]!.primary, true);
  assert.equal(slugify('Proof & Use-cases!'), 'proof_use_cases');
});

/** A minimal sfnt: a name table (family "Brand Sans", subfamily "Bold") and OS/2 weight 700. */
function tinyFont(): Buffer {
  const utf16be = (s: string) => Buffer.from(s, 'utf16le').swap16();
  const fam = utf16be('Brand Sans'), sub = utf16be('Bold');
  const name = Buffer.alloc(6 + 2 * 12);
  name.writeUInt16BE(0, 0); name.writeUInt16BE(2, 2); name.writeUInt16BE(6 + 2 * 12, 4);
  [[1, fam, 0], [2, sub, fam.length]].forEach(([id, s, off], i) => {
    const r = 6 + i * 12;
    name.writeUInt16BE(3, r); name.writeUInt16BE(1, r + 2); name.writeUInt16BE(0x409, r + 4);
    name.writeUInt16BE(id as number, r + 6); name.writeUInt16BE((s as Buffer).length, r + 8); name.writeUInt16BE(off as number, r + 10);
  });
  const nameTable = Buffer.concat([name, fam, sub]);
  const os2 = Buffer.alloc(8); os2.writeUInt16BE(700, 4);
  const head = Buffer.alloc(12 + 2 * 16);
  head.writeUInt32BE(0x00010000, 0); head.writeUInt16BE(2, 4);
  head.write('OS/2', 12, 'latin1'); head.writeUInt32BE(head.length, 20);
  head.write('name', 28, 'latin1'); head.writeUInt32BE(head.length + os2.length, 36);
  return Buffer.concat([head, os2, nameTable]);
}

test('fontInfo reads the family and weight the renderer will register', () => {
  assert.deepEqual(fontInfo(tinyFont()), { family: 'Brand Sans', weight: 700, italic: false });
  assert.throws(() => fontInfo(Buffer.from('wOFF0000000000000000')), /not a TTF or OTF/);
});

test('your photos: need a saved kit, at most 4, stored as PNGs and cleared with []', async () => {
  const ctx = await ctxWith();
  const img = await sharp({ create: { width: 2000, height: 2000, channels: 3, background: '#888' } }).jpeg().toBuffer();
  await assert.rejects(setPhotos(ctx, [img]), /brand name first/);
  await saveBrand(ctx, { name: 'Acme' });
  await assert.rejects(setPhotos(ctx, [img, img, img, img, img]), /At most 4/);
  await setPhotos(ctx, [img, img]);
  const got = await getPhotos(ctx);
  assert.equal(got.length, 2);
  assert.deepEqual(await sharp(got[0]!).metadata().then((m) => [m.format, m.width]), ['png', 1024]);
  await setPhotos(ctx, []);
  assert.deepEqual(await getPhotos(ctx), []);
  setBrand(DEFAULT_BRAND);
});

test('setLogo needs a saved kit, then stores a PNG', async () => {
  const ctx = await ctxWith();
  const img = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#000' } }).jpeg().toBuffer();
  await assert.rejects(setLogo(ctx, img), /brand name first/);
  await saveBrand(ctx, { name: 'Acme' });
  await setLogo(ctx, img);
  assert.equal((await loadBrand(ctx)).hasLogo, true);
  // An SVG padded past any sniffing window must still be refused, for the logo and for photos.
  const svg = Buffer.from(`<?xml version="1.0"?><!--${'x'.repeat(4096)}--><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`);
  await assert.rejects(setLogo(ctx, svg), /PNG, JPG or WebP/);
  await assert.rejects(setPhotos(ctx, [svg]), /PNG, JPG or WebP/);
  setBrand(DEFAULT_BRAND);
});

test('upgrade: a database with the old pillar enum moves to text with its views intact', async () => {
  const schema = readFileSync(new URL('../../../db/schema.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/create extension[^;]*;/i, '');
  // The old schema: today's, with the pillar columns typed by the old enum and no upgrade block.
  const old = `create schema content;
    create type content.pillar as enum ('practical_ai_for_operators','proof_and_use_cases');\n`
    + schema.replace('  pillar          text,\n', '  pillar          content.pillar,\n')
      .replace('  pillar          text                 not null,', '  pillar          content.pillar       not null,')
      .replace(/-- Upgrade: pillars were[\s\S]*?drop type if exists content\.pillar;/, '');
  const pg = new PGlite();
  await pg.exec(old);
  const enumCol = `select udt_name from information_schema.columns where table_schema='content' and table_name='topics' and column_name='pillar'`;
  assert.equal((await pg.query<{ udt_name: string }>(enumCol)).rows[0]!.udt_name, 'pillar');
  await pg.query(`insert into content.topics (title, pillar, status) values ('old', 'proof_and_use_cases', 'new')`);
  await pg.exec(schema); // re-running the current file upgrades it
  assert.equal((await pg.query<{ udt_name: string }>(enumCol)).rows[0]!.udt_name, 'text');
  assert.equal((await pg.query(`select 1 from content.v_topic_queue where pillar = 'proof_and_use_cases'`)).rows.length, 1);
  const col = await pg.query<{ data_type: string }>(`select data_type from information_schema.columns where table_schema='content' and table_name='topics' and column_name='pillar'`);
  assert.equal(col.rows[0]!.data_type, 'text');
  await pg.query(`insert into content.topics (title, pillar) values ('new', 'cafe_stories')`);
  assert.equal((await pg.query(`select 1 from pg_type where typname = 'pillar'`)).rows.length, 0);
  assert.equal(brand().name, DEFAULT_BRAND.name);
});

test('values and frameworks reach the prompts; reddit is drafted but posted by hand', async () => {
  const { brandBrief } = await import('../prompts/brand-context.ts');
  const { frameworkBlock, frameworkFor, isManual } = await import('../prompts/platform-playbooks.ts');
  const { setBrand, DEFAULT_BRAND } = await import('../brand.ts');
  setBrand({ ...DEFAULT_BRAND, values: ['Honest numbers only', 'No fear selling'] });
  try {
    assert.match(brandSystem(), /VALUES[\s\S]*- Honest numbers only\n- No fear selling/);
    assert.match(brandBrief(), /No fear selling/);
    const p = buildDraftPrompt({ topicTitle: 'T', platforms: ['linkedin', 'reddit'], frameworks: { linkedin: 'pas' } });
    assert.match(p, /- linkedin \(Problem → Agitate → Solve\)/);
    assert.match(p, /- reddit \(Value-first answer\)/);          // default framework
    assert.equal(frameworkFor('x', 'nope').id, 'thread_numbered');
    assert.doesNotMatch(frameworkBlock(['x']), /linkedin/);
    assert.ok(isManual({ platform: 'reddit' }) && isManual({ platform: 'instagram', format: 'reel_script' }));
    assert.ok(!isManual({ platform: 'instagram', format: 'carousel' }));
  } finally {
    setBrand(DEFAULT_BRAND);
  }
});
