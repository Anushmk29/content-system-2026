import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTinyfish } from './tinyfish.ts';

// Replace global fetch for one call; returns what the adapter sent.
function stubFetch(body: unknown, status = 200) {
  const sent: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return sent;
}

test('search: query + filters on the URL, key in the header, results returned', async () => {
  const sent = stubFetch({ results: [{ position: 1, site_name: 'a', title: 'T', snippet: 's', url: 'https://a.com' }] });
  const r = await createTinyfish('k').search('ai invoices', { domainType: 'news', recencyMinutes: 10080 });
  assert.equal(r[0]!.url, 'https://a.com');
  const u = new URL(sent[0]!.url);
  assert.deepEqual([u.origin, u.searchParams.get('query'), u.searchParams.get('domain_type'), u.searchParams.get('recency_minutes')],
    ['https://api.search.tinyfish.ai', 'ai invoices', 'news', '10080']);
  assert.equal((sent[0]!.init!.headers as Record<string, string>)['x-api-key'], 'k');
});

test('fetch: always sends ttl; per-URL errors come back instead of throwing; object text is stringified', async () => {
  const sent = stubFetch({ results: [{ url: 'https://a.com', text: '# Hi' }, { url: 'https://b.com', text: { x: 1 } }], errors: [{ url: 'https://c.com', error: 'timeout' }] });
  const r = await createTinyfish('k').fetch(['https://a.com', 'https://b.com', 'https://c.com'], { ttl: 0 });
  assert.deepEqual(JSON.parse(sent[0]!.init!.body as string), { urls: ['https://a.com', 'https://b.com', 'https://c.com'], format: 'markdown', ttl: 0 });
  assert.deepEqual(r.pages.map((p) => p.text), ['# Hi', '{"x":1}']);
  assert.deepEqual(r.errors, [{ url: 'https://c.com', error: 'timeout' }]);
  await assert.rejects(createTinyfish('k').fetch(Array(11).fill('https://a.com'), { ttl: 0 }), /at most 10/);
});

test('unconfigured: no calls, clear errors; HTTP errors surface the status', async () => {
  const tf = createTinyfish(undefined);
  assert.equal(tf.configured, false);
  assert.equal((await tf.healthCheck()).state, 'unconfigured');
  await assert.rejects(tf.search('x'), /not configured/);
  stubFetch({ error: 'bad key' }, 401);
  await assert.rejects(createTinyfish('k').search('x'), /TinyFish 401/);
  assert.equal((await createTinyfish('k').healthCheck()).state, 'error');
});
