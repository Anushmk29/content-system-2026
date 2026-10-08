// Scripts — YouTube Short filming cards. The publisher never posts these (a person films them),
// so this is their track after approval: to film → filmed → uploaded. Uploading records the
// YouTube link as the post's published URL, so a refresh of your own results (Brand Kit → your
// YouTube handle) finds its views and the learning loop counts it.
import type { ModuleContext } from '../modules/module.ts';
import { createContentItems, IllegalTransition } from '../db/content-items.ts';

export type ScriptStage = 'review' | 'to_film' | 'filmed' | 'uploaded';
export interface ScriptRow {
  id: string; title: string; hook: string | null; body: string | null; cta: string | null;
  status: string; stage: ScriptStage; filmed_at: string | null; published_url: string | null;
  published_at: string | null; created_at: string; vs_usual: number | null; views: number | null;
}

export async function listScripts(ctx: ModuleContext): Promise<ScriptRow[]> {
  return (await ctx.db.query<ScriptRow>(
    `select ci.id, ci.title, ci.hook, ci.body, ci.cta, ci.status::text, ci.filmed_at::text, ci.published_url,
       ci.published_at::text, ci.created_at::text, p.vs_usual, p.impressions as views,
       case when ci.status in ('published', 'performance_captured') then 'uploaded'
            when ci.status = 'approved' and ci.filmed_at is not null then 'filmed'
            when ci.status = 'approved' then 'to_film' else 'review' end as stage
     from content.content_items ci
     left join content.v_content_performance p on p.id = ci.id
     where ci.platform = 'youtube' and ci.status <> 'archived'
     order by ci.created_at desc`)).rows;
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
     where id = $1 and platform = 'youtube' and status = 'approved'`, [id, filmed]);
  return r.rowCount ? { ok: true, message: filmed ? 'Marked filmed' : 'Back to film' } : { ok: false, message: 'Only an approved script can be marked filmed.' };
}

export async function markUploaded(ctx: ModuleContext, id: string, link: unknown): Promise<{ ok: boolean; message: string }> {
  const url = youtubeUrl(link);
  if (!url) return { ok: false, message: 'Paste the YouTube link of the uploaded video.' };
  const item = (await ctx.db.query<{ platform: string }>(`select platform from content.content_items where id = $1`, [id])).rows[0];
  if (item?.platform !== 'youtube') return { ok: false, message: 'Not a YouTube script.' };
  try {
    await createContentItems(ctx.db).transition(id, { event: 'upload', url });
  } catch (e) {
    if (e instanceof IllegalTransition) return { ok: false, message: 'Approve the script first.' };
    throw e;
  }
  await ctx.db.query(`update content.content_items set filmed_at = coalesce(filmed_at, now()) where id = $1`, [id]);
  return { ok: true, message: 'Uploaded: its views come in with your next results refresh' };
}
