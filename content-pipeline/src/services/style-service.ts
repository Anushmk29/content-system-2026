// Style references: upload an example creative once → the LLM turns it into a content-free
// style prompt + spec, and the image model makes a "blank plate" (same layout and look, no
// words or subject). Both are saved, so future creatives reuse the stored prompt and never
// pay to re-analyse the example.
import sharp from 'sharp';
import type { ModuleContext } from '../modules/module.ts';
import { parseJsonObject } from '../modules/llm-json.ts';
import { PLACEMENTS, renderCreative, toSlides, type Placement, type SlideText } from '../creative.ts';
import { brandSystem } from '../prompts/brand-brain.ts';
import { brandLook, loadBrand } from './brand-service.ts';
import { describeClash, parseTemplateReply, renderTemplate, splitItems, textClashes, type Template } from '../template.ts';

export interface TextZone { role: string; x: number; y: number; w: number; h: number }
export interface StyleSpec {
  palette: string[]; typography: string; layout: string; mood: string; avoid: string; text_zones: TextZone[];
  /** The example's button, redrawn in code on every creative: colour sampled from the example, ratio = example height / width. */
  button?: { color: string; ratio: number };
  /** A numbered step badge ("1", "2" …), redrawn in code like the button. */
  badge?: { color: string; ratio: number };
  /** Per-layout overrides of what `typography` implies (carousels mix centred covers with left-aligned content). */
  align?: 'left' | 'center';
  headline_font?: 'serif' | 'sans';
  /** Carousel styles only: one entry per distinct slide layout ('main' = the first slide's, kept in style_refs). */
  layouts?: Record<string, LayoutSpec>;
  /** Carousel styles only: the example's slides in order, as layout ids. */
  sequence?: string[];
  /** Carousel styles only: how the example is written, as a recipe for a new topic. */
  structure?: string;
  /** The example rebuilt as a layout template (template.ts). Styles saved before templates have none and use the painted-text path. */
  tpl?: Template;
}
export const SLIDE_KINDS = ['cover', 'content', 'list', 'stat', 'quote', 'cta'] as const;
export type SlideKind = (typeof SLIDE_KINDS)[number];
export type LayoutSpec = { kind: SlideKind; text_zones: TextZone[] } & Pick<StyleSpec, 'button' | 'badge' | 'align' | 'headline_font' | 'tpl'>;
export interface StyleRow {
  id: string; name: string; style_prompt: string; spec: StyleSpec; aspect: string;
  has_plate: boolean; analysis_cost_usd: number; use_count: number; created_at: string;
}

// Ratios the image model accepts (OpenRouter image_config.aspect_ratio).
const ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

export function nearestAspect(w: number, h: number): string {
  const r = Math.log(w / h);
  return ASPECTS.reduce((best, a) => {
    const [x, y] = a.split(':').map(Number);
    const [bx, by] = best.split(':').map(Number);
    return Math.abs(Math.log(x! / y!) - r) < Math.abs(Math.log(bx! / by!) - r) ? a : best;
  });
}

const ANALYSE_PROMPT = `You are an art director. Describe the VISUAL STYLE of this social-media creative so a designer could make new, different posts that look like they belong to the same series.

Describe only reusable style: composition and layout grid, colour palette (hex), background treatment, lighting, photo/illustration style, graphic elements (shapes, lines, frames, icons, textures), typography (weight, case, serif/sans, size hierarchy, alignment), spacing, mood.
Do NOT describe the subject matter, the specific people/products, or what the words say.

Return ONLY JSON:
{
  "style_prompt": "one dense paragraph (80-150 words), written as an image-generation prompt for a NEW image in this style, with no words in the image",
  "palette": ["#hex", ...],
  "typography": "how text is set (for overlaying our own text later)",
  "layout": "where things sit, e.g. 'headline top-left third, visual bottom-right, logo bottom-left'",
  "mood": "3-6 words",
  "avoid": "what would break the style",
  "text_zones": [{"role":"headline|body|cta|logo","x":0.0,"y":0.0,"w":0.0,"h":0.0}]
}
text_zones are where text sits in the example, as 0-1 fractions of width/height.`;

// Image models reliably REMOVE things but can't reliably "keep the button, empty its inside"
// (they drop it, keep its arrow, or sketch placeholder bars). So the template is background +
// decorative graphics only, and the button is redrawn in code from the example (spec.button).
const PLAIN_TEXT_AREAS = 'Remove every button, pill, badge, logo and wordmark too. Where text, buttons or logos were, leave plain, uninterrupted background: no placeholder boxes, bars, lines or blocks.';

const PLATE_PROMPT = (stylePrompt: string) => `Recreate this exact design as an empty background template: keep the same background, colours, lighting, decorative shapes, frames and composition, but REMOVE all text, letters, numbers, logos and the specific subject/person/product. Keep every thin edge bar, rule and border exactly where it is, and add none. ${PLAIN_TEXT_AREAS} Style notes: ${stylePrompt}`;

// Narrow on purpose: a vague "placeholder lines" check flags the style's own accent bars.
const PLATE_CHECK_PROMPT = `This should be an EMPTY background template. Decorative shapes, accent bars and lines are FINE. Only flag these leftovers: any text, letters, numbers, logos or wordmarks (even tiny or garbled); buttons or pills; arrows or icons; stacks of grey bars that look like redacted lines of text.
Return ONLY JSON: {"clean": true|false, "issues": "short list of what is wrong, with where it is"}`;

/** A vision reply as JSON, or {} when it's missing/garbled — callers then fall back to defaults. */
async function askJson(ctx: ModuleContext, prompt: string, png: Buffer): Promise<Record<string, unknown>> {
  try {
    return parseJsonObject(await ctx.adapters.claude.complete(prompt, { images: [dataUrl(png)], maxTokens: 1000 }));
  } catch (e) {
    ctx.logger.warn('vision reply unusable', { error: (e as Error).message });
    return {};
  }
}

/**
 * Image models improvise (keep an arrow, invent garbled text), so every template is
 * checked by one cheap vision call and remade once with the named problems if it isn't clean.
 * Templates are made once per style + shape, so this cost is one-off too.
 */
async function makePlate(ctx: ModuleContext, prompt: string, ref: Buffer, aspect: string): Promise<Buffer> {
  const { claude } = ctx.adapters;
  let plate: Buffer = Buffer.alloc(0), fix = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    plate = await sharp(await claude.generateImage(prompt + fix, { images: [dataUrl(ref)], aspectRatio: aspect })).png().toBuffer();
    const check = await askJson(ctx, PLATE_CHECK_PROMPT, plate);
    if (check.clean !== false) break;
    fix = `\nA previous attempt got this wrong — avoid it: ${str(check.issues) || 'leftover text or placeholder shapes'}.`;
    ctx.logger.warn('template not clean, remaking once', { issues: check.issues });
  }
  return plate;
}

