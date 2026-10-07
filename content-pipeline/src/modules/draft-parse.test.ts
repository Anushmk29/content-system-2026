import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDraftResponse } from './draft-parse.ts';
import { extractJsonObject } from './llm-json.ts';

const valid = {
  pillar: 'practical_ai_for_operators',
  funnelStage: 'education',
  linkedin: { title: 'A', hook: 'h', body: 'long post', cta: 'Book a call' },
  blog: { title: 'B', hook: 'h', body: 'article', cta: 'Book a call' },
  x: { title: 'X', hook: 'h', body: 'tweet 1\n---\ntweet 2', cta: '?' },
  instagram: { title: 'I', hook: 'h', body: 'slide 1\n---\nslide 2', cta: 'save this' },
  facebook: { title: 'F', hook: 'h', body: 'post', cta: 'comment' },
  claims: ['cut processing from hours to minutes'],
};

test('parses a clean JSON response', () => {
  const out = parseDraftResponse(JSON.stringify(valid));
  assert.equal(out.pillar, 'practical_ai_for_operators');
  assert.equal(out.linkedin!.title, 'A');
  assert.equal(out.claims.length, 1);
});

test('recovers JSON wrapped in markdown fences and prose', () => {
  const noisy = 'Sure! Here is your content:\n```json\n' + JSON.stringify(valid) + '\n```\nHope that helps.';
  const out = parseDraftResponse(noisy);
  assert.equal(out.instagram!.body.includes('---'), true);
});

test('extractJsonObject ignores braces inside strings', () => {
  const s = 'prefix {"a":"has } brace","b":1} suffix';
  assert.equal(extractJsonObject(s), '{"a":"has } brace","b":1}');
});

test('extractJsonObject escapes an unescaped quote used mid-sentence', () => {
  const s = '{"body":"He said "great" and left.","b":1}';
  const out = extractJsonObject(s);
  assert.equal(JSON.parse(out).body, 'He said "great" and left.');
  assert.equal(JSON.parse(out).b, 1);
});

test('parseDraftResponse recovers a body with an unescaped internal quote', () => {
  const raw =
    '{"pillar":"practical_ai_for_operators","funnelStage":"education",' +
    '"linkedin":{"title":"A","hook":"h","body":"Founders call this "quick win" often.","cta":"Book a call"},' +
    '"blog":{"title":"B","hook":"h","body":"article","cta":"c"},"x":{"title":"X","hook":"h","body":"t","cta":"?"},' +
    '"instagram":{"title":"I","hook":"h","body":"slide","cta":"save"},' +
    '"facebook":{"title":"F","hook":"h","body":"post","cta":"?"},"claims":[]}';
  const out = parseDraftResponse(raw);
  assert.equal(out.linkedin!.body, 'Founders call this "quick win" often.');
});

test('normalizes claims: drops blanks and non-strings, trims', () => {
  const out = parseDraftResponse(JSON.stringify({ ...valid, claims: ['  real  ', '', 5, null] }));
  assert.deepEqual(out.claims, ['real']);
});

test('empty claims array is allowed (no claims to prove)', () => {
  const out = parseDraftResponse(JSON.stringify({ ...valid, claims: [] }));
  assert.deepEqual(out.claims, []);
});

test('rejects an invalid pillar', () => {
  assert.throws(() => parseDraftResponse(JSON.stringify({ ...valid, pillar: 'random' })), /pillar/);
});

test('rejects a missing required field', () => {
  const bad = { ...valid, facebook: { title: 'F', hook: 'h', cta: 'c' } }; // no body
  assert.throws(() => parseDraftResponse(JSON.stringify(bad)), /facebook\.body/);
});

test('throws clearly when there is no JSON at all', () => {
  assert.throws(() => parseDraftResponse('I cannot help with that.'), /no JSON object/);
});
