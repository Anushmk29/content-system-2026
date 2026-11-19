// Videos — every competitor (and own) video Decode found, and whether we have its words.
// Transcription itself runs inside Decode (decode-service transcribeVideos); this is the log
// of it, the transcript text, and a by-hand (re)try for any one video.
import type { ModuleContext } from '../modules/module.ts';
import type { VideoAnalysis } from './video-analysis-service.ts';
import { THUMB_SQL } from './decode-service.ts';

export type TranscriptState = 'done' | 'failed' | 'not_yet';
export interface VideoRow {
  id: string; url: string; platform: string; competitor: string | null; handle: string | null; thumb: string | null;
  posted_at: string | null; duration_s: number | null; views: number | null; vs_own_median: number | null;
  hunt_score: number | null; hook: string | null; state: TranscriptState; error: string | null;
  transcript: string | null; lang: string | null; transcribed_at: string | null;
  analysis: VideoAnalysis | null;
}

/** One row per video (its latest Decode run), best hunt score first. */
export async function listVideos(ctx: ModuleContext): Promise<VideoRow[]> {
  // A DB not yet migrated for transcripts.analysis (42703) still lists the videos.
  return (await ctx.db.query<VideoRow>(VIDEOS_SQL('tr.analysis')).catch((e: { code?: string }) =>
    e.code === '42703' ? ctx.db.query<VideoRow>(VIDEOS_SQL('null::jsonb')) : Promise.reject(e))).rows;
}

const VIDEOS_SQL = (analysis: string) =>
    `select * from (
       select distinct on (content.norm_url(p.url)) p.id, p.url, p.platform,
         case when c.is_self then 'You' else c.name end as competitor, p.handle, ${THUMB_SQL} as thumb, p.posted_at::text,
         p.duration_s, p.views, p.vs_own_median::float8 as vs_own_median, p.hunt_score, p.hook,
         case when tr.text is not null then 'done' when p.transcript_error is not null then 'failed' else 'not_yet' end as state,
         p.transcript_error as error, tr.text as transcript, tr.lang, tr.created_at::text as transcribed_at,
         ${analysis} as analysis
       from content.decoded_posts p
       join content.decode_runs r on r.id = p.run_id
       left join content.competitors c on c.id = p.competitor_id
       left join content.transcripts tr on tr.norm_url = content.norm_url(p.url)
       where p.post_type = 'video'
       order by content.norm_url(p.url), r.started_at desc
     ) v order by v.hunt_score desc nulls last, v.vs_own_median desc nulls last limit 500`;

/** Transcribe one video now (a retry, or one past the per-run cap). Synchronous: ~15s-5min. */
export async function transcribeVideo(ctx: ModuleContext, postId: string): Promise<{ ok: boolean; message: string }> {
  const t = ctx.adapters.transcriber;
  if (t) await t.healthCheck();
  if (!t?.configured) return { ok: false, message: 'Transcription tools are not installed on the server (see System).' };
  const p = (await ctx.db.query<{ url: string }>(`select url from content.decoded_posts where id = $1 and post_type = 'video'`, [postId])).rows[0];
  if (!p) return { ok: false, message: 'Video not found.' };
  try {
    const tr = await t.transcribe(p.url);
    if (!tr.text) throw new Error('no speech found');
    await ctx.db.query(
      `insert into content.transcripts (norm_url, text, segments, lang, duration_s) values (content.norm_url($1), $2, $3, $4, $5)
       on conflict (norm_url) do update set text = excluded.text, segments = excluded.segments, lang = excluded.lang,
         duration_s = excluded.duration_s, created_at = now()`,
      [p.url, tr.text, JSON.stringify(tr.segments), tr.lang, tr.durationS]);
    await ctx.db.query(
      `update content.decoded_posts set transcript_error = null, text_source = 'transcript'
       where content.norm_url(url) = content.norm_url($1)`, [p.url]);
    return { ok: true, message: `Transcribed (${tr.lang ?? '?'}, ${tr.durationS ?? '?'}s)` };
  } catch (e) {
    const error = (e as Error).message.split('\n').find((l) => /error/i.test(l))?.trim() ?? (e as Error).message.split('\n')[0]!;
    await ctx.db.query(`update content.decoded_posts set transcript_error = $2 where content.norm_url(url) = content.norm_url($1)`,
      [p.url, error.slice(0, 300)]);
    return { ok: false, message: `Failed: ${error.slice(0, 200)}` };
  }
}
