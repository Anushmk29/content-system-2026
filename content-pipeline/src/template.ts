// Layout templates: a style's example rebuilt by the LLM as HTML + inline styles with text slots
// ({{headline}}, {{body}} …), rendered to PNG by Satori (layout + real fonts) and resvg. Unlike
// the painted-text renderer in creative.ts, this keeps the example's fonts, sizes, colour
// accents, rules, pills, labels and diagrams, and text wraps like it does on a web page.
import satori from 'satori';
import { html as parseHtml } from 'satori-html';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { existsSync, readFileSync } from 'node:fs';
import { fetchGoogleFont } from './fonts.ts';
import { parseJsonObject } from './modules/llm-json.ts';

/** The example's own words per slot: what the preview shows, and the length each slot was designed for. */
export interface Slots {
  headline?: string; body?: string; kicker?: string; label?: string; cta?: string; items?: string[];
  number?: number; page?: number; total?: number; logo?: string; bg?: string;
}

export interface Template {
  html: string; w: number; h: number;
  /** Google Fonts families the html names. */
  fonts: string[];
  /** Colour for words marked *like this*. */
  accent?: string;
  sample: Slots;
  /** 'image' = the example has a photo / illustration / texture HTML can't draw: {{bg}} is the style's picture. */
  background: 'none' | 'image';
  /** Copies re-composed for other shapes, by aspect ('16:9' …), made once on first use. */
  sizes?: Record<string, { html: string; w: number; h: number; fonts?: string[] }>;
}

// ---- fonts ------------------------------------------------------------------
type Font = { name: string; data: Buffer; weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900; style: 'normal' };
const fontCache = new Map<string, Promise<Font[]>>();
// Last resort when Google Fonts can't be reached (offline tests, network down).
const SYSTEM_FONTS = ['C:/Windows/Fonts/arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf'];

function family(name: string): Promise<Font[]> {
  let p = fontCache.get(name);
  if (!p) {
    p = fetchGoogleFont(name)
      .then((fs) => fs.map((f) => ({ name, data: f.file, weight: f.weight as Font['weight'], style: 'normal' as const })))
      .catch(() => { fontCache.delete(name); return []; }); // retried next time
    fontCache.set(name, p);
  }
  return p;
}

async function fontsFor(names: string[]): Promise<Font[]> {
  const got = (await Promise.all([...new Set([...names, 'Inter'])].map(family))).flat();
  if (got.length) return got;
  const sys = SYSTEM_FONTS.find(existsSync);
  if (!sys) throw new Error('no fonts available: Google Fonts unreachable and no system font found');
  return [{ name: names[0] ?? 'Inter', data: readFileSync(sys), weight: 400, style: 'normal' }];
}

// ---- filling slots ----------------------------------------------------------
type El = { type: string; props: Record<string, unknown> & { style?: Record<string, unknown>; children?: unknown } };
type Node = El | string;

const TEXT_SLOTS = new Set(['headline', 'body', 'kicker', 'label', 'cta', 'item']);
const ONLY_SLOT = /^\s*\{\{(\w+)\}\}\s*$/;
const TOKEN = /\{\{(\w+)\}\}/g;
const plain = (s: string) => s.replace(/\*/g, '');

/**
 * Words as flex items (Satori has no inline layout), *marked* ones in the accent colour. Each
 * word but the last carries a no-break space: a gap in em resolves to 0 when the font size is
 * set on a parent, which ran small labels together.
 */
function words(line: string, accent: string | undefined): El[] {
  let on = false;
  const ws = line.split(/\s+/).filter((w) => w.replace(/\*/g, ''));
  return ws.map((w, i) => {
    const starts = w.startsWith('*'), ends = w.length > 1 && w.endsWith('*');
    if (starts) on = true;
    const el: El = { type: 'span', props: { style: on && accent ? { color: accent } : {}, children: w.replace(/\*/g, '') + (i < ws.length - 1 ? ' ' : '') } };
    if (ends || (starts && w.length > 1 && w.slice(1).includes('*'))) on = false;
    return el;
  });
}

const px = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^[\d.]+(px)?$/.test(v.trim()) ? parseFloat(v) : NaN);

/**
 * Text into a slot element: wraps by word, keeps its alignment, and shrinks the font when the
 * new text is longer than the example's (designed) text. ponytail: length ratio, not measured;
 * swap for measuring with Satori's layout if posts still overflow.
 */
