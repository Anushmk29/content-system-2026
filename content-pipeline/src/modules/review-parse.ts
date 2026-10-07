// Pure parser for the Weekly Review LLM response (Bible §14.1). Returns a short
// summary plus a list of concrete recommendations, which the module turns into
// operator todos so the learning loop produces action, not just a report.
import { parseJsonObject } from './llm-json.ts';

export interface ParsedReview {
  summary: string;
  recommendations: string[];
}

export function parseReview(raw: string): ParsedReview {
  const o = parseJsonObject(raw);
  const summary = typeof o.summary === 'string' ? o.summary.trim() : '';
  const recsRaw = Array.isArray(o.recommendations) ? o.recommendations : [];
  const recommendations = recsRaw
    .filter((r): r is string => typeof r === 'string')
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
    .slice(0, 10); // cap so a runaway response can't spam the todo list
  if (recommendations.length === 0) throw new Error('review returned no recommendations');
  return { summary, recommendations };
}
