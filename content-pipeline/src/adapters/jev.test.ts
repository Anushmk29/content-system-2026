import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJev, applyRules } from './jev.ts';
import type { CostEvent } from '../cost-ledger.ts';

test('decide: OpenRouter URL, bearer, pinned model, cost, retry on 503', async () => {
  const seen: { url: string; auth: string | null; body: { model: string; state: string } }[] = [];
  let calls = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, auth: new Headers(init.headers).get('authorization'), body: JSON.parse(String(init.body)) });
    if (calls++ === 0) return new Response('busy', { status: 503 });
    return Response.json({ model: 'typesafe/jev-1.13-20260917', answers: { spam: { type: 'noul', noul: 0.9 } }, usage: { cost: 0.00002 } });
  }) as typeof fetch;
  const costs: CostEvent[] = [];
  const jev = createJev({ apiKey: 'or-key', onCost: (e) => costs.push(e) });
  assert.equal(jev.mode, 'shadow');
  const r = await jev.decide('text', { spam: { type: 'noul', instructions: 'spam?' } });
  assert.equal(seen.length, 2);
  assert.equal(seen[1]!.url, 'https://openrouter.ai/api/alpha/decisions');
  assert.equal(seen[1]!.auth, 'Bearer or-key');
  assert.deepEqual([seen[1]!.body.model, seen[1]!.body.state], ['typesafe/jev-1.13', 'text']);
  assert.equal(r.answers.spam!.noul, 0.9);
  assert.equal(jev.spentUsd, 0.00002);
  assert.deepEqual([costs.length, costs[0]!.provider, costs[0]!.costUsd], [1, 'jev', 0.00002]);
});

test('off without a key or with mode off', () => {
  assert.equal(createJev({}).configured, false);
  assert.equal(createJev({ apiKey: 'k', mode: 'off' }).configured, false);
});

test('applyRules: thresholds set fields, later rules win', () => {
  const a = { sponsored: { type: 'noul' as const, noul: 0.85 }, lane: { type: 'choice' as const, choice: 'off_niche' } };
  assert.deepEqual(applyRules(a, [
    { when: { question: 'sponsored', noul_gte: 0.8 }, set: { paid: true } },
    { when: { question: 'sponsored', noul_gte: 0.9 }, set: { paid: 'very' } },
    { when: { question: 'lane', choice: 'off_niche' }, set: { skip: true } },
  ]), { paid: true, skip: true });
});
