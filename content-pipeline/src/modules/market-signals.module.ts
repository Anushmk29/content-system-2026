// Market Signals — pulls what's running in the market into content.research_inputs so
// the Research Collector turns it into topics (and, via topics.source, into dataset
// examples tagged with where they came from). X and Reddit are the main idea sources.
// Public/official access only: RSS/Atom URLs, Reddit's public RSS (its JSON API 403s
// without OAuth) and X's official API v2 recent search. No logins, no scraping behind auth.
//   CONTENT_MARKET_FEEDS   = "competitor=https://rival.com/feed, https://news.site/rss"  (no prefix → trend)
//   CONTENT_REDDIT_QUERIES = "AI automation small business, r/smallbusiness"  (r/name → that sub's top posts this week)
//   CONTENT_X_QUERIES      = "AI automation small business, n8n agency"  (needs CONTENT_X_BEARER_TOKEN)
//   CONTENT_TINYFISH_QUERIES = "AI automation small business, clinic automation"  (free TinyFish news search, last 7 days)
//   CONTENT_TINYFISH_WATCH   = "https://rival.com/blog, pricing=https://rival.com/pricing"  (free fetch; a signal only when the page changes)
import { createHash } from 'node:crypto';
import type { Module, ModuleContext, ModuleResult } from './module.ts';
import { skipped } from './module.ts';
import { createRepo } from '../db/repo.ts';
import type { SearchResult, FetchedPage } from '../adapters/tinyfish.ts';

export interface Signal { channel: string; rawText: string; sourceUrl: string }

// ponytail: 10 newest per source per run bounds the Research LLM spend; raise if the queue runs dry.
const PER_SOURCE = 10;
const UA = 'pratapai-content-pipeline/1.0 (market signals)';

// Feeds are third-party input, so every pattern here is linear: no lazy match that rescans to the
// end of the body from each unclosed opener (a malformed 400 KB feed used to block the event loop for seconds).
const clean = (s: string) =>
  // Entities first: RSS descriptions usually carry escaped HTML (&lt;p&gt;), which must be stripped too.
  s.replaceAll('<![CDATA[', '').replaceAll(']]>', '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^<>]*>/g, ' ')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();

/** Index of the first `</name>` at or after `from` (case-insensitive), or -1. */
function closeAt(xml: string, name: string, from: number): number {
  const re = new RegExp(`</${name}>`, 'gi');
  re.lastIndex = from;
  return re.exec(xml)?.index ?? -1;
}

function tag(xml: string, name: string): string | undefined {
  const open = new RegExp(`<${name}\\b[^<>]*>`, 'i').exec(xml);
  if (!open) return undefined;
  const start = open.index + open[0].length;
  const end = closeAt(xml, name, start);
  return end < 0 ? undefined : xml.slice(start, end);
}

/** RSS <item> or Atom <entry> → signals. */
export function parseFeed(xml: string, channel: string): Signal[] {
  const items: string[] = [];
  const open = /<(item|entry)\b/gi;
  let m: RegExpExecArray | null;
  while (items.length < PER_SOURCE && (m = open.exec(xml))) {
    const end = closeAt(xml, m[1]!, open.lastIndex);
    if (end < 0) break; // no close tag now means none later either
    open.lastIndex = end + m[1]!.length + 3;
    items.push(xml.slice(m.index, open.lastIndex));
  }
  return items.flatMap((it) => {
    const title = clean(tag(it, 'title') ?? '');
    const link = clean(tag(it, 'link') ?? '') || it.match(/<link\b[^<>]*href="([^"]+)"/i)?.[1] || '';
    const body = clean(tag(it, 'description') ?? tag(it, 'summary') ?? tag(it, 'content') ?? '').slice(0, 1500);
    return title && link ? [{ channel, rawText: body ? `${title}\n\n${body}` : title, sourceUrl: link }] : [];
  });
}

interface XSearch {
  data?: Array<{ id: string; text: string; author_id?: string;
    public_metrics?: { like_count?: number; reply_count?: number; retweet_count?: number; quote_count?: number } }>;
  includes?: { users?: Array<{ id: string; username: string }> };
}

/** X API v2 recent-search JSON → signals. Engagement goes into the text so the scorer
 *  sees demand, not just the words. */
export function parseXSearch(json: XSearch): Signal[] {
  const user = new Map((json.includes?.users ?? []).map((u) => [u.id, u.username]));
  return (json.data ?? []).map((t) => {
    const m = t.public_metrics ?? {};
    const name = t.author_id ? user.get(t.author_id) : undefined;
    return {
      channel: 'x',
      rawText: `${t.text.replace(/\s+/g, ' ').trim()}

(X engagement: ${m.reply_count ?? 0} replies, ${m.like_count ?? 0} likes, ${(m.retweet_count ?? 0) + (m.quote_count ?? 0)} reposts)`,
      sourceUrl: `https://x.com/${name ?? 'i'}/status/${t.id}`,
    };
  });
}

/** TinyFish news search results → signals. */
function parseNews(results: SearchResult[]): Signal[] {
  return results.slice(0, PER_SOURCE).filter((r) => r.url && r.title).map((r) => ({
    channel: 'news',
    rawText: r.snippet ? `${r.title}\n\n${r.snippet} (${r.site_name})` : r.title,
    sourceUrl: r.url,
  }));
}

/**
 * A watched page → a signal keyed by a hash of its text, so the same page only becomes a new
 * signal when it changes (research_inputs dedupes on source_url). Digits are ignored in the hash:
 * ponytail: dates/counters would otherwise flag every visit; a real diff would need stored text.
 */
