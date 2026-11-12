// Content Calendar ↔ Postiz. One way to hand an item to Postiz (the publisher module and the
// calendar both call scheduleItem), and, with CONTENT_POSTIZ_SYNC=1, the calendar is live:
// planning an approved, proof-complete post sends it to Postiz at that time right away, and
// moving one that Postiz already holds deletes it there and books the new time. Any Postiz
// failure leaves our item exactly as it was (the publisher run picks it up as before).
import type { ModuleContext } from '../modules/module.ts';
import { createRepo, type ContentItemRow } from '../db/repo.ts';
import { createContentItems } from '../db/content-items.ts';
import { buildUtmUrl, type Platform } from '../../core/src/index.ts';
import { renderSlides } from '../slides.ts';
import { itemMedia } from './asset-service.ts';
import { offerFor } from '../brand.ts';
import { postParts } from '../modules/publisher.module.ts';
import type { Channel } from '../adapters/postiz.ts';

/** Platforms with a channel connected in Postiz; null = don't restrict (Postiz not set up or unreachable). */
export async function connectedPlatforms(ctx: ModuleContext): Promise<string[] | null> {
  const p = ctx.adapters?.postiz;
  if (!p?.configured || !p.platforms) return null;
  return p.platforms().catch((e) => { ctx.logger.warn(`Postiz channels: ${(e as Error).message}`); return null; });
}

/** The Postiz channels that can carry `platform`; null = Postiz not set up or unreachable. */
export async function platformChannels(ctx: ModuleContext, platform: string): Promise<Channel[] | null> {
  const p = ctx.adapters?.postiz;
  if (!p?.configured || !p.channels) return null;
  return p.channels(platform).catch((e) => { ctx.logger.warn(`Postiz channels: ${(e as Error).message}`); return null; });
}

/** Choose the channels one post goes to (opting out of the rest). A post already booked in Postiz is
 *  re-booked on the new channels at the same time (with CONTENT_POSTIZ_SYNC). */
export async function setItemChannels(ctx: ModuleContext, id: string, ids: unknown): Promise<{ ok: boolean; message: string }> {
  if (!Array.isArray(ids) || !ids.length || ids.length > 20 || ids.some((x) => typeof x !== 'string' || x.length > 64)) {
    return { ok: false, message: 'Keep at least one channel. To skip this post everywhere, reject it.' };
  }
  const row = (await ctx.db.query<{ status: string; postiz_id: string | null; scheduled_at: string | null }>(
    `update content.content_items set channels = $2 where id = $1 and status <> 'published' returning status::text, postiz_id, scheduled_at::text`, [id, ids])).rows[0];
  if (!row) return { ok: false, message: 'Already published (or not found); its channels can no longer change.' };
  const saved = `Posts to ${ids.length} channel${ids.length === 1 ? '' : 's'}`;
  if (!(row.status === 'queued' && row.postiz_id && row.scheduled_at)) return { ok: true, message: saved };
  const synced = await syncPlanned(ctx, id, new Date(row.scheduled_at));
  return synced ? { ok: synced.ok, message: `${saved}. ${synced.message}` } : { ok: true, message: `${saved}. Move it on the Calendar to resend it to Postiz.` };
}

/** Send one item to Postiz at `at`; returns the Postiz id and the tracked link. Does not change our status. */
async function scheduleItem(ctx: ModuleContext, item: ContentItemRow, at: Date): Promise<{ postizId: string; utm: string }> {
  // No offer saved → the post goes out without a link.
  const offer = offerFor(item.offer_idx);
  const utm = offer ? buildUtmUrl(offer.url, { source: item.platform as Platform, campaign: ctx.env.defaultUtmCampaign, content: item.id }) : '';
  // The creative saved on the post, on every platform. Instagram can't post without one,
  // so a post with none falls back to plain text slides.
  let media = await itemMedia(ctx, item.id);
  if (!media.length && item.platform === 'instagram') {
    media = (await renderSlides(item.body ?? '')).map((buf, i) => ({ buf, mime: 'image/png' as const, name: `slide-${i + 1}.png` }));
  }
  const { postizId } = await ctx.adapters.postiz.schedule({ parts: postParts(item, utm), platform: item.platform, scheduledAt: at.toISOString(), media, title: item.title, channelIds: item.channels });
  return { postizId, utm };
}