// ---- layout templates (template.ts) -----------------------------------------------
// The example rebuilt as HTML with text slots, then compared with the example once and corrected,
// so the saved template already looks like the example before anyone uses it.

/** Pixel frame a template is written at: the placement size for that shape, else 1080 wide. */
export function frameFor(aspect: string): { w: number; h: number } {
  const p = Object.values(PLACEMENTS).find((x) => x.aspect === aspect);
  if (p) return { w: p.w, h: p.h };
  const [x, y] = aspect.split(':').map(Number);
  return { w: 1080, h: Math.round((1080 * y!) / x!) };
}

const RULES = (w: number, h: number) => `Renderer rules (Satori; anything else breaks):
- One root <div> exactly ${w}px wide and ${h}px tall, style "display:flex; position:relative; overflow:hidden".
- Inline style="" only. No classes, <style>, CSS grid, display:block or inline, calc(), vh/vw, or external URLs.
- Every element with more than one child needs display:flex. Position with flex (direction, gap, padding, margin, justify/align) or position:absolute with px top/left/right/bottom.
- Shapes: divs with background, border, border-radius, linear-gradient; or inline <svg> with width and height (polygons, paths, circles, lines, arrows, icons).
- Sizes in px, measured from the example at ${w}px wide.
- font-family: the closest Google Fonts family to each typeface in the example (e.g. Inter, Outfit, Manrope, Space Grotesk, DM Sans, Poppins, Archivo, Oswald, Bebas Neue, Playfair Display, DM Serif Display, Fraunces, Lora, Instrument Serif, Space Mono, JetBrains Mono). List every family you use in "fonts".

Text: never write the example's words into the template. Each piece of text is a slot, alone in its own element:
{{headline}} main headline · {{body}} supporting text · {{kicker}} small lead-in line above the headline · {{label}} small tag, caption, section or footer label · {{cta}} button text · {{number}} step number · {{item}} one entry of a list, diagram or row of cards.
- Page counter: its own element with "{{page}} / {{total}}" ("{{page2}} / {{total2}}" for zero-padded 02 / 04).
- Logo or avatar: <img src="{{logo}}" width=".." height=".." style="object-fit:contain">.
- Lists, diagrams, card rows: build ONE item with data-each="items"; it is repeated for every item of the new post (2-6), so lay items out with flex (wrap or column) so any count fits. Keep the diagram's look (boxes, icons, numbering, separators); drop connectors that only work for an exact count.
- Words shown in a second colour or highlighted: new text marks them *like this*; set "accent" to that colour.
- Put data-if="<slot>" on a wrapper (pill, box, divider) that belongs to that text and must disappear when the slot is empty.
- Text elements: set font-size, font-weight, line-height, color, letter-spacing, text-transform, text-align, and a max-width so text wraps where the example's did. Leave room below for longer text.

Background: draw flat colours, gradients, frames and shapes yourself. Only when the example has a photo, illustration or texture that HTML can't draw, set "background":"image" and make the root's first child <img src="{{bg}}" width="${w}" height="${h}" style="position:absolute;top:0;left:0">. That picture is the example with all text, buttons, pills, badges and logos removed (its shapes and imagery kept), so on top of it draw only those removed things.`;

const REPLY_FORMAT = `Reply in two parts:
1. JSON: {"fonts":["Family"],"accent":"#hex or null","background":"none|image","sample":{"headline":"","body":"","kicker":"","label":"","cta":"","items":[]}}
   "sample" = the example's own words in each slot you used, with *accent words* marked ("" for slots you didn't use).
2. The template in one \`\`\`html block.`;

const TEMPLATE_PROMPT = (w: number, h: number, context: string) => `You are a senior front-end designer. Rebuild this social-media design as a reusable layout template: HTML with inline styles, rendered to a ${w}×${h} PNG. New posts will put different words into it, so it must look like the same series. Match the example closely: positions, sizes, typefaces, weights, letter-spacing, colours, rules, frames, pills, shapes and icons.
${context}
${RULES(w, h)}

${REPLY_FORMAT}`;

const metaOf = (t: Template) => JSON.stringify({ fonts: t.fonts, accent: t.accent ?? null, background: t.background, sample: t.sample });

const FIX_PROMPT = (t: Template, rendered: boolean, err: string, note?: string, clashes: string[] = []) => `Image 1 is the original design.${rendered ? ' Image 2 is our layout template rendered with the original\'s words. Image 3 is the same template with much longer text, as real posts will have.' : ''}
${note
    ? `The user looked at the template and asks: "${note}". Make that change and keep everything else.`
    : rendered ? 'Compare images 1 and 2 closely: the position and size of every element, typefaces and weights, letter-spacing, colours, line breaks, rules, shapes and icons, and anything missing or extra. Fix every difference.' : ''}
${rendered ? 'In image 3, text must stay clear of every shape, picture and other text, and inside the frame: if it runs into anything, narrow its max-width, move it, or let it wrap sooner. Keep the look of image 2.' : ''}
${clashes.length ? `Measured in image 3 (fix each one): ${clashes.join('; ')}.` : ''}
${err ? `The template failed to render with this error. Fix it: ${err}` : ''}

${RULES(t.w, t.h)}

Current template:
${metaOf(t)}
\`\`\`html
${t.html}
\`\`\`

${REPLY_FORMAT}`;

const ADAPT_PROMPT = (t: Template, w: number, h: number) => `Image 1 is a social-media layout template rendered at ${t.w}×${t.h}. Re-compose the same template for a ${w}×${h} frame: same typefaces, colours, shapes, slots, data-each and data-if, rearranged so it fits the new shape naturally (e.g. text column beside the visual on a wide frame). Scale sizes to the new frame.

${RULES(w, h)}

Current template:
${metaOf(t)}
\`\`\`html
${t.html}
\`\`\`

${REPLY_FORMAT}`;

/** A correction whose JSON part was unreadable keeps the fonts, accent and example words it had. */
const keepMeta = (next: Template, prev: Template): Template => ({
  ...next,
  fonts: next.fonts.length ? next.fonts : prev.fonts,
  accent: next.accent ?? prev.accent,
  sample: Object.keys(next.sample).length ? next.sample : prev.sample,
});

/** Fill for a template's own preview: the example's words, a page counter and the brand logo. */
const previewSlots = (t: Template, extra: { logo?: string; bg?: string }) => ({ ...t.sample, number: 1, page: 2, total: 4, ...extra });

