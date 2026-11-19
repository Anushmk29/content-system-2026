import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { getSystemHealth } from './health-service.ts';
import { report } from '../health.ts';
import type { ModuleContext } from '../modules/module.ts';

test('page health returns the last result while one expired probe refreshes in the background', async () => {
  const originalNow = Date.now;
  let now = originalNow(), calls = 0;
  const pending = Promise.withResolvers<void>();
  const ctx = {
    db: { async healthCheck() { return report('database', 'ok', 'connected'); }, async query() { return { rows: [], rowCount: 0 }; } },
    adapters: { claude: { async healthCheck() { calls++; if (calls > 1) await pending.promise; return report('claude', calls > 1 ? 'ok' : 'error', 'probe result'); } } },
  } as unknown as ModuleContext;
  Date.now = () => now;
  try {
    assert.equal((await getSystemHealth(ctx)).adapters[0]?.state, 'error');
    now += 61_000;
    let returned = false;
    const page = getSystemHealth(ctx, { cached: true }).then((h) => { returned = true; return h; });
    await setImmediate();
    assert.equal(returned, true, 'navigation must not wait for an expired external probe');
    assert.equal((await page).adapters[0]?.state, 'error', 'keep the real previous result while refreshing');
    assert.equal((await getSystemHealth(ctx, { cached: true })).adapters[0]?.state, 'error');
    assert.equal(calls, 2, 'overlapping page requests share the refresh');
    pending.resolve();
    assert.equal((await getSystemHealth(ctx)).adapters[0]?.state, 'ok', 'explicit health requests await the fresh result');
  } finally { pending.resolve(); Date.now = originalNow; }
});
