// Weekly review prompt.
import { brand, type Brand } from '../brand.ts';

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
