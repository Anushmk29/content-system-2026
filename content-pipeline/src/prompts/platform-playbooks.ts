// Where drafts go and how each platform is shaped. One place for the per-platform rules so
// drafting, scripts and carousels read the same playbook.

// Ideas come in from X and Reddit (Market Signals); drafts go out to these, LinkedIn = anchor.
// youtube = a 45-second Short filming card (a script to record, never auto-posted) and reddit =
// a value-first post the founder posts by hand (subreddit rules differ); both opt-in, so they are
// not in the default set every selected topic gets.
export const DRAFT_PLATFORMS = ['linkedin', 'blog', 'x', 'instagram', 'facebook', 'reddit', 'youtube'] as const;
export type DraftPlatform = (typeof DRAFT_PLATFORMS)[number];
export const DEFAULT_DRAFT_PLATFORMS: readonly DraftPlatform[] = ['linkedin', 'blog', 'x', 'instagram', 'facebook'];
/** Drafted here, posted by a person: the publisher skips them. */
export const MANUAL_PLATFORMS: readonly string[] = ['youtube', 'reddit'];
/** Video scripts on any platform are filmed by a person too. */
export const SCRIPT_FORMATS: readonly string[] = ['short_script', 'reel_script'];
/** A piece a person posts (script to film, Reddit post): never sent to Postiz. */
export const isManual = (i: { platform: string; format?: string | null }) =>
  MANUAL_PLATFORMS.includes(i.platform) || SCRIPT_FORMATS.includes(i.format ?? '');

export const PIECE_NAME: Record<DraftPlatform, string> = {
  linkedin: 'LinkedIn post', blog: 'blog article', x: 'X thread', instagram: 'Instagram carousel', facebook: 'Facebook post',
  reddit: 'Reddit post', youtube: 'YouTube Short script',
};

// ---- Post formats -----------------------------------------------------------------
// What each platform's post is drafted as, picked on the idea card. The first is the default
// and is stored as the bare platform id ('linkedin'); another is 'linkedin:image'. `db` is the
// content.content_format value (a single image is a 'quote_card'). One written format per
// platform per idea; video is a separate script (SCRIPT_TARGETS), filmed by a person.
export interface PostFormat { id: string; label: string; db: string; visual: 'none' | 'image' | 'carousel' }
const TEXT = { visual: 'none' } as const;
const IMAGE: PostFormat = { id: 'image', label: 'Image', db: 'quote_card', visual: 'image' };
export const POST_FORMATS: Record<DraftPlatform, PostFormat[]> = {
  linkedin: [{ id: 'post', label: 'Text post', db: 'founder_post', ...TEXT }, { id: 'carousel', label: 'Carousel', db: 'carousel', visual: 'carousel' }, IMAGE],
  instagram: [{ id: 'carousel', label: 'Carousel', db: 'carousel', visual: 'carousel' }, IMAGE],
  facebook: [{ id: 'post', label: 'Text post', db: 'founder_post', ...TEXT }, IMAGE],
  x: [{ id: 'thread', label: 'Thread', db: 'thread', ...TEXT }, IMAGE],
  blog: [{ id: 'article', label: 'Article', db: 'article', ...TEXT }],
  reddit: [{ id: 'post', label: 'Post', db: 'reddit_answer', ...TEXT }],
  youtube: [{ id: 'short', label: 'Short (you film)', db: 'short_script', ...TEXT }],
};
/** Content formats that need a made visual (the Design desk). */
export const VISUAL_FORMATS: readonly string[] = ['carousel', 'quote_card'];

/** 'linkedin' | 'linkedin:image' → the platform and its format; null for anything else (scripts, junk). */
export function parsePick(id: string): { platform: DraftPlatform; format: PostFormat } | null {
  const [p, f] = id.split(':');
  if (!(DRAFT_PLATFORMS as readonly string[]).includes(p!)) return null;
  const list = POST_FORMATS[p as DraftPlatform];
  const format = f === undefined ? list[0] : list.find((x) => x.id === f);
  return format ? { platform: p as DraftPlatform, format } : null;
}
/** The id a pick is stored as: the default format is the bare platform. */
export const pickId = (platform: DraftPlatform, formatId: string) =>
  POST_FORMATS[platform][0]!.id === formatId ? platform : `${platform}:${formatId}`;

