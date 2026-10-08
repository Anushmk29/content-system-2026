import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performanceSignal } from '../src/performance.ts';

test('performanceSignal: reach×engagement quadrants (Table 30), numeric strings from SQL sums', () => {
  assert.equal(performanceSignal({ reach: 1000, qualified_engagement: 20 }), 'repurpose');
  assert.equal(performanceSignal({ reach: null, impressions: 5000, qualified_engagement: 3 }), 'awareness_only');
  assert.equal(performanceSignal({ reach: 10, qualified_engagement: '40' }), 'improve_hook');
  assert.equal(performanceSignal({ reach: '999', qualified_engagement: null }), 'archive');
  // own results win over the fixed bar
  assert.equal(performanceSignal({ reach: 10, qualified_engagement: 40, vs_usual: 0.6 }), 'archive');
  assert.equal(performanceSignal({ reach: 5000, qualified_engagement: 0, vs_usual: 1.4 }), 'repurpose');
});
