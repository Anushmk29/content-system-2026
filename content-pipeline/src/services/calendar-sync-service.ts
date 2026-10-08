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

/** Send one item to Postiz at `at`; returns the Postiz id and the tracked link. Does not change our status. */
export async function scheduleItem(ctx: ModuleContext, item: ContentItemRow, at: Date): Promise<{ postizId: string; utm: string }> {
  // No offer saved → the post goes out without a link.
  const offer = offerFor(item.offer_idx);
  const utm = offer ? buildUtmUrl(offer.url, { source: item.platform as Platform, campaign: ctx.env.defaultUtmCampaign, content: item.id }) : '';
  // The creative saved on the post, on every platform. Instagram can't post without one,
  // so a post with none falls back to plain text slides.
  let media = await itemMedia(ctx, item.id);
  if (!media.length && item.platform === 'instagram') {
    media = (await renderSlides(item.body ?? '')).map((buf, i) => ({ buf, mime: 'image/png' as const, name: `slide-${i + 1}.png` }));
  }
  const { postizId } = await ctx.adapters.postiz.schedule({ parts: postParts(item, utm), platform: item.platform, scheduledAt: at.toISOString(), media, title: item.title });
  return { postizId, utm };
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
  const ready = (await ctx.db.query(`select 1 from content.v_publish_ready where id = $1`, [item.id])).rowCount;
  if (item.status !== 'approved' || item.postiz_id || !ready) return null;
  try {
    const { postizId, utm } = await scheduleItem(ctx, item, at);
    await createContentItems(ctx.db).transition(item.id, { event: 'schedule', postizId, utmUrl: utm, scheduledAt: at.toISOString() });
    return { ok: true, message: `Scheduled in Postiz for ${at.toISOString()}` };
  } catch (e) {
    return { ok: false, message: `Planned here; Postiz said: ${(e as Error).message.slice(0, 160)}. The next publish run retries.` };
  }
}
