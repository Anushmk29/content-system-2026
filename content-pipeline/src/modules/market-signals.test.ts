import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, parseXSearch, redditUrl } from './market-signals.module.ts';

test('RSS and Atom items become signals; items without a link are dropped', () => {
  const rss = `<rss><channel><item><title><![CDATA[AI agents &amp; SMEs]]></title><link>https://a.com/1</link>
    <description>&lt;p&gt;Owners want <b>fewer</b> tools&lt;/p&gt;</description></item>
    <item><title>No link</title></item></channel></rss>`;
  assert.deepEqual(parseFeed(rss, 'competitor'), [
    { channel: 'competitor', rawText: 'AI agents & SMEs\n\nOwners want fewer tools', sourceUrl: 'https://a.com/1' },
  ]);
  const atom = `<feed><entry><title>Trend</title><link rel="alternate" href="https://b.com/x"/><summary>s</summary></entry></feed>`;
  assert.deepEqual(parseFeed(atom, 'trend'), [{ channel: 'trend', rawText: 'Trend\n\ns', sourceUrl: 'https://b.com/x' }]);
});

test('X recent search → signals with engagement and a post link', () => {
  const out = parseXSearch({
    data: [
      { id: '1', text: 'Our ops  team\nstill copies invoices by hand', author_id: 'u1',
        public_metrics: { like_count: 40, reply_count: 12, retweet_count: 3, quote_count: 1 } },
      { id: '2', text: 'no author' },
    ],
    includes: { users: [{ id: 'u1', username: 'founder' }] },
  });
  assert.deepEqual(out[0], {
    channel: 'x',
    rawText: 'Our ops team still copies invoices by hand\n\n(X engagement: 12 replies, 40 likes, 4 reposts)',
    sourceUrl: 'https://x.com/founder/status/1',
  });
  assert.equal(out[1]!.sourceUrl, 'https://x.com/i/status/2');
  assert.deepEqual(parseXSearch({}), [], 'no results is not an error');
});

test('r/name reads the subreddit; anything else searches Reddit', () => {
  assert.match(redditUrl('r/smallbusiness'), /reddit\.com\/r\/smallbusiness\/top\.rss\?t=week/);
  assert.match(redditUrl('AI for agencies'), /search\.rss\?q=AI%20for%20agencies/);
});

test('TinyFish: news search becomes signals; a watched page only signals again when it changes', async () => {
  const { marketSignalsModule } = await import('./market-signals.module.ts');
  const { createTestDb } = await import('../db/test-db.ts');
  type Ctx = Parameters<typeof marketSignalsModule.run>[0];
  let page = 'Pricing: Starter plan. Updated 2026-10-01';
  const ctx = {
    db: await createTestDb(), logger: { warn() {} },
    env: { tinyfishQueries: 'clinic automation', tinyfishWatch: 'pricing=https://rival.com/pricing' },
    adapters: { tinyfish: {
      configured: true,
      async search(_q: string, o: { domainType?: string; recencyMinutes?: number }) {
        assert.deepEqual([o.domainType, o.recencyMinutes], ['news', 10080]);
        return [{ position: 1, site_name: 'News', title: 'Clinics adopt AI', snippet: 'No-shows fall', url: 'https://n.com/1' }];
      },
      async fetch(urls: string[], o: { ttl: number }) {
        assert.equal(o.ttl, 0, 'watched pages are always fetched live');
        return { pages: [{ url: urls[0]!, title: 'Pricing', text: page }], errors: [] };
      },
    } },
  } as unknown as Ctx;

  const r1 = await marketSignalsModule.run(ctx);
  assert.deepEqual([r1.status, r1.itemsProcessed], ['ok', 2], 'news item + first look at the page');
  page = 'Pricing: Starter plan. Updated 2026-10-05';
  assert.equal((await marketSignalsModule.run(ctx)).itemsProcessed, 0, 'only a date changed → no new signal');
  page = 'Pricing: Starter plan, now with a Pro tier';
  assert.equal((await marketSignalsModule.run(ctx)).itemsProcessed, 1, 'real change → one new signal');
  const rows = (await ctx.db.query<{ channel: string; source_url: string }>(`select channel, source_url from content.research_inputs order by created_at`)).rows;
  assert.deepEqual(rows.map((r) => r.channel), ['news', 'pricing', 'pricing']);
  assert.match(rows[1]!.source_url, /^https:\/\/rival\.com\/pricing#v=[0-9a-f]{12}$/);
});
