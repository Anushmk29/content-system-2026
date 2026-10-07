// TinyFish adapter — free web Search + Fetch (docs.tinyfish.ai). Used for the Research web
// check and Market Signals. Both endpoints never draw from the TinyFish wallet; limits are
// Search 30/min · 500/h and Fetch 150 URLs/min · 1,000/day. The paid Agent API isn't used:
// Decode stays on Apify, whose per-result actors are cheaper for social posts.
import type { Adapter } from './adapter.ts';
import type { HealthReport } from '../health.ts';
import { report } from '../health.ts';

const SEARCH_URL = 'https://api.search.tinyfish.ai';
const FETCH_URL = 'https://api.fetch.tinyfish.ai';

export interface SearchResult { position: number; site_name: string; title: string; snippet: string; url: string }
export interface SearchOpts {
  domainType?: 'web' | 'news' | 'research_paper';
  /** Only results newer than this many minutes. */
  recencyMinutes?: number;
  /** What the search is for (helps ranking), ≤ 2000 chars. */
  purpose?: string;
}
export interface FetchedPage { url: string; final_url?: string; title?: string; description?: string; text: string }
export interface FetchOpts {
  format?: 'markdown' | 'html';
  /** Max age of a cached copy, in seconds. TinyFish returns ANY cached copy when omitted, so we always send it. */
  ttl: number;
}

export interface TinyfishAdapter extends Adapter {
  search(query: string, opts?: SearchOpts): Promise<SearchResult[]>;
  /** Up to 10 URLs per call. Per-URL failures (timeouts, blocks) are in `errors`, not thrown. */
  fetch(urls: string[], opts: FetchOpts): Promise<{ pages: FetchedPage[]; errors: Array<{ url: string; error: string }> }>;
}

export function createTinyfish(apiKey: string | undefined): TinyfishAdapter {
  const headers = { 'x-api-key': apiKey ?? '', 'content-type': 'application/json' };
  const call = async (url: string, init: RequestInit = {}) => {
    if (!apiKey) throw new Error('TinyFish not configured (CONTENT_TINYFISH_API_KEY)');
    const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`TinyFish ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  };

  const search: TinyfishAdapter['search'] = async (query, opts = {}) => {
    const q = new URLSearchParams({ query: query.slice(0, 400) });
    if (opts.domainType) q.set('domain_type', opts.domainType);
    if (opts.recencyMinutes) q.set('recency_minutes', String(Math.round(opts.recencyMinutes)));
    if (opts.purpose) q.set('purpose', opts.purpose.slice(0, 2000));
    const data = (await call(`${SEARCH_URL}?${q}`)) as { results?: SearchResult[] };
    return data.results ?? [];
  };

  return {
    id: 'tinyfish',
    configured: !!apiKey,
    search,

    async fetch(urls, opts) {
      if (urls.length === 0) return { pages: [], errors: [] };
      if (urls.length > 10) throw new Error('TinyFish fetch takes at most 10 URLs per call');
      const data = (await call(FETCH_URL, {
        method: 'POST',
        body: JSON.stringify({ urls, format: opts.format ?? 'markdown', ttl: opts.ttl }),
      })) as { results?: Array<FetchedPage & { text: unknown }>; errors?: Array<{ url: string; error: string }> };
      return {
        pages: (data.results ?? []).map((p) => ({ ...p, text: typeof p.text === 'string' ? p.text : JSON.stringify(p.text ?? '') })),
        errors: data.errors ?? [],
      };
    },

    async healthCheck(): Promise<HealthReport> {
      if (!apiKey) return report('tinyfish', 'unconfigured', 'no CONTENT_TINYFISH_API_KEY');
      try {
        const r = await search('tinyfish');
        return report('tinyfish', 'ok', `search ok (${r.length} results); Search + Fetch are free`);
      } catch (e) {
        return report('tinyfish', 'error', (e as Error).message);
      }
    },
  };
}
