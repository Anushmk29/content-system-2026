// Scripts desk — everything a person posts: video scripts (YouTube Shorts, Instagram/Facebook Reels,
// LinkedIn video) and Reddit posts. The publisher never posts these, so this is their track after
// approval: to film → filmed → posted (Reddit skips filming). Posting records the link as the
// post's published URL, so a refresh of your own results finds its numbers and the learning loop
// counts it.
import type { ModuleContext } from '../modules/module.ts';
import { createContentItems, IllegalTransition } from '../db/content-items.ts';
import { MANUAL_PLATFORMS, SCRIPT_FORMATS } from '../prompts/platform-playbooks.ts';

/** SQL for "a person posts it" (isManual() in platform-playbooks.ts); $1 = MANUAL_PLATFORMS, $2 = SCRIPT_FORMATS. */
const MANUAL = `(ci.platform::text = any($1) or ci.format::text = any($2))`;
const MANUAL_ARGS = [MANUAL_PLATFORMS, SCRIPT_FORMATS];

export type ScriptStage = 'review' | 'to_film' | 'filmed' | 'uploaded';
export interface ScriptRow {
  id: string; platform: string; format: string; title: string; hook: string | null; body: string | null; cta: string | null;
  status: string; stage: ScriptStage; filmed_at: string | null; published_url: string | null;
  published_at: string | null; created_at: string; vs_usual: number | null; views: number | null;
}

export async function listScripts(ctx: ModuleContext): Promise<ScriptRow[]> {
  return (await ctx.db.query<ScriptRow>(
    `select ci.id, ci.platform::text, ci.format::text, ci.title, ci.hook, ci.body, ci.cta, ci.status::text, ci.filmed_at::text, ci.published_url,
       ci.published_at::text, ci.created_at::text, p.vs_usual, p.impressions as views,
       case when ci.status in ('published', 'performance_captured') then 'uploaded'
            when ci.status = 'approved' and ci.filmed_at is not null then 'filmed'
            when ci.status = 'approved' then 'to_film' else 'review' end as stage
     from content.content_items ci
     left join content.v_content_performance p on p.id = ci.id
     where ${MANUAL} and ci.status <> 'archived'
     order by ci.created_at desc`, MANUAL_ARGS)).rows;
}

/** A pasted YouTube link (watch, shorts, youtu.be) → https://youtu.be/<id>, the shape Decode scrapes,
 *  so own-results matching (content.norm_url) finds it. Null when it isn't a YouTube video link. */
export function youtubeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/))([\w-]{11})/.exec(raw.trim());
  return m ? `https://youtu.be/${m[1]}` : null;
}

export async function markFilmed(ctx: ModuleContext, id: string, filmed: boolean): Promise<{ ok: boolean; message: string }> {
  const r = await ctx.db.query(
    `update content.content_items set filmed_at = case when $2 then now() end
     where id = $1 and (platform = 'youtube' or format::text = any($3)) and status = 'approved'`, [id, filmed, SCRIPT_FORMATS]);
  return r.rowCount ? { ok: true, message: filmed ? 'Marked filmed' : 'Back to film' } : { ok: false, message: 'Only an approved script can be marked filmed.' };
}

const HOSTS: Record<string, RegExp> = {
  instagram: /(^|.)instagram.com$/, linkedin: /(^|.)linkedin.com$/, facebook: /(^|.)(facebook.com|fb.watch)$/, reddit: /(^|.)(reddit.com|redd.it)$/,
};

/** The link of the live post on its own platform (YouTube links normalised), else null. */
export function postedUrl(platform: string, raw: unknown): string | null {
  if (platform === 'youtube') return youtubeUrl(raw);
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' && HOSTS[platform]?.test(u.hostname) ? u.toString() : null;
  } catch { return null; }
}

const NAME: Record<string, string> = { youtube: 'YouTube', instagram: 'Instagram', linkedin: 'LinkedIn', facebook: 'Facebook', reddit: 'Reddit' };

export async function markUploaded(ctx: ModuleContext, id: string, link: unknown): Promise<{ ok: boolean; message: string }> {
  const item = (await ctx.db.query<{ platform: string }>(
    `select ci.platform::text as platform from content.content_items ci where ci.id = $3 and ${MANUAL}`, [...MANUAL_ARGS, id])).rows[0];
  if (!item) return { ok: false, message: 'Not a script or hand-posted item.' };
  const url = postedUrl(item.platform, link);
  if (!url) return { ok: false, message: `Paste the ${NAME[item.platform] ?? item.platform} link of the live post.` };
  try {
    await createContentItems(ctx.db).transition(id, { event: 'upload', url });
  } catch (e) {
    if (e instanceof IllegalTransition) return { ok: false, message: 'Approve the script first.' };
    throw e;
  }
  await ctx.db.query(`update content.content_items set filmed_at = coalesce(filmed_at, now()) where id = $1`, [id]);
  return { ok: true, message: 'Uploaded: its views come in with your next results refresh' };
}
