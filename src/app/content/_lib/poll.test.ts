import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { poll } from './poll.ts';

test('slow progress requests never overlap; navigation aborts the active read and prevents more polls', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  let calls = 0;
  let signal: AbortSignal | undefined;
  const stop = poll(async (s) => { signal = s; calls++; await (calls === 1 ? first.promise : second.promise); }, 1000);
  try {
    t.mock.timers.tick(1000);
    assert.equal(calls, 1);
    t.mock.timers.tick(20_000);
    assert.equal(calls, 1, 'a stalled server must not accumulate progress requests');
    first.resolve();
    await setImmediate();
    t.mock.timers.tick(1000);
    assert.equal(calls, 2);
    stop();
    assert.equal(signal?.aborted, true);
    second.resolve();
    await setImmediate();
    t.mock.timers.tick(20_000);
    assert.equal(calls, 2);
  } finally { stop(); first.resolve(); second.resolve(); }
});

test('temporary failures retry, and leaving before the first tick sends no request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const stop = poll(async () => { calls++; throw new Error('temporary network failure'); }, 1000);
  t.mock.timers.tick(1000);
  await setImmediate();
  t.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(calls, 2);
  stop();
  const cancel = poll(async () => { calls++; }, 1000);
  cancel();
  t.mock.timers.tick(5000);
  assert.equal(calls, 2);
});