/** What a non-default format changes in a platform's shape (overrides PLATFORM_SHAPE for that piece). */
const FORMAT_SHAPE: Record<string, string> = {
  image: 'a SINGLE-IMAGE post. hook = the headline printed on the image, at most 12 words. body = the caption that goes with it (X: under 270 characters, one tweet, no "---"; elsewhere 60-150 words).',
  carousel: 'a 6-8 slide carousel (a document post). Slide 1 is the hook, the last slide the CTA; at most 25 words per slide, one idea per slide. Separate each slide with a line containing only "---". Put only the slide text in body; hook is also the caption\'s first line.',
};
export const formatShapeBlock = (formats: Partial<Record<DraftPlatform, string>>) => {
  const lines = Object.entries(formats).flatMap(([p, f]) => (FORMAT_SHAPE[f!] ? [`- ${p}: ${FORMAT_SHAPE[f!]}`] : []));
  return lines.length ? `FORMAT OVERRIDES — these pieces use another format than the shape above says:\n${lines.join('\n')}` : '';
};

/** The per-platform block of the drafting system prompt. */
export const PLATFORM_SHAPE = `PER-PLATFORM SHAPE (Bible §11.2) — never the same copy everywhere:
- linkedin: the ANCHOR. One founder-led post, 150-300 words. A strong first line (no
  link in body — LinkedIn suppresses outbound links). Optimize for comments. End with
  a soft CTA. This is the source the others repurpose from.
- blog: a full SEO article expanding the anchor. Clear title, strong intro, concrete
  examples, a short FAQ, and a CTA.
- x: a thread of 5-7 tweets, each under 270 characters. Concise, native, end with a
  question. Separate each tweet with a line containing only "---".
- instagram: a 6-10 slide carousel that earns saves (ig-carousel). Slide 1 is the cover:
  a hook of 6 words or fewer. Slide 2 the stake, then one idea per slide (a 3-7 word
  headline, at most 25 words), a recap slide, and a last slide with one CTA. Separate each
  slide with a line containing only "---". Put only the slide text in body.
- facebook: a warm, educational post, 80-150 words, slightly more conversational than
  LinkedIn. End with a simple question to invite comments.
- reddit: a value-first post, 150-400 words, written as a member of the community, never
  as a brand. title = a specific, plain question or claim (no clickbait). No links and no
  pitch in the body; the cta is an invitation to discuss. End the body with "TL;DR:" and one line.
- youtube: a 45-second Short FILMING CARD the founder records. hook = the first spoken line
  (under 3 seconds). body = 3-5 beats separated by lines containing only "---"; each beat is
  "[ON SCREEN: short text]" on one line, then the spoken lines. cta = the last spoken line.`;

// ---- Writing frameworks -----------------------------------------------------------
// Proven post structures per platform. The first one is the default; the user can pick another
// per platform when drafting. `steps` is what the writer follows, in order.

export interface Framework { id: string; name: string; steps: string }

