// Research Collector (Bible §6) — never create from a blank page. Turns each raw
// research signal in content.research_inputs (a prospect question, a community pain
// point, a note) into a candidate topic with status 'new', which the Topic Scorer
// then ranks. Question mining is the unfair advantage: real signals → real topics.
import { mapLimit, MODEL_CONCURRENCY } from '../map-limit.ts';
import type { Module, ModuleContext, ModuleResult } from './module.ts';
import { ok, degraded } from './module.ts';
import { createRepo, type ResearchInputRow } from '../db/repo.ts';
import {
  researchSystem, buildResearchPrompt, MARKET_CHECK_SYSTEM, buildMarketCheckPrompt,
  MARKET_CHECK_SOURCES_SYSTEM, buildMarketCheckFromSources,
} from '../prompts/decisions.ts';
import { parseExtractedTopic } from './topic-extract.ts';
import { audience } from './decision-tasks.ts';

const DEFAULT_RESEARCH_MODEL = 'perplexity/sonar';
// Topic extraction is a short structured reply (~100 tokens): a cheap model does it as well as
// the writing model. CONTENT_CHEAP_MODEL overrides; "off" (or a non-OpenRouter provider) = default model.
const DEFAULT_CHEAP_MODEL = 'deepseek/deepseek-v4.1-flash';
// ponytail: fixed cut-off, deliberately low so only clearly off-audience signals are dropped
// unpaid; raise it once the Training page shows Jev's relevance calls hold up.
const DROP_BELOW = 0.2;
const YEAR_MINUTES = 365 * 24 * 60;

/**
 * Web check from free TinyFish Search (last 12 months) + Fetch of the top 3 pages; our own LLM
 * writes the check from that text, so every cited URL is one we actually loaded. null = no results.
 */
async function tinyfishMarketCheck(ctx: ModuleContext, signal: string): Promise<string | null> {
  const tf = ctx.adapters.tinyfish;
  // ponytail: the signal's first line is the query (titles/questions search well); an LLM-written
  // query would cost one more call per topic.
  const query = signal.split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 200) ?? '';
  const results = (await tf.search(query, {
    recencyMinutes: YEAR_MINUTES,
    purpose: 'What people ask and what has already been published on this topic, for a B2B content team',
  })).slice(0, 8);
  if (results.length === 0) return null;
  // A week-old cached copy is fine for "what's been said"; failed fetches fall back to the snippet.
  const { pages } = await tf.fetch(results.slice(0, 3).map((r) => r.url), { ttl: 7 * 86400 });
  const sources = results.map((r, i) => {
    const page = pages.find((p) => p.url === r.url || p.final_url === r.url);
    return `[${i + 1}] ${r.title} — ${r.url}\n${page ? page.text.slice(0, 3000) : r.snippet}`;
  }).join('\n\n');
  return (await ctx.adapters.claude.complete(buildMarketCheckFromSources(signal, sources), {
    system: MARKET_CHECK_SOURCES_SYSTEM, maxTokens: 800,
  })).trim() || null;
}

// Live web check: "tinyfish" = free TinyFish Search + Fetch, then our LLM; any other value is
// an OpenRouter model with built-in web search (Perplexity). "off" skips it.
const researchModelOf = (ctx: ModuleContext) => ctx.env.researchModel ?? DEFAULT_RESEARCH_MODEL;
const hasWebCheck = (ctx: ModuleContext) => researchModelOf(ctx) === 'tinyfish'
  ? ctx.adapters.tinyfish.configured
  : ctx.adapters.claude.configured && researchModelOf(ctx) !== 'off';

const cheapModelOf = (ctx: ModuleContext) => {
  const m = ctx.env.cheapModel ?? DEFAULT_CHEAP_MODEL;
  return ctx.adapters.claude.configured && m !== 'off' ? m : undefined;
};

/** The live web check on one signal text (Perplexity or TinyFish). null = nothing found or no check configured. */
async function marketCheck(ctx: ModuleContext, signal: string): Promise<string | null> {
  if (!hasWebCheck(ctx)) return null;
  const researchModel = researchModelOf(ctx);
  return researchModel === 'tinyfish'
    ? tinyfishMarketCheck(ctx, signal)
    : (await ctx.adapters.claude.complete(buildMarketCheckPrompt(signal), {
      system: MARKET_CHECK_SYSTEM, model: researchModel, maxTokens: 800,
    })).trim() || null;
}

/** Web-check a topic right before it is drafted, if research skipped it (the batch path does).
 *  Paid once per topic that is actually drafted; a failure drafts without it, as before. */
