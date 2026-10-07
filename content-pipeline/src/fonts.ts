// Brand fonts for creatives. The SVG text renderer (librsvg via sharp) only sees fonts that
// fontconfig knows; loading a file once through sharp's `text.fontfile` registers it for the
// whole process, after which `font-family="<family>"` in our SVGs uses it (proved on Windows;
// same fontconfig call on Linux). Files live in content.brand_fonts and are written to a temp dir.
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface FontInfo { family: string; weight: number; italic: boolean }

/**
 * Family name and weight read from a TTF/OTF file (the names fontconfig will register it
 * under). Throws on anything that isn't a TrueType/OpenType font (e.g. WOFF).
 */
export function fontInfo(buf: Buffer): FontInfo {
  const tag = buf.toString('latin1', 0, 4);
  if (!(buf.readUInt32BE(0) === 0x00010000 || tag === 'OTTO' || tag === 'true')) {
    throw new Error('not a TTF or OTF font file (WOFF and other formats are not supported)');
  }
  const tables = new Map<string, number>();
  for (let i = 0, n = buf.readUInt16BE(4); i < n; i++) {
    const rec = 12 + i * 16;
    tables.set(buf.toString('latin1', rec, rec + 4), buf.readUInt32BE(rec + 8));
  }
  const nameAt = tables.get('name');
  if (nameAt == null) throw new Error('font has no name table');
  const count = buf.readUInt16BE(nameAt + 2), strings = nameAt + buf.readUInt16BE(nameAt + 4);
  const names = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    const r = nameAt + 6 + i * 12;
    const platform = buf.readUInt16BE(r), language = buf.readUInt16BE(r + 4), id = buf.readUInt16BE(r + 6);
    const len = buf.readUInt16BE(r + 8), off = strings + buf.readUInt16BE(r + 10);
    if (id !== 1 && id !== 2 && id !== 16 && id !== 17) continue;
    // Windows (UTF-16BE, English) wins; Mac Roman as a fallback.
    if (platform === 3 && (language & 0xff) === 0x09) {
      const be = buf.subarray(off, off + len);
      names.set(id, Buffer.from(be).swap16().toString('utf16le'));
    } else if (platform === 1 && !names.has(id)) {
      names.set(id, buf.toString('latin1', off, off + len));
    }
  }
  const family = (names.get(16) ?? names.get(1))?.trim();
  if (!family) throw new Error('font has no family name');
  const os2 = tables.get('OS/2');
  const weight = os2 != null ? buf.readUInt16BE(os2 + 4) : 400;
  const sub = (names.get(17) ?? names.get(2) ?? '').toLowerCase();
  return { family, weight: weight >= 100 && weight <= 1000 ? weight : 400, italic: /italic|oblique/.test(sub) };
}

const loaded = new Set<string>();
const DIR = join(tmpdir(), 'content-brand-fonts');

/** Make these font files available to the renderer (idempotent per process). */
export async function registerFonts(files: Buffer[]): Promise<void> {
  for (const f of files) {
    const hash = createHash('sha1').update(f).digest('hex');
    if (loaded.has(hash)) continue;
    mkdirSync(DIR, { recursive: true });
    const path = join(DIR, `${hash}.ttf`);
    writeFileSync(path, f);
    await sharp({ text: { text: '.', fontfile: path } }).png().toBuffer();
    loaded.add(hash);
  }
}

/** Google Fonts' CSS API hands out one static TTF per weight to clients that don't ask for woff2. */
export async function fetchGoogleFont(family: string): Promise<{ weight: number; file: Buffer }[]> {
  const css = async (spec: string) => {
    const res = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}${spec}`,
      { signal: AbortSignal.timeout(20_000) });
    return res.ok ? res.text() : null;
  };
  // Not every family has 700/800; Google then rejects the whole request, so fall back to its default.
  const text = (await css(':wght@400;700;800')) ?? (await css(':wght@400;700')) ?? (await css(''));
  if (!text) throw new Error(`Google Fonts has no family called "${family}"`);
  const faces = [...text.matchAll(/font-weight:\s*(\d+);\s*src:\s*url\((https:[^)]+\.ttf)\)/g)];
  if (!faces.length) throw new Error(`no TTF files for "${family}"`);
  return Promise.all(faces.map(async ([, w, url]) => {
    const res = await fetch(url!, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`font download failed (${res.status})`);
    return { weight: Number(w), file: Buffer.from(await res.arrayBuffer()) };
  }));
}

/** Suggestions for the font picker; any Google Fonts family name works. */
export const CURATED_FONTS = [
  'Inter', 'Manrope', 'DM Sans', 'Plus Jakarta Sans', 'Outfit', 'Sora', 'Poppins', 'Montserrat',
  'Work Sans', 'Space Grotesk', 'Lato', 'Open Sans', 'Rubik', 'Figtree', 'Archivo', 'Barlow',
  'Oswald', 'Bebas Neue', 'Anton', 'Archivo Black',
  'Playfair Display', 'DM Serif Display', 'Fraunces', 'Lora', 'Merriweather', 'Libre Baskerville',
  'Cormorant Garamond', 'EB Garamond', 'Instrument Serif', 'Space Mono',
] as const;