export const PLATFORM_FRAMEWORKS: Record<DraftPlatform, readonly Framework[]> = {
  linkedin: [
    { id: 'hook_story_lesson', name: 'Hook → Story → Lesson',
      steps: 'Line 1: a hook of at most 12 words that stops the scroll. Line 2: open a gap so they click "see more". A short real moment with one concrete detail. The turn: what you realised. 2-3 short takeaways. A soft CTA or a question that invites comments.' },
    { id: 'pas', name: 'Problem → Agitate → Solve',
      steps: 'Name the problem in the reader\'s own words. Show what it costs them to leave it (time, money, stress). Give the fix as 3 short steps. Close with a question about their version of the problem.' },
    { id: 'contrarian', name: 'Belief → Flip → Proof',
      steps: 'State the common belief. Flip it in one line. Explain the mechanism (why the truth holds). One example or proof we really have. A takeaway they can use today. Invite disagreement.' },
    { id: 'numbered', name: 'Numbered insights',
      steps: 'A promise line ("5 things … "). 3-7 numbered points, one line each plus why it matters. A one-line summary. A question.' },
  ],
  x: [
    { id: 'thread_numbered', name: 'Numbered thread',
      steps: 'Tweet 1 stands alone: the claim plus the promise of the thread. Tweets 2-6: one idea each, numbered, each useful on its own. Last tweet: a one-line recap and a question or follow ask.' },
    { id: 'single_insight', name: 'One insight, argued',
      steps: 'Tweet 1: a sharp claim. Tweet 2: the mechanism. Tweet 3: a concrete example. Tweet 4: the objection and the answer. Last tweet: the takeaway and a question.' },
  ],
  instagram: [
    { id: 'carousel_save', name: 'Save-worthy how-to carousel',
      steps: 'Slide 1: the hook as a promise. Slide 2: why it matters (the problem). Slides 3-5: one step or tip each. Slide 6: the CTA to save or share. Caption: front-load the keyword in the first 125 characters, then 3-5 niche hashtags.' },
    { id: 'carousel_myth', name: 'Myth → Truth carousel',
      steps: 'Slide 1: the myth people believe. Slide 2: why it is wrong. Slides 3-5: the truth as steps or examples. Slide 6: the CTA. Caption: the keyword first, then 3-5 niche hashtags.' },
  ],
  facebook: [
    { id: 'story_question', name: 'Story → Question',
      steps: 'A relatable moment. What happened. The takeaway in one or two lines. A simple question that people can answer from their own experience.' },
    { id: 'tip_discussion', name: 'Tip → Discussion',
      steps: 'One practical tip. Why it works. A tiny example. Ask people to share how they handle it.' },
  ],
  reddit: [
    { id: 'value_first', name: 'Value-first answer',
      steps: 'One line of context about who you are, no pitch. The detailed answer or how-to, with specifics. What did not work and why. "TL;DR:" and one line at the end.' },
    { id: 'lessons_learned', name: 'Lessons learned',
      steps: 'What you tried and the situation. 3-5 lessons, each with the concrete detail that taught it. What you would do differently. "TL;DR:" and one line at the end.' },
  ],
  blog: [
    { id: 'seo_howto', name: 'SEO how-to',
      steps: 'A title with the search phrase. An intro that answers the question in 2-3 sentences. One H2 section per step, each with an example. A short FAQ. A CTA.' },
  ],
  youtube: [
    { id: 'hook_beats_cta', name: 'Hook → Beats → CTA',
      steps: 'A spoken hook under 3 seconds. 3-5 beats, each with on-screen text and spoken lines. The CTA as the last spoken line.' },
  ],
};

/** The chosen framework for a platform, or its default (the first). */
export const frameworkFor = (platform: DraftPlatform, id?: string | null): Framework =>
  PLATFORM_FRAMEWORKS[platform].find((f) => f.id === id) ?? PLATFORM_FRAMEWORKS[platform][0]!;

/** The FRAMEWORKS block of a draft prompt: one structure per piece being written. */
export const frameworkBlock = (platforms: readonly DraftPlatform[], chosen: Partial<Record<DraftPlatform, string>> = {}) =>
  `FRAMEWORKS — build each piece on its structure, in this order:\n${platforms.map((p) => {
    const f = frameworkFor(p, chosen[p]);
    return `- ${p} (${f.name}): ${f.steps}`;
  }).join('\n')}`;

// ---- Video scripts beyond YouTube ---------------------------------------------------
// Picked on the idea card next to the platforms; written in their own call (prompts/scripts.ts)
// and filmed by a person (the Scripts desk), never auto-posted. YouTube Shorts stay a draft
// platform above.

export const SCRIPT_TARGETS = {
  instagram_reel: { platform: 'instagram', format: 'reel_script', name: 'Instagram Reel script',
    steps: '20-45 seconds. A spoken hook in the first 1.5 seconds with matching on-screen text (a pattern interrupt: a bold claim, a surprising visual or a "stop doing X"). 3-4 fast beats, one idea each, with [B-ROLL: …] cues. End on a line that loops back to the hook, and a CTA to save, share or comment a keyword. Captions carry the point with the sound off.' },
  linkedin_video: { platform: 'linkedin', format: 'short_script', name: 'LinkedIn video script',
    steps: '45-90 seconds. Subtitles-first: most watch with the sound off, so on-screen text carries every point. Open with why to listen (who you are and the problem) in under 5 seconds. Three beats: the problem, the insight, how to apply it. A calm, credible delivery. CTA: comment with their take, or follow for the next one.' },
  facebook_reel: { platform: 'facebook', format: 'reel_script', name: 'Facebook Reel script',
    steps: '30-60 seconds. Open with a relatable moment or story ("Last week a customer asked me…"). Conversational, warm, one main point. 3 beats with on-screen text. End with a simple question people can answer from their own life, to drive comments.' },
} as const;
export type ScriptTarget = keyof typeof SCRIPT_TARGETS;
export const isScriptTarget = (v: unknown): v is ScriptTarget => typeof v === 'string' && Object.hasOwn(SCRIPT_TARGETS, v);
