// The typed decisions (topic scoring, QC signals). Each is ONE definition:
// the input text both models see, the Jev questions + answer mapper, the LLM prompt +
// parser, and an optional no-model rule. decide.ts routes between them; modules and the
// dataset service only ever pass a definition + a subject.
// The Jev question wording mirrors scoringSystem / qcSystem in
// prompts/decisions.ts; keep them in sync or the shadow comparison stops being apples-to-apples.
import type { JevAnswer, JevQuestion, JevRule } from '../adapters/jev.ts';
import { HOOK_PATTERNS } from '../hook-patterns.ts';
import { isFunnelStage, clamp1to5, type FunnelStage } from '../../core/src/index.ts';
import { brand, pillarSlugs } from '../brand.ts';
import { parseTopicScore, type ParsedTopicScore } from './score-parse.ts';
import { QC_SIGNAL_KEYS, parseQcSignals, type QcSignals } from './qc-parse.ts';
import { scoringSystem, buildScorePrompt, qcSystem, buildQcPrompt, platformFitSystem, buildPlatformFitPrompt } from '../prompts/decisions.ts';
import { DRAFT_PLATFORMS, PIECE_NAME, POST_FORMATS, PLATFORM_FRAMEWORKS, type DraftPlatform } from '../prompts/platform-playbooks.ts';
import { parseJsonObject } from './llm-json.ts';
import { VALUE_STRUCTURES, CTA_TYPES } from '../prompts/decode.ts';

export type DecisionTask = 'topic_score' | 'qc_signals' | 'platform_fit';

export interface DecisionTaskDef<S, T> {
  task: DecisionTask;
  /** The exact text Jev, the LLM and the dataset see for this subject. */
  state(subject: S): string;
  questions: Record<string, JevQuestion>;
  fromJev(answers: Record<string, JevAnswer>): T;
  system: string;
  prompt(state: string): string;
  /** LLM text → answer. `subject` is absent for hand labels. */
  parse(raw: string, subject?: S): T;
  /** When Jev answers first for this task, use its answer at any confidence (low-risk decisions
   *  the operator sees and can change). Jev's confidences run low even when it agrees with the LLM. */
  trustJev?: boolean;
}

/** "<brand> writes for: … stands for: …" — the brand line every Jev question starts with. */
export const audience = () => {
  const b = brand();
  return `${b.name} writes for: ${b.audience.split('\n')[0]}${b.values.length ? ` ${b.name} stands for: ${b.values.join('; ')}.` : ''}`;
};

const scale = (instructions: string, low: string, high: string): JevQuestion => ({
  type: 'score',
  instructions: `${audience()} ${instructions} Score conservatively; never inflate.`,
  criteria: [`1 - ${low}`, '2', '3', '4', `5 - ${high}`],
});

/** Built per call: the audience line and the pillar choices come from the saved brand. */
export const topicQuestions = (): Record<string, JevQuestion> => ({
  leadIntent: scale('Is this topic close to a problem people pay to solve?', 'idle curiosity', 'a problem buyers actively pay to fix'),
  reach: scale('Is there real demand for this topic, and is it not already flooded with near-identical takes? Use the MARKET CHECK evidence when present.', 'no demand or saturated', 'strong demand, few good takes'),
  brandFit: scale('Does it fit our brand voice and our audience?', 'off-brand or hype', 'exactly on-brand'),
  proof: scale('Do we have a real edge (first-hand data or experience, a contrarian-but-correct view, or making something complex plain) and real proof? "More complete than others" is not an edge; facts found on the web are not our proof. If not, it is low.', 'no edge or no provable example', 'clear edge and real proof'),
  repurpose: scale('Can it become a LinkedIn post + blog + X thread + Instagram carousel + Facebook post?', 'one format only', 'works in every format'),
  pillar: {
    type: 'choice',
    instructions: 'Which content pillar does this topic belong to?',
    criteria: Object.fromEntries(pillarSlugs().map((slug) => {
      const p = brand().pillars.find((x) => x.slug === slug);
      return [slug, p?.description || p?.label || slug];
    })),
  },
  funnelStage: {
    type: 'choice',
    instructions: 'Which funnel stage does this topic serve?',
    criteria: {
      awareness: 'Reader does not know the problem yet',
      education: 'Reader knows the problem, learning the options',
      trust: 'Reader needs proof we are credible',
      consideration: 'Reader is comparing ways to solve it',
      conversion: 'Reader is ready to buy or book a call',
      retention: 'Existing client, keep them successful',
    } satisfies Record<FunnelStage, string>,
  },
});

