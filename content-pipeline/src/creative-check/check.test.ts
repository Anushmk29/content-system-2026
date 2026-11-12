import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createTestDb } from '../db/test-db.ts';
import type { ModuleContext } from '../modules/module.ts';
import { attentionSegments, measureFacts, validateReport, type ValidateInput } from './report.ts';
import { applyCheckFix, CheckBusy, createCreative, getCheck, getCreative, setCheckFeedback, startCheck, compareChecks } from './service.ts';

const transcript = [{ start: 4, end: 8, text: 'Here is the one fix that saves you an hour.' }];
const base = (over: Partial<ValidateInput> = {}): ValidateInput => ({
  promptVersion: 't', model: 'm', mode: 'video+speech', facts: [{ key: 'first_word', label: 'First spoken word', value: 'at 4 s', meaning: '' }],
  attention: [], durationS: 30, slideCount: 0, transcript, copy: { hook: 'Stop wasting mornings', body: 'Three steps.', cta: 'Comment FIX' },
  previousFindingIds: ['old1'], limitations: [], ...over,
});
const finding = (o: Record<string, unknown>) => ({ id: 'f1', category: 'hook', title: 'Voice starts late', detail: 'Nobody speaks for 4 s.', at: { start: 0, end: 4 }, evidence: 'B', priority: 'high', mechanisms: [], ...o });

test('CC-11: brain-% claim, out-of-range timestamp and invented quote are all removed and counted', () => {
  const r = validateReport({
    summary: 'The hook is clear. Your amygdala activates 89% when you see it.',
    findings: [
      finding({ id: 'ok' }),
      finding({ id: 'late', at: { start: 45 } }),
      finding({ id: 'fake', quote: 'this is not in the video' }),
    ],
  }, base());
  assert.equal(r.summary, 'The hook is clear.');
  assert.deepEqual(r.findings.map((f) => f.id), ['ok']);
  assert.ok(r.limitations.includes('Removed 3 statements we couldn’t support.'), r.limitations.join(' | '));
});

test('validate: unknown mechanisms dropped, class A needs a measured fact, replacements may not add numbers', () => {
  const r = validateReport({
    summary: 's',
    categories: { hook: 'review', visual: 'review' },
    findings: [
      finding({ mechanisms: ['amygdala_hijack', 'face_attention'], evidence: 'A', factKey: 'first_word', quote: 'the one fix' }),
      finding({ id: 'f2', category: 'cta', evidence: 'A', at: { field: 'cta' } }),
    ],
    recommendations: [
      { id: 'r1', findingIds: ['f1'], target: 'hook', at: '0:00', change: 'Say the fix first', experiment: 'Post both, compare 3 s hold', priority: 'low',
        replacements: ['The one fix that saves your mornings', 'Save 3 hours with this fix', 'Join 10,000 clients who love this'] },
      { id: 'r2', findingIds: ['f2'], target: 'cta', at: 'cta', change: 'One ask', experiment: 'Compare comments', priority: 'critical', replacements: ['Comment FIX'] },
      { id: 'r3', findingIds: ['missing'], target: 'edit', at: '0:01', change: 'x', experiment: 'y' },
    ],
    resolved: ['old1', 'never-existed'],
    triggers: [{ name: 'scarcity', evidence: 'Only 3 spots left', class: 'A' }, { name: 'mind control', evidence: 'x' }],
  }, base());
  assert.deepEqual(r.findings[0]!.mechanisms, ['face_attention']);
  assert.equal(r.findings[0]!.evidence, 'A');
  assert.equal(r.findings[1]!.evidence, 'B', 'no factKey → downgraded');
  assert.deepEqual(r.recommendations.find((x) => x.id === 'r1')!.replacements, ['The one fix that saves your mornings']);
  assert.deepEqual(r.recommendations.map((x) => x.id), ['r1', 'r2']);
  assert.deepEqual(r.top3, ['r2', 'r1'], 'critical first');
  assert.deepEqual(r.resolved, ['old1']);
  assert.equal(r.categories.visual, 'insufficient', 'review needs a finding behind it');
  assert.equal(r.categories.hook, 'review');
  assert.equal(r.triggers.length, 1);
  assert.match(r.triggers[0]!.risk, /Needs proof/);
  assert.equal(r.triggers[0]!.class, 'B', 'quote not in the content → not observed');
  assert.throws(() => validateReport({}, base()), /unusable/);
});

