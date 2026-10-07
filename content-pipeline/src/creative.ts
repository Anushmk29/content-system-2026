// Creative rendering: a style's background + our own text, drawn in code (exact spelling, no
// AI typos) into the text zones measured from the original example. Pure apart from sharp.
// Brand fonts (fonts.ts) and the logo come in as a Look; without one, system serif/sans.
// ponytail: char-count wrapping (like slides.ts); swap for satori if creatives need precise typography.
import sharp from 'sharp';
import { esc, wrap } from './slides.ts';
import type { StyleSpec, TextZone } from './services/style-service.ts';
import type { LogoCorner } from './brand.ts';

/** The brand's look for a creative: registered font families and the logo (brand-service.brandLook). */
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

const DEFAULT_ZONES: TextZone[] = [
  { role: 'headline', x: 0.08, y: 0.18, w: 0.84, h: 0.14 },
  { role: 'body', x: 0.08, y: 0.42, w: 0.84, h: 0.3 },
];

type Zone = TextZone & { maxH: number };

/**
 * Zones to draw into. Headline + body are one text column that flows from the headline's top
 * down to `limit` (the next thing below: button, logo, or the bottom margin); the headline may
 * take up to half of it and the body starts right under wherever the headline actually ends.
 */
export function layoutZones(zones: TextZone[], obstacles: TextZone[] = []): { headline: Zone; body: Zone; cta: Zone | undefined; limit: number } {
  const zs = [...(zones.some((z) => z.role === 'headline') ? zones : DEFAULT_ZONES), ...obstacles].filter((z) => z.w > 0.05);
  const pick = (role: string) => zs.find((z) => z.role === role);
  const headline = pick('headline')!;
  // No body zone in the example → put the body straight under the headline.
  const body = pick('body') ?? { role: 'body', x: headline.x, y: headline.y + headline.h + 0.02, w: headline.w, h: 0.2 };
  const cta = pick('cta');
  // A zone is as wide as the example's text happened to be ("73%" → narrow). Headline and body
  // sharing a left edge form one text column: both get the column's full width.
  const column = Math.abs(headline.x - body.x) < 0.03 ? Math.max(headline.w, body.w) : 0;
  // The column stops at the first other thing below it that it would run into (button, divider,
  // graphic, logo — not a step badge, which heads the column); things off to the side don't cap it.
  const colW = Math.max(headline.w, column);
  const limit = Math.min(0.94, ...zs.filter((z) => !['headline', 'body', 'number'].includes(z.role) && z.y > headline.y + 0.01
    && z.x < headline.x + colW && z.x + z.w > headline.x).map((z) => z.y)) - 0.02;
  return {
    headline: { ...headline, w: colW, maxH: Math.min(limit - headline.y, Math.max(headline.h, (limit - headline.y) / 2)) },
    body: { ...body, w: Math.max(body.w, column), maxH: Math.max(body.h, limit - body.y) },
    cta: cta && { ...cta, maxH: cta.h },
    limit,
  };
}

/** Largest font size (≤ max) at which `text` fits a w×h px box. */
export function fitText(text: string, w: number, h: number, max: number): { size: number; lines: string[] } {
  for (let size = Math.round(max); ; size -= 4) {
    // 0.6em ≈ average bold sans glyph width; erring wide keeps text out of neighbouring shapes.
    const lines = wrap(text, Math.max(4, Math.floor(w / (size * 0.6))));
    if (size <= 22 || lines.length * size * 1.2 <= h) return { size: Math.max(size, 22), lines };
  }
}

const rgb = (hex: string) => {
  const n = hex.replace('#', '');
  const f = n.length === 3 ? n.split('').map((c) => c + c).join('') : n.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};
const lumOf = (hex: string) => { const [r, g, b] = rgb(hex); return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255; };

/** Mean luminance (0-1) of a zone. Crops to a buffer first: sharp's stats() ignores extract(). */
async function zoneLum(bg: Buffer, W: number, H: number, z: TextZone): Promise<number> {
  const left = Math.min(W - 1, Math.round(z.x * W)), top = Math.min(H - 1, Math.round(z.y * H));
  const box = { left, top, width: Math.max(1, Math.min(W - left, Math.round(z.w * W))), height: Math.max(1, Math.min(H - top, Math.round(z.h * H))) };
  const { channels } = await sharp(await sharp(bg).extract(box).toBuffer()).stats();
  return (0.2126 * channels[0]!.mean + 0.7152 * channels[1]!.mean + 0.0722 * channels[2]!.mean) / 255;
}

