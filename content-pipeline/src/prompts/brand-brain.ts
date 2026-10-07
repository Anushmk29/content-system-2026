// The brand brain. Who we are, who we write for, the voice, pillars and offers come from the
// saved brand kit (brand.ts); the honest-numbers rule, craft and platform rules are fixed.
// Craft rules, topic edge test and test ladder adapted from iamzifei/show-me-the-money
// (CC BY-NC 4.0), restated in our own words.
import { FUNNEL_STAGES } from '../../core/src/index.ts';
import { brand, pillarSlugs, type Brand } from '../brand.ts';

// Ideas come in from X and Reddit (Market Signals); drafts go out to these, LinkedIn = anchor.
export const DRAFT_PLATFORMS = ['linkedin', 'blog', 'x', 'instagram', 'facebook'] as const;
export type DraftPlatform = (typeof DRAFT_PLATFORMS)[number];

/** "Acme (bookkeeping for cafés)" */
const who = (b: Brand) => (b.tagline ? `${b.name} (${b.tagline})` : b.name);

/** The pillar list as prompt lines. */
const pillarLines = (b: Brand) => pillarSlugs(b)
  .map((slug) => b.pillars.find((p) => p.slug === slug) ?? { slug, label: slug, description: '' })
  .map((p) => `- ${p.slug}: ${p.label}${p.description ? ` — ${p.description}` : ''}`).join('\n');

/** The drafting system prompt for this brand. */
export function brandSystem(b: Brand = brand()): string {
  const offers = b.offers.length
    ? b.offers.map((o, i) => `[${i}] ${o.label}${o.primary ? ' (primary — the default)' : ''}: ${o.cta}`).join('\n')
    : 'none yet — end with a soft question or invitation instead of an offer.';
  return `You are the drafting engine for ${who(b)}'s content pipeline.

AUDIENCE — who you write for:
${b.audience || "the brand's customers and prospects"}

VOICE:
${b.voice || 'Clear, practical and specific. No hype.'}
- Proof-aware: NEVER invent metrics, clients, or results.
${b.voiceSamples.length ? `
EXAMPLES OF THE VOICE (match the rhythm and word choice, never copy the content):
${b.voiceSamples.slice(0, 5).map((v) => `<example>\n${v.slice(0, 1200)}\n</example>`).join('\n')}
` : ''}
PILLARS — every piece belongs to one:
${pillarLines(b)}

THE HONEST-NUMBERS RULE (Bible §7/§10.3) — this is critical:
Any specific factual claim that would need external proof — a metric, percentage,
time saved, client result, or revenue figure — MUST be listed in "claims". Do NOT
invent numbers to fill claims; only list claims that genuinely appear in your copy.
If your copy contains no such claims, return an empty "claims" array. Every listed
claim will be blocked from publishing until a human attaches proof.

OFFERS / CTA — use a soft CTA, never pushy. Pick the offer that fits the topic best:
${offers}

CRAFT — how every piece is built:
- One core: before writing, name the single claim the piece makes; every section
  serves it. Say why it works (the mechanism), not just the conclusion. If it is
  correct but flat, say what the reader privately believes but won't say publicly.
- Hooks are statements, never a question you then answer. Strongest signal first.
  A data hook needs a real number; without one, lead with a contrast or a named pain.
- Titles pull at least two levers: a contradiction, an open gap, a cost of inaction,
  the reader's identity, a specific number, or an authority contrast.
- Density: every sentence gives a conclusion or a specific, usable detail — else cut
  it. If a word needs explaining, use a plainer one.
- Thin material (no real number, no before/after, no concrete pain) means a shorter,
  practical piece — never padding.

PER-PLATFORM SHAPE (Bible §11.2) — never the same copy everywhere:
- linkedin: the ANCHOR. One founder-led post, 150-300 words. A strong first line (no
  link in body — LinkedIn suppresses outbound links). Optimize for comments. End with
  a soft CTA. This is the source the others repurpose from.
- blog: a full SEO article expanding the anchor. Clear title, strong intro, concrete
  examples, a short FAQ, and a CTA.
- x: a thread of 5-7 tweets, each under 270 characters. Concise, native, end with a
  question. Separate each tweet with a line containing only "---".
- instagram: a 6-slide carousel that earns saves. Slide 1 is the hook, the last slide
  the CTA; at most 20 words per slide, one idea per slide. Separate each slide with a
  line containing only "---". Put only the slide text in body.
- facebook: a warm, educational post, 80-150 words, slightly more conversational than
  LinkedIn. End with a simple question to invite comments.`;
}

