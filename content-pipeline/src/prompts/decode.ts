// Decode prompts: grouping competitor posts into formats, breaking posts into beats, and the
// counter-angle. The tag lists are the taxonomy both the prompts and the parsers use.
import { brand, type Brand } from '../brand.ts';
import { HOOK_PATTERN_KEYS } from '../hook-patterns.ts';
import { brandBrief } from './brand-context.ts';

export const BEAT_TAGS = ['hook', 'setup', 'proof', 'offer', 'method', 'benefit', 'other', 'cta'] as const;
export type BeatTag = (typeof BEAT_TAGS)[number];
export const VALUE_STRUCTURES = ['steps', 'single_insight', 'framework', 'story', 'listicle', 'transformation'] as const;
export const CTA_TYPES = ['follow', 'comment', 'dm', 'link', 'lead_magnet', 'none'] as const;

export const decodeSystem = () => `You analyse social media posts for ${brand().name}${brand().tagline ? ` (${brand().tagline})` : ''}. Reply with JSON only.`;

export function buildFormatsPrompt(sample: Array<{ platform: string; post_type: string; caption: string }>, ours: Array<{ t: string }>, known: string[] = []): string {
  return `Competitor posts (best performers first):\n${sample.map((p, i) => `${i + 1}. [${p.platform} ${p.post_type}] ${p.caption.replace(/\s+/g, ' ')}`).join('\n')}

Our own recent posts:\n${ours.map((o) => `- ${o.t}`).join('\n') || '(none yet)'}
${known.length ? `\nFormat names already in use: ${known.join('; ')}. When a group is one of these, use that exact name.\n` : ''}
Group the competitor posts into at most 10 recurring content FORMATS (a repeatable structure, e.g. "client before/after story", "tool list", "contrarian take"), not topics.
For each format count how many of OUR posts already use it, and write its SKELETON as fill-in templates with [brackets] for the parts that change:
- hook_template: the opening line's pattern, e.g. "I [did X] for [time]. Here's what nobody tells you:"
- value_template: how the value is delivered, e.g. "[3-5 numbered steps], each one line + one proof"
- cta_template: how it ends, e.g. "Comment [word] and I'll send [resource]"
Templates copy STRUCTURE, never their words or topics.
Return {"formats":[{"name":"short lowercase name","description":"one plain sentence","our_posts":0,"hook_template":"…","value_template":"…","cta_template":"…"}]}`;
}

export function buildBreakdownPrompt(
  formats: Array<{ name: string; description: string }>,
  posts: Array<{ platform: string; post_type: string; caption: string; transcript: string | null }>,
): string {
  return `Formats:\n${formats.map((f, i) => `${i + 1}. ${f.name} — ${f.description}`).join('\n')}

Posts:\n${posts.map((p, i) => `### ${i + 1} [${p.platform} ${p.post_type}]\n${p.transcript ? `SPOKEN (transcript):\n${p.transcript}\nCAPTION:\n` : ''}${p.caption || '(no text)'}`).join('\n\n')}

For each post: pick the format number (null if none fits), quote its hook (the opening line; for a video with a transcript, its first spoken line), and split it into beats in order.
Beat "at" is the paragraph number ("¶1", "¶2"…), "slide N" for carousels, or "0:12" for spoken video. Beat tags: ${BEAT_TAGS.join(', ')} ("offer" = the moment they pitch their own product).
Also classify its skeleton:
- hook_technique: one of ${HOOK_PATTERN_KEYS.join(', ')}
- value_structure: one of ${VALUE_STRUCTURES.join(', ')}
- cta_type: one of ${CTA_TYPES.join(', ')}
Return {"posts":[{"n":1,"format":2,"hook":"…","hook_technique":"how_to","value_structure":"steps","cta_type":"comment","beats":[{"at":"¶1","tag":"hook","text":"short paraphrase"}]}]}`;
}

export const counterAngleSystem = (b: Brand) => `You are ${b.name}’s content strategist.
${brandBrief(b)}`;

export const buildCounterAnglePrompt = (b: Brand, proof: string, caption: string) =>
  `A competitor post that performed well (${proof}):\n"""${caption.slice(0, 2000)}"""\n\nIn 2–3 sentences, give ${b.name}'s counter-angle: what this post leaves out, gets wrong, or where we would disagree. Our audience: ${b.audience.split('\n')[0]}. Plain text, no preamble.`;
