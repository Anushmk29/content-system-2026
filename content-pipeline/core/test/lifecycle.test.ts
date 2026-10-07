import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, CONTENT_EVENTS } from '../src/lifecycle.ts';
import { performanceSignal } from '../src/performance.ts';

test('an approval can never land on an item that has left the review lane', () => {
  assert.ok(canTransition('needs_approval', 'approve'));
  for (const s of ['draft', 'queued', 'published', 'performance_captured', 'archived']) {
    assert.ok(!canTransition(s, 'approve'), `approve from ${s}`);
  }
  assert.ok(!canTransition('queued', 'reject'), 'already handed to Postiz');
});

test('the happy path is one chain of legal events', () => {
  let s = 'draft';
  for (const e of ['submit', 'approve', 'schedule', 'go_live', 'capture'] as const) {
    assert.ok(canTransition(s, e), `${e} from ${s}`);
    s = CONTENT_EVENTS[e].to;
  }
  assert.equal(s, 'performance_captured');
});

test('performanceSignal: reach×engagement quadrants (Table 30), numeric strings from SQL sums', () => {
  assert.equal(performanceSignal({ reach: 1000, qualified_engagement: 20 }), 'repurpose');
  assert.equal(performanceSignal({ reach: null, impressions: 5000, qualified_engagement: 3 }), 'awareness_only');
  assert.equal(performanceSignal({ reach: 10, qualified_engagement: '40' }), 'improve_hook');
  assert.equal(performanceSignal({ reach: '999', qualified_engagement: null }), 'archive');
  // own results win over the fixed bar
  assert.equal(performanceSignal({ reach: 10, qualified_engagement: 40, vs_usual: 0.6 }), 'archive');
  assert.equal(performanceSignal({ reach: 5000, qualified_engagement: 0, vs_usual: 1.4 }), 'repurpose');
});
