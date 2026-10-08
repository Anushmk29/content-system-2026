// Where drafts go and how each platform is shaped. One place for the per-platform rules so
// drafting, scripts and carousels read the same playbook.

// Ideas come in from X and Reddit (Market Signals); drafts go out to these, LinkedIn = anchor.
// youtube = a 45-second Short filming card (a script to record, never auto-posted); opt-in, so it
// is not in the default set every selected topic gets.
export const DRAFT_PLATFORMS = ['linkedin', 'blog', 'x', 'instagram', 'facebook', 'youtube'] as const;
export type DraftPlatform = (typeof DRAFT_PLATFORMS)[number];
export const DEFAULT_DRAFT_PLATFORMS: readonly DraftPlatform[] = ['linkedin', 'blog', 'x', 'instagram', 'facebook'];

export const PIECE_NAME: Record<DraftPlatform, string> = {
  linkedin: 'LinkedIn post', blog: 'blog article', x: 'X thread', instagram: 'Instagram carousel', facebook: 'Facebook post',
  youtube: 'YouTube Short script',
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
- instagram: a 6-slide carousel that earns saves. Slide 1 is the hook, the last slide
  the CTA; at most 20 words per slide, one idea per slide. Separate each slide with a
  line containing only "---". Put only the slide text in body.
- facebook: a warm, educational post, 80-150 words, slightly more conversational than
  LinkedIn. End with a simple question to invite comments.
- youtube: a 45-second Short FILMING CARD the founder records. hook = the first spoken line
  (under 3 seconds). body = 3-5 beats separated by lines containing only "---"; each beat is
  "[ON SCREEN: short text]" on one line, then the spoken lines. cta = the last spoken line.`;