/** Text colour that reads on a background of luminance `lum`, from the palette when one fits. */
export function inkOn(lum: number, palette: string[]): string {
  // Dark → lightest brand colour (or white); light → darkest brand colour (or near-black).
  const sorted = [...palette].sort((a, b) => lumOf(a) - lumOf(b));
  return lum < 0.5
    ? (sorted.length && lumOf(sorted.at(-1)!) > 0.75 ? sorted.at(-1)! : '#ffffff')
    : (sorted.length && lumOf(sorted[0]!) < 0.25 ? sorted[0]! : '#111111');
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

/** How far down open background goes under a column [x0, x1] from y0 (fractions of the frame). */
export type Room = (x0: number, x1: number, y0: number) => number;

/**
 * The open background around the text column, read from the template itself (pixel maths, $0):
 * a 72-cell-wide grid flood-filled from `seed` over cells whose colour changes only gradually.
 * Gradients and paper textures pass; shapes, divider lines and photos stop it. null when the
 * area is too small to trust (busy photo template); callers then keep the example's zones.
 */
export async function freeRegion(bg: Buffer, seed: { x: number; y: number }): Promise<Room | null> {
  const { data, info } = await sharp(bg).resize(72, null).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const gw = info.width, gh = info.height;
  const near = (a: number, b: number) => Math.abs(data[a * 3]! - data[b * 3]!) < 14
    && Math.abs(data[a * 3 + 1]! - data[b * 3 + 1]!) < 14 && Math.abs(data[a * 3 + 2]! - data[b * 3 + 2]!) < 14;
  const open = new Uint8Array(gw * gh);
  const cell = (v: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(v * n)));
  const stack = [cell(seed.y, gh) * gw + cell(seed.x, gw)];
  open[stack[0]!] = 1;
  let count = 0;
  while (stack.length) {
    const i = stack.pop()!, c = i % gw;
    count++;
    for (const j of [c > 0 ? i - 1 : -1, c < gw - 1 ? i + 1 : -1, i - gw, i + gw]) {
      if (j >= 0 && j < open.length && !open[j] && near(i, j)) { open[j] = 1; stack.push(j); }
    }
  }
  if (count < 0.08 * gw * gh) return null;
  return (x0, x1, y0) => {
    // One cell of padding on the right and below, so text never touches what stopped the fill.
    const c0 = cell(x0, gw), c1 = Math.min(gw - 1, Math.ceil(x1 * gw));
    let r = cell(y0, gh);
    while (r < gh && open.subarray(r * gw + c0, r * gw + c1 + 1).every(Boolean)) r++;
    return Math.max(0, (r - 1) / gh - y0);
  };
}

export interface TextPlan {
  x: number; w: number;
  head: { size: number; lines: string[] }; body: { size: number; lines: string[] };
  /** Text didn't fit even at the smallest readable sizes; it was cut with "…". */
  overflow: boolean;
}

const wrapAt = (text: string, wPx: number, size: number) => wrap(text, Math.max(4, Math.floor(wPx / (size * 0.6))));

/**
 * Where and how big this slide's headline + body go. Keeps the example's column when the text
 * fits it at a comfortable size; longer text first widens the column into open background
 * (`room`), then shrinks the type down to readable floors; text that still doesn't fit is cut
 * with "…" and flagged. Never drawn over graphics, past the button or off the slide.
 */
