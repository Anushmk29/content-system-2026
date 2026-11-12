// Examples: a design you like (one image, or a carousel's pages), kept as it is. The image model
// (Qwen Image 3 via OpenRouter, adapters/claude.ts) recreates it with our text, brand colours,
// logo and face: nothing is turned into a template. Saved in content.style_refs ("styles" in
// the code, "examples" on screen); style_prompt holds the description the model gets.
import sharp from 'sharp';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleContext } from '../modules/module.ts';
import { parseJsonObject, str } from '../modules/llm-json.ts';
import { PLACEMENTS, isRasterImage, logoBox, toSlides, type Placement, type SlideText } from '../creative.ts';
import { brandLook, getPhotos, loadBrand } from './brand-service.ts';
import type { Brand } from '../brand.ts';
import { mapLimit } from '../map-limit.ts';
import { STARTER_EXAMPLES } from '../starter-examples.ts';

export interface StyleRow {
  id: string; name: string; style_prompt: string; kind: 'image' | 'carousel'; pages: number;
  has_person: boolean; starter: string | null; aspect: string; analysis_cost_usd: number; created_at: string;
}

// Ratios the image model accepts.
const ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9'];

export function nearestAspect(w: number, h: number): string {
  const r = Math.log(w / h);
  return ASPECTS.reduce((best, a) => {
    const [x, y] = a.split(':').map(Number);
    const [bx, by] = best.split(':').map(Number);
    return Math.abs(Math.log(x! / y!) - r) < Math.abs(Math.log(bx! / by!) - r) ? a : best;
  });
}

const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;

const DESCRIBE_PROMPT = (n: number) => `You are an art director. ${n > 1 ? `These ${n} images are the pages of ONE social-media carousel, in order.` : 'This is one social-media post image.'} An image model will get ${n > 1 ? 'these pages' : 'this image'} as a reference and recreate the design for a different brand with different words, so describe the design precisely enough to copy.

Describe: the layout grid and where every element sits; background (colour, texture, photo); typography (serif/sans, weight, case, size hierarchy, alignment, any accent colour or highlight on certain words); colours as hex; graphic elements (cards, numbered badges, icons, tables, ticks and crosses, frames, rings, arrows, bars); any person (where they sit, how they are cut out or framed); ${n > 1 ? 'what each page is for (cover, content, closing) and what repeats on every page' : 'what each text block is for (title, list items, call to action bar)'}.
Name text blocks by role ("title", "subtitle", "item 1-8", "footer bar"), never by what they say. Leave out any brand names, handles, logos and the social app's own buttons or overlays.

Return ONLY JSON: {"description":"one dense paragraph, 100-200 words","has_person":true|false}`;

/** Upload → ≤1536px PNG (smaller vision bill, one stored format) + its nearest model aspect. */
async function normalise(image: Buffer): Promise<{ png: Buffer; aspect: string }> {
  if (!isRasterImage(image)) throw new Error('Use PNG, JPG or WebP images.');
  const img = sharp(image, { limitInputPixels: 4e7 }).rotate();
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new Error('not an image');
  return { png: await img.resize(1536, 1536, { fit: 'inside', withoutEnlargement: true }).png().toBuffer(), aspect: nearestAspect(meta.width, meta.height) };
}

const COLS = `id, name, style_prompt, kind, coalesce(array_length(pages, 1), 1) as pages, has_person, starter, aspect,
  analysis_cost_usd::float8 as analysis_cost_usd, created_at`;

async function insertExample(ctx: ModuleContext, e: { name: string; description: string; pages: Buffer[]; aspect: string; hasPerson: boolean; starter?: string; costUsd?: number }): Promise<StyleRow | undefined> {
  const r = await ctx.db.query<StyleRow>(
    `insert into content.style_refs (name, style_prompt, aspect, source_png, pages, kind, has_person, starter, analysis_cost_usd)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (starter) do nothing returning ${COLS}`,
    [e.name, e.description, e.aspect, e.pages[0], e.pages, e.pages.length > 1 ? 'carousel' : 'image', e.hasPerson, e.starter ?? null, e.costUsd ?? 0]);
  return r.rows[0];
}

