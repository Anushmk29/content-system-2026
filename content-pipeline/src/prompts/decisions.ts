// Prompts for the typed decisions (topic score, QC signals) and the research steps that feed them.
// The Jev questions in modules/decision-tasks.ts mirror scoringSystem / qcSystem — keep them in sync.
import { FUNNEL_STAGES } from '../../core/src/index.ts';
import { brand, pillarSlugs, type Brand } from '../brand.ts';
import { who, teamLine, brandBrief } from './brand-context.ts';

// === Topic Scorer (Bible §7) ================================================
export const scoringSystem = (b: Brand = brand()) => `You score content topics for ${who(b)} on five
1-5 factors (Bible §7). Be honest and conservative — never inflate a score.
${brandBrief(b)}
- leadIntent: is this close to a problem people pay to solve?
- reach: is there real demand, and is it not already flooded with near-identical takes?
- brandFit: does it fit our voice and our audience?
- proof: do we have a real edge — first-hand data or experience, a contrarian-but-correct
  view, or making something complex plain? "More complete than others" is not an edge.
  No edge or no real example/metric to back it: score LOW.
- repurpose: can it become a LinkedIn post + blog + X thread + Instagram carousel + Facebook post?
The honest-numbers rule: a topic we can't prove must score low on proof.
When a MARKET CHECK is given, base reach on its DEMAND and ALREADY SAID evidence.
Facts found on the web are not OUR proof — they never lift the proof score.`;

/** `state` is the same text Jev sees (decision-tasks.ts), so the two are compared like for like. */
export function buildScorePrompt(state: string): string {
  return `Score this topic. Respond with ONLY JSON:
{ "leadIntent": 1-5, "reach": 1-5, "brandFit": 1-5, "proof": 1-5, "repurpose": 1-5,
  "pillar": one of ${JSON.stringify(pillarSlugs())},
  "funnelStage": one of ${JSON.stringify(FUNNEL_STAGES)} }

${state}`;
}

// === Market check (live web, Perplexity Sonar via OpenRouter) ===============
// Runs before topic extraction so reach/proof are scored on evidence, not a guess.
export const MARKET_CHECK_SYSTEM = `You are a market researcher with live web search. Report
only what you actually find, with the source URL next to each point. If you find nothing
for a section, write "none found" — never guess or fill gaps. Plain text, no preamble.`;

export function buildMarketCheckPrompt(signal: string): string {
  return `A content team (${teamLine()}) is considering
a piece based on this signal:

${signal}

Search the web (last 12 months) and answer in under 250 words:
DEMAND: evidence people are asking about this now (forums, searches, questions).
ALREADY SAID: the 3-5 most common takes already published, one line each.
GAP: what those takes miss or get wrong.
FACTS: up to 3 recent, specific facts or numbers.
Put the source URL after every point.`;
}

// Same check, but answered from pages we fetched ourselves (TinyFish Search + Fetch) instead
// of the model's own web search — so every URL is one we actually loaded.
export const MARKET_CHECK_SOURCES_SYSTEM = `You are a market researcher. Use ONLY the numbered sources
you are given; never add facts or URLs from memory. Put the source URL after each point. If the
sources say nothing for a section, write "none found". Plain text, no preamble.`;

export function buildMarketCheckFromSources(signal: string, sources: string): string {
  return `A content team (${teamLine()}) is considering
a piece based on this signal:

${signal}

Sources (web search, last 12 months; the top ones with their page text):

${sources}

From these sources only, answer in under 250 words:
DEMAND: evidence people are asking about this now (forums, searches, questions).
ALREADY SAID: the 3-5 most common takes already published, one line each.
GAP: what those takes miss or get wrong.
FACTS: up to 3 recent, specific facts or numbers.
Put the source URL after every point.`;
}

// === Research Collector (Bible §6) ==========================================
export const researchSystem = (b: Brand = brand()) => `You convert ONE raw research signal (a real prospect
question, a community pain point, a competitor angle, an internal note) into ONE
content topic for ${who(b)}. Stay grounded in the signal — do NOT invent a topic that isn't
supported by it. Prefer the customer's own words. Frame the title as something useful to
this audience, not clickbait.
${brandBrief(b)}`;