test('CC-06 proof box: backed only with a quote found in the proof; rewrites may use proof numbers', () => {
  const proof = '312 students since 2024. Dec batch has 5 spots.';
  const raw = (proofQuote: string) => ({
    summary: 's',
    findings: [finding({ at: { field: 'hook' } })],
    triggers: [
      { name: 'social proof', evidence: 'x', proof: 'backed', proofQuote },
      { name: 'urgency', evidence: 'x', proof: 'backed', proofQuote: 'offer ends Friday' },
      { name: 'curiosity', evidence: 'x' },
    ],
    recommendations: [{ id: 'r1', findingIds: ['f1'], target: 'hook', at: 'hook', change: 'Lead with the result', experiment: 'Compare 3 s hold',
      replacements: ['312 students stopped wasting mornings', '500 students stopped wasting mornings'] }],
  });
  const r = validateReport(raw('“312 students since 2024”'), base({ copy: { hook: 'Stop wasting mornings', body: 'Three steps.', cta: 'Comment FIX', proof } }));
  assert.deepEqual(r.triggers[0]!.proof, { status: 'backed', quote: '312 students since 2024' });
  assert.doesNotMatch(r.triggers[0]!.risk, /Needs proof/);
  assert.deepEqual(r.triggers[1]!.proof, { status: 'unbacked' }, 'quote not in the proof → model claim ignored');
  assert.match(r.triggers[1]!.risk, /Needs proof.*Proof box/);
  assert.equal(r.triggers[2]!.proof, undefined, 'not a claim trigger');
  assert.deepEqual(r.proof, { backed: 1, needed: 1 });
  assert.deepEqual(r.recommendations[0]!.replacements, ['312 students stopped wasting mornings'], '312 is in the proof, 500 is not');

  const none = validateReport(raw('312 students since 2024'), base());
  assert.equal(none.triggers[0]!.proof?.status, 'unbacked', 'no proof given → nothing is backed');
  assert.deepEqual(none.recommendations[0]!.replacements, [], 'without proof, numbers stay blocked');
});

test('CC-04: 4 s of silence at the start is a high-risk, measured first segment', () => {
  const segs = attentionSegments(12, [], transcript);
  assert.equal(segs[0]!.risk, 'high');
  assert.deepEqual(segs[0]!.reasons, ['no voice']);
  assert.equal(segs[0]!.evidence, 'A');
  assert.ok(segs.at(-1)!.reasons.includes('long static shot'));
});

test('CC-03: facts are measured, stable, and explain themselves', () => {
  const input = { platform: 'x', hook: 'Stop wasting mornings', body: 'x'.repeat(300), cta: 'Follow and comment FIX',
    video: { durationS: 30, width: 1080, height: 1920, cuts: [3, 9], segments: transcript } };
  const a = measureFacts(input);
  assert.deepEqual(a, measureFacts(input));
  const by = Object.fromEntries(a.map((f) => [f.key, f]));
  assert.equal(by.aspect!.value, '9:16');
  assert.equal(by.first_word!.meaning, 'Viewers see 4 s with no voice.');
  assert.equal(by.opening_silence!.value, '4 s');
  assert.match(by.asks!.value, /^2 \(follow, comment\)/);
  assert.match(by.caption_length!.meaning, /Over the x limit by 20/);
});

// ---- service, on a real (in-memory) Postgres with a fake model ----

