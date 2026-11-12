// The parts of a Creative Check that code decides, never the model (PRD CC-03, CC-04, CC-11):
// measured facts, the attention strip, and validation of the model's reply. Pure: unit-tested.
import { humanScore } from '../humanizer.ts';
import { str } from '../modules/llm-json.ts';
import { MECHANISM_IDS } from './mechanisms.ts';

export const CATEGORIES = ['hook', 'visual', 'message', 'story', 'cta', 'audience'] as const;
export const FINDING_CATEGORIES = [...CATEGORIES, 'psychology'] as const;
export const TRIGGERS = [
  'curiosity', 'novelty', 'social proof', 'credibility', 'urgency', 'scarcity', 'loss framing',
  'emotional storytelling', 'identity relevance', 'cognitive simplicity', 'reciprocity', 'narrative tension',
] as const;
/** Claims: only keep them if the creator can show they're true (the Proof box). */
export const NEEDS_PROOF = new Set(['social proof', 'credibility', 'urgency', 'scarcity']);
export const ATTENTION_REASONS = ['no voice', 'long static shot', 'dense on-screen text', 'main benefit not stated yet', 'no face or subject visible', 'slow speech', 'repeated point'] as const;
const MEASURED_REASONS = new Set(['no voice', 'long static shot']);
const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
const TARGETS = ['hook', 'body', 'cta', 'visual', 'edit'] as const;
const CLASSES = ['A', 'B', 'C', 'D'] as const;

type Priority = (typeof PRIORITIES)[number];
type Cls = (typeof CLASSES)[number];
export type Mode = 'video+speech' | 'video-no-speech' | 'images' | 'copy-only';
export type CategoryStatus = 'good' | 'review' | 'insufficient';
export interface Fact { key: string; label: string; value: string; meaning: string }
export interface Segment { start: number; end: number; text: string }
export interface AttentionSegment { start: number; end: number; risk: 'low' | 'medium' | 'high'; reasons: string[]; evidence: 'A' | 'B' }
export type Location = { start: number; end?: number } | { field: 'hook' | 'body' | 'cta' | 'slide'; slide?: number };
export interface Finding {
  id: string; category: string; title: string; detail: string; at: Location; quote?: string;
  evidence: Cls; priority: Priority; mechanisms: string[];
}
export interface Trigger {
  name: string; evidence: string; at: string; role: string; benefit: string; risk: string; suggestion?: string; class: Cls;
  /** Claim triggers only: backed when the quote is found word for word in the creator's proof. */
  proof?: { status: 'backed' | 'unbacked'; quote?: string };
}
export interface Recommendation {
  id: string; findingIds: string[]; target: (typeof TARGETS)[number]; problem: string; at: string; why: string; change: string;
  replacements: string[]; direction: string; uncertainty: string; experiment: string; priority: Priority;
}
export interface CreativeCheckReport {
  version: { promptVersion: string; model: string | null; mode: Mode };
  summary: string;
  categories: Record<(typeof CATEGORIES)[number], CategoryStatus>;
  facts: Fact[];
  attention: AttentionSegment[];
  /** Images: what the model reads as the focal point, readability, clutter (Class B). */
  firstGlance: { focus: string; readability: string; clutter: string } | null;
  /** Model-read text per slide (Class B, not OCR-verified). */
  slides: { slide: number; text: string }[];
  transcript: Segment[];
  findings: Finding[];
  triggers: Trigger[];
  /** Claim triggers backed by the creator's proof vs still needing it. Absent in reports before cc-1.1. */
  proof?: { backed: number; needed: number };
  recommendations: Recommendation[];
  top3: string[];
  resolved: string[];
  limitations: string[];
}

// ---- measured facts (CC-03) --------------------------------------------------------------

