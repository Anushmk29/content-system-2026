// Postiz adapter — the single publishing rail (Bible §12). Self-hosted, public API v1
// (docs.postiz.com/public-api): posts go to a connected channel (integration) by id, with
// per-platform settings; media is uploaded first and referenced by {id, path}.
import { fetchJson, redact, type Adapter } from './adapter.ts';
import type { HealthReport } from '../health.ts';
import { report } from '../health.ts';

interface ScheduleInput {
  /** One entry per post; X gets several (a thread), everything else one. */
  parts: string[];
  platform: string;
  scheduledAt: string;      // ISO
  /** Images or one video, in order, attached to the first part (X: the first tweet). */
  media?: Array<{ buf: Buffer; mime: string; name: string }>;
  /** LinkedIn: the document title when several images go out as a swipeable carousel. */
  title?: string;
  /** Postiz integration ids to post on (one group, deleted together); empty = every channel of the platform. */
  channelIds?: string[] | null;
}
interface ScheduleResult {
  postizId: string;
}

export interface PostizAdapter extends Adapter {
  schedule(input: ScheduleInput): Promise<ScheduleResult>;
  /** Live numbers for one published post, read through the channel Postiz posted it on. */
  postStats(postizId: string): Promise<{ metrics: PostMetrics; raw: unknown }>;
  /** Delete a scheduled post (the calendar moved it). Postiz public API: DELETE /posts/:id. */
  remove(postizId: string): Promise<void>;
  /** Our platforms that have a connected, enabled channel in Postiz. */
  platforms(): Promise<string[]>;
  /** The enabled channels (a LinkedIn profile, a LinkedIn page...) that can carry one platform. */
  channels(platform: string): Promise<Channel[]>;
}

export interface Channel { id: string; name: string; identifier: string }

type MetricField = 'impressions' | 'reach' | 'likes' | 'comments' | 'shares' | 'saves' | 'clicks';
type PostMetrics = Partial<Record<MetricField, number>>;
type Series = Array<{ label: string; data?: Array<{ total: string | number }> }>;

// Each platform names its numbers differently (X "Retweets", LinkedIn "Unique Impressions", IG
// "Saved"…). First match wins, so "unique impressions" lands in reach before "impressions".
const LABELS: Array<[RegExp, MetricField]> = [
  [/reach|unique/i, 'reach'],
  [/impression|views?\b/i, 'impressions'],
  [/like|reaction/i, 'likes'],
  [/comment|repl/i, 'comments'],
  [/share|retweet|repost|quote/i, 'shares'],
  [/save|bookmark/i, 'saves'],
  [/click/i, 'clicks'],
];

/** Postiz post analytics → our metric fields. Totals are running counts, so the newest point wins;
 *  labels that share a field (retweets + quotes) are added. Unknown labels are kept only in raw. */
export function toMetrics(series: Series): PostMetrics {
  const out: PostMetrics = {};
  for (const s of series) {
    const field = LABELS.find(([re]) => re.test(s.label))?.[1];
    const last = Number(s.data?.at(-1)?.total);
    if (field && Number.isFinite(last)) out[field] = (out[field] ?? 0) + Math.max(0, Math.round(last));
  }
  return out;
}

interface Integration { id: string; name?: string; identifier: string; disabled?: boolean }

// Our platform → the Postiz channel identifiers that can carry it (first connected one wins).
const CHANNELS: Record<string, string[]> = {
  linkedin: ['linkedin', 'linkedin-page'],
  instagram: ['instagram', 'instagram-standalone'],
  facebook: ['facebook'],
  x: ['x'],
  blog: ['wordpress', 'medium', 'devto', 'hashnode'],
};

/** Channel-specific required settings (Postiz rejects a post without them). Several images on
 *  LinkedIn go out as one swipeable document (Postiz builds it: LinkedinDto.post_as_images_carousel). */
export function settingsFor(identifier: string, opts: { images?: number; title?: string } = {}): Record<string, unknown> {
  if (identifier.startsWith('linkedin') && (opts.images ?? 0) > 1) {
    return { __type: identifier, post_as_images_carousel: true, carousel_name: (opts.title ?? '').slice(0, 100) || 'Carousel' };
  }
  if (identifier.startsWith('instagram')) return { __type: identifier, post_type: 'post', collaborators: [] };
  if (identifier === 'x') return { __type: 'x', who_can_reply_post: 'everyone' };
  return { __type: identifier };
}

/** Every enabled channel that can carry `platform`, in Postiz order. */
function channelsFor(all: Integration[], platform: string): Integration[] {
  const ids = CHANNELS[platform] ?? [platform];
  return all.filter((i) => !i.disabled && ids.includes(i.identifier));
}

export const pickIntegration = (all: Integration[], platform: string): Integration | undefined => channelsFor(all, platform)[0];