/**
 * Clash check (textClashes) draws: null = the design with all text invisible; { slot, ink } = only
 * that slot's text (in the marker colour, or invisible) with everything not behind it hidden.
 * Colour and opacity never move anything, so every draw has the same layout.
 */
type Paint = null | { slot: string; ink: 'marker' | 'clear' };
type Fill = Pick<Template, 'accent' | 'sample'> & { paint?: Paint };
const MARKER = '#ff00ff';

function setText(el: El, name: string, text: string, t: Fill, notes: string[]) {
  const style = (el.props.style ??= {});
  if (t.paint !== undefined) {
    const ink = t.paint && t.paint.slot === name && t.paint.ink === 'marker' ? MARKER : 'transparent';
    style.color = ink;
    t = { ...t, accent: ink };
  }
  const designed = name === 'item' ? Math.max(0, ...(t.sample.items ?? []).map((s) => plain(s).length)) : plain(String(t.sample[name as keyof Slots] ?? '')).length;
  const len = plain(text).length, room = Math.max(designed, 12) * 1.15;
  const size = px(style.fontSize);
  if (len > room && size > 0) {
    const k = Math.max(0.55, Math.sqrt(room / len));
    style.fontSize = `${Math.round(size * k)}px`;
    if (len > room / 0.3) notes.push(`${name} is much longer than this design allows, so it may run over. Shorten it.`);
  }
  const justify = style.textAlign === 'center' ? 'center' : style.textAlign === 'right' ? 'flex-end' : 'flex-start';
  const row = (line: string): El => ({ type: 'div', props: { style: { display: 'flex', flexWrap: 'wrap', columnGap: 0, justifyContent: justify }, children: words(line, t.accent) } });
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  style.display = 'flex';
  if (lines.length > 1) {
    Object.assign(style, { flexDirection: 'column', alignItems: justify, rowGap: style.rowGap ?? '0.35em' });
    el.props.children = lines.map(row);
  } else {
    delete style.gap;
    Object.assign(style, { flexDirection: 'row', flexWrap: 'wrap', columnGap: 0, rowGap: 0, justifyContent: justify });
    el.props.children = words(lines[0] ?? '', t.accent);
  }
}

type Values = Record<string, string | undefined>;

/** One node with the slot values filled in; null = drop it (empty slot, data-if, emptied wrapper). */
function fill(node: Node, v: Values, items: string[], t: Fill, notes: string[]): Node | Node[] | null {
  if (typeof node === 'string') {
    if (!node.trim()) return null;
    let empty = false;
    const s = node.replace(TOKEN, (_, k: string) => { const x = v[k]; if (!x) empty = true; return x ?? ''; });
    return empty ? null : s;
  }
  const p = node.props;
  if (typeof p['data-if'] === 'string' && !(p['data-if'] === 'items' ? items.length : v[p['data-if']])) return null;
  if (p['data-each'] === 'items') {
    const { ['data-each']: _, ...rest } = p;
    return items.flatMap((item, i) => {
      const r = fill({ ...node, props: structuredClone(rest) }, { ...v, item, i: String(i + 1) }, [], t, notes);
      return r == null ? [] : r;
    });
  }
  const el: El = { type: node.type, props: structuredClone(p) };
  // Solo draw: anything that isn't the painted text or behind it (its containers) is hidden.
  if (t.paint && !JSON.stringify(node).includes(`{{${t.paint.slot}}}`)) el.props.style = { ...el.props.style, opacity: 0 };
  for (const [k, val] of Object.entries(el.props)) {
    if (typeof val === 'string' && val.includes('{{')) {
      let empty = false;
      el.props[k] = val.replace(TOKEN, (_, n: string) => { const x = v[n]; if (!x) empty = true; return x ?? ''; });
      if (empty) return null; // e.g. <img src="{{logo}}"> with no logo
    }
  }
  const kids = Array.isArray(p.children) ? p.children as Node[] : p.children == null ? [] : [p.children as Node];
  const only = kids.length === 1 && typeof kids[0] === 'string' ? ONLY_SLOT.exec(kids[0]) : null;
  if (only && TEXT_SLOTS.has(only[1]!)) {
    const text = v[only[1]!];
    if (!text?.trim()) return null;
    setText(el, only[1]!, text, t, notes);
    return el;
  }
  if (node.type === 'svg') return el; // shapes: nothing to fill inside
  const out = kids.flatMap((k) => { const r = fill(k, v, items, t, notes); return r == null ? [] : Array.isArray(r) ? r : [r]; });
  // A wrapper whose only content was text that's now gone (a pill, a tag box) goes too.
  if (kids.length && !out.length) return null;
  el.props.children = out.length === 1 ? out[0] : out;
  return el;
}