/** Longer words than the example's in every slot it uses: shows where real posts would run into shapes. */
const stressSlots = (t: Template, extra: { logo?: string; bg?: string }) => ({
  ...previewSlots(t, extra),
  headline: t.sample.headline && 'A much longer headline, to see how this *layout* copes with it',
  body: t.sample.body && 'Two full sentences of supporting text, longer than the example had. Real posts often say more than the design expected.',
  kicker: t.sample.kicker && 'A longer lead-in line than the example',
  label: t.sample.label && 'A LONGER LABEL',
  items: t.sample.items?.length ? ['A first item with a few more words', 'Second item', 'A third, longer item to wrap', 'Fourth item'] : undefined,
});

/** The template drawn with the example's words, and with longer words + where those run into things. */
async function tryRender(t: Template, extra: { logo?: string; bg?: string }): Promise<{ png: Buffer | null; stress?: Buffer; clashes: string[]; err: string }> {
  try {
    const png = await renderTemplate(t, previewSlots(t, extra));
    const long = stressSlots(t, extra);
    const stress = await renderTemplate(t, long).catch(() => undefined);
    const clashes = stress ? (await textClashes(t, long).catch(() => [])).map((c) => describeClash(c, true)) : [];
    return { png, stress, clashes, err: '' };
  } catch (e) { return { png: null, clashes: [], err: (e as Error).message.slice(0, 400) }; }
}

/**
 * One correction round: the LLM sees the example next to its rendered template (or the render
 * error) plus the user's note, and returns a corrected template. A correction that doesn't render
 * gets one repair; when nothing renders, the last working version (or an error) comes back.
 */
async function refine(ctx: ModuleContext, example: string, t: Template, extra: { logo?: string; bg?: string }, note?: string): Promise<Template> {
  let cur = t, r = await tryRender(t, extra);
  // Best so far = draws, fewest measured clashes (a later version wins a tie: it has seen more feedback).
  let best = r.png ? { t, clashes: r.clashes.length } : null;
  for (let i = 0; i < 2; i++) {
    // Round 1 always runs (compare with the example, or apply the note); round 2 only to fix what's still broken.
    if (i > 0 && r.png && !r.clashes.length) break;
    const images = r.png ? [example, dataUrl(r.png), dataUrl(r.stress ?? r.png)] : [example];
    let next: Template;
    try {
      next = keepMeta(parseTemplateReply(await ctx.adapters.claude.complete(FIX_PROMPT(cur, !!r.png, r.err, i === 0 ? note : undefined, r.clashes), { images, maxTokens: 12000 }), t.w, t.h), cur);
    } catch (e) {
      ctx.logger.warn('template correction unusable', { error: (e as Error).message });
      break;
    }
    const nr = await tryRender(next, extra);
    if (nr.png && (!best || nr.clashes.length <= best.clashes)) best = { t: next, clashes: nr.clashes.length };
    cur = next; r = nr;
  }
  if (best) return best.t;
  throw new Error(`the template could not be drawn: ${r.err}`);
}

const logoUrl = async (ctx: ModuleContext) => {
  const { logo } = await brandLook(ctx);
  return logo ? dataUrl(await sharp(logo).png().toBuffer()) : undefined;
};

/**
 * Example image → checked layout template (+ the blank picture when the design needs one).
 * `plate` = an existing picture to reuse; only made when the template asks for {{bg}}.
 */
async function makeTemplate(ctx: ModuleContext, input: { source: Buffer; aspect: string; context: string; stylePrompt: string; plate?: Buffer | null }): Promise<{ tpl: Template; plate: Buffer | null }> {
  const { w, h } = frameFor(input.aspect);
  const example = dataUrl(await sharp(input.source).resize(w, h, { fit: 'cover' }).png().toBuffer());
  const first = parseTemplateReply(await ctx.adapters.claude.complete(TEMPLATE_PROMPT(w, h, input.context), { images: [example], maxTokens: 12000 }), w, h);
  const plate = first.background === 'image'
    ? input.plate ?? await makePlate(ctx, PLATE_PROMPT(input.stylePrompt), input.source, input.aspect)
    : null;
  const tpl = await refine(ctx, example, first, { logo: await logoUrl(ctx), bg: plate ? dataUrl(plate) : undefined });
  return { tpl, plate: tpl.background === 'image' ? plate : null };
}

