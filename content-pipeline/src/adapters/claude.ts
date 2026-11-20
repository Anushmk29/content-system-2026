// LLM adapter — drafting / QC / scoring / triage intelligence (Bible: the custom part).
// Every model call goes through OpenRouter (OpenAI-compatible Chat Completions). The rest of the
// engine only depends on `complete(prompt, {system})`. The adapter id stays 'claude' so the
// health panel label is stable.
import { redact, type Adapter } from './adapter.ts';
import type { HealthReport } from '../health.ts';
import { report } from '../health.ts';
import { setTimeout as sleep } from 'node:timers/promises';
import type { OnCost } from '../cost-ledger.ts';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Default model; override with CONTENT_LLM_MODEL.
const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-sonnet-5.5';
const OPENROUTER_IMAGES_URL = 'https://openrouter.ai/api/v1/images';
// Image generation; OpenRouter only. Qwen Image 3 renders text itself and takes up to 4 reference images.
const DEFAULT_IMAGE_MODEL = 'qwen/qwen-image-3';
const MAX_REFS = 4;
// A hung call fails its one item instead of stalling the module (and, now runs are
// sequential, the whole pipeline). 120s covers the 8000-token seed batch.
const TIMEOUT_MS = 120_000;
// Claude 5.5 thinks on every call (it can't be turned off) and Sonnet defaults to 'high' effort; thinking is billed
// as output and counts against max_tokens. 'medium' keeps drafts good at a lower bill.
// ponytail: one level for every call; make it per-call if a route measurably needs 'high'.
const EFFORT = 'medium';
// Long system prompts (the brand context with voice samples) are marked for prompt
// caching (OpenRouter passes cache_control through to Anthropic): repeat calls within ~5 minutes (a pipeline run) read that part at ~10% of the price.
// Shorter prompts are below Anthropic's cache minimum (~1024 tokens) and are sent as plain text.
const CACHE_MIN_CHARS = 4000;
const cachedSystem = (m: string, system: string) =>
  /claude/.test(m) && system.length >= CACHE_MIN_CHARS
    ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
    : null;

interface LlmConfig {
  openrouterApiKey?: string;
  model?: string;
  /** OpenRouter image model slug (CONTENT_IMAGE_MODEL). */
  imageModel?: string;
  /** Called once per API call (success or failure) — the cost ledger. */
  onCost?: OnCost;
}

/** `images` are data URLs (data:image/png;base64,…) sent alongside the prompt. */
interface CompleteOpts { system?: string; model?: string; maxTokens?: number; images?: string[] }

export interface ClaudeAdapter extends Adapter {
  readonly model: string;
  complete(prompt: string, opts?: CompleteOpts): Promise<string>;
  /** One image from a prompt, guided by up to 4 reference images (data URLs; extras are dropped). OpenRouter only. */
  generateImage(prompt: string, opts?: { images?: string[]; aspectRatio?: string }): Promise<Buffer>;
  /** USD spent by this process so far (OpenRouter `usage.cost`). Diff it around a job. */
  readonly spentUsd: number;
}