function watchSignal(page: FetchedPage, channel: string): Signal {
  const norm = page.text.replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
  const v = createHash('sha256').update(norm).digest('hex').slice(0, 12);
  return {
    channel,
    rawText: `${page.title ? `${page.title}\n\n` : ''}${page.text.replace(/\s+/g, ' ').trim().slice(0, 1500)}`,
    sourceUrl: `${page.url}#v=${v}`,
  };
}

/** "r/name" → that subreddit's top posts this week; anything else → Reddit search. */
export function redditUrl(q: string): string {
  const sub = q.match(/^\/?r\/(\w+)$/i)?.[1];
  return sub
    ? `https://www.reddit.com/r/${sub}/top.rss?t=week&limit=${PER_SOURCE}`
    : `https://www.reddit.com/search.rss?q=${encodeURIComponent(q)}&sort=new&t=week&limit=${PER_SOURCE}`;
}

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const res = await fetch(url, { headers: { 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

const MAX_FEED = 1 << 20; // 1 MiB: real feeds are tens of KB
async function feedText(url: string): Promise<string> {
  const res = await get(url);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_FEED) throw new Error('feed larger than 1 MiB');
  if (!res.body) return '';
  const parts: Uint8Array[] = [];
  let n = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    if ((n += chunk.length) > MAX_FEED) throw new Error('feed larger than 1 MiB');
    parts.push(chunk);
  }
  return Buffer.concat(parts).toString('utf8');
}

export const marketSignalsModule: Module = {
  id: 'market-signals',
  title: 'Market Signals',
  description: 'Captures X posts, Reddit questions, TinyFish news + watched competitor pages, and competitor/trend feeds into research_inputs (official/public sources only).',

  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const feeds = list(ctx.env.marketFeeds);
    const queries = list(ctx.env.redditQueries);
    const token = ctx.env.xBearerToken;
    const xQueries = token ? list(ctx.env.xQueries) : [];
    const tf = ctx.adapters.tinyfish;
    const newsQueries = tf.configured ? list(ctx.env.tinyfishQueries) : [];
    const watch = tf.configured ? list(ctx.env.tinyfishWatch).map((w) => {
      const m = w.match(/^(\w+)=(.+)$/);
      return m ? { channel: m[1]!, url: m[2]! } : { channel: 'competitor', url: w };
    }) : [];
    if (feeds.length === 0 && queries.length === 0 && xQueries.length === 0 && newsQueries.length === 0 && watch.length === 0) {
      return skipped('set CONTENT_TINYFISH_QUERIES / CONTENT_TINYFISH_WATCH (+ CONTENT_TINYFISH_API_KEY), CONTENT_X_QUERIES (+ CONTENT_X_BEARER_TOKEN), CONTENT_REDDIT_QUERIES and/or CONTENT_MARKET_FEEDS to capture market signals');
    }

    const sources: Array<{ name: string; load(): Promise<Signal[]> }> = [
      ...feeds.map((f) => {
        const m = f.match(/^(\w+)=(.+)$/);
        const [channel, url] = m ? [m[1]!, m[2]!] : ['trend', f];
        return { name: url, load: async () => parseFeed(await feedText(url), channel) };
      }),
      ...queries.map((q) => ({
        name: `reddit:${q}`,
        load: async () => parseFeed(await feedText(redditUrl(q)), 'reddit'),
      })),
      ...xQueries.map((q) => ({
        name: `x:${q}`,
        // ponytail: relevancy-sorted, retweets/replies excluded — originals with engagement are the ideas.
        load: async () => parseXSearch(await (await get(
          `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(`${q} -is:retweet -is:reply lang:en`)}` +
          `&max_results=${PER_SOURCE}&sort_order=relevancy&tweet.fields=public_metrics&expansions=author_id&user.fields=username`,
          { authorization: `Bearer ${token}` })).json() as XSearch),
      })),
      ...newsQueries.map((q) => ({
        name: `news:${q}`,
        load: async () => parseNews(await tf.search(q, { domainType: 'news', recencyMinutes: 7 * 24 * 60 })),
      })),
      // Watched pages, 10 per Fetch call, always live (ttl 0) so a change is seen on the next run.
      ...Array.from({ length: Math.ceil(watch.length / 10) }, (_, i) => watch.slice(i * 10, i * 10 + 10)).map((batch) => ({
        name: `watch:${batch.map((w) => w.url).join(' ')}`,
        load: async () => {
          const { pages, errors } = await tf.fetch(batch.map((w) => w.url), { ttl: 0 });
          if (pages.length === 0 && errors.length) throw new Error(errors.map((e) => `${e.url}: ${e.error}`).join('; '));
          return pages.flatMap((p) => {
            const w = batch.find((b) => b.url === p.url || b.url === p.final_url);
            return w && p.text.trim() ? [watchSignal({ ...p, url: w.url }, w.channel)] : [];
          });
        },
      })),
    ];

    const repo = createRepo(ctx.db);
    let added = 0;
    const failures: string[] = [];
    for (const s of sources) {
      try {
        for (const sig of await s.load()) if (await repo.insertResearchInputIfNew(sig)) added++;
      } catch (e) {
        failures.push(`${s.name}: ${(e as Error).message}`);
      }
    }
    const ok = sources.length - failures.length;
    return {
      status: failures.length === 0 ? 'ok' : ok > 0 ? 'degraded' : 'error',
      itemsProcessed: added,
      message: `${added} new signal(s) from ${ok}/${sources.length} source(s)` + (failures.length ? `; failed: ${failures.join('; ')}` : ''),
      meta: { added, failures },
    };
  },
};