export function planText(slide: SlideText, zones: ReturnType<typeof layoutZones>, W: number, H: number, center: boolean, room: Room | null): TextPlan {
  const hz = zones.headline, y = hz.y;
  const minHead = Math.round(W / 20), minBody = Math.round(Math.max(24, W / 42));
  const bodyMax = (s: number) => Math.min(60, W / 18, Math.max(W / 26, s * 0.5));
  // Columns to try: the example's first, then 6% wider each step, up to the frame margins.
  // Without a readable template (room = null) there's no telling what's beside it: example only.
  const cands = [{ x: hz.x, w: hz.w }];
  for (let w = hz.w + 0.06; room; w += 0.06) {
    const x = center ? hz.x + hz.w / 2 - w / 2 : hz.x;
    if (x < 0.05 || x + w > 0.95) break;
    cands.push({ x, w });
  }
  const avail = (c: { x: number; w: number }) => Math.min(zones.limit - y, room ? room(c.x, c.x + c.w, y) : Infinity) * H;
  const gap = 0.025 * H;
  type Col = { x: number; w: number };
  // Headline at size s + body at size b in column c, or null if it doesn't fit.
  const at = (c: Col, s: number, b: number) => {
    const a = avail(c), wPx = c.w * W;
    const hl = wrapAt(slide.headline, wPx, s), hH = hl.length * s * 1.2;
    if (hH > a * (slide.body ? 0.6 : 1)) return null;
    const bl = slide.body ? wrapAt(slide.body, wPx, b) : [];
    if (slide.body && hH + gap + bl.length * b * 1.2 > a) return null;
    return { ...c, head: { size: s, lines: hl }, body: { size: slide.body ? b : 0, lines: bl }, overflow: false };
  };
  // 1. Comfortable sizes (headline ≥ 1.5× its floor, body ≥ 75% of full size) in the narrowest
  //    column that takes them, so long text widens the column before it shrinks.
  const comfyBody = Math.max(minBody, bodyMax(150) * 0.75);
  for (const c of cands) {
    for (let s = 150; s >= minHead * 1.5; s -= 4) {
      for (let b = Math.round(bodyMax(s)); b >= comfyBody; b -= 2) { const p = at(c, s, b); if (p) return p; }
    }
  }
  // 2. Otherwise readability first: the largest body that fits in any column, with the biggest
  //    headline that still sits above it in the hierarchy (body ≤ bodyMax(headline)).
  for (let b = Math.round(bodyMax(150)); b >= minBody; b -= 2) {
    for (const c of cands) {
      for (let s = 150; s >= minHead && b <= bodyMax(s); s -= 4) { const p = at(c, s, b); if (p) return p; }
    }
  }
  // Doesn't fit anywhere: the roomiest column at the smallest sizes, cut to the space with "…".
  const c = cands.reduce((best, k) => (avail(k) * k.w > avail(best) * best.w ? k : best));
  const a = avail(c);
  const cut = (ls: string[], n: number) => (ls.length <= n ? ls : n === 0 ? [] : [...ls.slice(0, n - 1), `${ls[n - 1]!.replace(/\W*$/, '')}…`]);
  const hl = cut(wrapAt(slide.headline, c.w * W, minHead), Math.max(1, Math.floor((a * (slide.body ? 0.6 : 1)) / (minHead * 1.2))));
  const left = a - hl.length * minHead * 1.2 - gap;
  const bl = slide.body ? cut(wrapAt(slide.body, c.w * W, minBody), Math.max(0, Math.floor(left / (minBody * 1.2)))) : [];
  return { ...c, head: { size: minHead, lines: hl }, body: { size: minBody, lines: bl }, overflow: true };
}

/**
 * One finished PNG: background (any size, cover-cropped to the placement) + this slide's text,
 * laid out for its length (planText). `notes` collects anything the viewer should fix.
 */