const yesNo = (instructions: string): JevQuestion => ({
  type: 'noul',
  instructions: `${instructions} When in doubt, answer yes: a false alarm only costs a founder review.`,
});

// Same seven signals and wording as qcSystem / buildQcPrompt in prompts/decisions.ts.
const QC_QUESTIONS: Record<(typeof QC_SIGNAL_KEYS)[number], JevQuestion> = {
  hasClientClaim: yesNo("Does the draft name or describe a specific client's results or story?"),
  hasMetric: yesNo('Does it state a number, percentage, revenue, time saved or other metric?'),
  isControversialOpinion: yesNo('Does it take a strong stance many people would push back on?'),
  isCaseStudy: yesNo('Does it walk through a real project or client engagement?'),
  isCompetitorComparison: yesNo('Does it compare us with a named competitor or tool?'),
  isNewPositioning: yesNo('Does it introduce a new offer, price, audience or way we describe ourselves?'),
  mentionsFaceOrVoice: yesNo("Does it rely on the founder's face, voice or personal appearance?"),
};

// ponytail: fixed 0.5 cut-off; lower it if reviews show Jev missing real risks.
export const qcSignalsFromJev = (a: Record<string, JevAnswer>): QcSignals =>
  Object.fromEntries(QC_SIGNAL_KEYS.map((k) => [k, (a[k]?.noul ?? 0) >= 0.5])) as QcSignals;

/** Jev score answers are a 0-based fractional level index; our scales are 1-5. */
const level = (a: JevAnswer | undefined) => clamp1to5(1 + Math.round(a?.score ?? 0));

/** One answer's confidence: the reported one, else how far a yes/no leans, else the top probability. */
const answerConfidence = (a: JevAnswer): number =>
  a.confidence
  ?? (a.noul !== undefined ? Math.max(a.noul, 1 - a.noul)
    : a.probabilities ? Math.max(0, ...Object.values(a.probabilities)) : 0);

/** Weakest answer's confidence — one shaky answer means the whole decision is shaky. */
export function minConfidence(answers: Record<string, JevAnswer>): number {
  const cs = Object.values(answers).map(answerConfidence);
  return cs.length ? Math.min(...cs) : 0;
}

export function topicScoreFromJev(a: Record<string, JevAnswer>): ParsedTopicScore {
  const out: ParsedTopicScore = {
    leadIntent: level(a.leadIntent), reach: level(a.reach), brandFit: level(a.brandFit),
    proof: level(a.proof), repurpose: level(a.repurpose),
  };
  const p = a.pillar?.choice, f = a.funnelStage?.choice;
  if (p && pillarSlugs().includes(p)) out.pillar = p;
  if (isFunnelStage(f)) out.funnelStage = f;
  return out;
}

type TopicSubject = { title: string; source?: string | null; customer_language?: string | null; market_context?: string | null };

// Market check capped so scoring cost stays flat and the text fits Jev's context.
const topicState = (t: TopicSubject) =>
  [`TOPIC: ${t.title}`, t.source && `SOURCE: ${t.source}`, t.customer_language && `CUSTOMER LANGUAGE: ${t.customer_language}`,
   t.market_context && `MARKET CHECK (live web):\n${t.market_context.slice(0, 2000)}`]
    .filter(Boolean).join('\n');