const pad2 = (n?: number) => (n ? String(n).padStart(2, '0') : undefined);

type Drawable = Pick<Template, 'html' | 'w' | 'h' | 'fonts' | 'accent' | 'sample'>;

/** One PNG from a template + this slide's words. `notes` collects anything the viewer should fix. */
export function renderTemplate(t: Drawable, s: Slots, notes: string[] = []): Promise<Buffer> {
  return draw(t, s, notes);
}

async function draw(t: Drawable, s: Slots, notes: string[], paint?: Paint, width = t.w): Promise<Buffer> {
  const parsed = parseHtml(t.html) as unknown as El;
  // satori-html wraps the markup in a 100% div; the template's own root is inside it.
  const kids = (Array.isArray(parsed.props.children) ? parsed.props.children : [parsed.props.children]).filter((k) => typeof k !== 'string' || k.trim()) as Node[];
  const root = kids.length === 1 && typeof kids[0] !== 'string' ? kids[0]! : parsed;
  const v: Values = {
    headline: s.headline, body: s.body, kicker: s.kicker, label: s.label, cta: s.cta,
    number: s.number ? String(s.number) : undefined,
    page: s.total && s.total > 1 ? String(s.page) : undefined, total: s.total && s.total > 1 ? String(s.total) : undefined,
    page2: s.total && s.total > 1 ? pad2(s.page) : undefined, total2: s.total && s.total > 1 ? pad2(s.total) : undefined,
    logo: s.logo, bg: s.bg,
  };
  const filled = fill(root, v, s.items ?? [], { accent: t.accent, sample: t.sample, paint }, notes);
  if (!filled || Array.isArray(filled) || typeof filled === 'string') throw new Error('template is empty');
  const svg = await satori(filled as never, { width: t.w, height: t.h, fonts: await fontsFor(t.fonts) });
  return Buffer.from(new Resvg(svg, { fitTo: width === t.w ? { mode: 'original' } : { mode: 'width', value: width } }).render().asPng());
}

export interface Clash { slot: string; problem: 'shape' | 'edge' | 'text'; /** where, in template px */ box: { x0: number; y0: number; x1: number; y1: number } }

const CHECK_W = 360;
const NAMES: Record<string, string> = { headline: 'the headline', body: 'the body text', kicker: 'the lead-in line', label: 'the label', cta: 'the button text', item: 'a list item' };

/** A clash in words: for the viewer (no box) or for the LLM fixing the template (with the box). */
export function describeClash(c: Clash, withBox = false): string {
  const what = c.problem === 'shape' ? `${NAMES[c.slot]} runs into a shape or picture`
    : c.problem === 'edge' ? `${NAMES[c.slot]} runs off the edge of the frame`
    : `${NAMES[c.slot]} overlaps other text`;
  return withBox ? `${what} (around x ${c.box.x0}-${c.box.x1}px, y ${c.box.y0}-${c.box.y1}px)` : what;
}

/**
 * Where this slide's text runs into shapes, other text or the frame edge. Pixel maths, $0: each
 * text slot is drawn on its own (marker ink vs invisible ink, so even text hidden under a button
 * shows), and the design under its pixels is compared with the colour under most of it.
 * ponytail: one background per text, so text meant to span two backgrounds would be flagged too.
 */