/**
 * Save uploaded image(s) as an example: one image = a single post, several = a carousel's pages
 * in order. One vision call describes the design for the image model; nothing else is made.
 */
export async function createStyle(ctx: ModuleContext, input: { name: string; image?: Buffer; images?: Buffer[] }): Promise<StyleRow> {
  const name = input.name.trim();
  if (!name) throw new Error('name is required');
  const uploads = input.images?.length ? input.images : input.image ? [input.image] : [];
  if (uploads.length === 0) throw new Error('add an image');
  if (uploads.length > 10) throw new Error('at most 10 pages');
  const pages = await Promise.all(uploads.map(normalise));
  const { claude } = ctx.adapters;
  const before = claude.spentUsd;
  const small = await Promise.all(pages.map((p) => sharp(p.png, { limitInputPixels: 4e7 }).resize(1024, 1024, { fit: 'inside' }).png().toBuffer()));
  const o = parseJsonObject(await claude.complete(DESCRIBE_PROMPT(pages.length), { images: small.map(dataUrl), maxTokens: 1200 }));
  const description = str(o.description);
  if (description.length < 20) throw new Error('the design could not be described — try again');
  return (await insertExample(ctx, {
    name, description, pages: pages.map((p) => p.png), aspect: pages[0]!.aspect, hasPerson: o.has_person === true, costUsd: claude.spentUsd - before,
  }))!;
}

/** The built-in examples' image folder: next to src/ when run from source, two up from dist/src/. */
function starterDir(): string {
  // ponytail: read from disk; inline the images if a deploy stops shipping content-pipeline/assets.
  // Not `new URL(rel, import.meta.url)`: Next's bundler would try to import the folder.
  const here = dirname(fileURLToPath(import.meta.url));
  const dirs = [join(here, '..', 'assets', 'examples'), join(here, '..', '..', 'assets', 'examples'),
    join(process.cwd(), 'content-pipeline', 'assets', 'examples'), join(process.cwd(), 'assets', 'examples')];
  const dir = dirs.find((d) => existsSync(d));
  if (dir) return dir;
  throw new Error('built-in example images not found');
}

/** Add the built-in examples that aren't saved yet (idempotent; deleted ones come back). $0. */
export async function ensureStarterExamples(ctx: ModuleContext): Promise<void> {
  const have = new Set((await ctx.db.query<{ starter: string }>(`select starter from content.style_refs where starter is not null`)).rows.map((r) => r.starter));
  const missing = STARTER_EXAMPLES.filter((s) => !have.has(s.slug));
  if (!missing.length) return;
  const dir = starterDir();
  for (const s of missing) {
    const pages = await Promise.all(s.files.map((f) => normalise(readFileSync(join(dir, f)))));
    await insertExample(ctx, { name: s.name, description: s.description, pages: pages.map((p) => p.png), aspect: pages[0]!.aspect, hasPerson: s.hasPerson, starter: s.slug });
  }
}

export async function listStyles(ctx: ModuleContext): Promise<StyleRow[]> {
  return (await ctx.db.query<StyleRow>(`select ${COLS} from content.style_refs order by starter is not null, created_at desc`)).rows;
}

/** One page of an example (0 = the first). */
export async function getStyleImage(ctx: ModuleContext, id: string, page = 0): Promise<Buffer | null> {
  const r = await ctx.db.query<{ png: Uint8Array | null }>(
    `select coalesce(pages[$2::int + 1], case when $2::int = 0 then source_png end) as png from content.style_refs where id = $1`, [id, page]);
  const png = r.rows[0]?.png;
  return png ? Buffer.from(png) : null;
}

export async function renameStyle(ctx: ModuleContext, id: string, name: string): Promise<void> {
  if (!name.trim()) throw new Error('name is required');
  const r = await ctx.db.query(`update content.style_refs set name = $2 where id = $1`, [id, name.trim()]);
  if (!r.rowCount) throw new Error('Not found.');
}

export async function deleteStyle(ctx: ModuleContext, id: string): Promise<void> {
  await ctx.db.query(`delete from content.style_refs where id = $1`, [id]);
}

