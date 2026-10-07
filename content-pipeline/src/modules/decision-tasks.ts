// The typed decisions (topic scoring, QC signals). Each is ONE definition:
// the input text both models see, the Jev questions + answer mapper, the LLM prompt +
// parser, and an optional no-model rule. decide.ts routes between them; modules and the
// dataset service only ever pass a definition + a subject.
// The Jev question wording mirrors scoringSystem / qcSystem in
// prompts/brand-brain.ts; keep them in sync or the shadow comparison stops being apples-to-apples.
import type { JevAnswer, JevQuestion } from '../adapters/jev.ts';
import { FUNNEL_STAGES, clamp1to5, type FunnelStage } from '../../core/src/index.ts';
import { brand, pillarSlugs } from '../brand.ts';
import { parseTopicScore, type ParsedTopicScore } from './score-parse.ts';
import { QC_SIGNAL_KEYS, parseQcSignals, type QcSignals } from './qc-parse.ts';
import { scoringSystem, buildScorePrompt, qcSystem, buildQcPrompt } from '../prompts/brand-brain.ts';

export type DecisionTask = 'topic_score' | 'qc_signals';

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
  /** Answer with no model at all. Omitted when there is no sensible rule. */
  rules?(subject: S): T;
}

/** One line on who the brand writes for, so Jev scores fit against the right audience. */
const audience = () => { const b = brand(); return `${b.name} writes for: ${b.audience.split('\n')[0]}`; };

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

// Same seven signals and wording as qcSystem / buildQcPrompt in brand-brain.ts.
export const QC_QUESTIONS: Record<(typeof QC_SIGNAL_KEYS)[number], JevQuestion> = {
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

/** Weakest answer's confidence — one shaky answer means the whole decision is shaky. */
export function minConfidence(answers: Record<string, JevAnswer>): number {
  const cs = Object.values(answers).map((a) =>
    a.confidence ?? (a.noul !== undefined ? Math.max(a.noul, 1 - a.noul) : 0));
  return cs.length ? Math.min(...cs) : 0;
}

export function topicScoreFromJev(a: Record<string, JevAnswer>): ParsedTopicScore {
  const out: ParsedTopicScore = {
    leadIntent: level(a.leadIntent), reach: level(a.reach), brandFit: level(a.brandFit),
    proof: level(a.proof), repurpose: level(a.repurpose),
  };
  const p = a.pillar?.choice, f = a.funnelStage?.choice;
  if (p && pillarSlugs().includes(p)) out.pillar = p;
  if (f && (FUNNEL_STAGES as readonly string[]).includes(f)) out.funnelStage = f as FunnelStage;
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
  task: 'topic_score', state: topicState, fromJev: topicScoreFromJev,
  get questions() { return topicQuestions(); },
  get system() { return scoringSystem(); },
  prompt: buildScorePrompt, parse: (raw) => parseTopicScore(raw),
};

// No rules: the QC gate's format rules already apply without any model.
export const QC_SIGNALS: DecisionTaskDef<Parameters<typeof qcState>[0], QcSignals> = {
  task: 'qc_signals', state: qcState, questions: QC_QUESTIONS, fromJev: qcSignalsFromJev,
  get system() { return qcSystem(); },
  prompt: buildQcPrompt, parse: (raw) => parseQcSignals(raw),
};

export const DECISION_TASKS: Record<DecisionTask, DecisionTaskDef<never, unknown>> = {
  topic_score: TOPIC_SCORE, qc_signals: QC_SIGNALS,
};