export interface DraftBriefInput {
  topicTitle: string;
  pillarHint?: string | null;
  funnelHint?: string | null;
  customerLanguage?: string | null;
  sourceDetail?: string | null;
  marketContext?: string | null;
  /** Only these platforms, in this order (the first is the anchor). Default: all five. */
  platforms?: readonly DraftPlatform[];
  /** A competitor post whose structure this set copies (Decode → "Make my version"). */
  steal?: string | null;
  /** Numbered proven hooks (see hook-service hookLines); each piece may name the one it used. */
  hooks?: string | null;
}

const PIECE_NAME: Record<DraftPlatform, string> = {
  linkedin: 'LinkedIn post', blog: 'blog article', x: 'X thread', instagram: 'Instagram carousel', facebook: 'Facebook post',
};

/** Build the user prompt that asks for the anchor + its repurposed drafts as JSON. */
export function buildDraftPrompt(input: DraftBriefInput): string {
  const [anchor, ...rest] = input.platforms?.length ? input.platforms : DRAFT_PLATFORMS;
  const all = [anchor!, ...rest];
  const order = rest.length
    ? `Write the ${PIECE_NAME[anchor!]} (anchor) first, then repurpose it into ${rest.map((p) => `the ${PIECE_NAME[p]}`).join(', ').replace(/, ([^,]*)$/, ' and $1')}.`
    : `Write only the ${PIECE_NAME[anchor!]}.`;
  return `Create an anchor-first content set for this topic.

TOPIC: ${input.topicTitle}
${input.pillarHint ? `SUGGESTED PILLAR: ${input.pillarHint}` : ''}
${input.funnelHint ? `SUGGESTED FUNNEL STAGE: ${input.funnelHint}` : ''}
${input.customerLanguage ? `CUSTOMER LANGUAGE (use their words): ${input.customerLanguage}` : ''}
${input.sourceDetail ? `SOURCE / CONTEXT: ${input.sourceDetail}` : ''}
${input.marketContext ? `MARKET CHECK (live web; use it to avoid repeating common takes and to aim at the gap —
any number or fact you take from it is an external claim and goes in "claims"):
${input.marketContext}` : ''}
${input.steal ? `FORMAT TO COPY — a competitor post that worked for them:
${input.steal}
Copy its STRUCTURE: the beat order, the hook pattern, the length and rhythm. Not its words or its subject
(the hook too: same shape, a new sentence, never their phrasing):
pick a subject from our pillars that fits this structure, and write it in our voice, for our audience, with our offer.
Never reuse their numbers, names, clients, results or claims. Any number you write is OUR claim and goes in "claims".` : ''}
${input.hooks ? `PROVEN HOOK PATTERNS — openings that beat their account's usual (ours and competitors'):
${input.hooks}
Where one fits, open a piece with its PATTERN (a confession, a number-first line, a contrarian claim…):
the shape only, never its words, names or numbers. Put that pattern's [number] in the piece's "hookFrom",
or null when you wrote your own.` : ''}

${order}

Respond with ONLY a JSON object (no markdown fences, no prose) of this exact shape:
{
  "pillar": one of ${JSON.stringify(pillarSlugs())},
  "funnelStage": one of ${JSON.stringify(FUNNEL_STAGES)},${brand().offers.length > 1 ? `
  "offer": the [index] of the offer that fits best,` : ''}
${all.map((p) => `  ${`"${p}":`.padEnd(12)} { "title": string, "hook": string, "body": string, "cta": string${input.hooks ? ', "hookFrom": number | null' : ''} },`).join('\n')}
  "claims":   string[]
}
"claims" lists every specific factual/metric/result claim across all the drafts that
would need external proof. Use [] if there are none. Do not invent claims.
This will be parsed with JSON.parse — every " inside a string value (quoting a word,
a customer's phrase, etc.) MUST be escaped as \\". Prefer rewording to avoid quotes
inside body text where possible.`;
}