export async function renderCreative(background: Buffer, spec: StyleSpec, placement: Placement, slide: SlideText,
  page?: { n: number; total: number }, notes?: string[], look: Look = {}): Promise<Buffer> {
  const { w: W, h: H } = PLACEMENTS[placement];
  const bg = await sharp(background).resize(W, H, { fit: 'cover' }).png().toBuffer();
  // The logo is placed first and counts as an obstacle, so text stops before it.
  const corner = look.logoCorner ?? 'br';
  const logo = look.logo ? await (async () => {
    const m = await sharp(look.logo!).metadata();
    const box = logoBox(W, H, (m.width ?? 1) / (m.height ?? 1), corner);
    const png = await sharp(look.logo!).resize(Math.round(box.w), Math.round(box.h), { fit: 'inside' }).png().toBuffer();
    return { box, png };
  })() : null;
  const obstacles: TextZone[] = logo ? [{ role: 'logo', x: logo.box.x / W, y: logo.box.y / H, w: logo.box.w / W, h: logo.box.h / H }] : [];
  const zones = layoutZones(spec.text_zones, obstacles);
  const SERIF = 'Georgia, \'Times New Roman\', serif', SANS = 'Arial, Helvetica, sans-serif';
  const styleFont = /\bserif\b/i.test(spec.typography) && !/sans/i.test(spec.typography) ? SERIF : SANS;
  const styleHead = spec.headline_font ? (spec.headline_font === 'serif' ? SERIF : SANS) : styleFont;
  // Brand fonts win over the style's serif/sans guess, which stays as the fallback.
  const fam = (f: string | null | undefined, fallback: string) => (f ? `'${f.replace(/['"<>&]/g, '')}', ${fallback}` : fallback);
  const font = fam(look.bodyFont, styleFont), headFont = fam(look.headingFont, styleHead);
  // Brand colours join the style's as text-colour candidates (inkOn takes the darkest/lightest that reads).
  const palette = [...(look.palette ?? []), ...spec.palette];
  const center = spec.align ? spec.align === 'center' : /\bcent(er|re)/i.test(spec.typography) && !/left/i.test(spec.typography);
  // A centred column measured from the example's (short) text is widened symmetrically about its centre.
  const widen = (z: Zone): Zone => {
    if (!center) return z;
    const c = z.x + z.w / 2, w = Math.max(z.w, 2 * Math.min(c, 1 - c) - 0.16);
    return { ...z, x: c - w / 2, w };
  };

  // Headline + body: sized and placed for THIS slide's text, inside the open background of THIS
  // template (see planText); the body flows in right under the headline.
  const base = widen(zones.headline);
  const room = await freeRegion(bg, { x: base.x + 0.01, y: base.y + 0.01 });
  const plan = planText(slide, { ...zones, headline: base }, W, H, center, room);
  if (plan.overflow) notes?.push('text too long for this layout, so it was cut short. Shorten it or split it across two slides.');
  const draw = async (t: { size: number; lines: string[] }, top: number, weight: number, family: string) => {
    if (!t.lines.length) return '';
    const fill = inkOn(await zoneLum(bg, W, H, { role: 't', x: plan.x, y: top / H, w: plan.w, h: (t.lines.length * t.size * 1.2) / H }), palette);
    const x = center ? (plan.x + plan.w / 2) * W : plan.x * W;
    return t.lines.map((l, i) => `<text x="${x}" y="${top + t.size * (0.9 + i * 1.2)}"${center ? ' text-anchor="middle"' : ''} font-family="${family}" font-weight="${weight}" font-size="${t.size}" fill="${fill}">${esc(l)}</text>`).join('\n');
  };
  const headTop = base.y * H, headH = plan.head.lines.length * plan.head.size * 1.2;
  const head = { svg: await draw(plan.head, headTop, headFont.endsWith(SERIF) ? 700 : 800, headFont) };
  const body = { svg: await draw(plan.body, headTop + (headH ? headH + 0.025 * H : 0), 500, font) };

  // One line of text centred in a shape: the CTA button (a pill) or a step-number badge (rounded
  // square). With a sampled shape we draw it ourselves at the example's proportions (scaled to
  // fit this frame, so 16:9 doesn't stretch it); otherwise the text goes into whatever the
  // background has there.
  const inShape = async (z: TextZone, text: string, shape: StyleSpec['button'], round: number, maxFrac: number, family: string) => {
    const scale = shape ? Math.min(W, H / shape.ratio) : 0;
    const bh = shape ? z.h * shape.ratio * scale : z.h * H;
    let bw = shape ? z.w * scale : z.w * W, bx = z.x * W;
    // Longer text than the example's → a wider shape (from its centre when centred), not tiny text.
    const need = shape ? (text.length * bh * maxFrac * 0.6) / 0.84 : 0;
    if (need > bw) {
      const nw = Math.min(need, W * 0.88);
      if (center) bx -= (nw - bw) / 2;
      bw = nw;
      bx = Math.max(W * 0.05, Math.min(bx, W * 0.95 - bw));
    }
    const by = Math.min(z.y * H, H * 0.95 - bh);
    const { size } = fitText(text, bw * 0.84, bh * 0.62, bh * maxFrac);
    const fill = inkOn(shape ? lumOf(shape.color) : await zoneLum(bg, W, H, z), palette);
    return `${shape ? `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${Math.min(bw, bh) * round}" fill="${shape.color}"/>` : ''}
<text x="${bx + bw / 2}" y="${by + bh / 2 + size * 0.35}" text-anchor="middle" font-family="${family}" font-weight="700" font-size="${size}" fill="${fill}">${esc(text)}</text>`;
  };
  const cz = zones.cta, nz = spec.text_zones.find((z) => z.role === 'number');
  const cta = cz && slide.cta ? await inShape(cz, slide.cta, spec.button, 0.5, 0.42, font) : '';
  const badge = nz && spec.badge && slide.number ? await inShape(nz, String(slide.number), spec.badge, 0.13, 0.62, headFont) : '';
  // Page counter bottom-right, or bottom-left when the logo sits there.
  const left = !!logo && corner === 'br';
  const counter = page && page.total > 1
    ? `<text x="${W * (left ? 0.06 : 0.94)}" y="${H * 0.96}" text-anchor="${left ? 'start' : 'end'}" font-family="${font}" font-size="${Math.round(W / 36)}" fill="${inkOn(await zoneLum(bg, W, H, { role: 'n', x: left ? 0.05 : 0.85, y: 0.93, w: 0.1, h: 0.04 }), palette)}" opacity="0.7">${page.n}/${page.total}</text>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${head.svg}\n${body.svg}\n${cta}${badge}${counter}</svg>`;
  return sharp(bg).composite([
    { input: Buffer.from(svg) },
    ...(logo ? [{ input: logo.png, left: Math.round(logo.box.x), top: Math.round(logo.box.y) }] : []),
  ]).png().toBuffer();
}