const clamp01 = (n: unknown) => Math.min(1, Math.max(0, Number(n) || 0));
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** LLM response → style prompt + spec. Throws when the prompt is missing; everything else is defaulted. */
export function parseStyle(raw: string): { style_prompt: string; spec: StyleSpec } {
  const o = parseJsonObject(raw);
  const style_prompt = str(o.style_prompt);
  if (style_prompt.length < 20) throw new Error('style analysis returned no style_prompt');
  return {
    style_prompt,
    spec: {
      palette: (Array.isArray(o.palette) ? o.palette : []).map(str).filter((c) => /^#[0-9a-f]{3,8}$/i.test(c)),
      typography: str(o.typography),
      layout: str(o.layout),
      mood: str(o.mood),
      avoid: str(o.avoid),
      text_zones: zonesOf(o),
    },
  };
}

function zonesOf(o: Record<string, unknown>): TextZone[] {
  const zones = Array.isArray(o.text_zones) ? o.text_zones : [];
  return zones.filter((z): z is Record<string, unknown> => !!z && typeof z === 'object').map((z) => ({
    role: str(z.role) || 'body', x: clamp01(z.x), y: clamp01(z.y), w: clamp01(z.w), h: clamp01(z.h),
  }));
}

const ZONES_PROMPT = `This is an empty social-media post template. Find the empty area a designer left for the text column: where the headline starts and the body below it, clear of the decorative shapes.
Return ONLY JSON: {"text_zones":[{"role":"headline|body","x":0.0,"y":0.0,"w":0.0,"h":0.0}]}
Fractions 0-1 of width/height. The headline zone sits above the body zone.`;

/** The example's button (or badge) colour: the dominant colour inside its zone (text inside is the minority). */
async function sampleButton(source: Buffer, zones: TextZone[], role = 'cta'): Promise<StyleSpec['button']> {
  const cta = zones.find((z) => z.role === role);
  if (!cta || cta.w < 0.03 || cta.h < 0.01) return undefined;
  const { width: W = 1, height: H = 1 } = await sharp(source).metadata();
  const box = { left: Math.round(cta.x * W), top: Math.round(cta.y * H), width: Math.max(1, Math.round(cta.w * W)), height: Math.max(1, Math.round(cta.h * H)) };
  box.width = Math.min(box.width, W - box.left); box.height = Math.min(box.height, H - box.top);
  const { dominant: d } = await sharp(await sharp(source).extract(box).toBuffer()).stats();
  return { color: `#${[d.r, d.g, d.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`, ratio: H / W };
}

const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;

const CAROUSEL_PROMPT = (n: number) => `You are an art director. These ${n} images are the slides of ONE social-media carousel, in order. Describe its VISUAL STYLE so a designer could make new carousels on other topics that look like the same series, and describe how the slides are organised.

Describe only reusable style: composition, colour palette (hex), background treatment, graphic elements, typography, spacing, mood, and what repeats on every slide.
Do NOT describe the subject matter or what the words say.

Return ONLY JSON:
{
  "style_prompt": "one dense paragraph (80-150 words), written as an image-generation prompt for a NEW slide in this style, with no words in the image",
  "palette": ["#hex", ...],
  "typography": "how text is set",
  "mood": "3-6 words",
  "avoid": "what would break the style",
  "structure": "how this carousel is WRITTEN, as a recipe for a new topic, e.g. 'Slide 1: bold question hook, max 8 words. Slides 2-4: one numbered tip each, short headline + 1-2 sentence body. Last slide: one-line recap + call to action.' The pattern, not this topic.",
  "slides": [{"kind":"cover|content|list|stat|quote|cta","same_layout_as":null,"align":"left|center","headline_font":"serif|sans","text_zones":[{"role":"headline|body|cta|logo|number|graphic","x":0.0,"y":0.0,"w":0.0,"h":0.0}]}]
}
"slides" has exactly one entry per image, in order. "same_layout_as" is the 0-based index of an EARLIER slide with the same design where only the words differ, else null. "align" is how that slide's headline is aligned. text_zones are boxes on that slide, as 0-1 fractions of width/height: where each text sits (cta = the button, number = a numbered step badge, NOT the page counter), plus one "graphic" box for every shape or divider line that text must not run into.`;

// ponytail: at most 4 templates per carousel style (cost cap); extra layouts reuse the nearest kind.
const MAX_LAYOUTS = 4;

/**
 * Carousel analysis → shared style + one layout per distinct slide design.
 * Layout ids: 'main' for the first slide's design, else its kind ('content', 'cta', 'content-2' …).
 * `roots[id]` = index of the example slide each layout was taken from.
 */
export function parseCarousel(raw: string, n: number): { style_prompt: string; spec: StyleSpec; roots: Record<string, number> } {
  const { style_prompt, spec } = parseStyle(raw);
  const o = parseJsonObject(raw);
  const list = Array.isArray(o.slides) ? o.slides : [];
  const layouts: Record<string, LayoutSpec> = {};
  const roots: Record<string, number> = {};
  const sequence: string[] = [];
  for (let i = 0; i < n; i++) {
    const s = (list[i] && typeof list[i] === 'object' ? list[i] : {}) as Record<string, unknown>;
    const kind = (SLIDE_KINDS as readonly string[]).includes(str(s.kind)) ? str(s.kind) as SlideKind
      : i === 0 ? 'cover' : i === n - 1 && n > 1 ? 'cta' : 'content';
    const same = typeof s.same_layout_as === 'number' ? s.same_layout_as : NaN; // Number(null) would be 0
    // Same design as an earlier slide → reuse its layout. Missing entry or over the cap → an
    // earlier layout of the same kind, else main.
    let id = Number.isInteger(same) && same >= 0 && same < i ? sequence[same] : undefined;
    if (!id && (!list[i] || Object.keys(layouts).length >= MAX_LAYOUTS)) id = Object.keys(layouts).find((k) => layouts[k]!.kind === kind) ?? (i > 0 ? 'main' : undefined);
    if (!id) {
      id = i === 0 ? 'main' : kind;
      for (let k = 2; layouts[id]; k++) id = `${kind}-${k}`;
      layouts[id] = {
        kind, text_zones: zonesOf(s),
        align: s.align === 'center' ? 'center' : s.align === 'left' ? 'left' : undefined,
        headline_font: s.headline_font === 'serif' ? 'serif' : s.headline_font === 'sans' ? 'sans' : undefined,
      };
      roots[id] = i;
    }
    sequence.push(id);
  }
  spec.text_zones = layouts.main!.text_zones;
  return { style_prompt, spec: { ...spec, layouts, sequence, structure: str(o.structure) }, roots };
}

/** What the template call should know beyond the image: the analysed typography, and the slide's role in a carousel. */
function styleContext(spec: StyleSpec, kind?: string, i?: number, n?: number): string {
  return [
    kind && i != null ? `This is slide ${i + 1} of ${n}, a "${kind}" slide of a carousel; other slides share its look.` : '',
    spec.typography ? `Typography notes from our analysis: ${spec.typography}` : '',
    spec.palette.length ? `Palette: ${spec.palette.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

/** Upload → ≤1536px PNG (smaller vision bill, one stored format) + its nearest model aspect. */
async function normalise(image: Buffer): Promise<{ png: Buffer; aspect: string }> {
  const img = sharp(image).rotate();
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new Error('not an image');
  return { png: await img.resize(1536, 1536, { fit: 'inside', withoutEnlargement: true }).png().toBuffer(), aspect: nearestAspect(meta.width, meta.height) };
}

/**
 * Analyse uploaded example(s) once and save them as a reusable style. One image = a single-post
 * style; several = a carousel style (shared look + one template per distinct slide layout).
 */
export async function createStyle(ctx: ModuleContext, input: { name: string; image?: Buffer; images?: Buffer[] }): Promise<StyleRow> {
  const name = input.name.trim();
  if (!name) throw new Error('name is required');
  const uploads = input.images?.length ? input.images : input.image ? [input.image] : [];
  if (uploads.length === 0) throw new Error('add an image');
  if (uploads.length > 10) throw new Error('at most 10 slides');
  if (uploads.length > 1) return createCarouselStyle(ctx, name, await Promise.all(uploads.map(normalise)));
  const { png: source, aspect } = await normalise(uploads[0]!);

  const { claude } = ctx.adapters;
  const before = claude.spentUsd;
  const { style_prompt, spec } = parseStyle(await claude.complete(ANALYSE_PROMPT, { images: [dataUrl(source)], maxTokens: 1500 }));
  spec.button = await sampleButton(source, spec.text_zones);

  let plate: Buffer | null = null;
  try {
    const t = await makeTemplate(ctx, { source, aspect, stylePrompt: style_prompt, context: styleContext(spec) });
    spec.tpl = t.tpl; plate = t.plate;
  } catch (e) {
    // No usable layout template → the older blank-picture method, so the style still works.
    ctx.logger.warn('layout template failed, using a blank picture', { error: (e as Error).message });
    try {
      plate = await makePlate(ctx, PLATE_PROMPT(style_prompt), source, aspect);
    } catch (e2) {
      // The analysis is the expensive, reusable part — keep it even if the plate fails.
      ctx.logger.warn('style plate failed', { error: (e2 as Error).message });
    }
  }

  const r = await ctx.db.query<StyleRow>(
    `insert into content.style_refs (name, style_prompt, spec, aspect, source_png, plate_png, analysis_cost_usd)
     values ($1, $2, $3, $4, $5, $6, $7) returning ${COLS}`,
    [name, style_prompt, JSON.stringify(spec), aspect, source, plate, claude.spentUsd - before],
  );
  return r.rows[0]!;
}

async function createCarouselStyle(ctx: ModuleContext, name: string, slides: { png: Buffer; aspect: string }[]): Promise<StyleRow> {
  const { claude } = ctx.adapters;
  const before = claude.spentUsd;
  const aspect = slides[0]!.aspect;
  // Vision sees ≤1024px copies: the whole set in one call, at a fraction of the token bill.
  const small = await Promise.all(slides.map((s) => sharp(s.png).resize(1024, 1024, { fit: 'inside' }).png().toBuffer()));
  const { style_prompt, spec, roots } = parseCarousel(
    await claude.complete(CAROUSEL_PROMPT(slides.length), { images: small.map(dataUrl), maxTokens: 3000 }), slides.length);

  // One template per layout, made from that layout's example slide (in parallel; a failed
  // non-main layout is dropped and its slides fall back to main).
  const plates: Record<string, Buffer | null> = {};
  await Promise.all(Object.entries(roots).map(async ([id, i]) => {
    const L = spec.layouts![id]!;
    L.button = await sampleButton(slides[i]!.png, L.text_zones);
    L.badge = await sampleButton(slides[i]!.png, L.text_zones, 'number');
    try {
      const t = await makeTemplate(ctx, { source: slides[i]!.png, aspect, stylePrompt: style_prompt, context: styleContext(spec, L.kind, i, slides.length) });
      L.tpl = t.tpl; plates[id] = t.plate;
      return;
    } catch (e) {
      ctx.logger.warn('carousel layout template failed, using a blank picture', { layout: id, error: (e as Error).message });
    }
    try {
      plates[id] = await makePlate(ctx, PLATE_PROMPT(style_prompt), slides[i]!.png, aspect);
    } catch (e) {
      ctx.logger.warn('carousel layout plate failed', { layout: id, error: (e as Error).message });
      plates[id] = null;
    }
  }));
  for (const id of Object.keys(roots)) if (id !== 'main' && !plates[id] && !spec.layouts![id]!.tpl) delete spec.layouts![id];
  spec.sequence = spec.sequence!.map((id) => (spec.layouts![id] ? id : 'main'));
  spec.button = spec.layouts!.main!.button;

  const r = await ctx.db.query<StyleRow>(
    `insert into content.style_refs (name, style_prompt, spec, aspect, source_png, plate_png, analysis_cost_usd)
     values ($1, $2, $3, $4, $5, $6, $7) returning ${COLS}`,
    [name, style_prompt, JSON.stringify(spec), aspect, slides[0]!.png, plates.main, claude.spentUsd - before],
  );
  const row = r.rows[0]!;
  for (const [id, i] of Object.entries(roots)) {
    if (id === 'main' || !spec.layouts![id]) continue;
    await ctx.db.query(
      `insert into content.style_variants (style_id, layout, aspect, plate_png, source_png, text_zones) values ($1, $2, $3, $4, $5, $6)`,
      [row.id, id, aspect, plates[id] ?? null, slides[i]!.png, JSON.stringify(spec.layouts![id]!.text_zones)]);
  }
  return row;
}

const COLS = `id, name, style_prompt, spec, aspect, plate_png is not null as has_plate,
  analysis_cost_usd::float8 as analysis_cost_usd, use_count, created_at`;

export async function listStyles(ctx: ModuleContext): Promise<StyleRow[]> {
  return (await ctx.db.query<StyleRow>(`select ${COLS} from content.style_refs order by created_at desc`)).rows;
}

/** A stored image; `layout` (carousel styles) picks another layout's template/example at the style's own shape. */
export async function getStyleImage(ctx: ModuleContext, id: string, kind: 'source' | 'plate', layout = 'main'): Promise<Buffer | null> {
  const col = kind === 'plate' ? 'plate_png' : 'source_png';
  const r = layout === 'main'
    ? await ctx.db.query<{ png: Uint8Array | null }>(`select ${col} as png from content.style_refs where id = $1`, [id])
    : await ctx.db.query<{ png: Uint8Array | null }>(
      `select v.${col} as png from content.style_variants v join content.style_refs s on s.id = v.style_id
       where v.style_id = $1 and v.layout = $2 and v.aspect = s.aspect`, [id, layout]);
  const png = r.rows[0]?.png;
  return png ? Buffer.from(png) : null;
}

export async function renameStyle(ctx: ModuleContext, id: string, name: string): Promise<void> {
  if (!name.trim()) throw new Error('name is required');
  await ctx.db.query(`update content.style_refs set name = $2 where id = $1`, [id, name.trim()]);
}

export async function deleteStyle(ctx: ModuleContext, id: string): Promise<void> {
  await ctx.db.query(`delete from content.style_refs where id = $1`, [id]);
}

// ---- generate ----------------------------------------------------------------
export interface GenerateInput {
  styleId: string;
  placement: Placement;
  /** Slide text: "---" between slides; first paragraph of each slide = headline. */
  text: string;
  cta?: string;
  /** Ask the image model for a new, topic-specific visual on the template instead of the bare template. */
  fresh?: boolean;
  /** What the post is about — only used when `fresh`. */
  brief?: string;
}
export interface GenerateResult {
  images: Buffer[];
  costUsd: number;
  /** template = saved template, $0 · new-size = made + saved a template for this shape (once) · fresh = new visual */
  background: 'template' | 'new-size' | 'fresh';
  /** Layout id used for each slide ('main' for single-post styles). */
  layouts: string[];
  /** Things to fix, e.g. "Slide 3: text too long for this layout …". */
  warnings: string[];
}

interface StyleForGen { style_prompt: string; spec: StyleSpec; aspect: string; plate: Uint8Array | null; source: Uint8Array }

/**
 * The blank template for a layout at an aspect ratio, made at most ONCE per style + layout + shape:
 * the original shape uses the saved plate; any other shape is re-composed by the image model,
 * its text areas found by one vision call, and both saved to content.style_variants.
 */
async function templateFor(ctx: ModuleContext, styleId: string, style: StyleForGen, aspect: string, layout = 'main'): Promise<{ plate: Buffer; zones: TextZone[]; made: boolean }> {
  if (layout === 'main' && style.plate && style.aspect === aspect) return { plate: Buffer.from(style.plate), zones: style.spec.text_zones, made: false };
  const variant = (a: string) => ctx.db.query<{ plate: Uint8Array; source: Uint8Array | null; zones: TextZone[] }>(
    `select plate_png as plate, source_png as source, text_zones as zones from content.style_variants where style_id = $1 and layout = $2 and aspect = $3 and plate_png is not null`,
    [styleId, layout, a]).then((r) => r.rows[0]);
  const hit = await variant(aspect);
  if (hit) return { plate: Buffer.from(hit.plate), zones: hit.zones, made: false };

  // Re-compose from this layout's own template at the example's shape.
  const orig = layout === 'main' ? { plate: style.plate, source: style.source } : await variant(style.aspect);
  if (!orig) return templateFor(ctx, styleId, style, aspect); // layout gone → main
  const prompt = orig.plate
    ? `Re-compose this empty background template for a ${aspect} frame: the same background, colours, decorative shapes and style, rearranged to fit the new shape naturally, keeping the same calm empty area for text. No words, letters, numbers or logos anywhere. ${PLAIN_TEXT_AREAS}\nStyle: ${style.style_prompt}`
    : PLATE_PROMPT(style.style_prompt); // no plate saved (it failed at upload) → make one from the example
  const plate = await makePlate(ctx, prompt, Buffer.from(orig.plate ?? orig.source!), aspect);
  const found = zonesOf(await askJson(ctx, ZONES_PROMPT, plate));
  // No usable headline zone → the example's layout (as fractions) is the best guess.
  const own = layoutOf(style.spec, layout).text_zones;
  const zones = found.some((z) => z.role === 'headline') ? found : own.filter((z) => z.role !== 'cta');
  await ctx.db.query(
    `insert into content.style_variants (style_id, layout, aspect, plate_png, text_zones) values ($1, $2, $3, $4, $5)
     on conflict (style_id, layout, aspect) do update set plate_png = excluded.plate_png, text_zones = excluded.text_zones`,
    [styleId, layout, aspect, plate, JSON.stringify(zones)]);
  return { plate, zones, made: true };
}

/** A layout's zones + button; single-post styles have only 'main', described by the spec itself. */
function layoutOf(spec: StyleSpec, id: string): LayoutSpec {
  return spec.layouts?.[id] ?? { kind: 'cover', text_zones: spec.text_zones, button: spec.button, badge: spec.badge, align: spec.align, headline_font: spec.headline_font, tpl: spec.tpl };
}

/**
 * Which saved layout each new slide uses: first = cover, last = CTA, middle by what the text
 * looks like (a number → stat, bullet lines → list, a quote → quote, else content). Missing
 * kinds fall back to content, then any middle layout, then main.
 */
export function pickLayouts(slides: SlideText[], layouts?: Record<string, LayoutSpec>): string[] {
  if (!layouts) return slides.map(() => 'main');
  // jsonb doesn't keep key order: main first, then by name.
  const ids = Object.keys(layouts).sort((a, b) => (a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b)));
  const byKind = (k: string) => ids.find((id) => layouts[id]!.kind === k);
  const middle = ids.find((id) => !['cover', 'cta'].includes(layouts[id]!.kind));
  return slides.map((s, i) => {
    const n = slides.length;
    const kind = i === 0 ? 'cover'
      : i === n - 1 ? 'cta'
      : /\d/.test(s.headline) && s.headline.length <= 8 ? 'stat'
      : (s.body?.match(/^\s*([-•*]|\d+[.)])\s/gm)?.length ?? 0) >= 2 ? 'list'
      : /^["“]/.test(s.headline) ? 'quote'
      : 'content';
    return byKind(kind) ?? (i === 0 ? 'main' : byKind('content') ?? middle ?? 'main');
  });
}

/**
 * Saved style + our text → finished PNGs (one per slide). Never re-analyses the example.
 * A template already saved for this shape costs $0; a new shape costs one image + one small
 * vision call per layout used, once; `fresh` costs one image call per creative (on the first slide's layout).
 */
export async function generateCreative(ctx: ModuleContext, input: GenerateInput): Promise<GenerateResult> {
  const slides = toSlides(input.text, input.cta?.trim() || undefined);
  if (slides.length === 0) throw new Error('add some text');
  const style = (await ctx.db.query<StyleForGen>(
    `select style_prompt, spec, aspect, plate_png as plate, source_png as source from content.style_refs where id = $1`, [input.styleId])).rows[0];
  if (!style) throw new Error('style not found');
  const target = PLACEMENTS[input.placement];
  const { claude } = ctx.adapters;
  const before = claude.spentUsd;

  const picks = pickLayouts(slides, style.spec.layouts);
  const look = await brandLook(ctx); // brand fonts + logo on every creative
  const logo = look.logo ? dataUrl(await sharp(look.logo).png().toBuffer()) : undefined;
  // Layouts with a layout template draw their own design (bg = its picture, when it has one);
  // older layouts paint the text onto a blank picture (tpls).
  const html = new Map<string, { t: Template; bg?: Buffer; made: boolean }>();
  const tpls = new Map<string, { background: Buffer; spec: StyleSpec; made: boolean }>();
  for (const id of new Set(picks)) {
    const own = layoutOf(style.spec, id);
    if (own.tpl) {
      const sized = await tplAt(ctx, input.styleId, id, own.tpl, style.aspect, target.aspect);
      const pic = own.tpl.background === 'image' ? await templateFor(ctx, input.styleId, style, target.aspect, id) : null;
      html.set(id, { t: sized.t, bg: pic?.plate, made: sized.made || !!pic?.made });
      continue;
    }
    const tpl = await templateFor(ctx, input.styleId, style, target.aspect, id);
    // Button and badge keep the example's position (as a fraction) on every shape; on a re-composed
    // template (which never carries those zones) they line up with the new text column.
    const { button, badge, align, headline_font } = own;
    let head = tpl.zones.find((z) => z.role === 'headline');
    const zones = [...tpl.zones];
    const cta = own.text_zones.find((t) => t.role === 'cta');
    if (cta && !zones.some((t) => t.role === 'cta')) {
      // Centred layouts centre the button under the headline (bw = its drawn width as a fraction of the frame).
      const bw = button ? cta.w * Math.min(target.w, target.h / button.ratio) / target.w : cta.w;
      zones.push({ ...cta, x: head ? (align === 'center' ? head.x + head.w / 2 - bw / 2 : head.x) : cta.x });
    }
    // The badge sits just above the headline (its example y would land anywhere on a new shape);
    // the headline moves down if there's no room. nh = drawn badge height as a fraction of the frame.
    const num = own.text_zones.find((t) => t.role === 'number');
    if (num && badge && head && !zones.some((t) => t.role === 'number')) {
      const nh = num.h * badge.ratio * Math.min(target.w, target.h / badge.ratio) / target.h;
      const y = Math.max(0.04, head.y - nh - 0.03);
      if (head.y < y + nh + 0.03) zones[zones.indexOf(head)] = head = { ...head, y: y + nh + 0.03 };
      zones.push({ ...num, x: head.x, y });
    }
    tpls.set(id, { background: tpl.plate, spec: { ...style.spec, text_zones: zones, button, badge, align, headline_font }, made: tpl.made });
  }
  const warnings: string[] = [];
  if (input.fresh) {
    const h = html.get(picks[0]!), first = tpls.get(picks[0]!);
    const base = h ? h.bg : first!.background;
    if (base) {
      const img = await claude.generateImage(
        `Add one visual element about "${input.brief?.trim() || slides[0]!.headline}" to this template, in exactly its style (${style.style_prompt}). Keep the layout and the empty text area exactly where they are and completely empty: no words, letters, numbers or logos. ${PLAIN_TEXT_AREAS}`,
        { images: [dataUrl(base)], aspectRatio: target.aspect });
      if (h) h.bg = img; else first!.background = img;
    } else {
      warnings.push('This style is drawn without a picture, so no new picture was added.');
    }
  }

  // Step numbers for badges: a cover isn't a step, so numbering starts on the slide after it.
  const offset = layoutOf(style.spec, picks[0]!).kind === 'cover' ? 0 : 1;
  const images = await Promise.all(slides.map(async (s, i) => {
    const notes: string[] = [];
    const h = html.get(picks[i]!);
    let png: Buffer;
    if (h) {
      const { body, items } = bodyFor(h.t.html, s.body, notes);
      const fill = {
        headline: s.headline, body, items, kicker: s.kicker, label: s.label, cta: s.cta,
        number: i + offset, page: i + 1, total: slides.length, logo, bg: h.bg && dataUrl(h.bg),
      };
      png = await renderTemplate(h.t, fill, notes);
      for (const c of await textClashes(h.t, fill).catch(() => [])) notes.push(`${describeClash(c)}. Shorten it, or fix the template on Styles.`);
      if (h.t.w !== target.w || h.t.h !== target.h) png = await sharp(png).resize(target.w, target.h, { fit: 'cover' }).png().toBuffer();
    } else {
      const t = tpls.get(picks[i]!)!;
      png = await renderCreative(t.background, t.spec, input.placement, { ...s, number: i + offset }, { n: i + 1, total: slides.length }, notes, look);
    }
    warnings.push(...notes.map((n) => `Slide ${i + 1}: ${n}`));
    return png;
  }));
  warnings.sort();
  await ctx.db.query(`update content.style_refs set use_count = use_count + 1 where id = $1`, [input.styleId]);
  const made = [...tpls.values(), ...html.values()].some((t) => t.made);
  return { images, costUsd: claude.spentUsd - before, background: input.fresh ? 'fresh' : made ? 'new-size' : 'template', layouts: picks, warnings };
}

/**
 * A slide's body for a template: list lines go to the repeated item block when it has one; with
 * no {{body}} slot, the body's lines become the items; with neither, the body can't be shown.
 */
function bodyFor(tplHtml: string, text: string | undefined, notes: string[]): { body?: string; items: string[] } {
  const each = tplHtml.includes('data-each'), hasBody = tplHtml.includes('{{body}}');
  const split = each ? splitItems(text) : { body: text, items: [] };
  if (split.body && !hasBody) {
    if (each) return { items: [...split.items, ...split.body.split(/\n+/).map((l) => l.trim()).filter(Boolean)] };
    notes.push('this layout has no place for body text, so only the headline is shown.');
    return { items: split.items };
  }
  return split;
}

/** The template at a shape: its own, a saved re-composition, or one made now (one LLM call) and saved. */
async function tplAt(ctx: ModuleContext, styleId: string, layout: string, t: Template, own: string, aspect: string): Promise<{ t: Template; made: boolean }> {
  if (aspect === own) return { t, made: false };
  const hit = t.sizes?.[aspect];
  if (hit) return { t: { ...t, ...hit }, made: false };
  const { w, h } = frameFor(aspect);
  const shown = await tryRender(t, {});
  const next = parseTemplateReply(await ctx.adapters.claude.complete(ADAPT_PROMPT(t, w, h), { images: shown.png ? [dataUrl(shown.png)] : undefined, maxTokens: 12000 }), w, h);
  // Doesn't draw → one repair round against the original-shape render.
  const next2 = keepMeta(next, t);
  const ok = (await tryRender(next2, {})).png || !shown.png ? next2 : await refine(ctx, dataUrl(shown.png), next2, {});
  const sized = { html: ok.html, w, h, fonts: [...new Set([...t.fonts, ...ok.fonts])] };
  await saveTemplates(ctx, styleId, { [layout]: { ...t, sizes: { ...t.sizes, [aspect]: sized } } });
  return { t: { ...t, ...sized }, made: true };
}

/** Write layout templates into the saved spec ('main' of a single-post style = spec.tpl). */
async function saveTemplates(ctx: ModuleContext, styleId: string, byLayout: Record<string, Template>): Promise<void> {
  await ctx.db.tx(async (db) => {
    const spec = (await db.query<{ spec: StyleSpec }>(`select spec from content.style_refs where id = $1 for update`, [styleId])).rows[0]?.spec;
    if (!spec) return;
    for (const [id, t] of Object.entries(byLayout)) {
      if (spec.layouts?.[id]) spec.layouts[id].tpl = t; else if (id === 'main') spec.tpl = t;
    }
    await db.query(`update content.style_refs set spec = $2 where id = $1`, [styleId, JSON.stringify(spec)]);
  });
}

/** A layout's template drawn with the example's own words: what the Styles page shows. $0. */
export async function previewStyle(ctx: ModuleContext, id: string, layout = 'main'): Promise<Buffer | null> {
  const spec = (await ctx.db.query<{ spec: StyleSpec }>(`select spec from content.style_refs where id = $1`, [id])).rows[0]?.spec;
  const t = spec && layoutOf(spec, layout).tpl;
  if (!t) return null;
  const bg = t.background === 'image' ? await getStyleImage(ctx, id, 'plate', layout) : null;
  return renderTemplate(t, previewSlots(t, { logo: await logoUrl(ctx), bg: bg ? dataUrl(bg) : undefined }));
}

/**
 * Remake a style's layout template(s) from the saved example. With a note ("make the headline
 * two colours"), an existing template is corrected to match it; without one (or for styles saved
 * before templates), it's rebuilt from scratch. Copies made for other shapes are dropped.
 */
export async function remakeTemplate(ctx: ModuleContext, id: string, input: { layout?: string; note?: string } = {}): Promise<{ costUsd: number; layouts: string[] }> {
  const style = (await ctx.db.query<{ spec: StyleSpec; style_prompt: string; aspect: string }>(
    `select spec, style_prompt, aspect from content.style_refs where id = $1`, [id])).rows[0];
  if (!style) throw new Error('style not found');
  const all = Object.keys(style.spec.layouts ?? { main: 1 });
  const ids = input.layout ? all.filter((l) => l === input.layout) : all;
  if (!ids.length) throw new Error('that layout is not part of this style');
  const note = input.note?.trim().slice(0, 1000) || undefined;
  const { claude } = ctx.adapters;
  const before = claude.spentUsd;
  const logo = await logoUrl(ctx);
  const done: Record<string, Template> = {};
  await Promise.all(ids.map(async (layout) => {
    const source = await getStyleImage(ctx, id, 'source', layout);
    if (!source) throw new Error(`no example saved for the ${layout} layout`);
    const L = layoutOf(style.spec, layout);
    const oldPlate = await getStyleImage(ctx, id, 'plate', layout);
    let tpl: Template, plate = oldPlate;
    if (note && L.tpl) {
      const example = dataUrl(await sharp(source).resize(L.tpl.w, L.tpl.h, { fit: 'cover' }).png().toBuffer());
      tpl = await refine(ctx, example, L.tpl, { logo, bg: oldPlate && L.tpl.background === 'image' ? dataUrl(oldPlate) : undefined }, note);
    } else {
      const i = style.spec.sequence?.indexOf(layout) ?? -1;
      const context = [note ? `The user asks: "${note}".` : '', styleContext(style.spec, style.spec.layouts ? L.kind : undefined, i >= 0 ? i : undefined, style.spec.sequence?.length)].filter(Boolean).join('\n');
      ({ tpl, plate } = await makeTemplate(ctx, { source, aspect: style.aspect, stylePrompt: style.style_prompt, context, plate: oldPlate }));
    }
    if (tpl.background === 'image' && !plate) plate = await makePlate(ctx, PLATE_PROMPT(style.style_prompt), source, style.aspect);
    if (plate && plate !== oldPlate) {
      if (layout === 'main') await ctx.db.query(`update content.style_refs set plate_png = $2 where id = $1`, [id, plate]);
      else await ctx.db.query(`update content.style_variants set plate_png = $3 where style_id = $1 and layout = $2 and aspect = (select aspect from content.style_refs where id = $1)`, [id, layout, plate]);
      // Pictures re-composed for other shapes came from the old one.
      await ctx.db.query(`delete from content.style_variants where style_id = $1 and layout = $2 and aspect <> (select aspect from content.style_refs where id = $1)`, [id, layout]);
    }
    done[layout] = tpl;
  }));
  await saveTemplates(ctx, id, done);
  return { costUsd: claude.spentUsd - before, layouts: ids };
}

/** Optional text a style's templates show, so drafts only write what will appear. */
function draftExtras(spec: StyleSpec): { kicker: boolean; label: boolean; accent: boolean } {
  const ts = [spec.tpl, ...Object.values(spec.layouts ?? {}).map((l) => l.tpl)].filter((t): t is Template => !!t);
  const html = ts.map((t) => t.html).join(' ');
  return { kicker: html.includes('{{kicker}}'), label: html.includes('{{label}}'), accent: ts.some((t) => !!t.accent) };
}

const DRAFT_PROMPT = (topic: string, spec: StyleSpec, slides?: number) => {
  const kinds = spec.sequence?.map((id) => spec.layouts?.[id]?.kind ?? 'content');
  const count = slides ?? kinds?.length ?? 5;
  const x = draftExtras(spec);
  const extra = [
    x.kicker ? '"kicker" is a short lead-in line shown above the headline (max 8 words), or "".' : '',
    x.label ? '"label" is a 1-4 word tag for the slide (a section name or short question), or "".' : '',
    x.accent ? 'In each headline, wrap the 1-3 words that matter most in *asterisks*; the design colours them.' : '',
  ].filter(Boolean).join(' ');
  const fields = `{${x.kicker ? '"kicker":"",' : ''}"headline":"","body":""${x.label ? ',"label":""' : ''}}`;
  return `Write a social-media carousel about: ${topic}

Follow the structure of a carousel we liked: ${spec.structure || 'Slide 1: a bold hook. Middle slides: one idea each, short headline + 1-2 sentence body. Last slide: a one-line recap + call to action.'}
${kinds ? `Its slides, in order, were: ${kinds.join(', ')}.\n` : ''}Write exactly ${count} slides.
Rules: headlines max 8 words; body max 30 words and optional; a "stat" slide's headline is just the number (e.g. "73%") with the meaning in the body; a "list" slide's body is 2-4 lines each starting with "- ". Plain text: no emojis, hashtags or markdown${x.accent ? ' (apart from the *asterisks*)' : ''}. Don't write "swipe" or "here's why" teasers or step numbers; the design adds those. Only claims you can stand behind; no invented statistics.${extra ? `\n${extra}` : ''}

Return ONLY JSON: {"slides":[${fields}],"cta":"button text for the last slide, max 4 words"}`;
};

/** Topic → slide text in the editor's "---" format, following the saved carousel's structure. One cheap text call. */
export async function draftCarousel(ctx: ModuleContext, input: { styleId: string; topic: string; slides?: number }): Promise<{ text: string; cta: string; costUsd: number }> {
  const topic = input.topic.trim();
  if (!topic) throw new Error('add a topic');
  const style = (await ctx.db.query<{ spec: StyleSpec }>(`select spec from content.style_refs where id = $1`, [input.styleId])).rows[0];
  if (!style) throw new Error('style not found');
  await loadBrand(ctx);
  const { claude } = ctx.adapters;
  const before = claude.spentUsd;
  const slides = input.slides && Math.min(10, Math.max(1, Math.round(input.slides)));
  const o = parseJsonObject(await claude.complete(DRAFT_PROMPT(topic, style.spec, slides || undefined), { system: brandSystem(), maxTokens: 1500 }));
  const list = (Array.isArray(o.slides) ? o.slides : []).filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && !!str(s.headline));
  if (list.length === 0) throw new Error('the draft came back empty — try again');
  return {
    // Kicker / label as tagged lines at the end of a slide (toSlides reads them back).
    text: list.map((s) => [str(s.headline), str(s.body), [str(s.kicker) && `kicker: ${str(s.kicker)}`, str(s.label) && `label: ${str(s.label)}`].filter(Boolean).join('\n')]
      .filter(Boolean).join('\n\n')).join('\n---\n'),
    cta: str(o.cta),
    costUsd: claude.spentUsd - before,
  };
}
