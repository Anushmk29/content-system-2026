// Drafting prompts: the anchor-first content set, hook rewrites, Contrast-Formula angles.
import { FUNNEL_STAGES } from '../../core/src/index.ts';
import { brand, pillarSlugs, type Brand } from '../brand.ts';
import { HOOK_PATTERN_KEYS } from '../hook-patterns.ts';
import { who } from './brand-context.ts';
import { DEFAULT_DRAFT_PLATFORMS, PIECE_NAME, type DraftPlatform } from './platform-playbooks.ts';

interface DraftBriefInput {
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
  /** Hook patterns that work / flop on OUR posts (the learning loop, hook-service.patternAdvice). */
  patternAdvice?: string | null;
  /** The chosen Contrast-Formula angle: the belief the piece flips and the truth it argues. */
  angle?: { belief: string; truth: string; proof_method?: string } | null;
}

/** Build the user prompt that asks for the anchor + its repurposed drafts as JSON. */
export function buildDraftPrompt(input: DraftBriefInput): string {
  const [anchor, ...rest] = input.platforms?.length ? input.platforms : DEFAULT_DRAFT_PLATFORMS;
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
${input.angle ? `ANGLE (Contrast Formula) — the whole set argues this:
COMMON BELIEF the audience holds: ${input.angle.belief}
OUR TRUTH: ${input.angle.truth}${input.angle.proof_method ? `\nHOW TO PROVE IT: ${input.angle.proof_method}` : ''}
Open by naming the belief, then flip it. Never invent proof; any number is a claim.` : ''}
${input.patternAdvice ? `WHAT WORKS FOR US (hook patterns on our own posts, learned from results):
${input.patternAdvice}` : ''}
${input.hooks ? `PROVEN HOOK PATTERNS — openings that beat their account's usual (ours and competitors'):
${input.hooks}
Open every piece with one of these PATTERNS (a confession, a number-first line, a contrarian claim…)
unless none fits the subject: the shape only, never its words, names or numbers. Put that pattern's
[number] in the piece's "hookFrom", or null when you wrote your own.` : ''}

${order}

Respond with ONLY a JSON object (no markdown fences, no prose) of this exact shape:
{
  "pillar": one of ${JSON.stringify(pillarSlugs())},
  "funnelStage": one of ${JSON.stringify(FUNNEL_STAGES)},${brand().offers.length > 1 ? `
  "offer": the [index] of the offer that fits best,` : ''}
${all.map((p) => `  ${`"${p}":`.padEnd(12)} { "title": string, "hook": string, "body": string, "cta": string, "hookPattern": string${input.hooks ? ', "hookFrom": number | null' : ''}, "hookOptions": [{ "hook": string, "pattern": string, "contrast": number, "pattern_strength": number, "platform_fit": number }] },`).join('\n')}
  "claims":   string[]
}
"claims" lists every specific factual/metric/result claim across all the drafts that
would need external proof. Use [] if there are none. Do not invent claims.
"hookPattern" names the kind of opening each piece uses, one of: ${HOOK_PATTERN_KEYS.join(', ')}.
"hookOptions" is 3 different opening lines for that piece (the first is "hook"), each one able to open
the same body, scored 1-10 on contrast (how sharply it flips what the reader assumes), pattern_strength
(how cleanly it follows its pattern) and platform_fit (how native it reads there); "pattern" as above.
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

Write 5 different opening options in that shape, and score each 1-10 on:
- contrast: how sharply it flips what the reader assumes
- pattern: how faithfully it follows the hook pattern's shape
- platform: how native it reads on ${PIECE_NAME[input.platform]}
and name each one's kind, one of: ${HOOK_PATTERN_KEYS.join(', ')}.
Then rewrite the body to flow from the option you score highest.

Respond with ONLY JSON:
{ "options": [{ "hook": string, "pattern": string, "contrast": number, "pattern_strength": number, "platform_fit": number }],
  "best": index of your top option, "body": string }
Every " inside a string value MUST be escaped as \\".`;
}

// === Angles (Contrast Formula) ===============================================
// Adapted from goviralbro's viral-angle prompt (MIT, Charles Dove): an angle = a belief the
// audience holds + the truth we argue instead. The brand's own audience beliefs go first.
export function buildAnglePrompt(topic: { title: string; customer_language?: string | null; market_context?: string | null }, b: Brand = brand()): string {
  return `Find 5 angles for a post on this topic, for ${who(b)}.

TOPIC: ${topic.title}
${topic.customer_language ? `CUSTOMER LANGUAGE: ${topic.customer_language}` : ''}
${topic.market_context ? `MARKET CHECK (what's already being said):\n${topic.market_context.slice(0, 1500)}` : ''}
AUDIENCE: ${b.audience.split('\n')[0] || 'the brand\'s customers'}
${b.audienceBeliefs.length ? `BELIEFS THIS AUDIENCE HOLDS (flip these first when they fit):\n${b.audienceBeliefs.map((x) => `- ${x}`).join('\n')}` : ''}

Each angle = a COMMON BELIEF the audience holds about this topic + the TRUTH we argue instead
(Contrast Formula: belief → truth). Rate strength 1-10: how surprised, and how convinced, the
reader would be. proof_method = how we could prove the truth WITHOUT inventing anything
(our own build, a demo, a public source, a worked example).

Respond with ONLY JSON: {"angles":[{"belief": string, "truth": string, "strength": number, "proof_method": string}]}`;
}
