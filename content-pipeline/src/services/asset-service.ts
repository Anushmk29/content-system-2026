// The creative on one post (content.content_assets): slides made from a saved style, or the
// client's own images / one video. Changeable only while the copy is (before approval: the
// reviewer signs off on text and creative together). The publisher reads itemMedia().
import sharp from 'sharp';
import type { ModuleContext } from '../modules/module.ts';
import type { ContentItemRow } from '../db/repo.ts';
import { generateCreative, type GenerateResult } from './style-service.ts';
import { isPlacement, isRasterImage } from '../creative.ts';
import { EDITABLE_STATUSES, carouselSlides } from '../../core/src/index.ts';
import { VISUAL_FORMATS } from '../prompts/platform-playbooks.ts';

type AssetMime = 'image/png' | 'image/jpeg' | 'video/mp4';
interface AssetInfo { idx: number; mime: AssetMime; source: 'generated' | 'upload'; style_id: string | null; size: number; created_at: string }
interface Media { buf: Buffer; mime: AssetMime; name: string }

const MAX_IMAGES = 10;

/**
 * What goes on the creative, in the style editor's "---" slide format. Instagram bodies are
 * slide text already; LinkedIn/Facebook bodies with "---" breaks become a carousel; otherwise
 * (and on X, where "---" splits a thread) one slide with the hook.
 */
export function creativeText(item: Pick<ContentItemRow, 'platform' | 'title' | 'hook' | 'body'> & { format?: string | null }): string {
  // Single image: its headline, then the caption for the design's other text blocks.
  if (item.format === 'quote_card') return [(item.hook || item.title).trim(), item.body?.trim()].filter(Boolean).join('\n\n');
  const slides = carouselSlides(item.body ?? '', item.format === 'carousel');
  if (item.platform !== 'x' && slides.length > 1) return slides.join('\n---\n');
  if (item.platform === 'instagram' && slides.length === 1) return slides[0]!;
  return (item.hook || item.title).trim();
}

async function editableItem(ctx: ModuleContext, itemId: string): Promise<ContentItemRow> {
  const item = (await ctx.db.query<ContentItemRow>('select * from content.content_items where id = $1 for update', [itemId])).rows[0];
  if (!item) throw new Error('That post no longer exists.');
  if (!EDITABLE_STATUSES.includes(item.status)) throw new Error('The creative is locked once the post is approved.');
  return item;
}

/** Replace the post's media (old rows go only if the new ones land). */
async function replace(ctx: ModuleContext, itemId: string, files: { buf: Buffer; mime: AssetMime }[], source: 'generated' | 'upload', styleId: string | null) {
  await ctx.db.tx(async (q) => {
    await editableItem({ ...ctx, db: q }, itemId);
    await q.query(`delete from content.content_assets where item_id = $1`, [itemId]);
    for (const [i, f] of files.entries()) {
      await q.query(`insert into content.content_assets (item_id, idx, mime, bytes, source, style_id) values ($1, $2, $3, $4, $5, $6)`,
        [itemId, i, f.mime, f.buf, source, styleId]);
    }
    await q.query(`update content.content_items set asset_url = $2 where id = $1`, [itemId, `/content/api/items/${itemId}/asset`]);
  });
}

/** Make the post's creative from a saved example (or one-off reference images) and attach it, replacing what was there. */
export async function saveItemCreative(ctx: ModuleContext, itemId: string, input: { styleId?: string; refs?: Buffer[] }): Promise<GenerateResult> {
  const item = await editableItem(ctx, itemId);
  const placement = isPlacement(item.platform) ? item.platform : null;
  if (!placement) throw new Error('Blog posts don’t carry a creative.');
  // The creative's button: the post's CTA when it's button-sized, else none (the caption carries the link).
  const cta = item.cta && item.cta.length <= 28 ? item.cta : undefined;
  // Recorded on the post so a page opened later still shows "creating…" or why it failed.
  const mark = (started: boolean, error: string | null) => ctx.db.query(
    `update content.content_items set creative_started_at = ${started ? 'now()' : 'null'}, creative_error = $2 where id = $1`, [itemId, error]);
  await mark(true, null);
  try {
    const r = await generateCreative(ctx, { styleId: input.styleId, refs: input.refs, placement, text: creativeText(item), cta, brief: item.title });
    await replace(ctx, itemId, r.images.map((buf) => ({ buf, mime: 'image/png' as const })), 'generated', input.styleId ?? null);
    await mark(false, null);
    return r;
  } catch (e) {
    await mark(false, (e as Error).message.slice(0, 500)).catch(() => {});
    throw e;
  }
}