// Body capped so a long blog stays well inside Jev's context and costs stay flat.
const qcState = (i: { platform: string; format: string; title: string; hook?: string | null; body?: string | null; cta?: string | null }) =>
  [`PLATFORM: ${i.platform} (${i.format})`, `TITLE: ${i.title}`, i.hook && `HOOK: ${i.hook}`,
   `BODY:\n${(i.body ?? '').slice(0, 8000)}`, i.cta && `CTA: ${i.cta}`].filter(Boolean).join('\n');

export const TOPIC_SCORE: DecisionTaskDef<TopicSubject, ParsedTopicScore> = {
  task: 'topic_score', state: topicState, fromJev: topicScoreFromJev, trustJev: true,
  get questions() { return topicQuestions(); },
  get system() { return scoringSystem(); },
  prompt: buildScorePrompt, parse: (raw) => parseTopicScore(raw),
};

export const QC_SIGNALS: DecisionTaskDef<Parameters<typeof qcState>[0], QcSignals> = {
  task: 'qc_signals', state: qcState, questions: QC_QUESTIONS, fromJev: qcSignalsFromJev,
  get system() { return qcSystem(); },
  prompt: buildQcPrompt, parse: (raw) => parseQcSignals(raw),
};

export const DECISION_TASKS: Record<DecisionTask, DecisionTaskDef<never, unknown>> = {
  topic_score: TOPIC_SCORE, qc_signals: QC_SIGNALS,
  get platform_fit() { return PLATFORM_FIT as DecisionTaskDef<never, unknown>; },
};

// ---- competitor posts (Decode → hunt score) ----------------------------------------
// Jev-only (no LLM teacher: it runs on every scraped post). Built per call from the Brand Kit,
// so lanes, ICP and the creator profile are this install's own. Wording adapted from
// competitor-hunter's jev/competitor-hunt.json (MIT, Charles Dove).
export const competitorPostQuestions = (): Record<string, JevQuestion> => {
  const b = brand();
  const lanes = Object.fromEntries(pillarSlugs().map((slug) => {
    const p = b.pillars.find((x) => x.slug === slug);
    return [slug, p?.description || p?.label || slug];
  }));
  return {
    lane: {
      type: 'choice',
      instructions: `Which of ${b.name}'s content lanes does this post's topic belong to?`,
      criteria: { ...lanes, adjacent: 'Related to our audience but none of our lanes', off_niche: 'Unrelated to our audience' },
    },
    icp_fit: {
      type: 'score',
      instructions: `${audience()} How much would that audience care about this post's topic?`,
      criteria: ['not at all', 'a little', 'clearly relevant', 'exactly their problem'],
    },
    hook_type: { type: 'choice', instructions: 'Which kind of hook does the post open with?', criteria: { ...HOOK_PATTERNS } },
    proof: {
      type: 'score',
      instructions: 'How much concrete proof does the post show (numbers, screenshots, named results, a demo)?',
      criteria: ['none, pure opinion', 'vague claims', 'some specifics', 'hard proof'],
    },
    replicable: { type: 'noul', instructions: `Could ${b.name} make its own version of this post with its own experience, without copying it?` },
    sponsored: { type: 'noul', instructions: 'Is this post paid, sponsored, an ad or a paid partnership?' },
    news_pegged: { type: 'noul', instructions: 'Does the post depend on a specific recent news event or launch?' },
  };
};

export const COMPETITOR_RULES: JevRule[] = [{ when: { question: 'sponsored', noul_gte: 0.8 }, set: { paid: true } }];

export const competitorState = (p: { platform: string; post_type: string; duration_s: number | null; caption: string; transcript?: string | null }) =>
  [`PLATFORM: ${p.platform} (${p.post_type}${p.duration_s ? `, ${p.duration_s}s` : ''})`,
   `CAPTION:\n${p.caption.slice(0, 3000)}`,
   p.transcript && `TRANSCRIPT (start):\n${p.transcript.slice(0, 1500)}`,
   `OUR PROFILE: ${brand().name}${brand().tagline ? ` — ${brand().tagline}` : ''}. ${audience()}`].filter(Boolean).join('\n');

