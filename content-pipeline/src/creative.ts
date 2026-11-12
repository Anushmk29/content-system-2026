// Creative basics: where a creative is going (sizes), slide text parsing, the logo's box and the
// LinkedIn PDF. The pictures themselves come from the image model (services/style-service.ts).
import sharp from 'sharp';
import type { LogoCorner } from './brand.ts';

/** The brand's look for a creative: font families, palette and the logo (brand-service.brandLook). */
export interface Look { headingFont?: string | null; bodyFont?: string | null; logo?: Buffer | null; logoCorner?: LogoCorner; palette?: string[] }

/** Where the logo goes: ~14% of the width, at most 7% of the height, inside a 4% margin. */
export function logoBox(W: number, H: number, ratio: number, corner: LogoCorner): { x: number; y: number; w: number; h: number } {
  let w = W * 0.14, h = w / ratio;
  if (h > H * 0.07) { h = H * 0.07; w = h * ratio; }
  const m = Math.min(W, H) * 0.04;
  return { x: corner.endsWith('l') ? m : W - m - w, y: corner.startsWith('t') ? m : H - m - h, w, h };
}

/** Where a creative is going → pixel size and the image-model aspect ratio. */
export const PLACEMENTS = {
  instagram: { w: 1080, h: 1350, aspect: '4:5', label: 'Instagram feed / carousel' },
  instagram_square: { w: 1080, h: 1080, aspect: '1:1', label: 'Instagram square' },
  story: { w: 1080, h: 1920, aspect: '9:16', label: 'Story / Reel cover' },
  linkedin: { w: 1080, h: 1350, aspect: '4:5', label: 'LinkedIn post / document' },
  facebook: { w: 1080, h: 1350, aspect: '4:5', label: 'Facebook feed' },
  x: { w: 1600, h: 900, aspect: '16:9', label: 'X (Twitter)' },
} as const;
export type Placement = keyof typeof PLACEMENTS;
export const isPlacement = (p: unknown): p is Placement => typeof p === 'string' && p in PLACEMENTS;

export interface SlideText {
  headline: string; body?: string; cta?: string; /** step number for a badge */ number?: number;
  /** Lead-in line above the headline / small tag (layout templates only), from "kicker:" / "label:" lines. */
  kicker?: string; label?: string;
}

/**
 * "---"-separated slides; in each, the first paragraph is the headline and the rest the body.
 * Lines "kicker: …" and "label: …" anywhere in a slide fill those slots instead.
 */
export function toSlides(text: string, cta?: string): SlideText[] {
  const slides = text.split(/^\s*---\s*$/m).map((raw) => {
    const tags: Record<string, string> = {};
    const s = raw.replace(/^[ \t]*(kicker|label):[ \t]*(.*)$/gim, (_, k: string, v: string) => { tags[k.toLowerCase()] = v.trim(); return ''; }).trim();
    const [headline, ...rest] = s.split(/\n\s*\n/);
    return { headline: headline!.trim(), body: rest.join('\n\n').trim() || undefined, kicker: tags.kicker || undefined, label: tags.label || undefined };
  }).filter((s) => s.headline);
  // Carousel: "Swipe →" until the last slide, which carries the real CTA.
  return slides.map((s, i) => ({ ...s, cta: i < slides.length - 1 ? 'Swipe →' : cta }));
}

/**
 * Slides → one PDF, a full-page JPEG per page (LinkedIn posts carousels as PDF "documents").
 * Hand-written: a PDF of images is just page objects + DCT-encoded image streams.
 */
export async function toPdf(pngs: Buffer[]): Promise<Buffer> {
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (b: Buffer | string) => { const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b; parts.push(buf); size += buf.length; };
  const obj = (n: number, body: string, stream?: Buffer) => {
    offsets[n] = size;
    push(`${n} 0 obj\n${body}\n`);
    if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
    push('endobj\n');
  };
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const pages = await Promise.all(pngs.map(async (p) => {
    const { data, info } = await sharp(p).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
    return { jpg: data, w: info.width, h: info.height };
  }));
  // Objects: 1 catalog, 2 pages, then per page k: page 3+3k, content 4+3k, image 5+3k.
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, k) => `${3 + 3 * k} 0 R`).join(' ')}] >>`);
  pages.forEach(({ jpg, w, h }, k) => {
    const draw = Buffer.from(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`, 'latin1');
    obj(3 + 3 * k, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${5 + 3 * k} 0 R >> >> /Contents ${4 + 3 * k} 0 R >>`);
    obj(4 + 3 * k, `<< /Length ${draw.length} >>`, draw);
    obj(5 + 3 * k, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>`, jpg);
  });
  const xref = size, count = 3 + 3 * pages.length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}


/** PNG, JPEG, WebP or GIF by magic bytes. Uploads are checked with this before sharp sees them, so
 *  SVG (librsvg, can reference external files), HEIF and other wider decoders never get user bytes. */
export function isRasterImage(b: Buffer): boolean {
  const head = b.subarray(0, 12).toString('latin1');
  return head.startsWith('\x89PNG') || head.startsWith('\xff\xd8\xff') || head.startsWith('GIF8')
    || (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP');
}
