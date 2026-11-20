const DIVIDER = /^\s*---\s*$/m;
const MARKER = /^\s*(?:slide\s*\d+|\d{1,2}\s*[.)/])\s*[:.\-–—]?\s*/im;

/**
 * A carousel body → its slides. The drafts separate slides with "---" lines, but some bodies come
 * back as "Slide 1: …" / "1. …" sections or plain paragraphs; those used to count as one slide
 * and got one image. Non-carousel text keeps the plain "---" split.
 */
export function carouselSlides(body: string, carousel = true): string[] {
  const split = body.split(DIVIDER).map((s) => s.trim()).filter(Boolean);
  if (!carousel || split.length > 1) return split;
  const text = split[0] ?? '';
  if (MARKER.test(text)) {
    // "Slide 3:" is a drafting label, not slide text; a "3." list number is kept.
    return text.split(new RegExp(`(?=${MARKER.source})`, 'im'))
      .map((s) => s.replace(/^\s*slide\s*\d+\s*[:.\-–—]?\s*/i, '').trim()).filter(Boolean);
  }
  return text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
}
