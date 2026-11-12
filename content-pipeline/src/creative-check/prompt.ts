// The one model call of a Creative Check (PRD CC-15.1): frames/images + copy + measured facts in,
// one JSON report out. Bump PROMPT_VERSION whenever the wording changes (stored per check).
import { MECHANISMS } from './mechanisms.ts';
import { ATTENTION_REASONS, CATEGORIES, TRIGGERS, type AttentionSegment, type Fact, type Mode, type Segment } from './report.ts';

export const PROMPT_VERSION = 'cc-1.1';

export const CHECK_SYSTEM = `You review one social media post BEFORE it is published, for the creator who made it.
You see its frames or images, its spoken words with timestamps, its hook, caption and CTA, facts measured by code, and the brand.

Rules (a validator deletes anything that breaks them):
- Every finding points to a timestamp in seconds ({"start":2.5,"end":4}) inside the video, or to a field ({"field":"hook"|"body"|"cta"} or {"field":"slide","slide":N}).
- A "quote" must be copied exactly from the transcript, hook, caption, CTA or the slide text you read. Leave it out if you aren't quoting.
- Evidence class per finding/trigger: "A" = a measured fact (set "factKey" to the fact's key), "B" = your reading of the content, "C" = a plausible improvement not validated for this audience, "D" = can't tell.
- Science: only attach mechanism ids from the library below. Never write about brain regions, brain activity, hormones or neurotransmitters, and never give percentages.
- Never predict views, likes, CTR, conversions or virality, and never promise outcomes.
- Triggers are "present" in the content; never say what the viewer feels.
- Replacement text keeps the original facts, product details and voice. It may NOT add numbers, testimonials, discounts, scarcity, deadlines, certifications or benefits that aren't in the original or in PROOF. When PROOF holds a specific result, number or quote that would make a vague line stronger, suggest using it.
- PROOF is what the creator says they can show. For every social proof, credibility, urgency or scarcity trigger set "proof":"backed" with "proofQuote" copied exactly from PROOF, or "proof":"unbacked" when PROOF doesn't support that exact claim. A claim in the post that PROOF doesn't back is a finding titled "Unproven claim: …", priority critical.
- Every recommendation names where (a timestamp like "0:02" or a field like "hook"), why, the change, what is uncertain, and an experiment: what to compare and which metric to watch.
- Priority: critical = factual risk, unproven claim, missing CTA on a conversion post, unreadable text, platform limit exceeded; high = blocks the message or the funnel goal; medium = worthwhile but optional; low = style alternative.
- For a weak hook give up to 3 alternative hooks as "replacements". For target "body" each replacement is the complete new caption; for "cta" the complete new CTA.
- Plain words a non-technical creator understands. No overall score.

TRIGGERS (use these names only): ${TRIGGERS.join(', ')}.
ATTENTION REASONS you may add per video segment: ${ATTENTION_REASONS.filter((r) => r !== 'no voice' && r !== 'long static shot').join(', ')}.
MECHANISM LIBRARY (id: cue):
${MECHANISMS.map((m) => `- ${m.id}: ${m.cue}`).join('\n')}

Reply with ONE JSON object, no prose:
{"summary":"2-4 sentences",
 "categories":{${CATEGORIES.map((c) => `"${c}":"good|review|insufficient"`).join(',')}},
 "slides":[{"slide":1,"text":"text you read on the slide"}],
 "firstGlance":{"focus":"","readability":"","clutter":""},
 "attention":[{"segment":0,"reasons":["dense on-screen text"]}],
 "findings":[{"id":"f1","category":"hook|visual|message|story|cta|audience|psychology","title":"","detail":"","at":{"start":0,"end":2},"quote":"","evidence":"A|B|C|D","factKey":"","priority":"critical|high|medium|low","mechanisms":["face_attention"]}],
 "triggers":[{"name":"curiosity","evidence":"quote or frame time","at":"0:01 or hook","role":"","benefit":"","risk":"","suggestion":"","class":"A|B|C|D","proof":"backed|unbacked (claim triggers only)","proofQuote":""}],
 "recommendations":[{"id":"r1","findingIds":["f1"],"target":"hook|body|cta|visual|edit","problem":"","at":"0:00-0:02","why":"","change":"","replacements":[""],"direction":"earlier relevance","uncertainty":"","experiment":"","priority":"high"}],
 "resolved":["ids of previous findings this version fixes"]}
"slides" and "firstGlance" only for images; "attention" only for video. At most 12 findings, 12 triggers, 8 recommendations.`;

const t = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

export interface PromptInput {
  brand: string;
  platform: string; funnelStage: string; mode: Mode;
  hook: string; body: string; cta: string; proof: string;
  facts: Fact[];
  attention: AttentionSegment[];
  transcript: Segment[];
  frameTimes: number[];
  slideCount: number;
  previous: { id: string; category: string; title: string }[];
  limitations: string[];
}

export const BODY_CAP = 6000;

export function buildCheckPrompt(p: PromptInput): string {
  const parts = [
    p.brand,
    `PLATFORM: ${p.platform} · GOAL (funnel stage): ${p.funnelStage} · WHAT YOU SEE: ${p.mode}`,
    `HOOK: ${p.hook || '(none)'}`,
    `CAPTION:\n${p.body.slice(0, BODY_CAP) || '(none)'}`,
    `CTA: ${p.cta || '(none)'}`,
    p.proof.trim() ? `PROOF THE CREATOR CAN SHOW:\n${p.proof.slice(0, 4000)}` : 'PROOF: (none given)',
    `MEASURED FACTS (key: value):\n${p.facts.map((f) => `- ${f.key}: ${f.label} = ${f.value}`).join('\n')}`,
  ];
  if (p.frameTimes.length) parts.push(`FRAMES ATTACHED, in order: ${p.frameTimes.map((s, i) => `#${i + 1} at ${s}s`).join(', ')}`);
  if (p.slideCount) parts.push(`IMAGES ATTACHED: ${p.slideCount}, in slide order (slide 1 first).`);
  if (p.transcript.length) parts.push(`TRANSCRIPT (start-end: words):\n${p.transcript.map((s) => `${t(s.start)}-${t(s.end)}: ${s.text}`).join('\n').slice(0, BODY_CAP)}`);
  if (p.attention.length) parts.push(`VIDEO SEGMENTS (index: start-end s, measured reasons):\n${p.attention.map((a, i) => `${i}: ${a.start}-${a.end} ${a.reasons.join(', ') || '-'}`).join('\n')}`);
  if (p.previous.length) parts.push(`PREVIOUS CHECK FINDINGS (list the ids this version fixes in "resolved"):\n${p.previous.map((f) => `- ${f.id} [${f.category}] ${f.title}`).join('\n')}`);
  if (p.limitations.length) parts.push(`LIMITS OF THIS CHECK: ${p.limitations.join(' ')}`);
  return parts.join('\n\n');
}
