// LLM adapter — drafting / QC / scoring / triage intelligence (Bible: the custom part).
// Provider-flexible: prefers OpenRouter (OpenAI-compatible Chat Completions) when its
// key is set, and falls back to the Anthropic Messages API. The rest of the engine
// only depends on `complete(prompt, {system})`, so swapping providers changes nothing
// downstream. The adapter id stays 'claude' so the health panel label is stable.
import type { Adapter } from './adapter.ts';
import type { HealthReport } from '../health.ts';
import { report } from '../health.ts';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
// Sensible defaults; override per provider with CONTENT_LLM_MODEL.
const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-sonnet-5.5';
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5.5';
// Image generation ("nano banana"); OpenRouter only. Override with CONTENT_IMAGE_MODEL.
const DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image';
// A hung call fails its one item instead of stalling the module (and, now runs are
// sequential, the whole pipeline). 120s covers the 8000-token seed batch.
const TIMEOUT_MS = 120_000;

export interface LlmConfig {
  openrouterApiKey?: string;
  anthropicApiKey?: string;
  model?: string;
  imageModel?: string;
}

/** `images` are data URLs (data:image/png;base64,…) sent alongside the prompt. */
export interface CompleteOpts { system?: string; model?: string; maxTokens?: number; images?: string[] }

export interface ClaudeAdapter extends Adapter {
  readonly provider: 'openrouter' | 'anthropic' | 'none';
  readonly model: string;
  complete(prompt: string, opts?: CompleteOpts): Promise<string>;
  /** One image from a prompt, optionally guided by reference images (data URLs). OpenRouter only. */
  generateImage(prompt: string, opts?: { images?: string[]; aspectRatio?: string; model?: string }): Promise<Buffer>;
  /** Real USD spent by this process so far (OpenRouter `usage.cost`; Anthropic calls report 0). Diff it around a job. */
  readonly spentUsd: number;
}

export function createClaude(c: LlmConfig = {}): ClaudeAdapter {

  const provider: ClaudeAdapter['provider'] =
    c.openrouterApiKey ? 'openrouter' : c.anthropicApiKey ? 'anthropic' : 'none';
  const model =
    c.model ?? (provider === 'openrouter' ? DEFAULT_OPENROUTER_MODEL : DEFAULT_ANTHROPIC_MODEL);
  const configured = provider !== 'none';
  let spentUsd = 0;

  type OrMessage = { content?: string; images?: Array<{ image_url?: { url?: string } }> };

  async function openRouter(body: Record<string, unknown>): Promise<OrMessage> {
    const send = () => fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${c.openrouterApiKey}`,
        // Optional attribution headers OpenRouter recommends.
        'HTTP-Referer': 'https://content-studio.local',
        'X-Title': 'Content Studio',
      },
      body: JSON.stringify({ ...body, usage: { include: true } }),
    });
    // Rate limits / brief outages (several calls at once, e.g. a carousel's layouts): wait as told, retry up to 3 times.
    let res = await send();
    for (let i = 0; i < 3 && (res.status === 429 || res.status >= 500); i++) {
      const wait = Math.min(30, Number(res.headers.get('retry-after')) || 5 * 2 ** i);
      await new Promise((r) => setTimeout(r, wait * 1000));
      res = await send();
    }
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices?: Array<{ message?: OrMessage }>; usage?: { cost?: number } };
    spentUsd += Number(data.usage?.cost ?? 0);
    return data.choices?.[0]?.message ?? {};
  }

  // Text plus image parts in OpenAI chat shape; plain string when there are no images.
  const userContent = (prompt: string, images?: string[]) => images?.length
    ? [{ type: 'text', text: prompt }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))]
    : prompt;

  async function completeOpenRouter(prompt: string, opts?: CompleteOpts): Promise<string> {
    const messages = [
      ...(opts?.system ? [{ role: 'system', content: opts.system }] : []),
      { role: 'user', content: userContent(prompt, opts?.images) },
    ];
    const msg = await openRouter({ model: opts?.model ?? model, max_tokens: opts?.maxTokens ?? 2048, messages });
    return msg.content ?? '';
  }

  async function completeAnthropic(prompt: string, opts?: CompleteOpts): Promise<string> {
    const images = (opts?.images ?? []).map((url) => {
      const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
      if (!m) throw new Error('Anthropic images must be data URLs');
      return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
    });
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'x-api-key': c.anthropicApiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: opts?.model ?? model,
        max_tokens: opts?.maxTokens ?? 2048,
        system: opts?.system,
        messages: [{ role: 'user', content: images.length ? [...images, { type: 'text', text: prompt }] : prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    return (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  }

  return {
    id: 'claude',
    configured,
    provider,
    model,
    get spentUsd() { return spentUsd; },

    async complete(prompt, opts) {
      if (provider === 'openrouter') return completeOpenRouter(prompt, opts);
      if (provider === 'anthropic') return completeAnthropic(prompt, opts);
      throw new Error('No LLM configured (set CONTENT_OPENROUTER_API_KEY or CONTENT_ANTHROPIC_API_KEY)');
    },

    async generateImage(prompt, opts) {
      if (provider !== 'openrouter') throw new Error('Image generation needs CONTENT_OPENROUTER_API_KEY');
      const msg = await openRouter({
        model: opts?.model ?? c.imageModel ?? DEFAULT_IMAGE_MODEL,
        modalities: ['image', 'text'],
        messages: [{ role: 'user', content: userContent(prompt, opts?.images) }],
        ...(opts?.aspectRatio ? { image_config: { aspect_ratio: opts.aspectRatio } } : {}),
      });
      const url = msg.images?.[0]?.image_url?.url ?? '';
      const b64 = /^data:[^;]+;base64,(.*)$/s.exec(url)?.[1];
      if (!b64) throw new Error(`image model returned no image${msg.content ? `: ${msg.content.slice(0, 200)}` : ''}`);
      return Buffer.from(b64, 'base64');
    },

    async healthCheck(): Promise<HealthReport> {
      if (!configured) return report('claude', 'unconfigured', 'no LLM key (CONTENT_OPENROUTER_API_KEY / CONTENT_ANTHROPIC_API_KEY)');
      // Presence-only: don't burn tokens on every health poll.
      return report('claude', 'ok', `${provider} key present`, { provider, model });
    },
  };
}