// ---- Decode skeleton (Jev decides; the LLM still writes the hook quote and the beats) ----

const VALUE_STRUCTURE_CRITERIA = {
  steps: 'Numbered or ordered steps the reader can follow',
  single_insight: 'One idea or lesson, explained',
  framework: 'A named model, matrix or mental framework',
  story: 'A personal or client story with a turn',
  listicle: 'A list of tips, tools or examples',
  transformation: 'Before and after: where someone was, what changed, where they are now',
} satisfies Record<(typeof VALUE_STRUCTURES)[number], string>;

const CTA_CRITERIA = {
  follow: 'Asks the reader to follow the account',
  comment: 'Asks for a comment or a reply',
  dm: 'Asks the reader to send a direct message',
  link: 'Points to a link (bio, site, article)',
  lead_magnet: 'Offers a free resource in exchange for a comment, DM or sign-up',
  none: 'No call to action',
} satisfies Record<(typeof CTA_TYPES)[number], string>;

/** One run's formats (f1, f2 … in list order) plus value structure and CTA. */
export const skeletonQuestions = (formats: Array<{ name: string; description: string }>): Record<string, JevQuestion> => ({
  ...(formats.length ? { format: {
    type: 'choice', instructions: 'Which recurring content format does this post follow?',
    criteria: { ...Object.fromEntries(formats.map((f, i) => [`f${i + 1}`, `${f.name}: ${f.description}`])), none: 'None of these formats' },
  } satisfies JevQuestion } : {}),
  value_structure: { type: 'choice', instructions: 'How does this post deliver its value?', criteria: VALUE_STRUCTURE_CRITERIA },
  cta_type: { type: 'choice', instructions: 'What does the end of this post ask the reader to do?', criteria: CTA_CRITERIA },
});

/** Jev's confident skeleton answers; a field is absent when Jev was unsure (the LLM's pick stays). */
export function skeletonFromJev(a: Record<string, JevAnswer>, minConf: number): { format?: number | null; valueStructure?: string; ctaType?: string } {
  const sure = (k: string) => a[k]?.choice && minConfidence({ [k]: a[k]! }) >= minConf ? a[k]!.choice! : undefined;
  const f = sure('format');
  return {
    ...(f !== undefined ? { format: f === 'none' ? null : Number(f.slice(1)) || null } : {}),
    ...(sure('value_structure') ? { valueStructure: sure('value_structure') } : {}),
    ...(sure('cta_type') ? { ctaType: sure('cta_type') } : {}),
  };
}

// ---- Platform fit: which platforms an idea suits, and Jev's format + writing structure on each
// (scoring module, behind CONTENT_PLATFORM_FIT). The idea card shows this as Jev's plan; the
// operator only changes it when they disagree. A new format or framework is just one more choice.

export interface PlatformPick { format: string; framework: string }
export type PlatformFit = Partial<Record<DraftPlatform, number>> & { picks?: Partial<Record<DraftPlatform, PlatformPick>> };

const FORMAT_HINT: Record<string, string> = {
  post: 'a text post: the idea lands in words alone',
  article: 'a long article',
  thread: 'a thread: several linked points',
  carousel: 'a slide carousel: steps, a list or a before/after people save',
  image: 'a single image with a headline: one sharp line carries the whole idea',
  short: 'a short video script',
};
const hasChoice = (p: DraftPlatform) => POST_FORMATS[p].length > 1 || PLATFORM_FRAMEWORKS[p].length > 1;