const db = await createTestDb();
function ctxWith(reply: (prompt: string) => string) {
  const calls: string[] = [];
  const ctx = {
    db, env: {}, logger: { warn() {}, info() {}, error() {} },
    adapters: { claude: { configured: true, model: 'llm-test', complete: async (p: string) => { calls.push(p); await sleep(20); return reply(p); } } },
  } as unknown as ModuleContext;
  return { ctx, calls };
}
const REPLY = JSON.stringify({
  summary: 'The hook works but the CTA asks for two things.',
  categories: { hook: 'good', cta: 'review' },
  findings: [{ id: 'c1', category: 'cta', title: 'Two asks', detail: 'Follow and comment compete.', at: { field: 'cta' }, quote: 'Follow and comment', evidence: 'B', priority: 'high' }],
  recommendations: [{ id: 'r1', findingIds: ['c1'], target: 'cta', at: 'cta', change: 'Keep one ask', experiment: 'Compare comment rate', priority: 'high', replacements: ['Comment FIX'] }],
});
const done = async (ctx: ModuleContext, id: string) => {
  for (let i = 0; i < 200; i++) { const r = await getCheck(ctx, id); if (r && r.status !== 'running') return r; await sleep(10); }
  throw new Error('check never finished');
};

test('service: run in the background, cached by version, one at a time, fixes and feedback stored', async () => {
  const { ctx, calls } = ctxWith(() => REPLY);
  const c = await createCreative(ctx, { name: 'Morning post', platform: 'linkedin', hook: 'Stop wasting mornings', body: 'Three steps.', cta: 'Follow and comment FIX' });

  const first = await startCheck(ctx, c.id);
  assert.equal(first.check.status, 'running');
  await assert.rejects(startCheck(ctx, c.id, { fresh: true }), CheckBusy);
  const r = await done(ctx, first.check.id);
  assert.equal(r.status, 'done', r.message ?? '');
  assert.equal(r.report!.version.mode, 'copy-only');
  assert.deepEqual(r.report!.top3, ['r1']);

  const again = await startCheck(ctx, c.id);
  assert.ok(again.cached);
  assert.equal(again.check.id, r.id);
  assert.equal(calls.length, 1);

  await setCheckFeedback(ctx, r.id, 'r1', 'useful', 'good one');
  await assert.rejects(setCheckFeedback(ctx, r.id, 'r1', 'love it'), /Pick useful/);
  const applied = await applyCheckFix(ctx, r.id, 'r1', 0);
  assert.equal(applied.cta, 'Comment FIX');
  const after = (await getCheck(ctx, r.id))!;
  assert.equal(after.feedback.r1!.verdict, 'applied');

  // Changed content → a new check that sees the previous findings and may resolve them.
  const { ctx: ctx2, calls: calls2 } = ctxWith(() => JSON.stringify({ summary: 'One clear ask now.', resolved: ['c1', 'zzz'] }));
  const second = await done(ctx2, (await startCheck(ctx2, c.id)).check.id);
  assert.match(calls2[0]!, /PREVIOUS CHECK FINDINGS[^]*c1 \[cta\] Two asks/);
  assert.deepEqual(second.report!.resolved, ['c1']);
  const cmp = compareChecks(r.report!, second.report!);
  assert.equal(cmp.resolved.length, 1);
  assert.deepEqual(cmp.facts.find((f) => f.key === 'asks'), { key: 'asks', label: 'Asks in CTA', before: '2 (follow, comment)', after: '1 (comment)' });
  assert.equal((await getCreative(ctx, c.id))!.checks.length, 2);
});

test('service: a failing model leaves an error row, and the creative can be checked again', async () => {
  const { ctx } = ctxWith(() => 'no json here');
  const c = await createCreative(ctx, { name: 'Bad', hook: 'Hi there friends' });
  const r = await done(ctx, (await startCheck(ctx, c.id)).check.id);
  assert.equal(r.status, 'error');
  assert.ok(r.message);
  const { ctx: ok } = ctxWith(() => REPLY);
  assert.equal((await startCheck(ok, c.id)).check.status, 'running', 'not blocked by the failed run');
});
