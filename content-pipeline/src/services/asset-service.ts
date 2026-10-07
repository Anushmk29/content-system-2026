// The creative on one post (content.content_assets): slides made from a saved style, or the
// client's own images / one video. Changeable only while the copy is (before approval: the
// reviewer signs off on text and creative together). The publisher reads itemMedia().
import sharp from 'sharp';
import type { ModuleContext } from '../modules/module.ts';
import { createRepo, type ContentItemRow } from '../db/repo.ts';
import { generateCreative, type GenerateResult } from './style-service.ts';
import type { Placement } from '../creative.ts';
import { splitSlides } from '../slides.ts';

export const EDITABLE_STATUSES = ['idea', 'draft', 'qc_passed', 'needs_approval'];
export type AssetMime = 'image/png' | 'image/jpeg' | 'video/mp4';
export interface AssetInfo { idx: number; mime: AssetMime; source: 'generated' | 'upload'; style_id: string | null; size: number; created_at: string }
export interface Media { buf: Buffer; mime: AssetMime; name: string }

const PLACEMENT: Record<string, Placement> = { instagram: 'instagram', linkedin: 'linkedin', facebook: 'facebook', x: 'x' };
const MAX_IMAGES = 10;

/**
 * What goes on the creative, in the style editor's "---" slide format. Instagram bodies are
 * slide text already; LinkedIn/Facebook bodies with "---" breaks become a carousel; otherwise
 * (and on X, where "---" splits a thread) one slide with the hook.
 */
export function creativeText(item: Pick<ContentItemRow, 'platform' | 'title' | 'hook' | 'body'>): string {
  const slides = splitSlides(item.body ?? '');
  if (item.platform !== 'x' && slides.length > 1) return slides.join('\n---\n');
  if (item.platform === 'instagram' && slides.length === 1) return slides[0]!;
  return (item.hook || item.title).trim();
}

async function editableItem(ctx: ModuleContext, itemId: string): Promise<ContentItemRow> {
  const item = await createRepo(ctx.db).getItem(itemId);
  if (!item) throw new Error('That post no longer exists.');
  if (!EDITABLE_STATUSES.includes(item.status)) throw new Error('The creative is locked once the post is approved.');
  return item;
}

/** Replace the post's media (old rows go only if the new ones land). */
async function replace(ctx: ModuleContext, itemId: string, files: { buf: Buffer; mime: AssetMime }[], source: 'generated' | 'upload', styleId: string | null) {
  await ctx.db.tx(async (q) => {
    await q.query(`delete from content.content_assets where item_id = $1`, [itemId]);
    for (const [i, f] of files.entries()) {
      await q.query(`insert into content.content_assets (item_id, idx, mime, bytes, source, style_id) values ($1, $2, $3, $4, $5, $6)`,
        [itemId, i, f.mime, f.buf, source, styleId]);
    }
    await q.query(`update content.content_items set asset_url = $2 where id = $1`, [itemId, `/content/api/items/${itemId}/asset`]);
  });
}

/** Make the post's creative from a saved style and attach it (replacing what was there). */
export async function saveItemCreative(ctx: ModuleContext, itemId: string, input: { styleId: string; fresh?: boolean }): Promise<GenerateResult> {
  const item = await editableItem(ctx, itemId);
  const placement = PLACEMENT[item.platform];
  if (!placement) throw new Error('Blog posts don’t carry a creative.');
  // The creative's button: the post's CTA when it's button-sized, else none (the caption carries the link).
  const cta = item.cta && item.cta.length <= 28 ? item.cta : undefined;
  const r = await generateCreative(ctx, { styleId: input.styleId, placement, text: creativeText(item), cta, fresh: input.fresh, brief: item.title });
  await replace(ctx, itemId, r.images.map((buf) => ({ buf, mime: 'image/png' as const })), 'generated', input.styleId);
  return r;
}

const sniff = (b: Buffer): AssetMime | null =>
  b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? 'image/png'
  : b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'image/jpeg'
  : b.subarray(4, 8).toString('latin1') === 'ftyp' ? 'video/mp4'
  : null;

/** The client's own media: up to 10 images (other image types become PNG), or one MP4 video. */
export async function uploadItemAssets(ctx: ModuleContext, itemId: string, files: Buffer[]): Promise<{ count: number }> {
  await editableItem(ctx, itemId);
  if (files.length === 0) throw new Error('Choose a file.');
  const out: { buf: Buffer; mime: AssetMime }[] = [];
  for (const buf of files) {
    const mime = sniff(buf);
    if (mime) { out.push({ buf, mime }); continue; }
    try { out.push({ buf: await sharp(buf).rotate().png().toBuffer(), mime: 'image/png' }); }
    catch { throw new Error('Use PNG, JPG or WebP images, or an MP4 video.'); }
  }
  const videos = out.filter((f) => f.mime === 'video/mp4').length;
  if (videos && out.length > 1) throw new Error('Attach one video on its own, or images only.');
  if (out.length > MAX_IMAGES) throw new Error(`At most ${MAX_IMAGES} images.`);
  await replace(ctx, itemId, out, 'upload', null);
  return { count: out.length };
}

export async function removeItemAssets(ctx: ModuleContext, itemId: string): Promise<void> {
  await editableItem(ctx, itemId);
  await ctx.db.query(`delete from content.content_assets where item_id = $1`, [itemId]);
  await ctx.db.query(`update content.content_items set asset_url = null where id = $1`, [itemId]);
}

export async function listItemAssets(ctx: ModuleContext, itemId: string): Promise<AssetInfo[]> {
  return (await ctx.db.query<AssetInfo>(
    `select idx, mime, source, style_id, octet_length(bytes) as size, created_at from content.content_assets where item_id = $1 order by idx`, [itemId],
  )).rows.map((r) => ({ ...r, size: Number(r.size) }));
}

export async function getItemAsset(ctx: ModuleContext, itemId: string, idx: number): Promise<{ mime: AssetMime; bytes: Buffer } | null> {
  const r = (await ctx.db.query<{ mime: AssetMime; bytes: Uint8Array }>(
    `select mime, bytes from content.content_assets where item_id = $1 and idx = $2`, [itemId, idx])).rows[0];
  return r ? { mime: r.mime, bytes: Buffer.from(r.bytes) } : null;
}

/** Everything attached to a post, in order, ready to upload. */
export async function itemMedia(ctx: ModuleContext, itemId: string): Promise<Media[]> {
  const r = await ctx.db.query<{ idx: number; mime: AssetMime; bytes: Uint8Array }>(
    `select idx, mime, bytes from content.content_assets where item_id = $1 order by idx`, [itemId]);
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'video/mp4': 'mp4' } as const;
  return r.rows.map((a) => ({ buf: Buffer.from(a.bytes), mime: a.mime, name: `${itemId.slice(0, 8)}-${a.idx + 1}.${ext[a.mime]}` }));
}