// MP4: an `ftyp` box whose major brand is a real MP4 one, not just any 4 bytes after it.
const MP4_BRANDS = ['isom', 'iso2', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash'];
export const sniff = (b: Buffer): AssetMime | null =>
  b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? 'image/png'
  : b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'image/jpeg'
  : b.subarray(4, 8).toString('latin1') === 'ftyp' && MP4_BRANDS.includes(b.subarray(8, 12).toString('latin1')) ? 'video/mp4'
  : null;

/** The client's own media: up to 10 images (other image types become PNG), or one MP4 video. */
export async function uploadItemAssets(ctx: ModuleContext, itemId: string, files: Buffer[]): Promise<{ count: number }> {
  await editableItem(ctx, itemId);
  if (files.length === 0) throw new Error('Choose a file.');
  const out: { buf: Buffer; mime: AssetMime }[] = [];
  for (const buf of files) {
    const mime = sniff(buf);
    if (mime) { out.push({ buf, mime }); continue; }
    if (!isRasterImage(buf)) throw new Error('Use PNG, JPG or WebP images, or an MP4 video.');
    try { out.push({ buf: await sharp(buf, { limitInputPixels: 4e7 }).rotate().png().toBuffer(), mime: 'image/png' }); }
    catch { throw new Error('Use PNG, JPG or WebP images, or an MP4 video.'); }
  }
  const videos = out.filter((f) => f.mime === 'video/mp4').length;
  if (videos && out.length > 1) throw new Error('Attach one video on its own, or images only.');
  if (out.length > MAX_IMAGES) throw new Error(`At most ${MAX_IMAGES} images.`);
  await replace(ctx, itemId, out, 'upload', null);
  return { count: out.length };
}

export async function removeItemAssets(ctx: ModuleContext, itemId: string): Promise<void> {
  await ctx.db.tx(async (db) => {
    await editableItem({ ...ctx, db }, itemId);
    await db.query(`delete from content.content_assets where item_id = $1`, [itemId]);
    await db.query(`update content.content_items set asset_url = null where id = $1`, [itemId]);
  });
}

export async function listItemAssets(ctx: ModuleContext, itemId: string): Promise<AssetInfo[]> {
  return (await ctx.db.query<AssetInfo>(
    `select idx, mime, source, style_id, octet_length(bytes) as size, created_at from content.content_assets where item_id = $1 order by idx`, [itemId],
  )).rows.map((r) => ({ ...r, size: Number(r.size) }));
}

/** Design desk: every carousel / image post not yet live. 'needs' = no visual yet, 'made' = has one and
 *  can still change, 'locked' = approved with the copy (scheduled or about to be). */
export type DesignStage = 'needs' | 'made' | 'locked';
export interface DesignRow {
  id: string; platform: string; format: string; title: string; hook: string | null; body: string | null;
  status: string; scheduled_at: string | null; created_at: string; stage: DesignStage;
  creative_started_at: string | null; creative_error: string | null;
  assets: { idx: number; mime: string; source: string; created_at: string }[];
}
export async function listDesignQueue(ctx: ModuleContext): Promise<DesignRow[]> {
  return (await ctx.db.query<DesignRow>(
    `select ci.id, ci.platform::text, ci.format::text, ci.title, ci.hook, ci.body, ci.status::text,
       ci.scheduled_at::text, ci.created_at::text, ci.creative_started_at::text, ci.creative_error,
       coalesce((select json_agg(json_build_object('idx', a.idx, 'mime', a.mime, 'source', a.source, 'created_at', a.created_at) order by a.idx)
                 from content.content_assets a where a.item_id = ci.id), '[]'::json) as assets,
       case when ci.status::text <> all($2) then 'locked'
            when exists (select 1 from content.content_assets a where a.item_id = ci.id) then 'made' else 'needs' end as stage
     from content.content_items ci
     where ci.format::text = any($1) and ci.status in ('idea','draft','qc_passed','needs_approval','approved','queued')
     order by ci.scheduled_at nulls last, ci.created_at`, [VISUAL_FORMATS, EDITABLE_STATUSES])).rows;
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
