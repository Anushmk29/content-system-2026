// Prompts that turn the founder's feedback into work: a revision of one post, and the standing
// rules every later draft follows (brand-context.ts adds them to the brand block).
import { PIECE_NAME, type DraftPlatform } from './platform-playbooks.ts';

/** One-click reasons on "Request changes" (the note is optional when one is picked). */
export const CHANGE_REASONS = [
  'Too long', 'Sounds like AI', 'Too generic', 'Off our voice', 'Weak hook', 'Wrong or unproven facts', 'Too salesy', 'Not for our audience', 'Unclear point',
] as const;

export function buildRevisePrompt(i: {
  platform: string; title: string; hook: string | null; body: string | null; cta: string | null; feedback: string;
}): string {
  const piece = PIECE_NAME[i.platform as DraftPlatform] ?? `${i.platform} post`;
  return `Revise this ${piece} using the founder's feedback. Fix exactly what the feedback asks; keep
everything else that works (the subject, the true points, the platform shape and length rules,
lines containing only "---" as separators). Add no new number, result, client or claim.

FEEDBACK FROM THE FOUNDER:
${i.feedback}

CURRENT TITLE: ${i.title}
CURRENT HOOK: ${i.hook || '(none)'}
CURRENT BODY:
${i.body ?? ''}
CURRENT CTA: ${i.cta || '(none)'}

Respond with ONLY JSON: { "hook": string, "body": string, "cta": string }
Every " inside a string value MUST be escaped as \\".`;
}

export const LESSONS_SYSTEM = `You maintain a short list of standing writing rules for a content team, learned from the
founder's review notes. Rules are specific and actionable ("Never open with a question",
"Keep LinkedIn posts under 200 words"), never vague ("Write better"). Reply with JSON only.`;

export function buildLessonsPrompt(current: string[], notes: Array<{ platform: string; decision: string; note: string }>): string {
  return `CURRENT RULES:
${current.length ? current.map((r) => `- ${r}`).join('\n') : '(none yet)'}

RECENT REVIEW NOTES (newest first; "changes" = asked for a rewrite, "rejected" = thrown away):
${notes.map((n) => `- [${n.platform}, ${n.decision}] ${n.note}`).join('\n')}

Update the rules: keep the current ones that still hold, merge duplicates, add a rule only for a
pattern that shows up in the notes (a single one-off note is not a pattern unless it is a hard
"never"). At most 10 rules, each under 120 characters. Platform-specific rules start with the
platform name, e.g. "LinkedIn: …".
Respond with ONLY JSON: { "rules": string[] }`;
}