const platformQuestions = (): Record<string, JevQuestion> => Object.fromEntries(DRAFT_PLATFORMS.flatMap((p) => [
  [p, {
    type: 'noul',
    instructions: `${audience()} Would this idea work natively as a ${PIECE_NAME[p]}? Consider the format it needs, how this audience uses ${p}, and the tone there.`,
    criteria: { true: `A natural ${PIECE_NAME[p]} this audience would engage with`, false: `Forced or off-format as a ${PIECE_NAME[p]}` },
  } satisfies JevQuestion],
  ...(POST_FORMATS[p].length > 1 ? [[`${p}_format`, {
    type: 'choice', instructions: `If this idea is posted on ${p}, which format suits it best?`,
    criteria: Object.fromEntries(POST_FORMATS[p].map((f) => [f.id, FORMAT_HINT[f.id] ?? f.label])),
  } satisfies JevQuestion]] : []),
  ...(PLATFORM_FRAMEWORKS[p].length > 1 ? [[`${p}_framework`, {
    type: 'choice', instructions: `If this idea is posted on ${p}, which writing structure suits it best?`,
    criteria: Object.fromEntries(PLATFORM_FRAMEWORKS[p].map((f) => [f.id, `${f.name}: ${f.steps}`])),
  } satisfies JevQuestion]] : []),
]));

const clamp01 = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0; };
/** A known id, else the platform's default (the first). */
const known = (list: readonly { id: string }[], id: unknown) => (list.some((x) => x.id === id) ? id as string : list[0]!.id);
const toFit = (prob: (p: DraftPlatform) => unknown, format: (p: DraftPlatform) => unknown, framework: (p: DraftPlatform) => unknown): PlatformFit => ({
  ...Object.fromEntries(DRAFT_PLATFORMS.map((p) => [p, Math.round(clamp01(prob(p)) * 100) / 100])),
  picks: Object.fromEntries(DRAFT_PLATFORMS.filter(hasChoice).map((p) => [p, {
    format: known(POST_FORMATS[p], format(p)), framework: known(PLATFORM_FRAMEWORKS[p], framework(p)),
  }])),
});

export const PLATFORM_FIT: DecisionTaskDef<TopicSubject, PlatformFit> = {
  task: 'platform_fit', state: topicState, trustJev: true,
  get questions() { return platformQuestions(); },
  // An unsure format/structure pick (< 0.5) falls back to the platform's proven default.
  fromJev: (a) => {
    const sure = (k: string) => (a[k] && minConfidence({ [k]: a[k]! }) >= 0.5 ? a[k]!.choice : undefined);
    return toFit((p) => a[p]?.noul, (p) => sure(`${p}_format`), (p) => sure(`${p}_framework`));
  },
  get system() { return platformFitSystem(); },
  prompt: (state) => buildPlatformFitPrompt(state, Object.fromEntries(DRAFT_PLATFORMS.map((p) => [p, {
    piece: PIECE_NAME[p],
    formats: POST_FORMATS[p].length > 1 ? POST_FORMATS[p].map((f) => `${f.id} (${FORMAT_HINT[f.id] ?? f.label})`) : [],
    frameworks: PLATFORM_FRAMEWORKS[p].length > 1 ? PLATFORM_FRAMEWORKS[p].map((f) => `${f.id} (${f.name})`) : [],
  }]))),
  parse: (raw) => {
    const o = parseJsonObject(raw);
    const picks = (o.picks && typeof o.picks === 'object' ? o.picks : {}) as Record<string, { format?: unknown; framework?: unknown } | undefined>;
    return toFit((p) => o[p], (p) => picks[p]?.format, (p) => picks[p]?.framework);
  },
};

/** The suggested platforms: the best MAX_PLATFORMS at or above 0.5, in DRAFT_PLATFORMS order; empty
 *  when none. Capped because Jev scores most platforms 0.5-0.85, which would otherwise mean all of them. */
export const MAX_PLATFORMS = 4;
export const suggestedPlatforms = (fit: PlatformFit | null | undefined): DraftPlatform[] => {
  if (!fit) return [];
  const best = DRAFT_PLATFORMS.filter((p) => (fit[p] ?? 0) >= 0.5)
    .sort((a, b) => (fit[b] ?? 0) - (fit[a] ?? 0)).slice(0, MAX_PLATFORMS);
  return DRAFT_PLATFORMS.filter((p) => best.includes(p));
};
