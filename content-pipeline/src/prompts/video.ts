// Video analysis: why a (competitor's) video worked, whether it suits the brand, and two
// ideas for the brand built on the same proven hook, structure and CTA.
import { brand, type Brand } from '../brand.ts';
import { brandBrief } from './brand-context.ts';
import { HOOK_PATTERN_KEYS } from '../hook-patterns.ts';
import { CTA_TYPES } from './decode.ts';
import { DRAFT_PLATFORMS, SCRIPT_TARGETS } from './platform-playbooks.ts';

export const videoAnalysisSystem = (b: Brand = brand()) => `You are a short-form video strategist for ${b.name}.
You explain WHY a video worked in mechanisms (attention, tension, payoff, proof), not adjectives, and you turn
what worked into ideas this brand can actually make, in its own voice. You never copy words, stories, names or
numbers; you reuse STRUCTURE. Reply with JSON only.
${brandBrief(b)}`;

export interface VideoInput {
  platform: string; durationS: number | null; caption: string; transcript: string;
  creator: string | null; views: number | null; vsUsual: number | null; reactions: number; comments: number;
}

export function buildVideoAnalysisPrompt(v: VideoInput): string {
  const perf = [v.views != null && `${v.views} views`, v.vsUsual != null && `${v.vsUsual}x the creator's usual`,
    `${v.reactions} reactions`, `${v.comments} comments`].filter(Boolean).join(', ');
  return `A ${v.platform} video${v.durationS ? ` (${v.durationS}s)` : ''}${v.creator ? ` by ${v.creator}` : ''} that performed: ${perf}.

CAPTION:
${v.caption.slice(0, 1500) || '(none)'}

TRANSCRIPT:
${v.transcript.slice(0, 6000)}

Analyse it, then give exactly TWO ideas for our brand that reuse what made it work (its hook type,
its beat structure, its CTA type), on a subject from our pillars, in our voice, for our audience.
Ideas must be specific enough to film or write tomorrow: a real opening line, the beats in order,
the closing ask. Never reuse their words, story, names or numbers.

Respond with ONLY JSON:
{ "whyItWorked": "2-3 sentences on the mechanism",
  "hook": { "text": "their opening line", "type": one of ${JSON.stringify(HOOK_PATTERN_KEYS)}, "why": "why it stops the scroll" },
  "structure": [ { "beat": "what happens", "purpose": "what it does for the viewer" } ],
  "cta": { "text": "their closing ask, or \\"\\"", "type": one of ${JSON.stringify(CTA_TYPES)} },
  "retention": [ "devices that keep people watching (open loops, pattern breaks, on-screen text…)" ],
  "verdict": "use" | "adapt" | "skip",
  "verdictWhy": "one sentence: good or bad for our brand, and why",
  "adapt": [ "parts we can reuse" ],
  "avoid": [ "parts that would not suit our brand or that we cannot back up" ],
  "ideas": [ { "title": string, "hook": "our opening line", "beats": [string], "cta": string,
               "platforms": subset of ${JSON.stringify([...DRAFT_PLATFORMS, ...Object.keys(SCRIPT_TARGETS)])},
               "why": "which proven element it reuses" } ] }`;
}