/** "Rewrite with this hook" (drawer): one piece, a new opening in the shape of a proven hook. */
export function buildHookRewritePrompt(input: {
  platform: DraftPlatform; hook: string; body: string; pattern: string; source: string; lift: number;
}): string {
  return `Rewrite this ${PIECE_NAME[input.platform]} so it opens with the hook PATTERN below. Keep the subject,
the points, the length and the format (lines containing only "---" stay as separators). Change the
opening, and whatever the body needs to flow from it.

HOOK PATTERN (${input.source}, ${input.lift}x their usual): "${input.pattern}"
Copy its shape, never its words, names or numbers. Add no new number, result or claim.

CURRENT HOOK: ${input.hook || '(none)'}
CURRENT BODY:
${input.body}

Respond with ONLY JSON: { "hook": string, "body": string }
Every " inside a string value MUST be escaped as \\".`;
}

// === Topic Scorer (Bible §7) ================================================
export const scoringSystem = (b: Brand = brand()) => `You score content topics for ${who(b)} on five
1-5 factors (Bible §7). Be honest and conservative — never inflate a score.
AUDIENCE: ${b.audience}
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
const teamLine = (b: Brand = brand()) => `${who(b)}, writing for: ${b.audience.split('\n')[0]}`;
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
AUDIENCE: ${b.audience}
PILLARS:
${pillarLines(b)}`;

export function buildResearchPrompt(input: { rawText: string; channel?: string | null; marketContext?: string | null }): string {
  return `Turn this signal into one topic. Respond with ONLY JSON:
{ "title": string,
  "pillar": one of ${JSON.stringify(pillarSlugs())},
  "funnelStage": one of ${JSON.stringify(FUNNEL_STAGES)},
  "customerLanguage": string (the prospect's own words, or "") }

CHANNEL: ${input.channel ?? 'unknown'}
SIGNAL: ${input.rawText}${input.marketContext ? `

MARKET CHECK (live web): angle the title at the GAP, not at what is ALREADY SAID.
${input.marketContext}` : ''}`;
}

// === Weekly Review (Bible §14.1) ============================================
export const reviewSystem = (b: Brand = brand()) => `You are the weekly review agent for ${b.name}'s content
pipeline (Bible §14.1). Given the week's performance roll-up, recommend what to double
down on, what to stop, and what to turn into next week's topics or an offer page. Be
specific and practical. Recommendations become operator todos, so phrase each as an action.
Judge each piece against this account's own median, not raw numbers; saves and qualified
comments count more than likes. A topic that beat the median moves up one format
(Facebook post → LinkedIn post → Instagram carousel → video). Name any topic that
underperformed twice and recommend dropping it.`;

export function buildReviewPrompt(performanceSummary: string): string {
  return `Here is this period's performance roll-up (per published item: "x your usual" = likes over
this account's own median on that platform, when known; reach; engagement = likes + comments + shares;
qualified engagement) plus pillar usage:

${performanceSummary}

Respond with ONLY JSON:
{ "summary": string (2-3 sentences),
  "recommendations": string[] (3-7 concrete actions for next week) }`;
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

// === Seed QC examples (docs/DECISION-DATASET.md §4c) ========================
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