export function createClaude(c: LlmConfig = {}): ClaudeAdapter {

  const model = c.model ?? DEFAULT_OPENROUTER_MODEL;
  const configured = !!c.openrouterApiKey;
  let spentUsd = 0;

  type OrMessage = { content?: string };
  type Reply = {
    model?: string; choices?: Array<{ message?: OrMessage; finish_reason?: string }>; data?: Array<{ b64_json?: string }>;
    usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
  };

  async function openRouter(body: Record<string, unknown>, url = OPENROUTER_URL): Promise<Reply> {
    const kind = url === OPENROUTER_IMAGES_URL ? 'image' : 'llm';
    const log = (e: { ok: boolean; costUsd?: number; model?: string; inputTokens?: number; outputTokens?: number; error?: string }) =>
      c.onCost?.({ provider: 'openrouter', kind, model: String(body.model), costUsd: 0, units: kind === 'image' && e.ok ? 1 : undefined, ...e });
    const send = () => fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${c.openrouterApiKey}`,
        // Optional attribution headers OpenRouter recommends.
        'HTTP-Referer': 'https://content-studio.local',
        'X-Title': 'Content Studio',
      },
      body: JSON.stringify(kind === 'llm' ? { ...body, usage: { include: true } } : body),
    });
    let data: Reply;
    try {
      // Rate limits / brief outages (several calls at once, e.g. a carousel's layouts): wait as told, retry up to 3 times.
      let res = await send();
      for (let i = 0; i < 3 && (res.status === 429 || res.status >= 500); i++) {
        const wait = Math.min(30, Number(res.headers.get('retry-after')) || 5 * 2 ** i);
        await sleep(wait * 1000);
        res = await send();
      }
      if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${redact((await res.text()).slice(0, 300))}`);
      data = (await res.json()) as Reply;
    } catch (e) {
      log({ ok: false, error: (e as Error).message });
      throw e;
    }
    const cost = Number(data.usage?.cost ?? 0);
    spentUsd += cost;
    log({ ok: true, costUsd: cost, model: data.model ?? String(body.model), inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens });
    return data;
  }

  // Text plus image parts in OpenAI chat shape; plain string when there are no images.
  const userContent = (prompt: string, images?: string[]) => images?.length
    ? [{ type: 'text', text: prompt }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))]
    : prompt;

  async function completeOpenRouter(prompt: string, opts?: CompleteOpts): Promise<string> {
    const m = opts?.model ?? model;
    const messages = [
      ...(opts?.system ? [{ role: 'system', content: cachedSystem(m, opts.system) ?? opts.system }] : []),
      { role: 'user', content: userContent(prompt, opts?.images) },
    ];
    const data = await openRouter({ model: m, max_tokens: opts?.maxTokens ?? 2048, messages, ...(/claude/.test(m) ? { reasoning: { effort: EFFORT } } : {}) });
    const choice = data.choices?.[0];
    if (!choice) throw new Error(`OpenRouter returned no answer: ${JSON.stringify(data).slice(0, 200)}`);
    if (choice.finish_reason === 'length') throw new Error(`reply cut off at max_tokens (${opts?.maxTokens ?? 2048}); raise it or ask for less`);
    return choice.message?.content ?? '';
  }


  return {
    id: 'claude',
    configured,
    model,
    get spentUsd() { return spentUsd; },

    async complete(prompt, opts) {
      if (!configured) throw new Error('No LLM configured (set CONTENT_OPENROUTER_API_KEY)');
      return completeOpenRouter(prompt, opts);
    },

    async generateImage(prompt, opts) {
      if (!configured) throw new Error('Image generation needs CONTENT_OPENROUTER_API_KEY');
      const refs = (opts?.images ?? []).slice(0, MAX_REFS);
      const data = await openRouter({
        model: c.imageModel || DEFAULT_IMAGE_MODEL, prompt, n: 1, resolution: '2K',
        ...(opts?.aspectRatio ? { aspect_ratio: opts.aspectRatio } : {}),
        ...(refs.length ? { input_references: refs.map((url) => ({ type: 'image_url', image_url: { url } })) } : {}),
      }, OPENROUTER_IMAGES_URL);
      const b64 = data.data?.[0]?.b64_json;
      if (!b64) throw new Error('image model returned no image');
      return Buffer.from(b64, 'base64');
    },

    async healthCheck(): Promise<HealthReport> {
      if (!configured) return report('claude', 'unconfigured', 'no LLM key (CONTENT_OPENROUTER_API_KEY)');
      // /key costs no tokens: it proves the key is accepted, not just present.
      const res = await fetch('https://openrouter.ai/api/v1/key', {
        headers: { authorization: `Bearer ${c.openrouterApiKey}` }, signal: AbortSignal.timeout(4000),
      }).catch((e: Error) => e);
      if (res instanceof Error) return report('claude', 'degraded', `OpenRouter unreachable: ${res.message}`);
      if (res.status === 401 || res.status === 403) return report('claude', 'error', 'OpenRouter rejected the key (CONTENT_OPENROUTER_API_KEY)');
      if (!res.ok) return report('claude', 'degraded', `OpenRouter /key ${res.status}`);
      return report('claude', 'ok', 'OpenRouter key accepted', { provider: 'openrouter', model });
    },
  };
}