// ---- generate ----------------------------------------------------------------
export interface GenerateInput {
  /** A saved example, or… */
  styleId?: string;
  /** …one-off reference images (e.g. a competitor's post on Decode), used when there's no styleId. */
  refs?: Buffer[];
  placement: Placement;
  /** Slide text: "---" between slides; first paragraph of each slide = headline. */
  text: string;
  cta?: string;
  /** What the post is about: helps the model pick imagery. */
  brief?: string;
}
export interface GenerateResult { images: Buffer[]; costUsd: number; warnings: string[] }

const ONE_OFF_DESCRIPTION = 'Copy the design of the reference images closely: layout, background, typography, colours, graphic elements and the role of each text block.';

/** The words on one slide, as the model must render them. */
function slideWords(s: SlideText): string {
  return [
    s.kicker && `small line above the title: "${s.kicker}"`,
    `title: "${s.headline}"`,
    s.body && `supporting text: "${s.body}"`,
    s.label && `small tag: "${s.label}"`,
    s.cta && `call to action: "${s.cta}"`,
  ].filter(Boolean).join('\n');
}

const COPY_PROMPT = (description: string, slides: SlideText[], brief?: string) => `A designer is recreating this social-media design with our content:
${description}

Our content${brief ? ` (about: ${brief})` : ''}, ${slides.length === 1 ? 'for one image' : `one entry per page, ${slides.length} pages`}:
${slides.map((s, i) => `PAGE ${i + 1}\n${slideWords({ ...s, cta: undefined })}`).join('\n\n')}

Write the exact words for every text block of the design on each page, by role (title, subtitle, item 1, item 2 …, footer bar), using only our content: shorten it to fit the design, split it into the design's items or rows, and leave out blocks we have nothing true to say for. Keep our title's meaning. Leave out any call to action or "swipe" label: we add those. No names, handles or links that aren't in our content. Plain text, no emojis.

Return ONLY JSON: {"pages":[["role: text", "role: text"]]} with exactly ${slides.length} entr${slides.length === 1 ? 'y' : 'ies'}.`;

/**
 * Our slide text laid out for the design's text blocks (a grid needs 8 items, a table its rows):
 * one cheap text call for all pages. A slide it can't fill keeps its plain title / body.
 */
async function fitCopy(ctx: ModuleContext, description: string, slides: SlideText[], brief?: string): Promise<string[]> {
  let pages: unknown[] = [];
  try {
    const o = parseJsonObject(await ctx.adapters.claude.complete(COPY_PROMPT(description, slides, brief), { maxTokens: 2500 }));
    pages = Array.isArray(o.pages) ? o.pages : [];
  } catch (e) {
    ctx.logger.warn('copy fitting failed, using the slide text', { error: (e as Error).message });
  }
  return slides.map((s, i) => {
    const lines = Array.isArray(pages[i]) ? (pages[i] as unknown[]).map(str).filter(Boolean) : [];
    if (!lines.length) return slideWords(s);
    return [...lines, s.cta && `call to action: "${s.cta}"`].filter(Boolean).join('\n');
  });
}

/** The prompt for one slide. Pure: what references were sent is described by `refs`. */
export function slidePrompt(p: {
  description: string; words: string; i: number; n: number; brand: Pick<Brand, 'name' | 'palette' | 'headingFont' | 'bodyFont'>;
  refs: { cover: boolean; photo: boolean }; hasPerson: boolean; brief?: string; hasLogo: boolean;
}): string {
  const { i, n, brand: b } = p;
  const role = n === 1 ? 'a single social-media post image' : i === 0 ? `the cover (page 1 of ${n}) of a social-media carousel` : i === n - 1 ? `the closing page (page ${n} of ${n}) of a social-media carousel` : `page ${i + 1} of ${n} of a social-media carousel`;
  const person = !p.hasPerson ? ''
    : p.refs.photo ? 'The person in the design must be the person in the LAST reference image (same face and hair); use their likeness, a new pose is fine.'
    : 'Leave the person out: fill their space with a simple graphic or icon in the same style.';
  return [
    `Recreate the design of reference image 1 as ${role}, for a different brand and with different words.`,
    `The design: ${p.description}`,
    p.refs.cover ? 'Reference image 2 is the cover we already made for this carousel: match its colours, fonts and finish exactly so the pages look like one set.' : '',
    `Text to render, exactly as written (spelling and capitals), and no other words, numbers or labels:\n${p.words}`,
    p.brief ? `The post is about: ${p.brief}. Icons and pictures should fit this topic.` : '',
    `Brand: ${b.name || 'our brand'}.${b.palette.length ? ` Use these brand colours in place of the reference's accent colours: ${b.palette.join(', ')}.` : ''}${b.headingFont ? ` Title font like ${b.headingFont}.` : ''}${b.bodyFont ? ` Body font like ${b.bodyFont}.` : ''}`,
    'Replace every name, handle, website, logo and watermark from the reference with nothing (do not copy them).',
    p.hasLogo ? 'Leave a small empty area for our logo; do not draw any logo.' : '',
    person,
  ].filter(Boolean).join('\n\n');
}

