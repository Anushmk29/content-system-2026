// YouTube for Decode — the free YouTube Data API v3 (≈ 40 quota units a hunt, 10k/day free), not
// Apify. Ported from competitor-hunter's scrape_youtube_channel (hunt.py, MIT, Charles Dove):
// channel → uploads playlist → playlistItems → videos (statistics + duration).
import { fetchJson, type Adapter } from './adapter.ts';
import type { HealthReport } from '../health.ts';
import { report } from '../health.ts';
import type { ScrapedPost } from './apify.ts';

const API = 'https://www.googleapis.com/youtube/v3';

export interface YoutubeAdapter extends Adapter {
  scrape(handle: string, opts: { since: Date; limit: number }): Promise<{ posts: ScrapedPost[]; costUsd: number }>;
}

/** ISO 8601 duration (PT1H2M3S) → seconds. */
export function isoSeconds(d: string | undefined): number | null {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d ?? '');
  return m ? (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + (+(m[4] ?? 0)) : null;
}

/** "@acme", "acme", a channel id (UC…) or a youtube.com/@acme URL → the channels.list query. */
export function channelQuery(h: string): string {
  const s = h.trim().replace(/\/+$/, '').replace(/^https?:\/\/(www\.|m\.)?youtube\.com\//, '').replace(/^channel\//, '');
  return /^UC[\w-]{22}$/.test(s) ? `id=${s}` : `forHandle=${encodeURIComponent(s.startsWith('@') ? s : `@${s}`)}`;
}

type Video = {
  id: string;
  snippet?: { title?: string; description?: string; publishedAt?: string; channelTitle?: string; thumbnails?: Record<string, { url?: string }> };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
};

export function toPost(v: Video): ScrapedPost {
  const sn = v.snippet ?? {}, st = v.statistics ?? {};
  return {
    // youtu.be keeps the id in the path: content.norm_url drops query strings, so ?v= would collapse every video into one.
    url: `https://youtu.be/${v.id}`, platform: 'youtube', postType: 'video',
    handle: sn.channelTitle ?? null,
    thumb: sn.thumbnails?.high?.url ?? sn.thumbnails?.medium?.url ?? sn.thumbnails?.default?.url ?? null,
    postedAt: sn.publishedAt ?? null, durationS: isoSeconds(v.contentDetails?.duration),
    reactions: Number(st.likeCount ?? 0), comments: Number(st.commentCount ?? 0), shares: 0,
    views: st.viewCount != null ? Number(st.viewCount) : null,
    caption: [sn.title, sn.description].filter(Boolean).join('\n\n'),
  };
}

export function createYoutube(apiKey: string | undefined): YoutubeAdapter {
  const get = <T>(path: string) => fetchJson<T>(`${API}/${path}&key=${apiKey}`, { signal: AbortSignal.timeout(20_000) }, 'YouTube');

  return {
    id: 'youtube',
    configured: Boolean(apiKey),

    async scrape(handle, { since, limit }) {
      if (!apiKey) throw new Error('YouTube not configured (set CONTENT_YOUTUBE_API_KEY)');
      const ch = await get<{ items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] }>(`channels?part=contentDetails&${channelQuery(handle)}`);
      const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploads) throw new Error(`YouTube channel not found: ${handle}`);
      const ids: string[] = [];
      let page = '';
      // Uploads come newest first: stop at the lookback window or the cap.
      while (ids.length < limit) {
        const pl = await get<{ nextPageToken?: string; items?: { contentDetails?: { videoId?: string; videoPublishedAt?: string } }[] }>(
          `playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}${page ? `&pageToken=${page}` : ''}`);
        const fresh = (pl.items ?? []).filter((i) => !i.contentDetails?.videoPublishedAt || new Date(i.contentDetails.videoPublishedAt) >= since);
        ids.push(...fresh.map((i) => i.contentDetails?.videoId).filter((x): x is string => !!x));
        if (!pl.nextPageToken || fresh.length < (pl.items ?? []).length) break;
        page = pl.nextPageToken;
      }
      const posts: ScrapedPost[] = [];
      for (let i = 0; i < Math.min(ids.length, limit); i += 50) {
        const v = await get<{ items?: Video[] }>(`videos?part=snippet,statistics,contentDetails&id=${ids.slice(i, Math.min(i + 50, limit)).join(',')}`);
        posts.push(...(v.items ?? []).map(toPost));
      }
      return { posts, costUsd: 0 };
    },

    async healthCheck(): Promise<HealthReport> {
      if (!apiKey) return report('youtube', 'unconfigured', 'no CONTENT_YOUTUBE_API_KEY — Decode skips YouTube');
      try {
        await get('videos?part=id&id=dQw4w9WgXcQ');
        return report('youtube', 'ok', 'Data API key works');
      } catch (e) {
        return report('youtube', 'error', (e as Error).message);
      }
    },
  };
}
