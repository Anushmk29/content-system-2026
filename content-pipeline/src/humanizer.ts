// Humanizer — how human a draft reads, 0-100, and the AI tells behind the number. A port of the
// content-humanizer skill's scorer (scripts/humanizer_scorer.py): AI vocabulary 25, sentence
// rhythm 20, passive voice 20, hedging 15, em dashes 10, paragraph variety 10. No model call, so
// it runs on every draft. The rules the drafts are written to live in prompts/brand-context.ts.
// ponytail: fixed word lists (the skill's 2026-06 checklist); refresh them when new tells show up.
// Plus the instagram-agent-skill lexicon (ig-human/slop.json: 154 stock words/phrases, 16 structural
// tells), read from assets so editing that file tunes the check.
import { igSlop } from './prompts/ig-skills.ts';

const AI_WORDS = [
  'delve', 'landscape', 'crucial', 'vital', 'pivotal', 'leverage', 'robust', 'comprehensive', 'holistic',
  'foster', 'facilitate', 'navigate', 'ensure', 'utilize', 'furthermore', 'moreover', 'innovative',
  'cutting-edge', 'seamless', 'seamlessly', 'empower', 'streamline', 'cultivate', 'paradigm', 'ecosystem',
  'synergy', 'game-changer', 'game changer', 'unlock', 'elevate', 'tapestry', 'testament', 'realm',
  'in conclusion', 'in summary', 'to summarize', "in today's fast-paced", 'ever-evolving',
] as const;

const HEDGES = [
  'it is important to note', "it's important to note", 'it should be noted', 'it is worth mentioning',
  "it's worth mentioning", 'it goes without saying', 'needless to say', 'in many cases', 'in most cases',
  'in certain cases', 'in most instances', 'in many instances', 'generally speaking', 'for the most part',
  'this may vary', 'results may differ', 'one might argue', 'it can be argued', 'there are various',
  'there are many', 'it is crucial to', "it's crucial to",
] as const;

const VAGUE_AUTHORITY = [
  'studies show', 'research suggests', 'research shows', 'experts agree', 'experts say', 'many companies',
  'leading brands', 'it has been shown', 'according to research', 'data suggests', 'evidence suggests',
] as const;

let vocabList: readonly string[] | undefined;
const aiList = () => (vocabList ??= [...new Set([...AI_WORDS, ...igSlop().terms])]);

const PASSIVE = [/\b(is|are|was|were|be|been|being)\s+(being\s+)?\w+ed\b/gi, /\b(can|could|should|would|may|might|must)\s+be\s+\w+ed\b/gi];

export interface HumanScore {
  score: number;
  /** Plain-language tells, worst first; empty when it reads human. */
  tells: string[];
  /** The AI words and hedges found, for the rewrite and the reviewer. */
  phrases: string[];
}

/** Whole word or phrase, simple inflections included ("ensures", "leveraging"); "-" also matches a space. */
const phraseRe = (p: string) => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '[- ]')}(s|d|ed|es|ing)?(?!\\w)`, 'gi');
const hits = (text: string, list: readonly string[]) => list.filter((p) => phraseRe(p).test(text));
const count = (text: string, list: readonly string[]) => list.reduce((n, p) => n + (text.match(phraseRe(p))?.length ?? 0), 0);
const sd = (xs: number[]) => {
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - avg) ** 2, 0) / xs.length);
};

/** Score hook + body + cta as one piece. Script beat separators ("---" lines) and cue tags are ignored. */
export function humanScore(raw: string): HumanScore {
  const text = raw.replace(/’/g, "'").replace(/^\s*-{3,}\s*$/gm, '').replace(/\[[A-Z][A-Z -]*:[^\]]*\]/g, '');
  const words = Math.max(1, text.match(/\b\w+\b/g)?.length ?? 0);
  const tells: string[] = [];

  const ai = hits(text, aiList());
  const shapes = igSlop().structures.filter((x) => { x.re.lastIndex = 0; return x.re.test(text); });
  const aiN = count(text, aiList()) + shapes.length;
  const vocab = aiN === 0 ? 25 : aiN <= 2 ? 20 : aiN <= 5 ? 14 : aiN <= 10 ? 8 : aiN <= 15 ? 3 : 0;
  if (ai.length) tells.push(`AI words: ${ai.join(', ')}`);
  for (const x of shapes) tells.push(`${x.name}: ${x.fix}`);

  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 3);
  const spread = sentences.length < 3 ? null : sd(sentences.map((s) => s.split(/\s+/).length));
  const rhythm = spread === null ? 10 : spread >= 12 ? 20 : spread >= 8 ? 16 : spread >= 5 ? 10 : spread >= 3 ? 5 : 0;
  if (spread !== null && spread < 5) tells.push('Every sentence is about the same length');

  const nSentences = Math.max(1, text.split(/[.!?]+/).filter((s) => s.trim()).length);
  const passiveRatio = PASSIVE.reduce((n, re) => n + (text.match(re)?.length ?? 0), 0) / nSentences;
  const passive = passiveRatio < 0.1 ? 20 : passiveRatio < 0.2 ? 16 : passiveRatio < 0.3 ? 10 : passiveRatio < 0.4 ? 5 : 0;
  if (passiveRatio >= 0.3) tells.push('Too much passive voice');

  const hedges = hits(text, HEDGES);
  const hedgeN = count(text, HEDGES);
  const hedging = [15, 12, 8, 4][hedgeN] ?? 0;
  if (hedgeN) tells.push(`Hedging: ${hedges.join(', ')}`);
  const vague = hits(text, VAGUE_AUTHORITY);
  if (vague.length) tells.push(`Vague authority: ${vague.join(', ')}`);

  const dashes = (text.match(/—|--/g)?.length ?? 0) / (words / 100);
  const em = dashes < 0.5 ? 10 : dashes < 1.5 ? 8 : dashes < 3 ? 5 : dashes < 5 ? 2 : 0;
  if (dashes >= 1.5) tells.push('Too many em dashes');

  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !p.startsWith('#'));
  let variety = 5;
  if (paras.length >= 3) {
    const lens = paras.map((p) => p.split(/\s+/).length);
    const s = sd(lens);
    variety = Math.min(10, (s >= 30 ? 5 : s >= 15 ? 3 : s >= 5 ? 1 : 0) + (lens.some((l) => l <= 15) ? 3 : 0)
      + (lens.some((l) => l >= 80) && s >= 15 ? 2 : 0));
    if (!lens.some((l) => l <= 15)) tells.push('No short paragraphs');
  }

  return { score: vocab + rhythm + passive + hedging + em + variety, tells, phrases: [...ai, ...hedges, ...vague] };
}

/** Below this, QC rewrites the draft once before a person sees it (the skill's "light edits" line). */
export const HUMAN_MIN = 70;

/** The rewrite brief QC sends through the normal revise path. */
export const humanizeFeedback = (h: HumanScore) =>
  `This reads AI-written (${h.score}/100 on our human check). Fix: ${h.tells.join('; ')}. Replace each AI word with a plain, specific one, `
  + 'state claims without hedging, mix short and long sentences, use active voice, at most one em dash, and add a one-line paragraph. '
  + 'Keep the meaning, facts and length.';
