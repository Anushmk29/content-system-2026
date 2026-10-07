import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escalateLane, classifyLane } from '../src/lanes.ts';

test('escalateLane: never downgrades a lane', () => {
  // sensitive must survive any proposed lower lane
  assert.equal(escalateLane('sensitive', 'review'), 'sensitive');
  assert.equal(escalateLane('sensitive', 'safe_auto'), 'sensitive');
  assert.equal(escalateLane('review', 'safe_auto'), 'review');
});

test('escalateLane: raises when proposed is stricter', () => {
  assert.equal(escalateLane('safe_auto', 'review'), 'review');
  assert.equal(escalateLane('safe_auto', 'sensitive'), 'sensitive');
  assert.equal(escalateLane('review', 'sensitive'), 'sensitive');
});

test('escalateLane: equal lanes are stable', () => {
  assert.equal(escalateLane('review', 'review'), 'review');
});

test('classifyLane: any sensitive signal -> sensitive', () => {
  for (const sig of [
    { mentionsFaceOrVoice: true },
    { hasClientClaim: true },
    { hasMetric: true },
    { isControversialOpinion: true },
    { isCaseStudy: true },
    { isCompetitorComparison: true },
  ]) {
    assert.equal(classifyLane(sig), 'sensitive', JSON.stringify(sig));
  }
});

test('classifyLane: plain new post -> review', () => {
  assert.equal(classifyLane({ isNewPositioning: true }), 'review');
  assert.equal(classifyLane({}), 'review');
});

test('classifyLane: safe_auto is DISABLED by default (v1)', () => {
  const templated = { isTemplateBased: true, derivedFromApprovedContent: true };
  assert.equal(classifyLane(templated), 'review');               // default: not allowed
  assert.equal(classifyLane(templated, true), 'safe_auto');      // only when explicitly enabled
});

test('classifyLane: sensitive beats safe_auto even when enabled', () => {
  assert.equal(
    classifyLane({ isTemplateBased: true, derivedFromApprovedContent: true, hasMetric: true }, true),
    'sensitive',
  );
});

test('classifyLane: new positioning never auto-approves, even when safe_auto is earned', () => {
  const s = { isTemplateBased: true, derivedFromApprovedContent: true };
  assert.equal(classifyLane(s, true), 'safe_auto');
  assert.equal(classifyLane({ ...s, isNewPositioning: true }, true), 'review');
});
