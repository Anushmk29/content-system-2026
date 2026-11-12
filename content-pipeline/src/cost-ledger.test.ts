import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './db/test-db.ts';
import { createLogger } from './logger.ts';
import { costRecorder, costScoped, withCostScope, budgetGuard, gate, BudgetExceeded, type CostEvent } from './cost-ledger.ts';
import { createClaude } from './adapters/claude.ts';
import { runCostUsd } from './adapters/apify.ts';
import { getCosts, costsCsv, costDays } from './services/cost-service.ts';
import type { ModuleContext } from './modules/module.ts';

const db = await createTestDb();
const pending: Promise<void>[] = [];
const record = costRecorder(db, createLogger('test'));
const onCost = (e: CostEvent) => { pending.push(record(e)); };
const flush = () => Promise.all(pending.splice(0));

// OpenRouter stub: one 200 with usage, or a 400.
let status = 200;
globalThis.fetch = (async () => new Response(
  status === 200
    ? JSON.stringify({ model: 'anthropic/claude-sonnet-5.5', choices: [{ message: { content: 'hi' } }], usage: { cost: 0.0123, prompt_tokens: 100, completion_tokens: 20 } })
    : 'bad request',
  { status })) as typeof fetch;
const llm = createClaude({ openrouterApiKey: 'k', onCost });

test('a scoped OpenRouter call lands with its feature, ref, tokens and cost', async () => {
  const draft = costScoped('hook_rewrite', async (_ctx: unknown, _itemId: string) => llm.complete('p'), 'content_item');
  await draft(null, 'item-1');
  await flush();
  const r = (await db.query<Record<string, unknown>>(`select * from content.cost_events`)).rows;
  assert.equal(r.length, 1);
  assert.deepEqual([r[0]!.provider, r[0]!.kind, r[0]!.feature, r[0]!.ref_type, r[0]!.ref_id, r[0]!.input_tokens, r[0]!.output_tokens, Number(r[0]!.cost_usd), r[0]!.ok],
    ['openrouter', 'llm', 'hook_rewrite', 'content_item', 'item-1', 100, 20, 0.0123, true]);
});

test('unscoped calls log as untagged; failures log too', async () => {
  await llm.complete('p');
  status = 400;
  await assert.rejects(withCostScope({ feature: 'draft' }, () => llm.complete('p')));
  status = 200;
  await flush();
  const r = (await db.query<{ feature: string; ok: boolean; error: string | null }>(`select feature, ok, error from content.cost_events order by id desc limit 2`)).rows;
  assert.deepEqual([r[0]!.feature, r[0]!.ok], ['draft', false]);
  assert.match(r[0]!.error!, /OpenRouter 400/);
  assert.equal(r[1]!.feature, 'untagged');
});

test('a failing ledger insert never throws into the work', async () => {
  const broken = costRecorder({ query: async () => { throw new Error('db down'); } } as never, { error() {} } as never);
  await broken({ provider: 'apify', kind: 'scrape', costUsd: 1, ok: true });
});

test('Apify cost: priced events when usageTotalUsd has not settled yet', () => {
  const pricing = { pricingModel: 'PAY_PER_EVENT', pricingPerEvent: { actorChargeEvents: { 'apify-actor-start': { eventPriceUsd: 0.00005 }, post: { eventPriceUsd: 0.002 } } } };
  assert.equal(runCostUsd({ usageTotalUsd: 0.0001, chargedEventCounts: { 'apify-actor-start': 1, post: 40 }, pricingInfo: pricing }, 40).toFixed(5), '0.08005');
  assert.equal(runCostUsd({ usageTotalUsd: 0.5, chargedEventCounts: { post: 1 }, pricingInfo: pricing }, 1), 0.5);
  assert.equal(runCostUsd({ usageTotalUsd: 0.01, pricingInfo: { pricingModel: 'PRICE_PER_DATASET_ITEM', pricePerUnitUsd: 0.001 } }, 30), 0.03);
});

test('getCosts totals by feature and flags untagged; CSV has every row', async () => {
  const ctx = { db, env: {} } as unknown as ModuleContext; // no provider keys → no reconcile calls
  const c = await getCosts(ctx, 'today');
  assert.equal(c.calls, 3);
  assert.equal(c.failed, 1);
  assert.equal(c.total.toFixed(4), '0.0246');
  assert.equal(c.untagged.toFixed(4), '0.0123');
  assert.equal(c.byDay.length, 1);
  assert.equal(c.byDay[0]!.usd.toFixed(4), '0.0246');
  assert.equal(c.top[0]!.usd.toFixed(4), '0.0123');
  const csv = (await costsCsv(ctx, 'today')).trim().split('\n');
  assert.equal(csv.length, 4);
  assert.ok(csv[0]!.startsWith('at,provider,kind,feature'));
});

test('costDays: ranges are IST days', () => {
  const now = new Date('2026-10-06T20:00:00Z'); // 7 Oct 01:30 IST
  assert.deepEqual(costDays('today', now), ['2026-10-07', '2026-10-07']);
  assert.deepEqual(costDays('yesterday', now), ['2026-10-06', '2026-10-06']);
  assert.deepEqual(costDays('7d', now), ['2026-10-01', '2026-10-07']);
  assert.deepEqual(costDays('month', now), ['2026-10-01', '2026-10-07']);
  assert.deepEqual(costDays('custom', now, { from: '2026-10-05', to: '2026-10-01' }), ['2026-10-01', '2026-10-05']);
});

test('daily budget: calls stop once the last 24h reach the cap; no cap = never blocks', async () => {
  const fresh = await createTestDb();
  await fresh.query(`insert into content.cost_events (provider, kind, feature, cost_usd, ok) values ('openrouter','llm','t',4.5,true)`);
  let calls = 0;
  const llm = { complete: async () => { calls++; return 'x'; } };
  await gate(llm, ['complete'], budgetGuard(fresh, 10, createLogger('test'))).complete();
  assert.equal(calls, 1);
  const capped = gate({ complete: async () => { calls++; return 'x'; } }, ['complete'], budgetGuard(fresh, 4, createLogger('test')));
  await assert.rejects(capped.complete(), BudgetExceeded);
  assert.equal(calls, 1, 'the paid call never ran');
  await budgetGuard(fresh, undefined, createLogger('test'))();
});

test('daily budget: an unreadable ledger blocks the paid call', async () => {
  const down = { query: async () => { throw new Error('connection refused'); } } as unknown as Parameters<typeof budgetGuard>[0];
  await assert.rejects(budgetGuard(down, 3, createLogger('test'))(), BudgetExceeded);
});
