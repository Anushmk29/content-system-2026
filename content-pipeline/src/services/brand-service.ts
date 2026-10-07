// The brand kit (content.brand_kit, one row): who the client is, who they write for, their voice,
// pillars, offers and look. loadBrand() makes it the active brand every prompt reads (brand.ts);
// brandLook() hands creatives their fonts and logo. Edited on /content/brand and /content/setup.
import sharp from 'sharp';
import type { ModuleContext } from '../modules/module.ts';
import { DECODE_PLATFORMS, type DecodePlatform } from '../adapters/apify.ts';
import { DEFAULT_BRAND, brand, setBrand, slugify, type Brand, type BrandOffer, type BrandPillar, type LogoCorner } from '../brand.ts';
import { fetchGoogleFont, fontInfo, registerFonts } from '../fonts.ts';
import type { Look } from '../creative.ts';

interface KitRow {
  name: string; tagline: string; audience: string; voice_prompt: string; voice_samples: string[];
  pillars: BrandPillar[]; offers: BrandOffer[]; palette: string[]; heading_font: string | null; body_font: string | null;
  has_logo: boolean; logo_corner: LogoCorner; own_handles: Brand['ownHandles']; onboarded_at: string | null;
}
const KIT_COLS = `name, tagline, audience, voice_prompt, voice_samples, pillars, offers, palette, heading_font, body_font,
  logo_png is not null as has_logo, logo_corner, own_handles, onboarded_at`;

/** A blank kit: what the setup form starts from on a fresh install. */
export const EMPTY_BRAND: Brand = {
  ...DEFAULT_BRAND, name: '', tagline: '', audience: '', voice: '', pillars: [], offers: [], saved: false,
};

const toBrand = (r: KitRow): Brand => ({
  name: r.name, tagline: r.tagline, audience: r.audience, voice: r.voice_prompt, voiceSamples: r.voice_samples ?? [],
  pillars: r.pillars ?? [], offers: r.offers ?? [], palette: r.palette ?? [],
  headingFont: r.heading_font, bodyFont: r.body_font, hasLogo: r.has_logo, logoCorner: r.logo_corner,
  ownHandles: r.own_handles ?? {}, onboardedAt: r.onboarded_at, saved: true,
});

/** Read the saved kit and make it the active brand (the default when nothing is saved). Throws on a DB error. */
export async function readBrand(ctx: ModuleContext): Promise<Brand> {
  const r = (await ctx.db.query<KitRow>(`select ${KIT_COLS} from content.brand_kit where id`)).rows[0];
  setBrand(r ? toBrand(r) : DEFAULT_BRAND);
  return brand();
}

/**
 * readBrand that never throws: on a DB error (or the table not migrated yet) the last loaded
 * brand stays active, so the pipeline never stops over the kit.
 */
export async function loadBrand(ctx: ModuleContext): Promise<Brand> {
  try {
    await readBrand(ctx);
  } catch (e) {
    ctx.logger.warn(`brand kit not loaded, using the default: ${(e as Error).message}`);
  }
  return brand();
}

