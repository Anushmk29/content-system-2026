import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { runResponse } from './run-response.ts';

test('a UI run is acknowledged while work is still pending and continues after navigation', async () => {
  const work = Promise.withResolvers<unknown>();
  const controller = new AbortController();
  const req = new Request('http://localhost/content/api/run', { method: 'POST', headers: { prefer: 'respond-async' }, signal: controller.signal });
  let completed = false;
  void work.promise.then(() => { completed = true; });
  const response = await runResponse(req, work.promise);
  assert.equal(response.status, 202);
  assert.equal(response.headers.get('preference-applied'), 'respond-async');
  assert.equal((await response.json()).status, 'started');
  assert.equal(completed, false);
  controller.abort();
  work.resolve({ status: 'ok' });
  await setImmediate();
  assert.equal(completed, true, 'leaving the page must not cancel server-side pipeline work');
});

test('cron callers without the preference still wait and receive the original result shape', async () => {
  const work = Promise.withResolvers<unknown>();
  let returned = false;
  const response = runResponse(new Request('http://localhost/content/api/run'), work.promise).then((r) => { returned = true; return r; });
  await setImmediate();
  assert.equal(returned, false);
  const records = [{ moduleId: 'research', status: 'ok', itemsProcessed: 1 }];
  work.resolve(records);
  assert.deepEqual(await (await response).json(), records);
  await assert.rejects(runResponse(new Request('http://localhost/content/api/run'), Promise.reject(new Error('test failure'))), /test failure/);
});

test('an unexpected background failure is handled and logged after the acknowledgment', async () => {
  const log = mock.method(console, 'error', () => {});
  const work = Promise.withResolvers<unknown>();
  try {
    const response = await runResponse(new Request('http://localhost/content/api/run', { headers: { prefer: 'respond-async' } }), work.promise);
    assert.equal(response.status, 202);
    work.reject(new Error('unexpected worker failure'));
    await setImmediate();
    assert.equal(log.mock.callCount(), 1);
  } finally { log.mock.restore(); }
});
