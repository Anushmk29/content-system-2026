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
  assert.equal(classifyLane({}), 'review');
});