/** Our logo pasted in the brand's corner (the model can't reproduce an exact logo). */
async function withLogo(png: Buffer, logo: Buffer | null | undefined, corner: Parameters<typeof logoBox>[3] | undefined): Promise<Buffer> {
  if (!logo) return png;
  const { width: W = 1080, height: H = 1350 } = await sharp(png).metadata();
  const m = await sharp(logo).metadata();
  const box = logoBox(W, H, (m.width ?? 1) / (m.height ?? 1), corner ?? 'br');
  const mark = await sharp(logo).resize(Math.round(box.w), Math.round(box.h), { fit: 'inside' }).png().toBuffer();
  return sharp(png).composite([{ input: mark, left: Math.round(box.x), top: Math.round(box.y) }]).png().toBuffer();
}

/**
 * An example (or one-off references) + our text → one finished PNG per slide. The cover is made
 * first and then sent with every other page, so the set looks consistent. ~3-4¢ per image.
 */
export async function generateCreative(ctx: ModuleContext, input: GenerateInput): Promise<GenerateResult> {
  const slides = toSlides(input.text, input.cta?.trim() || undefined);
  if (slides.length === 0) throw new Error('add some text');
  let description = ONE_OFF_DESCRIPTION, hasPerson = true, pages = input.refs ?? [];
  if (input.styleId) {
    const ex = (await ctx.db.query<{ style_prompt: string; has_person: boolean; pages: Uint8Array[] | null; source: Uint8Array }>(
      `select style_prompt, has_person, pages, source_png as source from content.style_refs where id = $1`, [input.styleId])).rows[0];
    if (!ex) throw new Error('example not found');
    description = ex.style_prompt; hasPerson = ex.has_person;
    pages = (ex.pages ?? [ex.source]).map((p) => Buffer.from(p));
  }
  if (!pages.length) throw new Error('pick an example or add a reference image');
  const target = PLACEMENTS[input.placement];
  const b = await loadBrand(ctx);
  const look = await brandLook(ctx);
  const photo = hasPerson ? (await getPhotos(ctx))[0] : undefined;
  const { claude } = ctx.adapters;
  const before = claude.spentUsd;

  const words = await fitCopy(ctx, description, slides, input.brief);
  const make = async (i: number, cover?: Buffer): Promise<Buffer> => {
    // Reference 1 = the example page in the same position (cover → page 1, last → last page), then our cover, then the face.
    const page = pages[i === 0 ? 0 : i === slides.length - 1 && slides.length > 1 ? pages.length - 1 : Math.min(i, pages.length - 1)]!;
    const refs = [page, ...(cover ? [cover] : []), ...(photo ? [photo] : [])];
    const prompt = slidePrompt({ description, words: words[i]!, i, n: slides.length, brand: b, refs: { cover: !!cover, photo: !!photo }, hasPerson, brief: input.brief, hasLogo: !!look.logo });
    const raw = await claude.generateImage(prompt, { images: refs.map(dataUrl), aspectRatio: target.aspect });
    const sized = await sharp(raw).resize(target.w, target.h, { fit: 'cover' }).png().toBuffer();
    return withLogo(sized, look.logo, look.logoCorner);
  };
  const cover = await make(0);
  const rest = await mapLimit(slides.slice(1), 3, (_, k) => make(k + 1, cover));
  return { images: [cover, ...rest], costUsd: claude.spentUsd - before, warnings: [] };
}