export async function ensureMarketContext<T extends { id: string; title: string; source_detail: string | null; market_context: string | null }>(
  ctx: ModuleContext, topic: T,
): Promise<T> {
  if (topic.market_context || !hasWebCheck(ctx)) return topic;
  try {
    const market_context = await marketCheck(ctx, [topic.title, topic.source_detail].filter(Boolean).join('\n\n'));
    if (!market_context) return topic;
    await ctx.db.query(`update content.topics set market_context = $2 where id = $1`, [topic.id, market_context]);
    return { ...topic, market_context };
  } catch (e) {
    ctx.logger.warn(`market check ${topic.id}: ${(e as Error).message}`);
    return topic;
  }
}

/** Jev's read on one raw signal: false only when it is clearly not for our audience. Jev off or
 *  failing = keep it (the gate only ever saves money, never loses a signal to an outage). */
async function relevant(ctx: ModuleContext, input: ResearchInputRow): Promise<boolean> {
  const jev = ctx.adapters.jev;
  if (!jev?.configured) return true;
  const state = input.raw_text.slice(0, 2000);
  const t0 = Date.now();
  try {
    const r = await jev.decide(state, { relevant: { type: 'noul', instructions:
      `${audience()} Would this audience want to read a post about this? When in doubt, answer yes.` } });
    const p = r.answers.relevant?.noul ?? 1;
    await createRepo(ctx.db).logDecision({ task: 'signal_relevance', subjectId: input.id, state, source: 'jev', model: r.model,
      answer: r.answers, used: true, latencyMs: Date.now() - t0, confidence: Math.max(p, 1 - p) }).catch(() => {});
    return p >= DROP_BELOW;
  } catch (e) {
    ctx.logger.warn(`jev signal_relevance ${input.id}: ${(e as Error).message}`);
    return true;
  }
}

/** One signal → one new topic. A failed web check never blocks the topic (signal-only, error returned).
 *  `webCheck: false` (the batch path) leaves the check to ensureMarketContext at draft time, so it is
 *  paid only for topics that get drafted. "Make posts" on Ideas checks at once (it drafts next). */
export async function researchSignal(ctx: ModuleContext, input: ResearchInputRow, opts: { webCheck?: boolean } = {}): Promise<{ topicId: string; checked: boolean; checkError?: string }> {
  let marketContext: string | null = null;
  let checkError: string | undefined;
  if (opts.webCheck !== false) {
    try {
      marketContext = await marketCheck(ctx, input.raw_text);
    } catch (e) {
      checkError = (e as Error).message;
    }
  }
  const raw = await ctx.adapters.claude.complete(
    buildResearchPrompt({ rawText: input.raw_text, channel: input.channel, marketContext }),
    { system: researchSystem(), model: cheapModelOf(ctx) },
  );
  const topic = parseExtractedTopic(raw);
  // Topic + "signal processed" commit together, so a crash can't leave a topic whose signal is drafted again.
  const topicId = await ctx.db.tx(async (q) => {
    const repo = createRepo(q);
    const id = await repo.insertTopic({
      title: topic.title,
      pillar: topic.pillar,
      funnelStage: topic.funnelStage,
      source: input.channel,
      sourceDetail: input.raw_text.slice(0, 500),
      customerLanguage: topic.customerLanguage,
      marketContext,
      status: 'new',
    });
    await repo.markResearchProcessed(input.id, id);
    return id;
  });
  return { topicId, checked: !!marketContext, checkError };
}

export const researchModule: Module = {
  id: 'research',
  title: 'Research Collector',
  description: 'Drops off-audience signals (Jev), turns the rest into ranked-queue topics via a cheap LLM (Bible §6). The web check waits until a topic is drafted.',

  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const repo = createRepo(ctx.db);
    const inputs = await repo.unprocessedResearchInputs();
    if (inputs.length === 0) return ok(0, 'no new research signals to process');
    if (!ctx.adapters.claude.configured) {
      return degraded(`${inputs.length} signal(s) waiting but no LLM configured`, { waiting: inputs.length });
    }

    let created = 0;
    let dropped = 0;
    const failures: string[] = [];
    await mapLimit(inputs, MODEL_CONCURRENCY, async (input) => {
      try {
        if (!(await relevant(ctx, input))) {
          if (await repo.dropResearchInput(input.id)) dropped++;
          return;
        }
        await researchSignal(ctx, input, { webCheck: false });
        created++;
      } catch (e) {
        failures.push(`${input.id}: ${(e as Error).message}`);
        await repo.noteFailure('research_inputs', input.id, (e as Error).message);
      }
    });

    return {
      status: failures.length > 0 ? 'degraded' : 'ok',
      itemsProcessed: created,
      message: `${created} topic(s) created from ${inputs.length} signal(s)` + (dropped ? `, ${dropped} dropped as off-audience` : '')
        + (failures.length ? `, ${failures.length} failed` : ''),
      meta: { created, dropped, failures },
    };
  },
};