/** The channels a post goes to: the chosen ones still connected, else (none chosen) all of them. */
export function targetsFor(all: Integration[], platform: string, chosen?: string[] | null): Integration[] {
  const fit = channelsFor(all, platform);
  return chosen?.length ? fit.filter((i) => chosen.includes(i.id)) : fit;
}

/** Every platform some enabled channel can carry (our names, plus Postiz ids we have no mapping for). */
export const connectedTo = (all: Integration[]): string[] =>
  [...new Set([...Object.keys(CHANNELS), ...all.map((i) => i.identifier)])].filter((p) => pickIntegration(all, p));

export function createPostiz(apiUrl: string | undefined, apiKey: string | undefined): PostizAdapter {
  const configured = Boolean(apiUrl && apiKey);
  const base = `${(apiUrl ?? '').replace(/\/$/, '')}/public/v1`;

  const call = <T>(path: string, init: RequestInit = {}) => fetchJson<T>(`${base}${path}`, {
    ...init,
    headers: { authorization: apiKey!, ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }) },
    signal: init.signal ?? AbortSignal.timeout(60000),
  }, `Postiz ${path}`);

  return {
    id: 'postiz',
    configured,

    async schedule(input): Promise<ScheduleResult> {
      if (!configured) throw new Error('Postiz not configured (CONTENT_POSTIZ_API_URL / _API_KEY)');
      const targets = targetsFor(await call<Integration[]>('/integrations'), input.platform, input.channelIds);
      if (!targets.length) throw new Error(input.channelIds?.length ? `none of the chosen ${input.platform} channels is connected in Postiz` : `no ${input.platform} channel connected in Postiz`);

      const image: Array<{ id: string; path: string }> = [];
      for (const m of input.media ?? []) {
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(m.buf)], { type: m.mime }), m.name);
        const up = await call<{ id: string; path: string }>('/upload', { method: 'POST', body: form });
        image.push({ id: up.id, path: up.path });
      }

      const created = await call<Array<{ postId?: string }>>('/posts', {
        method: 'POST',
        body: JSON.stringify({
          type: 'schedule',
          date: input.scheduledAt,
          shortLink: false,
          tags: [],
          posts: targets.map((channel) => ({
            integration: { id: channel.id },
            value: input.parts.map((content, i) => ({ content, image: i === 0 ? image : [] })),
            settings: settingsFor(channel.identifier, { images: image.length, title: input.title }),
          })),
        }),
      });
      // One group: deleting this id (a calendar move) removes the post on every channel.
      // ponytail: stats are read through the first channel only; keep per-channel ids when that matters.
      const postizId = created[0]?.postId;
      if (!postizId) throw new Error('Postiz response missing postId');
      return { postizId };
    },

    async remove(postizId) {
      if (!configured) throw new Error('Postiz not configured (CONTENT_POSTIZ_API_URL / _API_KEY)');
      // Not fetchJson: a delete may answer with an empty body.
      const res = await fetch(`${base}/posts/${encodeURIComponent(postizId)}`, {
        method: 'DELETE', headers: { authorization: apiKey! }, signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`Postiz delete ${res.status}: ${redact((await res.text()).slice(0, 200))}`);
    },

    async platforms() {
      if (!configured) throw new Error('Postiz not configured (CONTENT_POSTIZ_API_URL / _API_KEY)');
      return connectedTo(await call<Integration[]>('/integrations', { signal: AbortSignal.timeout(4000) }));
    },

    async channels(platform) {
      if (!configured) throw new Error('Postiz not configured (CONTENT_POSTIZ_API_URL / _API_KEY)');
      return channelsFor(await call<Integration[]>('/integrations', { signal: AbortSignal.timeout(4000) }), platform)
        .map(({ id, name, identifier }) => ({ id, name: name || identifier, identifier }));
    },

    async postStats(postizId) {
      if (!configured) throw new Error('Postiz not configured (CONTENT_POSTIZ_API_URL / _API_KEY)');
      const raw = await call<Series>(`/analytics/post/${encodeURIComponent(postizId)}?date=30`);
      return { metrics: toMetrics(Array.isArray(raw) ? raw : []), raw };
    },

    async healthCheck(): Promise<HealthReport> {
      if (!configured) return report('postiz', 'unconfigured', 'Postiz URL/key not set');
      try {
        // Runs on every page view: fail fast instead of holding navigation for a minute.
        const list = await call<Integration[]>('/integrations', { signal: AbortSignal.timeout(4000) });
        const on = list.filter((i) => !i.disabled).map((i) => i.identifier);
        return on.length
          ? report('postiz', 'ok', `channels: ${on.join(', ')}`)
          : report('postiz', 'degraded', 'reachable but no channels connected');
      } catch (e) {
        return report('postiz', 'error', (e as Error).message);
      }
    },
  };
}
