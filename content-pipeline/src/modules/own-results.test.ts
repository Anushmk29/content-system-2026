import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../db/test-db.ts';
import { saveBrand } from '../services/brand-service.ts';
import { ownResultsModule } from './own-results.module.ts';
import type { ModuleContext } from './module.ts';

test('own results waits for its scrape, retries failures, and delays only successful refreshes', async () => {
  const db = await createTestDb();
  let started!: () => void, finish!: () => void;
  const scraping = new Promise<void>((resolve) => { started = resolve; });
  const reply = new Promise<void>((resolve) => { finish = resolve; });
  let calls = 0, settled = false;
  const ctx = { db, logger: { warn() {}, error() {} }, env: {}, adapters: {
    claude: { configured: true, spentUsd: 0 }, apify: { configured: true, scrape: async () => {
      calls++; started(); await reply; return { posts: [], costUsd: 0 };
    } },
  } } as unknown as ModuleContext;
  await saveBrand(ctx, { name: 'Test', ownHandles: { instagram: 'test-account' } });
  const pending = ownResultsModule.run(ctx).then((result) => { settled = true; return result; });
  await scraping;
  assert.equal(settled, false);
  finish();
  assert.equal((await pending).status, 'degraded');
  assert.equal((await ownResultsModule.run(ctx)).status, 'degraded');
  assert.equal(calls, 2, 'failed refresh can retry');
  await db.query(`update content.decode_runs set status = 'done'`);
  assert.equal((await ownResultsModule.run(ctx)).status, 'skipped');
  assert.equal(calls, 2, 'successful refresh waits seven days');
});
