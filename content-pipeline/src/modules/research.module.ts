// Research Collector (Bible §6) — never create from a blank page. Turns each raw
// research signal in content.research_inputs (a prospect question, a community pain
// point, a note) into a candidate topic with status 'new', which the Topic Scorer
// then ranks. Question mining is the unfair advantage: real signals → real topics.
import type { Module, ModuleContext, ModuleResult } from './module.ts';
import { ok, degraded } from './module.ts';
import { createRepo } from '../db/repo.ts';
import {
  researchSystem, buildResearchPrompt, MARKET_CHECK_SYSTEM, buildMarketCheckPrompt,
  MARKET_CHECK_SOURCES_SYSTEM, buildMarketCheckFromSources,
} from '../prompts/brand-brain.ts';
import { parseExtractedTopic } from './topic-extract.ts';

const DEFAULT_RESEARCH_MODEL = 'perplexity/sonar';
const YEAR_MINUTES = 365 * 24 * 60;

/**
 * Web check from free TinyFish Search (last 12 months) + Fetch of the top 3 pages; our own LLM
 * writes the check from that text, so every cited URL is one we actually loaded. null = no results.
 */
export async function tinyfishMarketCheck(ctx: ModuleContext, signal: string): Promise<string | null> {
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

export const researchModule: Module = {
  id: 'research',
  title: 'Research Collector',
  description: 'Turns raw research signals (research_inputs) into ranked-queue topics via the LLM (Bible §6).',

  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const repo = createRepo(ctx.db);
    const inputs = await repo.unprocessedResearchInputs();
    if (inputs.length === 0) return ok(0, 'no new research signals to process');
    if (!ctx.adapters.claude.configured) {
      return degraded(`${inputs.length} signal(s) waiting but no LLM configured`, { waiting: inputs.length });
    }

    // Live web check: "tinyfish" = free TinyFish Search + Fetch, then our LLM; any other value is
    // an OpenRouter model with built-in web search (Perplexity). "off" skips it.
    const researchModel = ctx.env.researchModel ?? DEFAULT_RESEARCH_MODEL;
    const viaTinyfish = researchModel === 'tinyfish';
    const webCheck = viaTinyfish ? ctx.adapters.tinyfish.configured
      : ctx.adapters.claude.provider === 'openrouter' && researchModel !== 'off';

    let created = 0;
    let checked = 0;
    const failures: string[] = [];
    const checkFailures: string[] = [];
    for (const input of inputs) {
      try {
        // A failed web check never blocks the topic: it falls back to signal-only.
        let marketContext: string | null = null;
        if (webCheck) {
          try {
            marketContext = viaTinyfish
              ? await tinyfishMarketCheck(ctx, input.raw_text)
              : (await ctx.adapters.claude.complete(buildMarketCheckPrompt(input.raw_text), {
                system: MARKET_CHECK_SYSTEM, model: researchModel, maxTokens: 800,
              })).trim() || null;
            if (marketContext) checked++;
          } catch (e) {
            checkFailures.push(`${input.id}: ${(e as Error).message}`);
          }
        }
        const raw = await ctx.adapters.claude.complete(
          buildResearchPrompt({ rawText: input.raw_text, channel: input.channel, marketContext }),
          { system: researchSystem() },
        );
        const topic = parseExtractedTopic(raw);
        const topicId = await repo.insertTopic({
          title: topic.title,
          pillar: topic.pillar,
          funnelStage: topic.funnelStage,
          source: input.channel,
          sourceDetail: input.raw_text.slice(0, 500),
          customerLanguage: topic.customerLanguage,
          marketContext,
          status: 'new',
        });
        await repo.markResearchProcessed(input.id, topicId);
        created++;
      } catch (e) {
        failures.push(`${input.id}: ${(e as Error).message}`);
      }
    }

    return {
      status: failures.length + checkFailures.length > 0 ? 'degraded' : 'ok',
      itemsProcessed: created,
      message: `${created} topic(s) created from ${inputs.length} signal(s)` + (failures.length ? `, ${failures.length} failed` : '')
        + (webCheck ? `; web-checked ${checked}` + (checkFailures.length ? `, ${checkFailures.length} web check(s) failed` : '') : ''),
      meta: { created, failures, webChecked: checked, checkFailures },
    };
  },
};
