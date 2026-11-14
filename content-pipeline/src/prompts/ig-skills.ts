// Instagram skills (github.com/Jakeschincariol/instagram-agent-skill, MIT), vendored unchanged in
// assets/instagram-skills and read at run time. Each SKILL.md is written for an interactive Claude
// Code session (ask the user, run python, wait for "yes"), so it goes into our prompts behind a
// header that keeps only its rules. Their voice.md is our brand kit (brandSystem); their swipe.md
// is Decode's proven hooks.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type IgSkill = 'ig-audit' | 'ig-caption' | 'ig-carousel' | 'ig-comment' | 'ig-dm' | 'ig-human' | 'ig-plan'
  | 'ig-profile' | 'ig-reel' | 'ig-reply' | 'ig-repurpose' | 'ig-story' | 'ig-viral';

const root = (() => {
  // Same lookup as style-service starterDir: next to src/ from source, two up from dist/src/.
  const here = dirname(fileURLToPath(import.meta.url));
  const dirs = [join(here, '..', '..', 'assets', 'instagram-skills'), join(here, '..', '..', '..', 'assets', 'instagram-skills'),
    join(process.cwd(), 'content-pipeline', 'assets', 'instagram-skills'), join(process.cwd(), 'assets', 'instagram-skills')];
  return dirs.find((d) => existsSync(d)) ?? dirs[0]!;
})();
const read = (rel: string) => readFileSync(join(root, 'skills', rel), 'utf8');
const memo = <T>(f: () => T) => { let v: T | undefined; return () => (v ??= f()); };

const skills = new Map<IgSkill, string>();
/** One skill's rules, ready to paste into a prompt (front-matter dropped). Read once. */
export function igSkill(name: IgSkill): string {
  if (!skills.has(name)) {
    const md = read(`${name}/SKILL.md`).replace(/^---[\s\S]*?\n---\s*/, '').trim();
    skills.set(name, `=== INSTAGRAM SKILL: ${name} ===
You are inside an automated pipeline, not a chat: ask no questions, run no tools or scripts, read or
write no files, and don't wait for a "yes". Use only this skill's rules, checklists and numbers. Our
BRAND block is the voice profile it mentions (voice.md); the proven hooks, when given, are its
swipe.md. Ignore its own output format: the format asked for at the end of this prompt wins.

${md}
=== END SKILL: ${name} ===`);
  }
  return skills.get(name)!;
}

interface Hook { id: number; name: string; template: string; on_screen: string; best_for: string; trap: string }
/** The 26 hook formulas from ig-reel/hooks.json, one line each, plus their rules. */
export const igHooks = memo(() => {
  const h = JSON.parse(read('ig-reel/hooks.json')) as { rules: string[]; hooks: Hook[] };
  return `HOOK FORMULAS (pick from these; never the "trap"):
${h.hooks.map((x) => `${x.id}. ${x.name}: "${x.template}" (on screen: ${x.on_screen}). Trap: ${x.trap}`).join('\n')}
HOOK RULES:
${h.rules.map((r) => `- ${r}`).join('\n')}`;
});

interface Slop { words: { find: string }[]; phrases: { find: string }[]; structures: { id: string; regex: string; name: string; fix: string }[] }
/** ig-human/slop.json: its stock words and phrases, and its structural tells as JS regexes. */
export const igSlop = memo(() => {
  const s = JSON.parse(read('ig-human/slop.json')) as Slop;
  return {
    terms: [...s.words, ...s.phrases].map((w) => w.find.toLowerCase()),
    structures: s.structures.map((x) => {
      // Python syntax → JS: leading (?im) flags, \U0001F680 escapes.
      const flags = x.regex.match(/^\(\?([a-z]+)\)/)?.[1] ?? '';
      const src = x.regex.replace(/^\(\?[a-z]+\)/, '').replace(/\\U([0-9A-Fa-f]{8})/g, (_, h: string) => `\\u{${parseInt(h, 16).toString(16)}}`);
      return { id: x.id, name: x.name, fix: x.fix, re: new RegExp(src, `gu${flags.replace(/[^im]/g, '')}`) };
    }),
  };
});