/** Caption limits per platform (characters). */
export const CAPTION_LIMIT: Record<string, number> = { x: 280, instagram: 2200, linkedin: 3000, youtube: 5000, facebook: 63206, reddit: 40000 };
const ASKS: [string, RegExp][] = [
  ['follow', /\b(follow|subscribe)\b/i],
  ['comment', /\b(comment|reply|tell me|let me know|drop a)\b/i],
  ['DM', /\b(dm|message me|inbox|send me a message)\b/i],
  ['link', /\b(link|click|visit|sign up|register|book|buy|shop|download|bio|join)\b/i],
  ['save', /\b(save|bookmark)\b/i],
  ['share', /\b(share|tag|send this)\b/i],
];

const words = (t: string) => t.match(/[\p{L}\p{N}’']+/gu)?.length ?? 0;
const syllables = (w: string) => {
  const s = w.toLowerCase().replace(/[^a-z]/g, '').replace(/e$/, '');
  return Math.max(1, s.match(/[aeiouy]+/g)?.length ?? 0);
};
/** Flesch reading ease (0–100, higher = easier); null under 3 words. */
export function readingEase(text: string): number | null {
  const ws = text.match(/[A-Za-z’']+/g) ?? [];
  if (ws.length < 3) return null;
  const sentences = Math.max(1, text.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim()).length);
  const syl = ws.reduce((n, w) => n + syllables(w), 0);
  return Math.round(206.835 - 1.015 * (ws.length / sentences) - 84.6 * (syl / ws.length));
}

export function aspectName(w: number, h: number): string {
  if (!w || !h) return 'unknown';
  const r = w / h;
  const named: [string, number][] = [['9:16', 9 / 16], ['4:5', 4 / 5], ['1:1', 1], ['16:9', 16 / 9]];
  return named.find(([, v]) => Math.abs(r - v) / v < 0.03)?.[0] ?? `other (${w}×${h})`;
}

export const hookText = (c: { hook: string; body: string }) => (c.hook.trim() || c.body.trim().split('\n')[0] || '').trim();
const ctaText = (c: { cta: string; body: string }) => c.cta.trim() || c.body.trim().split(/\n\s*\n/).pop() || '';
const s1 = (n: number) => `${Math.round(n * 10) / 10} s`;

export interface FactInput {
  platform: string; hook: string; body: string; cta: string;
  video?: { durationS: number; width: number; height: number; cuts: number[]; segments: Segment[] | null } | null;
  images?: { width: number; height: number }[];
}

export function measureFacts(i: FactInput): Fact[] {
  const out: Fact[] = [];
  const add = (key: string, label: string, value: string, meaning: string) => out.push({ key, label, value, meaning });
  const v = i.video;
  if (v) {
    add('duration', 'Duration', s1(v.durationS), v.durationS <= 30 ? 'Short: easy to watch to the end.' : 'Longer videos need a reason to stay every few seconds.');
    add('aspect', 'Aspect ratio', aspectName(v.width, v.height), aspectName(v.width, v.height) === '9:16' ? 'Full-screen vertical: right for Reels, Shorts and TikTok.' : 'Not full-screen vertical: it shows smaller in Reels/Shorts feeds.');
    const per10 = v.durationS > 0 ? (v.cuts.length / v.durationS) * 10 : 0;
    add('cuts', 'Cuts', `${v.cuts.length} (${Math.round(per10 * 10) / 10} per 10 s)`, v.cuts.length === 0 ? 'One continuous shot.' : `A new shot about every ${s1(v.durationS / (v.cuts.length + 1))}.`);
    if (v.segments) {
      const first = v.segments[0];
      if (!first) add('first_word', 'First spoken word', 'none', 'No speech found in the video.');
      else {
        add('first_word', 'First spoken word', `at ${s1(first.start)}`, first.start < 1 ? 'Speaking from the first second.' : `Viewers see ${s1(first.start)} with no voice.`);
        if (first.start >= 1) add('opening_silence', 'Opening silence', s1(first.start), `Silent for ${s1(first.start)} at the start.`);
        const spoken = v.segments.reduce((n, s) => n + Math.max(0, s.end - s.start), 0);
        const wpm = spoken > 0 ? Math.round((v.segments.reduce((n, s) => n + words(s.text), 0) / spoken) * 60) : 0;
        add('pace', 'Speech pace', `${wpm} words/min`, wpm < 120 ? 'Slower than everyday talk (about 150 words/min).' : wpm > 190 ? 'Fast: hard to follow without captions.' : 'Close to everyday talk.');
      }
    }
  }
  if (!v && i.images?.length) {
    const a = aspectName(i.images[0]!.width, i.images[0]!.height);
    add('aspect', 'Aspect ratio', a, a === '4:5' || a === '1:1' ? 'Fills the feed well.' : a === '9:16' ? 'Vertical: fits Stories; crops in the feed.' : 'An unusual shape: check how the feed crops it.');
    if (i.images.length > 1) add('slides', 'Slides', String(i.images.length), 'Each slide needs one idea people can read in a second or two.');
  }
  const hookWords = words(hookText(i));
  add('hook_length', 'Hook length', `${hookWords} words`, hookWords === 0 ? 'No hook.' : hookWords <= 12 ? 'Short enough to read at a glance.' : 'Long for a first line: the point may arrive late.');
  const limit = CAPTION_LIMIT[i.platform];
  const chars = i.body.trim().length;
  add('caption_length', 'Caption length', `${words(i.body)} words, ${chars} characters${limit ? ` of ${limit}` : ''}`,
    limit && chars > limit ? `Over the ${i.platform} limit by ${chars - limit} characters.` : 'Within the platform limit.');
  const ease = readingEase(i.body);
  if (ease !== null) add('reading_ease', 'Reading ease', `${ease} / 100`, ease >= 60 ? 'Plain and easy to read.' : ease >= 40 ? 'Fairly hard: long sentences or words.' : 'Hard to read: long sentences and long words.');
  const asks = ASKS.filter(([, re]) => re.test(ctaText(i))).map(([n]) => n);
  add('asks', 'Asks in CTA', asks.length ? `${asks.length} (${asks.join(', ')})` : '0', asks.length === 0 ? 'No clear ask.' : asks.length === 1 ? 'One clear ask.' : 'Several asks compete; one usually works better.');
  add('human_score', 'Human score', `${humanScore([i.hook, i.body, i.cta].join('\n\n')).score} / 100`, 'How much the copy reads like a person wrote it (AI phrases, rhythm, hedging).');
  return out;
}

// ---- attention strip (CC-04) ---------------------------------------------------------------

const MAX_SEGMENTS = 30;
/** Between cuts, or 3 s blocks with no cuts (or too many to show). Measured reasons only;
 *  the model's reasons are merged in by validateReport. */
export function attentionSegments(durationS: number, cuts: number[], speech: Segment[] | null): AttentionSegment[] {
  const end = Math.min(durationS, 90);
  if (end <= 0) return [];
  const inside = cuts.filter((c) => c > 0 && c < end);
  const bounds = inside.length && inside.length < MAX_SEGMENTS
    ? [0, ...inside, end]
    : [...Array.from({ length: Math.ceil(end / 3) }, (_, k) => k * 3), end];
  const segs: AttentionSegment[] = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const start = bounds[k]!, stop = bounds[k + 1]!;
    if (stop - start < 0.05) continue;
    const reasons: string[] = [];
    if (speech) {
      const voiced = speech.reduce((n, s) => n + Math.max(0, Math.min(stop, s.end) - Math.max(start, s.start)), 0);
      if (voiced / (stop - start) < 0.3) reasons.push('no voice');
    }
    const static_ = inside.length ? stop - start > 4 : stop > 4;
    if (static_) reasons.push('long static shot');
    segs.push({ start: Math.round(start * 10) / 10, end: Math.round(stop * 10) / 10, risk: 'low', reasons, evidence: 'A' });
  }
  return segs.map(rate);
}
function rate(s: AttentionSegment): AttentionSegment {
  const early = s.start < 3 && s.reasons.includes('no voice');
  return { ...s, risk: early || s.reasons.length >= 2 ? 'high' : s.reasons.length === 1 ? 'medium' : 'low' };
}

// ---- validation (CC-11) ------------------------------------------------------------------

const BANNED: RegExp[] = [
  // V-07 neuroscience claims
  /\b(amygdala|dopamine|serotonin|oxytocin|cortisol|reward (center|centre|circuit|system)|neurons? (fire|firing)|hijack\w*|nucleus accumbens|prefrontal|limbic|hippocamp\w*|neurotransmitter\w*)\b/i,
  /\bbrain\b[^.]*\b(activat\w*|lights? up|lit up|\d+\s*%)/i,
  // V-08 outcome claims
  /\b(guarantee\w*|go(es|ing)? viral|will (definitely )?(get|reach|hit|earn|generate|double|triple)\b[^.]*\b(views|likes|followers|clicks|sales|comments|shares|reach|engagement))\b/i,
  /\b(ctr|click-through rate|conversion rate) (of|will be|around|about) \d/i,
];
const PCT = /\d+(?:\.\d+)?\s*%/g;
// V-10: what a replacement may not add unless the original already says it.
const ADDED = /\b(testimonials?|discount\w*|\d+\s*% off|sale|limited (time|offer|spots?)|only \d+ (left|spots?)|spots? left|last chance|certified|certification|accredited|award[- ]winning|guarantee\w*|clients? (say|love))\b/gi;

const norm = (t: string) => t.toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const oneOf = <T extends string>(v: unknown, list: readonly T[], dflt: T): T => {
  const s = str(v).toLowerCase();
  return list.find((x) => x.toLowerCase() === s) ?? dflt;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const rank = (p: Priority) => PRIORITIES.indexOf(p);
/** "0:05", "0:05–0:08", "5 s", "at 2.5s" → seconds of the first time; Infinity when none. */
export function firstTime(at: string): number {
  const mm = at.match(/(\d+):(\d{2}(?:\.\d+)?)/);
  if (mm) return Number(mm[1]) * 60 + Number(mm[2]);
  const s = at.match(/(\d+(?:\.\d+)?)\s*s(ec|econds?)?\b/i);
  return s ? Number(s[1]) : Infinity;
}

export interface ValidateInput {
  promptVersion: string; model: string | null; mode: Mode;
  facts: Fact[];
  attention: AttentionSegment[];
  durationS: number | null;
  slideCount: number;
  transcript: Segment[];
  copy: { hook: string; body: string; cta: string; proof?: string };
  previousFindingIds: string[];
  limitations: string[];
}

/** The model reply → a report with nothing in it that the content doesn't support. */
export function validateReport(raw: Record<string, unknown>, v: ValidateInput): CreativeCheckReport {
  let removed = 0;
  const factValues = v.facts.map((f) => f.value).join(' ');
  /** V-07/08/09: drop sentences with banned claims or unmeasured percentages. */
  const clean = (t: unknown): string => {
    const text = str(t);
    if (!text) return '';
    const kept = text.split(/(?<=[.!?])\s+/).filter((s) => {
      const bad = BANNED.some((re) => re.test(s)) || (s.match(PCT) ?? []).some((p) => !factValues.includes(p.replace(/\s+/g, '')));
      if (bad) removed++;
      return !bad;
    });
    return kept.join(' ').trim();
  };

  const slides = arr(raw.slides).map(obj)
    .map((s) => ({ slide: Math.trunc(Number(s.slide)), text: str(s.text).slice(0, 1000) }))
    .filter((s) => s.slide >= 1 && s.slide <= v.slideCount && s.text);
  const haystack = norm([v.transcript.map((s) => s.text).join(' '), v.copy.hook, v.copy.body, v.copy.cta, ...slides.map((s) => s.text)].join(' \n '));
  const found = (q: string) => { const n = norm(q); return n.length > 0 && haystack.includes(n); };
  const proofText = norm(v.copy.proof ?? '');
  const inProof = (q: string) => { const n = norm(q); return n.length > 0 && proofText.includes(n); };
  const factKeys = new Set(v.facts.map((f) => f.key));
  const isVideo = v.durationS !== null;
  const dur = v.durationS ?? 0;

  // Findings
  const seen = new Set<string>();
  let findings: Finding[] = [];
  for (const [n, f] of arr(raw.findings).map(obj).entries()) {
    let id = str(f.id) || `f${n + 1}`;
    if (seen.has(id)) id = `${id}-${n + 1}`;
    const title = clean(f.title);
    if (!title) { removed++; continue; }
    const at = obj(f.at);
    let loc: Location | null = null;
    if (typeof at.start === 'number' || typeof f.start === 'number') {
      const start = Number(at.start ?? f.start), end = at.end ?? f.end;
      const ok = isVideo && start >= 0 && start <= dur + 0.5 && (end === undefined || (typeof end === 'number' && end >= start && end <= dur + 0.5));
      if (!ok) { removed++; continue; } // V-02
      loc = { start, ...(typeof end === 'number' ? { end: Math.min(end, dur) } : {}) };
    } else {
      const field = str(at.field).toLowerCase();
      if (field === 'slide') {
        const slide = Math.trunc(Number(at.slide));
        if (slide >= 1 && slide <= v.slideCount) loc = { field, slide };
      } else if (field === 'hook' || field === 'body' || field === 'cta') loc = { field };
      if (!loc) { removed++; continue; } // points to nothing
    }
    const quote = str(f.quote);
    if (quote && !found(quote)) { removed++; continue; } // V-03
    const mechanisms = arr(f.mechanisms).filter((m): m is string => typeof m === 'string');
    const known = mechanisms.filter((m) => MECHANISM_IDS.has(m)); // V-04
    removed += mechanisms.length - known.length;
    let evidence = oneOf(f.evidence, CLASSES, 'B');
    if (evidence === 'A' && !factKeys.has(str(f.factKey))) evidence = 'B'; // V-06
    seen.add(id);
    findings.push({
      id, category: oneOf(f.category, FINDING_CATEGORIES, 'message'), title, detail: clean(f.detail), at: loc,
      ...(quote ? { quote } : {}), evidence, priority: oneOf(f.priority, PRIORITIES, 'medium'), mechanisms: [...new Set(known)],
    });
  }
  if (findings.length > 12) { removed += findings.length - 12; findings = [...findings].sort((a, b) => rank(a.priority) - rank(b.priority)).slice(0, 12); } // V-11
  const ids = new Set(findings.map((f) => f.id));

  // Triggers
  let triggers: Trigger[] = [];
  for (const t of arr(raw.triggers).map(obj)) {
    const name = str(t.name).toLowerCase().replace(/_/g, ' ');
    if (!(TRIGGERS as readonly string[]).includes(name)) { removed++; continue; }
    const evidence = str(t.evidence);
    let risk = clean(t.risk);
    let proof: Trigger['proof'];
    if (NEEDS_PROOF.has(name)) {
      const quote = str(t.proofQuote).replace(/^["“]|["”]$/g, '');
      if (str(t.proof).toLowerCase() === 'backed' && inProof(quote)) {
        proof = { status: 'backed', quote };
        risk = `${risk ? `${risk} ` : ''}Backed by your proof: “${quote}”.`;
      } else {
        proof = { status: 'unbacked' };
        risk = `${risk ? `${risk} ` : ''}Needs proof before publishing: only keep it if you can show it’s true. Add it in the Proof box.`;
      }
    }
    let cls = oneOf(t.class, CLASSES, 'B');
    if (cls === 'A' && !found(evidence.replace(/^["“]|["”]$/g, ''))) cls = 'B';
    triggers.push({ name, evidence, at: str(t.at), role: clean(t.role), benefit: clean(t.benefit), risk, ...(clean(t.suggestion) ? { suggestion: clean(t.suggestion) } : {}), class: cls, ...(proof ? { proof } : {}) });
  }
  if (triggers.length > 12) { removed += triggers.length - 12; triggers = triggers.slice(0, 12); }

  // Recommendations
  // Rewrites may use what's in the post or in the creator's proof, nothing else (V-10).
  const original = [v.copy.hook, v.copy.body, v.copy.cta, v.copy.proof ?? ''].join('\n').toLowerCase();
  const origNums = new Set(original.match(/\d+(?:[.,]\d+)?/g) ?? []);
  const honest = (r: string) => (r.match(/\d+(?:[.,]\d+)?/g) ?? []).every((n) => origNums.has(n))
    && [...r.matchAll(ADDED)].every((m) => original.includes(m[0].toLowerCase()))
    && !BANNED.some((re) => re.test(r));
  const recSeen = new Set<string>();
  let recs: Recommendation[] = [];
  for (const [n, r] of arr(raw.recommendations).map(obj).entries()) {
    let id = str(r.id) || `r${n + 1}`;
    if (recSeen.has(id)) id = `${id}-${n + 1}`;
    const findingIds = arr(r.findingIds).filter((x): x is string => typeof x === 'string' && ids.has(x));
    const at = str(r.at), experiment = clean(r.experiment), change = clean(r.change);
    if (!findingIds.length || !at || !experiment || !change) { removed++; continue; } // V-05 + names a location and an experiment
    const target = oneOf(r.target, TARGETS, 'edit');
    const reps = target === 'hook' || target === 'body' || target === 'cta' ? arr(r.replacements).map(str).filter(Boolean) : [];
    const kept = reps.filter(honest); // V-10
    removed += reps.length - kept.length;
    recSeen.add(id);
    recs.push({
      id, findingIds, target, problem: clean(r.problem), at, why: clean(r.why), change, replacements: kept.slice(0, 3),
      direction: clean(r.direction), uncertainty: clean(r.uncertainty), experiment, priority: oneOf(r.priority, PRIORITIES, 'medium'),
    });
  }
  const ordered = [...recs].sort((a, b) => rank(a.priority) - rank(b.priority) || firstTime(a.at) - firstTime(b.at));
  if (recs.length > 8) { removed += recs.length - 8; recs = ordered.slice(0, 8); }

  // Categories: "Needs review" only with a finding behind it (CC-05).
  const cats = obj(raw.categories);
  const categories = Object.fromEntries(CATEGORIES.map((c) => {
    const s = oneOf(cats[c], ['good', 'review', 'insufficient'] as const, 'insufficient');
    return [c, s === 'review' && !findings.some((f) => f.category === c) ? 'insufficient' : s];
  })) as CreativeCheckReport['categories'];

  // Attention: model reasons from the fixed list are added to the measured ones (Class B).
  const attention = v.attention.map((s) => ({ ...s, reasons: [...s.reasons] }));
  for (const a of arr(raw.attention).map(obj)) {
    const seg = attention[Math.trunc(Number(a.segment))];
    if (!seg) continue;
    const add = arr(a.reasons).map((x) => str(x).toLowerCase())
      .filter((x) => (ATTENTION_REASONS as readonly string[]).includes(x) && !MEASURED_REASONS.has(x) && !seg.reasons.includes(x));
    if (add.length && !seg.reasons.some((x) => MEASURED_REASONS.has(x))) seg.evidence = 'B';
    seg.reasons.push(...add);
  }

  const g = obj(raw.firstGlance);
  const firstGlance = v.mode === 'images' && (g.focus || g.readability || g.clutter)
    ? { focus: clean(g.focus), readability: clean(g.readability), clutter: clean(g.clutter) } : null;
  const summary = clean(raw.summary);
  if (!summary && !findings.length) throw new Error('The check came back unusable. Try again.'); // V-01
  const prev = new Set(v.previousFindingIds);
  const limitations = [...v.limitations];
  if (removed) limitations.push(`Removed ${removed} statement${removed === 1 ? '' : 's'} we couldn’t support.`); // V-12

  return {
    version: { promptVersion: v.promptVersion, model: v.model, mode: v.mode },
    summary, categories, facts: v.facts, attention: attention.map(rate), firstGlance, slides, transcript: v.transcript,
    findings, triggers, recommendations: recs,
    proof: { backed: triggers.filter((t) => t.proof?.status === 'backed').length, needed: triggers.filter((t) => t.proof?.status === 'unbacked').length },
    top3: ordered.filter((r) => recs.includes(r)).slice(0, 3).map((r) => r.id),
    resolved: [...new Set(arr(raw.resolved).filter((x): x is string => typeof x === 'string' && prev.has(x)))],
    limitations,
  };
}