/** Book one approved, proof-complete item in Postiz at `at` and mark it queued. Runs in one
 *  transaction holding the item's row lock, so a second booking (publisher run, calendar) or a
 *  reviewer's reject waits for it instead of racing it, and an item that stopped being bookable is
 *  left alone (null). If anything fails after Postiz accepted, the Postiz post is removed again. */
export async function bookItem(ctx: ModuleContext, itemId: string, at: Date): Promise<{ postizId: string; utm: string } | null> {
  let booked: { postizId: string; utm: string } | undefined;
  try {
    return await ctx.db.tx(async (q) => {
      const item = (await q.query<ContentItemRow>(
        `select * from content.content_items where id = $1 and status = 'approved' and postiz_id is null for update`, [itemId])).rows[0];
      if (!item || !(await q.query(`select 1 from content.v_publish_ready where id = $1`, [itemId])).rowCount) return null;
      booked = await scheduleItem({ ...ctx, db: q }, item, at);
      await createContentItems(q).transition(item.id, { event: 'schedule', postizId: booked.postizId, utmUrl: booked.utm, scheduledAt: at.toISOString() });
      return booked;
    });
  } catch (e) {
    if (booked) await ctx.adapters.postiz.remove(booked.postizId).catch((err) => ctx.logger.error(`orphaned Postiz post ${booked!.postizId} for ${itemId}: ${(err as Error).message}`));
    throw e;
  }
}

/** Calendar → Postiz after the operator planned or moved an item. `null` when sync is off or not applicable. */
export async function syncPlanned(ctx: ModuleContext, itemId: string, at: Date): Promise<{ ok: boolean; message: string } | null> {
  if (!ctx.env?.postizSync || !ctx.adapters.postiz?.configured) return null;
  const item = await createRepo(ctx.db).getItem(itemId);
  if (!item) return { ok: false, message: 'Item not found.' };

  // Already in Postiz and not live yet: move it there (delete, then book the new time).
  if (item.status === 'queued' && item.postiz_id) {
    try {
      await ctx.adapters.postiz.remove(item.postiz_id);
    } catch (e) {
      return { ok: false, message: `Postiz kept the old time: ${(e as Error).message.slice(0, 160)}` };
    }
    try {
      const { postizId } = await scheduleItem(ctx, item, at);
      await ctx.db.query(`update content.content_items set postiz_id = $2, scheduled_at = $3 where id = $1`, [item.id, postizId, at.toISOString()]);
      return { ok: true, message: `Moved in Postiz to ${at.toISOString()}` };
    } catch (e) {
      // Deleted there but not re-booked: back to approved + planned, so the next publisher run books it.
      await ctx.db.query(
        `update content.content_items set status = 'approved', postiz_id = null, scheduled_at = $2 where id = $1`, [item.id, at.toISOString()]);
      return { ok: false, message: `Removed from Postiz but not re-booked (${(e as Error).message.slice(0, 120)}); the next publish run books it.` };
    }
  }

  // Approved and proof-complete (v_publish_ready): book it now instead of waiting for the run.
  if (item.status !== 'approved' || item.postiz_id) return null;
  try {
    if (!(await bookItem(ctx, item.id, at))) return null;
    return { ok: true, message: `Scheduled in Postiz for ${at.toISOString()}` };
  } catch (e) {
    return { ok: false, message: `Planned here; Postiz said: ${(e as Error).message.slice(0, 160)}. The next publish run retries.` };
  }
}
