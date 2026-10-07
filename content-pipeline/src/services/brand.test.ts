import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { PGlite } from '@electric-sql/pglite';
import { createTestDb } from '../db/test-db.ts';
import type { ModuleContext } from '../modules/module.ts';
import { DEFAULT_BRAND, brand, setBrand, offerFor, slugify } from '../brand.ts';
import { brandSystem, buildDraftPrompt } from '../prompts/brand-brain.ts';
import { parseDraftResponse } from '../modules/draft-parse.ts';
import { topicQuestions } from '../modules/decision-tasks.ts';
import { loadBrand, saveBrand, cleanPatch, setLogo } from './brand-service.ts';
import { fontInfo } from '../fonts.ts';
import { renderCreative, logoBox } from '../creative.ts';
import type { StyleSpec } from './style-service.ts';

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

test('the logo is stamped in its corner and text keeps clear of it', async () => {
  const W = 1080, H = 1350;
  const bg = await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const logo = await sharp({ create: { width: 400, height: 100, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const spec = { palette: [], typography: 'bold sans', text_zones: [{ role: 'headline', x: 0.08, y: 0.1, w: 0.84, h: 0.1 }] } as unknown as StyleSpec;
  const long = 'word '.repeat(400);
  const png = await renderCreative(bg, spec, 'instagram', { headline: 'Hello', body: long }, undefined, [], { logo, logoCorner: 'br' });
  const box = logoBox(W, H, 4, 'br');
  const at = async (x: number, y: number) => [...(await sharp(png).extract({ left: Math.round(x), top: Math.round(y), width: 1, height: 1 }).raw().toBuffer())];
  assert.deepEqual((await at(box.x + box.w / 2, box.y + box.h / 2)).slice(0, 3), [255, 0, 0]);
  // No body text drawn into the strip above the logo's top edge across the logo's width.
  // (crop to a buffer first: sharp's stats() ignores extract())
  const strip = await sharp(await sharp(png).extract({ left: Math.round(box.x), top: Math.round(box.y - 30), width: Math.round(box.w), height: 30 }).toBuffer()).stats();
  assert.ok(strip.channels[0]!.min > 200, 'text ran into the logo');
});

test('setLogo needs a saved kit, then stores a PNG', async () => {
  const ctx = await ctxWith();
  const img = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#000' } }).jpeg().toBuffer();
  await assert.rejects(setLogo(ctx, img), /brand name first/);
  await saveBrand(ctx, { name: 'Acme' });
  await setLogo(ctx, img);
  assert.equal((await loadBrand(ctx)).hasLogo, true);
  setBrand(DEFAULT_BRAND);
});

test('upgrade: a database with the old pillar enum moves to text with its views intact', async () => {
  const schema = readFileSync(new URL('../../../db/schema.sql', import.meta.url), 'utf8').replace(/create extension[^;]*;/i, '');
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
