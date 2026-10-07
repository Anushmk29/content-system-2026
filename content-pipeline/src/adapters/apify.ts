// Apify adapter — scrapes competitors' PUBLIC posts for Decode. One public actor per
// platform, none of which needs a login cookie (public-pages-only rule). Each actor's
// output is normalised into one ScrapedPost shape; the run's real USD cost is returned
// so the dashboard can show Apify spend next to AI spend.
//
// Actor ids are the common public ones but were NOT verified against a live token when
// this was written — override any of them with CONTENT_APIFY_ACTOR_<X|INSTAGRAM|LINKEDIN|FACEBOOK>.
// The normaliser reads several known field spellings per value for the same reason.
import type { Adapter } from './adapter.ts';
import type { HealthReport } from '../health.ts';
import { report } from '../health.ts';

const API = 'https://api.apify.com/v2';

export const DECODE_PLATFORMS = ['x', 'instagram', 'linkedin', 'facebook'] as const;
export type DecodePlatform = (typeof DECODE_PLATFORMS)[number];

export const DEFAULT_ACTORS: Record<DecodePlatform, string> = {
  x: 'apidojo~tweet-scraper',
  instagram: 'apify~instagram-post-scraper',
  linkedin: 'harvestapi~linkedin-company-posts',
  facebook: 'apify~facebook-posts-scraper',
};

export interface ScrapedPost {
  url: string;
  platform: DecodePlatform;
  postType: 'text' | 'image' | 'carousel' | 'video';
  handle: string | null;
  thumb: string | null;
  postedAt: string | null;
  durationS: number | null;
  reactions: number;
  comments: number;
  shares: number;
  views: number | null;
  caption: string;
}

export interface ApifyAdapter extends Adapter {
  /** Scrape one account's recent public posts. `handle` is a handle or a profile/page URL. */
  scrape(platform: DecodePlatform, handle: string, opts: { since: Date; limit: number }): Promise<{ posts: ScrapedPost[]; costUsd: number }>;
}

export function createApify(token: string | undefined, actors: Partial<Record<DecodePlatform, string>> = {}): ApifyAdapter {
  const actorFor = (p: DecodePlatform) => (actors[p] ?? DEFAULT_ACTORS[p]).replace('/', '~');

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }

  return {
    id: 'apify',
    configured: Boolean(token),

    async scrape(platform, handle, { since, limit }) {
      if (!token) throw new Error('Apify not configured (set CONTENT_APIFY_TOKEN)');
      type Run = { id: string; status: string; defaultDatasetId: string; usageTotalUsd?: number; statusMessage?: string };
      let run = (await call<{ data: Run }>(`/acts/${actorFor(platform)}/runs?waitForFinish=60`, {
        method: 'POST', body: JSON.stringify(actorInput(platform, handle, since, limit)),
      })).data;
      // ponytail: polls up to ~10 min per account; a longer actor run fails this account only.
      for (let i = 0; i < 10 && ['READY', 'RUNNING'].includes(run.status); i++) {
        run = (await call<{ data: Run }>(`/actor-runs/${run.id}?waitForFinish=60`)).data;
      }
      if (run.status !== 'SUCCEEDED') throw new Error(`Apify ${platform} run ${run.status}${run.statusMessage ? `: ${run.statusMessage}` : ''}`);
      const items = await call<Record<string, unknown>[]>(`/datasets/${run.defaultDatasetId}/items?clean=true&limit=${limit}`);
      const posts = items.map((it) => normalise(platform, it)).filter((p): p is ScrapedPost => !!p)
        .filter((p) => !p.postedAt || new Date(p.postedAt) >= since);
      return { posts, costUsd: Number(run.usageTotalUsd ?? 0) };
    },

    async healthCheck(): Promise<HealthReport> {
      if (!token) return report('apify', 'unconfigured', 'no CONTENT_APIFY_TOKEN — Decode can’t scrape until it’s set');
      try {
        const me = await call<{ data: { username?: string } }>('/users/me');
        return report('apify', 'ok', `connected as ${me.data.username ?? 'unknown'}`, { actors: DECODE_PLATFORMS.map(actorFor) });
      } catch (e) {
        return report('apify', 'error', (e as Error).message);
      }
    },
  };
}