export function buildResearchPrompt(input: { rawText: string; channel?: string | null; marketContext?: string | null }): string {
  return `Turn this signal into one topic. Respond with ONLY JSON:
{ "title": string,
  "pillar": one of ${JSON.stringify(pillarSlugs())},
  "funnelStage": one of ${JSON.stringify(FUNNEL_STAGES)},
  "customerLanguage": string (the prospect's own words, or "") }

CHANNEL: ${input.channel ?? 'unknown'}
SIGNAL: ${input.rawText.slice(0, 8000)}${input.marketContext ? `

MARKET CHECK (live web): angle the title at the GAP, not at what is ALREADY SAID.
${input.marketContext}` : ''}`;
}

// === QC signals (Bible §10, prompts/qc-checklist.md) ========================
// Only the risk SIGNALS — the lane itself is computed by the tested core logic.
export const qcSystem = (b: Brand = brand()) => `You are the QC risk checker for ${b.name}'s content (Bible §10).
Read one draft and answer yes/no for each risk signal. When in doubt, answer true:
a false alarm only costs a founder review; a miss can publish something risky.`;

export function buildQcPrompt(state: string): string {
  return `Check this draft. Respond with ONLY JSON, every value true or false:
{ "hasClientClaim": names or describes a specific client's results or story,
  "hasMetric": states a number, percentage, revenue, time saved or other metric,
  "isControversialOpinion": takes a strong stance many people would push back on,
  "isCaseStudy": walks through a real project or client engagement,
  "isCompetitorComparison": compares us with a named competitor or tool,
  "isNewPositioning": introduces a new offer, price, audience or way we describe ourselves,
  "mentionsFaceOrVoice": relies on the founder's face, voice or personal appearance }

${state}`;
}

// === Seed QC examples (docs/development/DECISION-DATASET.md §4c) ========================
// Practice drafts so the QC checks have training examples before real history
// exists. Each is reviewed by the operator before it is ever trained on.
export const seedQcSystem = (b: Brand = brand()) => `You write realistic short social drafts for ${who(b)} to train a content-risk checker. Make them varied
and believable, including subtle and borderline cases, not cartoon examples.`;

export function buildSeedQcPrompt(n: number): string {
  return `Write ${n} different drafts. About half should be safe (no risk signals) and half should
carry one or more signals; across the set, cover every signal at least once, including subtle
cases. Mix platforms. Bodies 40-150 words. Label each draft's signals honestly.
Respond with ONLY JSON:
{ "examples": [ { "platform": "linkedin" | "blog" | "x" | "instagram" | "facebook",
                  "format": "founder_post" | "article" | "thread" | "carousel",
                  "title": string, "body": string,
                  "signals": { "hasClientClaim": bool, "hasMetric": bool, "isControversialOpinion": bool,
                               "isCaseStudy": bool, "isCompetitorComparison": bool,
                               "isNewPositioning": bool, "mentionsFaceOrVoice": bool } } ] }
Signal meanings: hasClientClaim = a specific client's results or story; hasMetric = any number,
percentage, revenue or time saved; isControversialOpinion = a stance many would push back on;
isCaseStudy = walks through a real engagement; isCompetitorComparison = compares with a named
competitor or tool; isNewPositioning = a new offer, price, audience or self-description;
mentionsFaceOrVoice = relies on the founder's face, voice or appearance.`;
}

// === Platform fit (which platforms an idea suits) ============================
// The Jev questions in modules/decision-tasks.ts (platformQuestions) mirror this wording.
export const platformFitSystem = (b: Brand = brand()) => `You decide which platforms a content idea suits for ${who(b)}.
Judge native fit on each platform: the format it needs, how this audience uses the platform, and
the tone there. Be selective: most ideas suit 2-4 platforms, not all of them.
${brandBrief(b)}`;

export function buildPlatformFitPrompt(
  state: string, platforms: Record<string, { piece: string; formats: string[]; frameworks: string[] }>,
): string {
  const choosy = Object.entries(platforms).filter(([, o]) => o.formats.length || o.frameworks.length);
  return `For each platform, give the probability (0 to 1) that this idea would work natively there.
${Object.entries(platforms).map(([p, o]) => `- ${p}: as a ${o.piece}`).join('\n')}
Then, for each platform below, pick the post format and the writing structure that suit this idea best:
${choosy.map(([p, o]) => `- ${p}:${o.formats.length ? ` formats ${o.formats.join(', ')};` : ''}${o.frameworks.length ? ` structures ${o.frameworks.join(', ')}` : ''}`).join('\n')}
Respond with ONLY JSON: { ${Object.keys(platforms).map((p) => `"${p}": number`).join(', ')}, "picks": { ${choosy.map(([p]) => `"${p}": { "format": id, "framework": id }`).join(', ')} } }

${state}`;
}
