import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { mapLimit } from './map-limit.ts';

test('mapLimit: never more than `limit` at once, results in input order', async () => {
  let live = 0, peak = 0;
  const out = await mapLimit([5, 1, 4, 2, 3, 0], 2, async (ms) => {
    peak = Math.max(peak, ++live);
    await sleep(ms);
    live--;
    return ms * 10;
  });
  assert.equal(peak, 2);
  assert.deepEqual(out, [50, 10, 40, 20, 30, 0]);
  assert.deepEqual(await mapLimit([], 4, async () => 1), []);
});