export async function textClashes(t: Drawable, s: Slots): Promise<Clash[]> {
  const raw = async (paint: Paint) => (await sharp(await draw(t, s, [], paint, CHECK_W)).removeAlpha().raw().toBuffer({ resolveWithObject: true }));
  const base = await raw(null);
  const { width: W, height: H } = base.info, B = base.data, k = t.w / W;
  const boxOf = (ps: number[]) => {
    const xs = ps.map((p) => p % W), ys = ps.map((p) => Math.floor(p / W));
    return { x0: Math.round(Math.min(...xs) * k), y0: Math.round(Math.min(...ys) * k), x1: Math.round(Math.max(...xs) * k), y1: Math.round(Math.max(...ys) * k) };
  };
  const out: Clash[] = [];
  const masks: [string, Set<number>][] = [];
  const present = ['headline', 'body', 'kicker', 'label', 'cta', 'item'].filter((n) => (n === 'item' ? s.items?.length : s[n as keyof Slots]));
  for (const slot of present) {
    const [{ data: D }, { data: C }] = await Promise.all([raw({ slot, ink: 'marker' }), raw({ slot, ink: 'clear' })]);
    const ps: number[] = [];
    for (let p = 0; p < W * H; p++) {
      if (Math.abs(D[p * 3]! - C[p * 3]!) + Math.abs(D[p * 3 + 1]! - C[p * 3 + 1]!) + Math.abs(D[p * 3 + 2]! - C[p * 3 + 2]!) > 150) ps.push(p);
    }
    if (ps.length < 10) continue;
    masks.push([slot, new Set(ps)]);
    const med = [0, 1, 2].map((c) => { const v = ps.map((p) => B[p * 3 + c]!).sort((a, b) => a - b); return v[v.length >> 1]!; });
    const far = ps.filter((p) => Math.abs(B[p * 3]! - med[0]!) + Math.abs(B[p * 3 + 1]! - med[1]!) + Math.abs(B[p * 3 + 2]! - med[2]!) > 90);
    if (far.length > Math.max(8, ps.length * 0.03)) out.push({ slot, problem: 'shape', box: boxOf(far) });
    const edge = ps.filter((p) => { const x = p % W, y = Math.floor(p / W); return x < 2 || y < 2 || x >= W - 2 || y >= H - 2; });
    if (edge.length > 2) out.push({ slot, problem: 'edge', box: boxOf(edge) });
  }
  for (let i = 0; i < masks.length; i++) {
    for (let j = i + 1; j < masks.length; j++) {
      const both = [...masks[i]![1]].filter((p) => masks[j]![1].has(p));
      if (both.length > 8) out.push({ slot: masks[i]![0], problem: 'text', box: boxOf(both) });
    }
  }
  return out;
}

/** Body text → the list items a data-each block repeats ("- x", "• x", "1. x" lines) and what's left as body. */
export function splitItems(body: string | undefined): { body?: string; items: string[] } {
  const items: string[] = [], rest: string[] = [];
  for (const line of (body ?? '').split('\n')) {
    const m = /^\s*(?:[-•*]|\d+[.)])\s+(.+)$/.exec(line);
    if (m) items.push(m[1]!.trim()); else rest.push(line);
  }
  return { body: rest.join('\n').trim() || undefined, items };
}

/** The ```html block and the JSON before it, from an LLM reply. Throws when either is missing. */
export function parseTemplateReply(raw: string, w: number, h: number): Template {
  const code = /```html\s*([\s\S]*?)```/i.exec(raw)?.[1]?.trim();
  if (!code || !code.startsWith('<')) throw new Error('the reply had no html template');
  if (code.length > 40_000) throw new Error('template too large');
  // The JSON normally comes before the html block; tolerate it after, and stray quotes in the example's words.
  const at = raw.search(/```html/i);
  let o: Record<string, unknown> = {};
  for (const part of [raw.slice(0, at), raw.slice(at + 7 + code.length)]) {
    try { o = parseJsonObject(part); break; } catch { /* next part, else defaults below */ }
  }
  const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
  const sm = (o.sample && typeof o.sample === 'object' ? o.sample : {}) as Record<string, unknown>;
  const sample: Slots = {};
  for (const k of ['headline', 'body', 'kicker', 'label', 'cta'] as const) if (str(sm[k])) sample[k] = str(sm[k]);
  if (Array.isArray(sm.items)) sample.items = sm.items.map(str).filter(Boolean);
  return {
    html: code, w, h,
    fonts: (Array.isArray(o.fonts) ? o.fonts : []).map(str).filter((f) => /^[\w ]{2,40}$/.test(f)).slice(0, 4),
    accent: /^#[0-9a-f]{3,8}$/i.test(str(o.accent)) ? str(o.accent) : undefined,
    background: o.background === 'image' || code.includes('{{bg}}') ? 'image' : 'none',
    sample,
  };
}