export interface BrandPatch {
  name?: string; tagline?: string; audience?: string; voice?: string; voiceSamples?: string[];
  pillars?: Partial<BrandPillar>[]; offers?: Partial<BrandOffer>[]; palette?: string[];
  headingFont?: string | null; bodyFont?: string | null; logoCorner?: LogoCorner;
  ownHandles?: Record<string, unknown>; onboarded?: boolean;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Clean every field at the trust boundary; throws a plain-English error on bad input. */
export function cleanPatch(p: BrandPatch): BrandPatch {
  const out: BrandPatch = {};
  if (p.name !== undefined) { out.name = text(p.name, 80); if (!out.name) throw new Error('Brand name can’t be empty.'); }
  if (p.tagline !== undefined) out.tagline = text(p.tagline, 160);
  if (p.audience !== undefined) out.audience = text(p.audience, 2000);
  if (p.voice !== undefined) out.voice = text(p.voice, 4000);
  if (p.voiceSamples !== undefined) out.voiceSamples = (p.voiceSamples ?? []).map((s) => text(s, 3000)).filter(Boolean).slice(0, 10);
  if (p.pillars !== undefined) {
    const seen = new Set<string>();
    out.pillars = (p.pillars ?? []).map((x) => {
      const label = text(x.label, 60);
      return { slug: slugify(x.slug || label), label, description: text(x.description, 240), target: Math.max(0, Math.min(100, Math.round(Number(x.target) || 0))) };
    }).filter((x) => x.slug && !seen.has(x.slug) && seen.add(x.slug)).slice(0, 8);
  }
  if (p.offers !== undefined) {
    const offers = (p.offers ?? []).map((o) => ({ label: text(o.label, 80), url: text(o.url, 500), cta: text(o.cta, 300), primary: !!o.primary }))
      .filter((o) => o.label || o.url).slice(0, 3);
    for (const o of offers) {
      if (!/^https?:\/\/[^\s]+\.[^\s]+$/.test(o.url)) throw new Error(`“${o.label || o.url}” needs a full link starting with https://`);
      if (!o.label) throw new Error('Every offer needs a name.');
    }
    const primary = Math.max(0, offers.findIndex((o) => o.primary));
    out.offers = offers.map((o, i) => ({ ...o, primary: i === primary }));
  }
  if (p.palette !== undefined) out.palette = (p.palette ?? []).map((c) => text(c, 9).toLowerCase()).filter((c) => /^#[0-9a-f]{6}$/.test(c)).slice(0, 6);
  if (p.headingFont !== undefined) out.headingFont = text(p.headingFont, 80) || null;
  if (p.bodyFont !== undefined) out.bodyFont = text(p.bodyFont, 80) || null;
  if (p.logoCorner !== undefined) {
    if (!['tl', 'tr', 'bl', 'br'].includes(p.logoCorner)) throw new Error('bad logo corner');
    out.logoCorner = p.logoCorner;
  }
  if (p.ownHandles !== undefined) {
    out.ownHandles = Object.fromEntries(DECODE_PLATFORMS
      .map((k) => [k, text((p.ownHandles ?? {})[k], 200)] as const).filter(([, v]) => v)) as Partial<Record<DecodePlatform, string>>;
  }
  if (p.onboarded !== undefined) out.onboarded = !!p.onboarded;
  return out;
}

/** Merge a patch into the saved kit (a fresh install starts blank) and make it active. */
export async function saveBrand(ctx: ModuleContext, patch: BrandPatch): Promise<Brand> {
  const p = cleanPatch(patch);
  const cur = await loadBrand(ctx);
  const base = cur.saved ? cur : EMPTY_BRAND;
  // A chosen font must exist as a file before a creative can use it: fetch it from Google once.
  if (p.headingFont) p.headingFont = await ensureFont(ctx, p.headingFont);
  if (p.bodyFont) p.bodyFont = await ensureFont(ctx, p.bodyFont);
  const b: Brand = { ...base, ...Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'onboarded')) };
  await ctx.db.query(
    `insert into content.brand_kit (id, name, tagline, audience, voice_prompt, voice_samples, pillars, offers, palette,
       heading_font, body_font, logo_corner, own_handles, onboarded_at)
     values (true, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, case when $13 then now() end)
     on conflict (id) do update set name = $1, tagline = $2, audience = $3, voice_prompt = $4, voice_samples = $5,
       pillars = $6, offers = $7, palette = $8, heading_font = $9, body_font = $10, logo_corner = $11, own_handles = $12,
       onboarded_at = case when $13 then coalesce(content.brand_kit.onboarded_at, now()) else content.brand_kit.onboarded_at end`,
    [b.name, b.tagline, b.audience, b.voice, JSON.stringify(b.voiceSamples), JSON.stringify(b.pillars), JSON.stringify(b.offers),
     JSON.stringify(b.palette), b.headingFont, b.bodyFont, b.logoCorner, JSON.stringify(b.ownHandles), p.onboarded === true]);
  return loadBrand(ctx);
}

// ---- voice ------------------------------------------------------------------

const VOICE_PROMPT = (samples: string[]) => `Here are ${samples.length} posts written by one brand.

${samples.map((s, i) => `<post ${i + 1}>\n${s.slice(0, 2500)}\n</post>`).join('\n\n')}

Write a voice guide another writer could follow to sound exactly like this. 6-9 short bullet
rules, each starting with "- ": tone, sentence length and rhythm, how posts open, how they
close, words and phrases they use, things they never do. Describe HOW they write, never WHAT
they wrote about. Plain text, no heading, no preamble.`;

/** 3-10 example posts → an editable voice guide (one LLM call). Not saved until the client saves. */
export async function extractVoice(ctx: ModuleContext, samples: string[]): Promise<{ voice: string; costUsd: number }> {
  const posts = samples.map((s) => s.trim()).filter((s) => s.length >= 40);
  if (posts.length < 3) throw new Error('Paste at least 3 posts (a few sentences each).');
  const { claude } = ctx.adapters;
  if (!claude.configured) throw new Error('No AI model is configured.');
  const before = claude.spentUsd;
  const voice = (await claude.complete(VOICE_PROMPT(posts.slice(0, 10)), { maxTokens: 700 })).trim();
  return { voice, costUsd: claude.spentUsd - before };
}

