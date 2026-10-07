// Pure parser for the QC-signals LLM response. Only an explicit true (or "yes")
// counts as a signal; the lane logic is escalate-only, so a garbled answer can
// never lower a lane below what the format rules already set.
import { parseJsonObject } from './llm-json.ts';

export const QC_SIGNAL_KEYS = [
  'hasClientClaim', 'hasMetric', 'isControversialOpinion', 'isCaseStudy',
  'isCompetitorComparison', 'isNewPositioning', 'mentionsFaceOrVoice',
] as const;
export type QcSignals = Record<(typeof QC_SIGNAL_KEYS)[number], boolean>;

export const toQcSignals = (o: Record<string, unknown>): QcSignals =>
  Object.fromEntries(QC_SIGNAL_KEYS.map((k) => [k, o[k] === true || o[k] === 'true' || o[k] === 'yes'])) as QcSignals;

export const parseQcSignals = (raw: string): QcSignals => toQcSignals(parseJsonObject(raw));
