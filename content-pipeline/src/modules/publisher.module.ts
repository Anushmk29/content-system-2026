// Postiz Scheduler + UTM (Bible §12, §13.2). Reads ONLY v_publish_ready, so an
// item with an unproven claim can never reach Postiz (honest-numbers, enforced in SQL).
import type { Module, ModuleContext, ModuleResult } from './module.ts';
import { ok, degraded } from './module.ts';
import { createRepo } from '../db/repo.ts';
import { createContentItems } from '../db/content-items.ts';
import { splitSlides } from '../slides.ts';
import { bookItem } from '../services/calendar-sync-service.ts';
import { isManual } from '../prompts/platform-playbooks.ts';

/** Posting time: one post per platform per day at `hourUtc`, the earliest day that is
 *  still ahead of `now` and after that platform's last booked slot. */
export function nextSlot(now: Date, lastForPlatform: Date | undefined, hourUtc: number): Date {
  const at = (d: Date, addDays: number) =>
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + addDays, hourUtc));
  let slot = at(now, 0);
  if (slot <= now) slot = at(now, 1);
  if (lastForPlatform) { const after = at(lastForPlatform, 1); if (after > slot) slot = after; }
  return slot;
}

/** An operator-planned future time (set from the dashboard calendar) wins; else the next free slot. */
export function pickSlot(now: Date, planned: Date | null, lastForPlatform: Date | undefined, hourUtc: number): Date {
  return planned && planned > now ? planned : nextSlot(now, lastForPlatform, hourUtc);
}

interface Postable { platform: string; format?: string | null; title: string; hook?: string | null; body?: string | null; cta?: string | null }

/** What goes into Postiz for one item: X → a thread (one part per "---" tweet, link on the
 *  last); Instagram → a short caption (links aren't clickable there; the slides carry the
 *  post); everything else → body + CTA + tracked link. */
export function postParts(item: Postable, utm: string): string[] {
  const body = item.body ?? item.title;
  const cta = `${item.cta ?? ''} ${utm}`.trim();
  if (item.platform === 'x') {
    const tweets = splitSlides(body);
    return tweets.map((t, i) => (i === tweets.length - 1 ? `${t}\n\n${cta}` : t));
  }
  if (item.platform === 'instagram') {
    // A single-image post's body is its caption; a carousel's body is the slides.
    return [`${item.format === 'quote_card' ? body : item.hook || item.title}\n\n${item.cta ?? ''}`.trim()];
  }
  if (item.format === 'carousel') return [`${item.hook || item.title}\n\n${cta}`];
  return [`${body}\n\n${cta}`];
}

export const publisherModule: Module = {
  id: 'publisher',
  title: 'Postiz Scheduler + UTM',
  description: 'Schedules approved, proof-complete items via Postiz (one per platform per day) with UTM-tagged links.',

  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const repo = createRepo(ctx.db);
    const items = createContentItems(ctx.db);
    const wentLive = await items.goLiveDue();
    const ready = await repo.publishReady();
    const note = wentLive ? `; ${wentLive} went live` : '';

    if (ready.length === 0) return ok(wentLive, `nothing approved & proof-complete to publish${note}`);
    if (!ctx.adapters.postiz.configured) {
      return degraded(`${ready.length} item(s) ready but Postiz is not configured`, { ready: ready.length });
    }

    let published = 0;
    const failures: { id: string; platform: string; error: string }[] = [];
    const last = await repo.lastScheduledByPlatform();
    const now = new Date();
    for (const item of ready) {
      try {
        if (item.postiz_id) continue; // idempotent: already scheduled
        if (isManual(item)) continue; // Short scripts are filmed, Reddit posts are posted by hand
        const planned = item.scheduled_at ? new Date(item.scheduled_at) : null;
        const slot = pickSlot(now, planned, last.get(item.platform), ctx.env.postHourUtc);
        if (!(await bookItem(ctx, item.id, slot))) continue; // booked elsewhere, or no longer approved
        const prev = last.get(item.platform);
        if (!prev || slot > prev) last.set(item.platform, slot);
        published++;
      } catch (e) {
        failures.push({ id: item.id, platform: item.platform, error: (e as Error).message });
      }
    }

    return {
      status: failures.length > 0 ? 'degraded' : 'ok',
      itemsProcessed: published,
      message: `${published} scheduled${failures.length ? `, ${failures.length} failed` : ''}${note}`,
      meta: { published, failures, wentLive },
    };
  },
};