/** The client's own best recent posts on one platform (Apify), as voice samples. */
export async function importOwnPosts(ctx: ModuleContext, platform: DecodePlatform, handle: string): Promise<{ samples: string[]; costUsd: number }> {
  if (!DECODE_PLATFORMS.includes(platform)) throw new Error('unknown platform');
  if (!handle.trim()) throw new Error('Enter your profile or page link.');
  if (!ctx.adapters.apify.configured) throw new Error('Importing needs the Apify connection (ask your admin).');
  const since = new Date(Date.now() - 365 * 86_400_000);
  const { posts, costUsd } = await ctx.adapters.apify.scrape(platform, handle.trim(), { since, limit: 40 });
  const samples = posts.filter((p) => p.caption.length >= 80)
    .sort((a, b) => (b.reactions + 2 * b.comments) - (a.reactions + 2 * a.comments))
    .slice(0, 8).map((p) => p.caption);
  if (samples.length < 3) throw new Error(`Found only ${samples.length} usable post(s) there. Paste a few posts instead.`);
  return { samples, costUsd };
}

// ---- fonts ------------------------------------------------------------------

export interface FontRow { family: string; weights: number[]; source: 'google' | 'upload' }

export async function listFonts(ctx: ModuleContext): Promise<FontRow[]> {
  return (await ctx.db.query<FontRow>(
    `select family, array_agg(weight order by weight) as weights, min(source) as source
     from content.brand_fonts group by family order by family`)).rows;
}

/** The family's name as stored; a Google family is downloaded the first time it's chosen. */
async function ensureFont(ctx: ModuleContext, family: string): Promise<string> {
  const have = await ctx.db.query<{ family: string }>(`select family from content.brand_fonts where lower(family) = lower($1) limit 1`, [family]);
  if (have.rows[0]) return have.rows[0].family;
  let name = family;
  for (const { weight, file } of await fetchGoogleFont(family)) {
    name = fontInfo(file).family; // the name the renderer will know it by
    await ctx.db.query(
      `insert into content.brand_fonts (family, weight, file, source) values ($1, $2, $3, 'google')
       on conflict (family, weight, style) do update set file = excluded.file`, [name, weight, file]);
  }
  return name;
}

/** An uploaded TTF/OTF, filed under the family and weight written inside it. */
export async function uploadFont(ctx: ModuleContext, file: Buffer): Promise<{ family: string; weight: number }> {
  const info = fontInfo(file);
  await ctx.db.query(
    `insert into content.brand_fonts (family, weight, style, file, source) values ($1, $2, $3, $4, 'upload')
     on conflict (family, weight, style) do update set file = excluded.file, source = 'upload'`,
    [info.family, info.weight, info.italic ? 'italic' : 'normal', file]);
  return { family: info.family, weight: info.weight };
}

export async function deleteFont(ctx: ModuleContext, family: string): Promise<void> {
  await ctx.db.query(`delete from content.brand_fonts where family = $1`, [family]);
}

// ---- logo + look ------------------------------------------------------------

/** Any image → a PNG at most 1000px on its long side; null removes the logo. */
export async function setLogo(ctx: ModuleContext, image: Buffer | null): Promise<void> {
  const png = image && await sharp(image).resize(1000, 1000, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const r = await ctx.db.query(`update content.brand_kit set logo_png = $1 where id`, [png]);
  if (!r.rowCount) throw new Error('Save your brand name first.');
}

export async function getLogo(ctx: ModuleContext): Promise<Buffer | null> {
  const r = await ctx.db.query<{ logo_png: Uint8Array | null }>(`select logo_png from content.brand_kit where id`);
  return r.rows[0]?.logo_png ? Buffer.from(r.rows[0].logo_png) : null;
}

/** What creatives need from the brand: fonts registered with the renderer, plus the logo. */
export async function brandLook(ctx: ModuleContext): Promise<Look> {
  const b = await loadBrand(ctx);
  if (!b.saved) return {};
  const families = [b.headingFont, b.bodyFont].filter((f): f is string => !!f);
  if (families.length) {
    const files = await ctx.db.query<{ file: Uint8Array }>(`select file from content.brand_fonts where family = any($1)`, [families]);
    await registerFonts(files.rows.map((r) => Buffer.from(r.file)));
  }
  return { headingFont: b.headingFont, bodyFont: b.bodyFont, logo: b.hasLogo ? await getLogo(ctx) : null, logoCorner: b.logoCorner, palette: b.palette };
}
