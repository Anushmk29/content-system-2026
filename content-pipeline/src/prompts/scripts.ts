// Video scripts for Instagram Reels, LinkedIn video and Facebook Reels (SCRIPT_TARGETS), written
// for one topic in the brand's voice. Same filming-card shape as the YouTube Short, so the
// Scripts desk shows them all the same way.
import { SCRIPT_TARGETS, type ScriptTarget } from './platform-playbooks.ts';
import { igHooks, igSkill } from './ig-skills.ts';

export function buildScriptPrompt(input: {
  topicTitle: string; customerLanguage?: string | null; angle?: { belief: string; truth: string } | null;
  anchor?: string | null; targets: readonly ScriptTarget[]; steal?: string;
}): string {
  return `Write a video script for each target below, on this topic, in our voice, for our audience.

TOPIC: ${input.topicTitle}
${input.customerLanguage ? `CUSTOMER LANGUAGE (use their words): ${input.customerLanguage}` : ''}
${input.angle ? `ANGLE — every script argues this:\nCOMMON BELIEF: ${input.angle.belief}\nOUR TRUTH: ${input.angle.truth}` : ''}
${input.steal ? `A PROVEN VIDEO TO BUILD ON (copy its structure, not its words):
${input.steal}` : ''}
${input.anchor ? `THE WRITTEN POST ON THIS TOPIC (same points; spoken, not read aloud):\n${input.anchor.slice(0, 2500)}` : ''}

TARGETS — each is a FILMING CARD the founder records:
${input.targets.map((t) => `- ${t} (${SCRIPT_TARGETS[t].name}): ${SCRIPT_TARGETS[t].steps}`).join('\n')}

${input.targets.includes('instagram_reel') ? `For instagram_reel only, apply this skill (its timing, hook and on-screen rules win over the line above):
${igSkill('ig-reel')}
${igHooks()}
` : ''}
Shape of each script: hook = the first spoken line. body = the beats, separated by lines containing
only "---"; each beat starts with "[ON SCREEN: short text]" on its own line, then the spoken lines
(add "[B-ROLL: …]" where a cutaway helps). cta = the last spoken line. Speak like a person, short
sentences. Never invent numbers, clients or results; any number is a claim.

Respond with ONLY JSON:
{ ${input.targets.map((t) => `"${t}": { "title": string, "hook": string, "body": string, "cta": string }`).join(',\n  ')},
  "claims": string[] }
"claims" lists every specific number, result or client claim the scripts make (they need proof
before publishing); [] if none.
Every " inside a string value MUST be escaped as \\".`;
}