/** "@acme", "acme" or a profile URL → the bare handle. */
export function bareHandle(h: string): string {
  const s = h.trim().replace(/\/+$/, '');
  return (/^https?:\/\//.test(s) ? s.split('/').pop()! : s).replace(/^@/, '');
}

function pageUrl(platform: 'linkedin' | 'facebook', h: string): string {
  if (/^https?:\/\//.test(h.trim())) return h.trim();
  return platform === 'linkedin' ? `https://www.linkedin.com/company/${bareHandle(h)}/` : `https://www.facebook.com/${bareHandle(h)}`;
}

function actorInput(platform: DecodePlatform, handle: string, since: Date, limit: number): Record<string, unknown> {
  const day = since.toISOString().slice(0, 10);
  switch (platform) {
    case 'x': return { twitterHandles: [bareHandle(handle)], maxItems: limit, sort: 'Latest', start: day };
    case 'instagram': return { username: [bareHandle(handle)], resultsLimit: limit, onlyPostsNewerThan: day };
    case 'linkedin': return { targetUrls: [pageUrl('linkedin', handle)], maxPosts: limit };
    case 'facebook': return { startUrls: [{ url: pageUrl('facebook', handle) }], resultsLimit: limit, onlyPostsNewerThan: day };
  }
}

// ---- normalisation -----------------------------------------------------------
/** First present value among dotted paths (`a.b`, `a.0.b`). */
function pick(o: unknown, ...paths: string[]): unknown {
  for (const p of paths) {
    let v: unknown = o;
    for (const k of p.split('.')) v = v == null ? undefined : (v as Record<string, unknown>)[k];
    if (v != null && v !== '') return v;
  }
  return undefined;
}
const num = (v: unknown): number | null => (v == null || Number.isNaN(Number(v)) ? null : Math.max(0, Math.round(Number(v))));
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
function date(v: unknown): string | null {
  if (v == null) return null;
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function normalise(platform: DecodePlatform, it: Record<string, unknown>): ScrapedPost | null {
  const url = str(pick(it, 'url', 'postUrl', 'post_url', 'linkedinUrl', 'twitterUrl', 'topLevelUrl', 'link'));
  if (!url) return null;
  const caption = str(pick(it, 'caption', 'text', 'fullText', 'full_text', 'content', 'commentary', 'message')) ?? '';
  const thumb = str(pick(it, 'displayUrl', 'thumbnailUrl', 'thumbnail', 'image', 'media.0.thumbnail', 'media.0.photo_image.uri',
    'extendedEntities.media.0.media_url_https', 'entities.media.0.media_url_https', 'postImages.0.url', 'images.0', 'images.0.url',
    'media.images.0.url', 'document.coverPages.0'));
  const views = num(pick(it, 'viewCount', 'videoViewCount', 'videoPlayCount', 'viewsCount', 'views', 'playCount'));
  const durationS = num(pick(it, 'videoDuration', 'duration', 'video.duration'));
  const rawType = String(pick(it, 'type', 'productType', 'media_type', 'postType') ?? '').toLowerCase();
  const isVideo = /video|reel|clips/.test(rawType) || durationS != null || pick(it, 'videoUrl', 'video', 'extendedEntities.media.0.video_info') != null;
  const isCarousel = /sidecar|carousel|album|document/.test(rawType) || Number((pick(it, 'childPosts', 'images') as unknown[] | undefined)?.length ?? 0) > 1;
  return {
    url, platform, caption, thumb, views, durationS: isVideo ? durationS : null,
    postType: isVideo ? 'video' : isCarousel ? 'carousel' : thumb ? 'image' : 'text',
    handle: str(pick(it, 'ownerUsername', 'author.userName', 'author.username', 'author.name', 'author.screen_name', 'user.username', 'pageName', 'authorName')),
    postedAt: date(pick(it, 'timestamp', 'createdAt', 'created_at', 'postedAt.date', 'postedAt', 'posted_at.date', 'posted_at', 'time', 'date', 'publishedAt')),
    reactions: num(pick(it, 'likesCount', 'likeCount', 'favorite_count', 'likes', 'reactionsCount', 'reactions', 'numLikes',
      'engagement.likes', 'engagement.reactions', 'stats.total_reactions', 'socialActivity.numLikes')) ?? 0,
    comments: num(pick(it, 'commentsCount', 'replyCount', 'reply_count', 'comments', 'numComments', 'engagement.comments', 'stats.comments')) ?? 0,
    shares: (num(pick(it, 'retweetCount', 'retweet_count', 'shares', 'sharesCount', 'numShares', 'reposts', 'engagement.shares', 'stats.reposts')) ?? 0)
      + (num(pick(it, 'quoteCount', 'quote_count')) ?? 0),
  };
}
