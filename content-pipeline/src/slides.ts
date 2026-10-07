// Instagram carousel slides: draft body ("---"-separated slide text) → 1080×1350 PNGs in the
// gold-on-black brand. SVG built by hand, rasterised by sharp (already installed with Next).
// ponytail: fixed wrap-by-character-count and system sans font; swap for a designed template
// (or satori with a bundled font) if slides need real typography.
import { brand } from './brand.ts';
import sharp from 'sharp';

const W = 1080, H = 1350, PAD = 110;
const GOLD = '#d4af37', INK = '#f5f1e6', BG = '#0b0b0c';

export const splitSlides = (body: string): string[] =>
  body.split(/^\s*---\s*$/m).map((s) => s.trim()).filter(Boolean);

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n+/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && (line + ' ' + word).length > maxChars) { lines.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
  }
  return lines;
}

export function slideSvg(text: string, n: number, total: number): string {
  // Short slides (hooks) get big type; longer ones shrink until they fit the frame.
  let size = 88, lines = wrap(text, 18);
  while (size > 44 && lines.length * size * 1.25 > H - 2 * PAD - 160) {
    size -= 8;
    lines = wrap(text, Math.floor((W - 2 * PAD) / (size * 0.55)));
  }
  const lh = size * 1.25;
  const top = (H - lines.length * lh) / 2 + size * 0.8;
  const color = n === 1 ? GOLD : INK;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<rect width="100%" height="100%" fill="${BG}"/>
<rect x="${PAD}" y="${PAD - 30}" width="120" height="8" fill="${GOLD}"/>
${lines.map((l, i) => `<text x="${PAD}" y="${top + i * lh}" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${size}" fill="${color}">${esc(l)}</text>`).join('\n')}
<text x="${PAD}" y="${H - PAD + 20}" font-family="Arial, Helvetica, sans-serif" font-size="32" fill="${GOLD}" letter-spacing="4">${esc(brand().name.toUpperCase())}</text>
<text x="${W - PAD}" y="${H - PAD + 20}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="32" fill="${INK}" opacity="0.6">${n}/${total}</text>
</svg>`;
}

/** One PNG per slide, in order. Throws if the body has no slides. */
export async function renderSlides(body: string): Promise<Buffer[]> {
  const slides = splitSlides(body);
  if (slides.length === 0) throw new Error('carousel has no slide text');
  return Promise.all(slides.map((s, i) => sharp(Buffer.from(slideSvg(s, i + 1, slides.length))).png().toBuffer()));
}
