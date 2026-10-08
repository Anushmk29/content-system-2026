// Decode — the competitor spy (docs/DESIGN-GUIDE.md §6e, §9). A run goes through these
// stages, each resumable, and the dashboard polls it while it works:
//   scraping      Apify (YouTube: the Data API) pulls each active competitor's public posts; every
//                 post is scored against that competitor's own median for that platform and post
//                 type, on views when the platform reports them ("4.2x their usual").
//   transcribing  the best video posts get their real spoken words (local yt-dlp + whisper).
//   judging       Jev answers Brand-Kit questions per post (lane, ICP fit, hook, proof, sponsored);
//                 then every post gets a hunt score (services/hunt-score.ts) and a paid flag.
//   sorting       one LLM call proposes the run's formats + each format's skeleton templates.
//   decoding      LLM batches assign a format, hook, beats and skeleton per post; each post gets the
//                 next `seq`, which is what the page polls on (`?after=<seq>`) to fly new points in.
// Stop is a status flip the loop checks between accounts / batches. Nothing here posts
// anything: "add to ideas" / "counter-angle" create Ideas signals; "make my version" (stealFormat)
// writes drafts that wait in Approvals.
import type { ModuleContext } from '../modules/module.ts';
import { DECODE_PLATFORMS, type DecodePlatform } from '../adapters/apify.ts';
import { parseJsonObject } from '../modules/llm-json.ts';
import { addSignal } from './console-service.ts';
import { loadBrand } from './brand-service.ts';
import { createRepo } from '../db/repo.ts';
import { DRAFT_PLATFORMS } from '../prompts/platform-playbooks.ts';
import { draftTopic } from '../modules/draft-generator.module.ts';
import { qcItem } from '../modules/qc-gate.module.ts';
import { saveItemCreative } from './asset-service.ts';
import { withCostScope } from '../cost-ledger.ts';
import { applyRules } from '../adapters/jev.ts';
import { competitorPostQuestions, competitorState, COMPETITOR_RULES, minConfidence } from '../modules/decision-tasks.ts';
import { huntScores, type HuntInput } from './hunt-score.ts';
import { isHookPattern, type HookPattern } from '../hook-patterns.ts';

import {
  BEAT_TAGS, VALUE_STRUCTURES, CTA_TYPES, type BeatTag, decodeSystem, buildFormatsPrompt, buildBreakdownPrompt,
  counterAngleSystem, buildCounterAnglePrompt,
} from '../prompts/decode.ts';

export { VALUE_STRUCTURES, CTA_TYPES };
export interface Beat { at: string; tag: BeatTag; text: string }

export interface CompetitorRow {
  id: string; name: string; active: boolean; created_at: string; is_self?: boolean;
  handles: Partial<Record<DecodePlatform, string>>;
}
export interface DecodeRunRow {
  id: string; status: 'running' | 'stopped' | 'done' | 'error'; stage: 'scraping' | 'transcribing' | 'judging' | 'sorting' | 'decoding' | 'done';
  competitor_ids: string[]; platforms: DecodePlatform[]; lookback_days: number; post_cap: number;
  total: number; decoded: number; cost_ai_usd: number; cost_apify_usd: number; cost_jev_usd: number; jev_health: number | null;
  message: string | null; started_at: string; finished_at: string | null;
}
export interface DecodeFormatRow {
  id: string; idx: number; name: string; description: string; our_post_count: number;
  hook_template: string | null; value_template: string | null; cta_template: string | null;
}
export interface DecodedPostRow {
  id: string; competitor_id: string | null; competitor: string | null; platform: DecodePlatform;
  post_type: 'text' | 'image' | 'carousel' | 'video'; url: string; handle: string | null; thumb: string | null;
  posted_at: string | null; duration_s: number | null; reactions: number; comments: number; shares: number;
  views: number | null; vs_own_median: number | null; caption: string; text_source: string;
  format_id: string | null; hook: string | null; beats: Beat[]; seq: number;
  lane: string | null; hook_type: HookPattern | null; hunt_score: number | null; demand: number | null; fit: number | null; paid: boolean;
  value_structure: string | null; cta_type: string | null;
}

const RUN_COLS = `id, status, stage, competitor_ids, platforms, lookback_days, post_cap, total, decoded,
  cost_ai_usd::float8 as cost_ai_usd, cost_apify_usd::float8 as cost_apify_usd, cost_jev_usd::float8 as cost_jev_usd, jev_health,
  message, started_at, finished_at`;
const POST_COLS = `p.id, p.competitor_id, c.name as competitor, p.platform, p.post_type, p.url, p.handle, p.thumb,
  to_char(p.posted_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as posted_at, p.duration_s, p.reactions, p.comments, p.shares, p.views, p.vs_own_median::float8 as vs_own_median,
  p.caption, p.text_source, p.format_id, p.hook, p.beats, p.seq,
  p.lane, p.hook_type, p.hunt_score, p.demand, p.fit, p.paid, p.value_structure, p.cta_type`;
/** The cached transcript of a post `p` (tr.text, null when none). */
const TRANSCRIPT_JOIN = `left join content.transcripts tr on tr.norm_url = content.norm_url(p.url)`;
const BATCH = 8;

// ---- competitors -----------------------------------------------------------
export async function listCompetitors(ctx: ModuleContext): Promise<CompetitorRow[]> {
  return (await ctx.db.query<CompetitorRow>(`select * from content.competitors where not is_self order by active desc, name`)).rows;
}

/** The client's own accounts as the hidden "You" row, kept in step with Brand Kit → own accounts. */
export async function selfCompetitor(ctx: ModuleContext): Promise<CompetitorRow> {
  const handles = Object.fromEntries(Object.entries((await loadBrand(ctx)).ownHandles).filter(([p, h]) =>
    (DECODE_PLATFORMS as readonly string[]).includes(p) && h));
  const r = await ctx.db.query<CompetitorRow>(
    `update content.competitors set handles = $1, active = true where is_self returning *`, [JSON.stringify(handles)]);
  return r.rows[0] ?? (await ctx.db.query<CompetitorRow>(
    `insert into content.competitors (name, handles, is_self) values ('You', $1, true) returning *`, [JSON.stringify(handles)])).rows[0]!;
}

/** Self runs (own results) stay off the Decode page. */
const NOT_SELF_RUN = `not exists (select 1 from content.competitors s where s.is_self and s.id = any(decode_runs.competitor_ids))`;

export async function saveCompetitor(ctx: ModuleContext, input: { id?: string; name?: string; handles?: Record<string, unknown>; active?: boolean }): Promise<CompetitorRow> {
  const handles = input.handles === undefined ? undefined : Object.fromEntries(DECODE_PLATFORMS
    .map((p) => [p, typeof input.handles![p] === 'string' ? (input.handles![p] as string).trim() : ''] as const).filter(([, v]) => v));
  if (input.id) {
    const r = await ctx.db.query<CompetitorRow>(
      `update content.competitors set name = coalesce($2, name), handles = coalesce($3, handles), active = coalesce($4, active)
       where id = $1 returning *`, [input.id, input.name?.trim() || null, handles ? JSON.stringify(handles) : null, input.active ?? null]);
    if (!r.rows[0]) throw new Error('competitor not found');
    return r.rows[0];
  }
  const name = input.name?.trim();
  if (!name) throw new Error('name is required');
  return (await ctx.db.query<CompetitorRow>(
    `insert into content.competitors (name, handles, active) values ($1, $2, $3) returning *`,
    [name, JSON.stringify(handles ?? {}), input.active ?? true])).rows[0]!;
}

export async function deleteCompetitor(ctx: ModuleContext, id: string): Promise<void> {
  await ctx.db.query(`delete from content.competitors where id = $1`, [id]);
}

// ---- reading ---------------------------------------------------------------
async function getRun(ctx: ModuleContext, id: string): Promise<DecodeRunRow | null> {
  return (await ctx.db.query<DecodeRunRow>(`select ${RUN_COLS} from content.decode_runs where id = $1`, [id])).rows[0] ?? null;
}

async function formatsOf(ctx: ModuleContext, runId: string): Promise<DecodeFormatRow[]> {
  return (await ctx.db.query<DecodeFormatRow>(
    `select id, idx, name, description, our_post_count, hook_template, value_template, cta_template
     from content.decode_formats where run_id = $1 order by idx`, [runId])).rows;
}

/** One poll: the run, its formats, and posts decoded after `after` (in decode order). */
export async function getDecodeRun(ctx: ModuleContext, runId: string, after = 0) {
  const run = await getRun(ctx, runId);
  if (!run) return null;
  const posts = (await ctx.db.query<DecodedPostRow>(
    `select ${POST_COLS} from content.decoded_posts p left join content.competitors c on c.id = p.competitor_id
     where p.run_id = $1 and p.seq > $2 order by p.seq`, [runId, after])).rows;
  return { run, formats: await formatsOf(ctx, runId), posts };
}

/** Everything the Decode page needs on first render. Defaults to the latest run. */
export async function getDecodeView(ctx: ModuleContext, runId?: string) {
  const [competitors, runs] = await Promise.all([
    listCompetitors(ctx),
    ctx.db.query<DecodeRunRow>(`select ${RUN_COLS} from content.decode_runs where ${NOT_SELF_RUN} order by started_at desc limit 10`).then((r) => r.rows),
  ]);
  const id = runId ?? runs[0]?.id;
  const current = id ? await getDecodeRun(ctx, id, 0) : null;
  return { competitors, runs, run: current?.run ?? null, formats: current?.formats ?? [], posts: current?.posts ?? [] };
}
export type DecodeView = Awaited<ReturnType<typeof getDecodeView>>;

// ---- starting / stopping -----------------------------------------------------
/** `self`: scrape the client's own accounts (Brand Kit) instead of competitors — "Refresh my results". */
interface StartDecodeInput { competitorIds?: string[]; platforms?: string[]; lookbackDays?: number; postCap?: number; resumeRunId?: string; self?: boolean }

/** Creates (or resumes) a run and works it in the background. Returns as soon as the run row exists. */
export async function startDecode(ctx: ModuleContext, input: StartDecodeInput = {}): Promise<DecodeRunRow> {
  const busy = await ctx.db.query(`select 1 from content.decode_runs where status = 'running' and started_at > now() - interval '6 hours'`);
  if (busy.rowCount) throw new Error('A decode is already running — stop it first');
  if (!ctx.adapters.claude.configured) throw new Error('No LLM configured — Decode needs one to break posts down');

  let run: DecodeRunRow | null;
  if (input.resumeRunId) {
    run = (await ctx.db.query<DecodeRunRow>(
      `update content.decode_runs set status = 'running', message = null, finished_at = null
       where id = $1 and status <> 'done' returning ${RUN_COLS}`, [input.resumeRunId])).rows[0] ?? null;
    if (!run) throw new Error('run not found or already finished');
  } else {
    // YouTube needs its own key; every other platform goes through Apify.
    const can = (p: DecodePlatform) => (p === 'youtube' ? ctx.adapters.youtube?.configured : ctx.adapters.apify.configured);
    const platforms = (input.platforms?.length ? input.platforms : [...DECODE_PLATFORMS])
      .filter((p): p is DecodePlatform => (DECODE_PLATFORMS as readonly string[]).includes(p)).filter(can);
    if (!platforms.length) throw new Error('No scraper for those platforms — add CONTENT_APIFY_TOKEN (or CONTENT_YOUTUBE_API_KEY for YouTube) to .env');
    const comps = input.self ? [await selfCompetitor(ctx)]
      : (await listCompetitors(ctx)).filter((c) => c.active && (!input.competitorIds?.length || input.competitorIds.includes(c.id)));
    if (!comps.some((c) => platforms.some((p) => c.handles[p]))) {
      throw new Error(input.self ? 'Add your own accounts in Brand Kit first' : 'No active competitor has a handle on the chosen platforms');
    }
    // Own results want a real baseline: more posts per platform than a competitor sample.
    run = (await ctx.db.query<DecodeRunRow>(
      `insert into content.decode_runs (competitor_ids, platforms, lookback_days, post_cap) values ($1, $2, $3, $4) returning ${RUN_COLS}`,
      [comps.map((c) => c.id), platforms, clamp(input.lookbackDays, 90, 7, 365), clamp(input.postCap, input.self ? 30 : 10, 5, 500)])).rows[0]!;
  }
  // ponytail: in-process background work — fine for one long-lived `next` server; a serverless
  // deploy needs a queue/cron to call runDecode instead.
  void withCostScope({ feature: input.self ? 'own_results' : 'decode', refType: 'decode_run', refId: run!.id }, () => runDecode(ctx, run!.id)).catch((e) => ctx.logger?.error('decode run crashed', { runId: run!.id, error: (e as Error).message }));
  return run;
}

export async function stopDecode(ctx: ModuleContext, runId: string): Promise<void> {
  await ctx.db.query(`update content.decode_runs set status = 'stopped', finished_at = now() where id = $1 and status = 'running'`, [runId]);
}

// ---- the work ----------------------------------------------------------------
/** Works a run to the end (or until stopped). Exported so tests can await it. */
export async function runDecode(ctx: ModuleContext, runId: string): Promise<void> {
  await loadBrand(ctx);
  const llm = ctx.adapters.claude, jev = ctx.adapters.jev;
  let mark = llm.spentUsd, jevMark = jev?.spentUsd ?? 0;
  const bill = async () => {
    const d = llm.spentUsd - mark, j = (jev?.spentUsd ?? 0) - jevMark;
    mark = llm.spentUsd;
    jevMark = jev?.spentUsd ?? 0;
    if (d > 0 || j > 0) {
      await ctx.db.query(`update content.decode_runs set cost_ai_usd = cost_ai_usd + $2, cost_jev_usd = cost_jev_usd + $3 where id = $1`, [runId, d, j]);
    }
  };
  const stopped = async () => (await getRun(ctx, runId))?.status !== 'running';
  const stage = (s: DecodeRunRow['stage']) => ctx.db.query(`update content.decode_runs set stage = $2 where id = $1`, [runId, s]);

  try {
    const run = (await getRun(ctx, runId))!;
    let at = run.stage;
    if (at === 'scraping') {
      if (!(await scrape(ctx, run, stopped))) return;
      await stage(at = 'transcribing');
    }
    if (at === 'transcribing') {
      if (!(await transcribeVideos(ctx, runId, stopped))) return;
      await stage(at = 'judging');
    }
    if (at === 'judging') {
      if (!(await judgePosts(ctx, run, stopped))) return;
      await bill();
      await stage(at = 'sorting');
    }
    if (at === 'sorting') {
      await sortFormats(ctx, runId);
      await bill();
      await stage('decoding');
    }
    while (!(await stopped())) {
      const n = await decodeBatch(ctx, runId);
      await bill();
      if (n === 0) {
        await ctx.db.query(`update content.decode_runs set status = 'done', stage = 'done', finished_at = now() where id = $1 and status = 'running'`, [runId]);
        return;
      }
    }
  } catch (e) {
    await bill().catch(() => {});
    await ctx.db.query(`update content.decode_runs set status = 'error', message = $2, finished_at = now() where id = $1`, [runId, (e as Error).message.slice(0, 500)]);
  }
}

async function scrape(ctx: ModuleContext, run: DecodeRunRow, stopped: () => Promise<boolean>): Promise<boolean> {
  const comps = (await ctx.db.query<CompetitorRow>(`select * from content.competitors where id = any($1)`, [run.competitor_ids])).rows;
  const since = new Date(Date.now() - run.lookback_days * 86_400_000);
  const failures: string[] = [];
  for (const c of comps) {
    for (const p of run.platforms) {
      const handle = c.handles[p];
      if (!handle) continue;
      if (await stopped()) return false;
      try {
        const { posts, costUsd } = p === 'youtube'
          ? await ctx.adapters.youtube.scrape(handle, { since, limit: run.post_cap })
          : await ctx.adapters.apify.scrape(p, handle, { since, limit: run.post_cap });
        for (const s of posts) {
          await ctx.db.query(
            `insert into content.decoded_posts (run_id, competitor_id, platform, post_type, url, handle, thumb, posted_at, duration_s,
               reactions, comments, shares, views, caption, text_source)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) on conflict (run_id, url) do nothing`,
            [run.id, c.id, p, s.postType, s.url, s.handle ?? handle, s.thumb, s.postedAt, s.durationS,
              s.reactions, s.comments, s.shares, s.views, s.caption, s.postType === 'video' ? 'captions' : 'post_text']);
        }
        await ctx.db.query(
          `update content.decode_runs set cost_apify_usd = cost_apify_usd + $2,
             total = (select count(*) from content.decoded_posts where run_id = $1) where id = $1`, [run.id, costUsd]);
      } catch (e) {
        failures.push(`${c.name}/${p}: ${(e as Error).message}`);
      }
    }
  }
  // "Their usual" = that competitor's median on that platform for that post type in this run (a reel
  // is never compared with a text post), on views when the platform reports them, else reactions.
  await ctx.db.query(
    `update content.decoded_posts d set vs_own_median = round((case when d.views is not null and m.med_views > 0
         then d.views / m.med_views else d.reactions / nullif(m.med, 0) end)::numeric, 2)
     from (select competitor_id, platform, post_type,
             percentile_cont(0.5) within group (order by reactions) as med,
             percentile_cont(0.5) within group (order by views) as med_views
           from content.decoded_posts where run_id = $1 group by competitor_id, platform, post_type) m
     where d.run_id = $1 and m.competitor_id is not distinct from d.competitor_id and m.platform = d.platform
       and m.post_type = d.post_type`, [run.id]);
  if (comps.some((c) => c.is_self)) await syncOwnMetrics(ctx, run.id);
  const total = (await getRun(ctx, run.id))!.total;
  if (failures.length) await ctx.db.query(`update content.decode_runs set message = $2 where id = $1`, [run.id, failures.join(' · ').slice(0, 500)]);
  if (total === 0) throw new Error(`No posts scraped${failures.length ? ` — ${failures.join(' · ')}` : ''}`.slice(0, 500));
  return true;
}

/** Our published posts found in a scrape of our own accounts get those numbers as their latest
 *  metrics (keeping the last hand-entered qualified engagement). Returns how many matched. */
async function syncOwnMetrics(ctx: ModuleContext, runId: string): Promise<number> {
  return (await ctx.db.query(
    `insert into content.metrics (content_item_id, impressions, likes, comments, shares, qualified_engagement, raw)
     select ci.id, p.views, p.reactions, p.comments, p.shares,
       (select m.qualified_engagement from content.metrics m where m.content_item_id = ci.id order by m.captured_at desc limit 1),
       jsonb_build_object('source', 'own-scrape', 'run_id', p.run_id, 'url', p.url)
     from content.content_items ci
     join content.decoded_posts p on p.run_id = $1 and content.norm_url(p.url) = content.norm_url(ci.published_url)
     where ci.published_url is not null`, [runId])).rowCount ?? 0;
}

/** Transcribes the best video posts (cached by URL). Returns false when stopped. */
async function transcribeVideos(ctx: ModuleContext, runId: string, stopped: () => Promise<boolean>): Promise<boolean> {
  const t = ctx.adapters.transcriber;
  if (!t?.cap || !t.configured) return true;
  const vids = (await ctx.db.query<{ id: string; url: string; cached: boolean }>(
    `select p.id, p.url, tr.text is not null as cached from content.decoded_posts p ${TRANSCRIPT_JOIN}
     where p.run_id = $1 and p.post_type = 'video' order by p.vs_own_median desc nulls last limit $2`, [runId, t.cap])).rows;
  const failed: string[] = [];
  for (const v of vids) {
    if (await stopped()) return false;
    try {
      if (!v.cached) {
        const tr = await t.transcribe(v.url);
        if (!tr.text) continue;
        await ctx.db.query(
          `insert into content.transcripts (norm_url, text, segments, lang, duration_s) values (content.norm_url($1), $2, $3, $4, $5)
           on conflict (norm_url) do nothing`, [v.url, tr.text, JSON.stringify(tr.segments), tr.lang, tr.durationS]);
      }
      await ctx.db.query(`update content.decoded_posts set text_source = 'transcript', transcript_error = null where id = $1`, [v.id]);
    } catch (e) {
      // The post keeps its caption; the run goes on. The Videos tab shows the reason and can retry.
      const msg = (e as Error).message;
      failed.push(msg.split('\n')[0]!.slice(0, 120));
      await ctx.db.query(`update content.decoded_posts set transcript_error = $2 where id = $1`,
        [v.id, (msg.split('\n').find((l) => /error/i.test(l)) ?? msg).trim().slice(0, 300)]);
    }
  }
  if (failed.length) {
    await ctx.db.query(`update content.decode_runs set message = $2 where id = $1`,
      [runId, `${failed.length} video(s) not transcribed: ${failed[0]}`.slice(0, 500)]);
  }
  return true;
}

// Jev concurrency, and how many posts the health number (mean weakest-answer confidence) uses.
const JUDGE_CONCURRENCY = 8;
const PILOT = 20;

/** Jev judges each competitor post against the Brand Kit, then every post gets its hunt score.
 *  Own-results runs skip Jev (judging our own posts against our own brand tells us nothing). */
async function judgePosts(ctx: ModuleContext, run: DecodeRunRow, stopped: () => Promise<boolean>): Promise<boolean> {
  const jev = ctx.adapters.jev;
  const self = (await ctx.db.query(`select 1 from content.competitors where is_self and id = any($1)`, [run.competitor_ids])).rowCount > 0;
  if (jev?.configured && !self) {
    const posts = (await ctx.db.query<{ id: string; platform: string; post_type: string; duration_s: number | null; caption: string; transcript: string | null }>(
      `select p.id, p.platform, p.post_type, p.duration_s, p.caption, tr.text as transcript
       from content.decoded_posts p ${TRANSCRIPT_JOIN}
       where p.run_id = $1 and p.jev is null order by p.vs_own_median desc nulls last`, [run.id])).rows;
    const questions = competitorPostQuestions();
    const repo = createRepo(ctx.db);
    const confidences: number[] = [];
    let failures = 0;
    const judge = async (p: (typeof posts)[number]) => {
      const state = competitorState(p);
      const t0 = Date.now();
      try {
        const r = await jev.decide(state, questions);
        const set = applyRules(r.answers, COMPETITOR_RULES);
        const hook = r.answers.hook_type?.choice;
        await ctx.db.query(`update content.decoded_posts set jev = $2, lane = $3, hook_type = $4, paid = paid or $5 where id = $1`,
          [p.id, JSON.stringify(r.answers), r.answers.lane?.choice ?? null, isHookPattern(hook) ? hook : null, set.paid === true]);
        const conf = minConfidence(r.answers);
        confidences.push(conf);
        await repo.logDecision({ task: 'competitor_post', subjectId: p.id, state, source: 'jev', model: r.model,
          answer: r.answers, used: true, latencyMs: Date.now() - t0, confidence: conf })
          .catch((e: Error) => ctx.logger.warn(`decision log failed: ${e.message}`));
      } catch (e) {
        failures++;
        ctx.logger.warn(`jev competitor_post ${p.id}: ${(e as Error).message}`);
      }
    };
    for (let i = 0; i < posts.length; i += JUDGE_CONCURRENCY) {
      if (await stopped()) return false;
      await Promise.all(posts.slice(i, i + JUDGE_CONCURRENCY).map(judge));
      const pilot = confidences.slice(0, PILOT);
      if (pilot.length) {
        await ctx.db.query(`update content.decode_runs set jev_health = $2 where id = $1`, [run.id, pilot.reduce((a, b) => a + b, 0) / pilot.length]);
      }
    }
    if (failures) {
      await ctx.db.query(`update content.decode_runs set message = $2 where id = $1`, [run.id, `Jev could not judge ${failures} post(s); they rank on demand only`]);
    }
  }
  await scoreHunt(ctx, run.id);
  return true;
}

/** Writes demand / fit / hunt_score / paid for every post of the run (pure math, services/hunt-score.ts). */
async function scoreHunt(ctx: ModuleContext, runId: string): Promise<void> {
  const rows = (await ctx.db.query<{ id: string; platform: string; views: number | null; reactions: number; comments: number; shares: number;
    breakout: number | null; posted_at: string | null; jev: HuntInput['jev'] }>(
    `select id, platform, views, reactions, comments, shares, vs_own_median::float8 as breakout, posted_at::text, jev
     from content.decoded_posts where run_id = $1`, [runId])).rows;
  if (!rows.length) return;
  const scores = huntScores(rows.map((r) => ({ ...r, postedAt: r.posted_at })));
  await ctx.db.query(
    `update content.decoded_posts d set demand = x.demand, fit = x.fit, hunt_score = x.hunt, paid = x.paid
     from jsonb_to_recordset($1::jsonb) as x(id uuid, demand real, fit real, hunt real, paid boolean) where d.id = x.id`,
    [JSON.stringify(scores)]);
}

async function sortFormats(ctx: ModuleContext, runId: string): Promise<void> {
  const sample = (await ctx.db.query<{ platform: string; post_type: string; caption: string }>(
    `select p.platform, p.post_type, left(coalesce('SPOKEN: ' || left(tr.text, 300) || ' | CAPTION: ', '') || p.caption, 500) as caption
     from content.decoded_posts p ${TRANSCRIPT_JOIN}
     where p.run_id = $1 and (p.caption <> '' or tr.text is not null) and not p.paid
     order by p.hunt_score desc nulls last, p.vs_own_median desc nulls last limit 80`, [runId])).rows;
  const ours = (await ctx.db.query<{ t: string }>(
    `select coalesce(hook, title) as t from content.content_items where status <> 'archived' order by created_at desc limit 40`)).rows;
  const raw = await ctx.adapters.claude.complete(buildFormatsPrompt(sample, ours), { system: decodeSystem(), maxTokens: 2000 });
  const formats = parseFormats(raw);
  if (!formats.length) throw new Error('LLM returned no formats');
  await ctx.db.tx(async (db) => {
    await db.query(`delete from content.decode_formats where run_id = $1`, [runId]);
    for (const [i, f] of formats.entries()) {
      await db.query(
        `insert into content.decode_formats (run_id, idx, name, description, our_post_count, hook_template, value_template, cta_template)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [runId, i, f.name, f.description, f.ourPosts, f.hookTemplate, f.valueTemplate, f.ctaTemplate]);
    }
  });
}

/** Breaks down the next batch (best performers first). Returns how many posts it finished. */
async function decodeBatch(ctx: ModuleContext, runId: string): Promise<number> {
  const posts = (await ctx.db.query<{ id: string; platform: string; post_type: string; caption: string; transcript: string | null }>(
    `select p.id, p.platform, p.post_type, left(p.caption, 1500) as caption, left(tr.text, 2500) as transcript
     from content.decoded_posts p ${TRANSCRIPT_JOIN}
     where p.run_id = $1 and p.seq is null order by p.hunt_score desc nulls last, p.vs_own_median desc nulls last, p.reactions desc limit ${BATCH}`, [runId])).rows;
  if (!posts.length) return 0;
  const formats = await formatsOf(ctx, runId);
  let parsed: Map<number, Breakdown> = new Map();
  try {
    const raw = await ctx.adapters.claude.complete(buildBreakdownPrompt(formats, posts), { system: decodeSystem(), maxTokens: 8000 });
    parsed = parseBreakdowns(raw, formats.length);
  } catch (e) {
    // One bad batch must not stall the run: its posts land as "no clear format".
    await ctx.db.query(`update content.decode_runs set message = $2 where id = $1`, [runId, `a batch failed to decode: ${(e as Error).message}`.slice(0, 500)]);
  }
  await ctx.db.tx(async (db) => {
    const base = (await db.query<{ decoded: number }>(`select decoded from content.decode_runs where id = $1 for update`, [runId])).rows[0]!.decoded;
    for (const [i, p] of posts.entries()) {
      const b = parsed.get(i + 1);
      // Jev's hook type wins when it judged the post; the LLM's fills the rest.
      await db.query(
        `update content.decoded_posts set seq = $2, format_id = $3, hook = $4, beats = $5,
           hook_type = coalesce(hook_type, $6), value_structure = $7, cta_type = $8 where id = $1`,
        [p.id, base + i + 1, b?.format != null ? formats[b.format - 1]?.id ?? null : null, b?.hook ?? null, JSON.stringify(b?.beats ?? []),
          b?.hookTechnique ?? null, b?.valueStructure ?? null, b?.ctaType ?? null]);
    }
    await db.query(`update content.decode_runs set decoded = $2 where id = $1`, [runId, base + posts.length]);
  });
  return posts.length;
}

// ---- LLM parsing (pure) --------------------------------------------------------
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null => (list.includes(v as T) ? (v as T) : null);

export function parseFormats(raw: string): { name: string; description: string; ourPosts: number; hookTemplate: string | null; valueTemplate: string | null; ctaTemplate: string | null }[] {
  const list = parseJsonObject(raw).formats;
  return (Array.isArray(list) ? list : []).slice(0, 10).flatMap((f) => {
    const name = typeof f?.name === 'string' ? f.name.trim().toLowerCase() : '';
    return name ? [{
      name, description: typeof f.description === 'string' ? f.description.trim() : '', ourPosts: Math.max(0, Math.round(Number(f.our_posts) || 0)),
      hookTemplate: str(f.hook_template), valueTemplate: str(f.value_template), ctaTemplate: str(f.cta_template),
    }] : [];
  });
}

export interface Breakdown {
  format: number | null; hook: string | null; beats: Beat[];
  hookTechnique: HookPattern | null; valueStructure: string | null; ctaType: string | null;
}
export function parseBreakdowns(raw: string, formatCount: number): Map<number, Breakdown> {
  const list = parseJsonObject(raw).posts;
  const out = new Map<number, Breakdown>();
  for (const p of Array.isArray(list) ? list : []) {
    const n = Number(p?.n);
    if (!Number.isInteger(n)) continue;
    const f = Number(p.format);
    out.set(n, {
      format: Number.isInteger(f) && f >= 1 && f <= formatCount ? f : null,
      hook: typeof p.hook === 'string' && p.hook.trim() ? p.hook.trim() : null,
      hookTechnique: isHookPattern(p.hook_technique) ? p.hook_technique : null,
      valueStructure: oneOf(p.value_structure, VALUE_STRUCTURES),
      ctaType: oneOf(p.cta_type, CTA_TYPES),
      beats: (Array.isArray(p.beats) ? p.beats : []).flatMap((b: Record<string, unknown>) => {
        const tag = String(b?.tag ?? '').toLowerCase().replace(/ shows up$/, '') as BeatTag;
        return typeof b?.text === 'string' && b.text.trim()
          ? [{ at: String(b.at ?? ''), tag: BEAT_TAGS.includes(tag) ? tag : 'other', text: b.text.trim() }] : [];
      }),
    });
  }
  return out;
}

// ---- turning research into ideas -------------------------------------------------
/** `use` = copy a format; `counter` = our take on it. Both land as an Ideas signal (channel 'decode'). */
/** The post itself, or a format's best performer. */
async function bestPost(ctx: ModuleContext, input: { formatId?: string; postId?: string }) {
  type Best = DecodedPostRow & { format_name: string | null; format_desc: string | null;
    hook_template: string | null; value_template: string | null; cta_template: string | null };
  const post = (await ctx.db.query<Best>(
    `select ${POST_COLS}, f.name as format_name, f.description as format_desc, f.hook_template, f.value_template, f.cta_template
     from content.decoded_posts p left join content.competitors c on c.id = p.competitor_id
     left join content.decode_formats f on f.id = p.format_id
     where ${input.postId ? 'p.id = $1' : 'p.format_id = $1 and not p.paid'}
     order by p.hunt_score desc nulls last, p.vs_own_median desc nulls last limit 1`, [input.postId ?? input.formatId])).rows[0];
  if (!post) throw new Error('nothing decoded for that format or post');
  const proof = `${post.competitor ?? post.handle} on ${post.platform}, ${post.vs_own_median ?? '?'}x their usual, ${post.reactions} reactions`;
  return { post, proof };
}

export async function useDecode(ctx: ModuleContext, input: { formatId?: string; postId?: string; mode: 'use' | 'counter' }): Promise<{ id: string }> {
  const { post, proof } = await bestPost(ctx, input);
  const b = await loadBrand(ctx);
  const fmt = post.format_name ? `the "${post.format_name}" format (${post.format_desc})` : 'this post’s structure';
  const anatomy = post.beats.map((b) => b.tag).join(' → ');

  let rawText: string;
  if (input.mode === 'use') {
    rawText = `[Decode] Use ${fmt}. It works for competitors: ${proof}. Their hook: "${post.hook ?? post.caption.slice(0, 120)}".${anatomy ? ` Structure: ${anatomy}.` : ''} Write ${b.name}'s own version for its audience.`;
  } else {
    if (!ctx.adapters.claude.configured) throw new Error('No LLM configured');
    const angle = (await ctx.adapters.claude.complete(buildCounterAnglePrompt(b, proof, post.caption),
      { system: counterAngleSystem(b), maxTokens: 400 })).trim();
    rawText = `[Decode counter-angle] On ${fmt} (${proof}): ${angle}`;
  }
  const row = await addSignal(ctx, { rawText, channel: 'decode', sourceUrl: post.url });
  return { id: row.id };
}

export interface StealResult { topicId: string; items: number; toApproval: number; needProof: number; creativeErrors: string[]; costUsd: number }

/**
 * "Make my version": a competitor post's structure → our own drafts for the chosen platforms,
 * through the same QC gate as any draft (unproven numbers stay in draft until proof is attached).
 * A style, when given, makes each post's creative. Synchronous: one draft call + QC reads, ~1 min.
 */
export async function stealFormat(ctx: ModuleContext, input: { formatId?: string; postId?: string; platforms: string[]; styleId?: string }): Promise<StealResult> {
  if (!ctx.adapters.claude.configured) throw new Error('No LLM configured');
  const platforms = DRAFT_PLATFORMS.filter((p) => input.platforms.includes(p));
  if (!platforms.length) throw new Error('Pick at least one platform');
  const { post, proof } = await bestPost(ctx, input);
  const b = await loadBrand(ctx);
  const spent = ctx.adapters.claude.spentUsd;

  const steal = [
    `Proof it works: ${proof}.`,
    post.format_name ? `Format: ${post.format_name} — ${post.format_desc}` : '',
    post.hook_template || post.value_template || post.cta_template
      ? `Proven skeleton (copy the structure, not the words):\n- hook: ${post.hook_template ?? '—'}\n- value: ${post.value_template ?? '—'}\n- CTA: ${post.cta_template ?? '—'}` : '',
    `Their hook: "${post.hook ?? post.caption.slice(0, 160)}"`,
    post.beats.length ? `Their beats, in order:\n${post.beats.map((x) => `- ${x.at} ${x.tag}: ${x.text}`).join('\n')}` : `Their post:\n"""${post.caption.slice(0, 1500)}"""`,
  ].filter(Boolean).join('\n');
  const repo = createRepo(ctx.db);
  const topicId = await repo.insertTopic({
    title: `${b.name}'s version of ${post.format_name ? `"${post.format_name}"` : `@${post.handle ?? post.competitor}'s post`}`,
    source: 'decode', sourceDetail: `${proof} — ${post.url}`, status: 'selected',
  });
  const topic = (await repo.selectedTopics()).find((t) => t.id === topicId)!;
  const ids = await draftTopic(ctx, topic, { platforms, steal });
  await ctx.db.query(`update content.content_items set hook_ref = $1 where id = any($2)`, [post.id, ids]);

  // Creatives before QC: a post is still a draft here, so it can carry one.
  const creativeErrors: string[] = [];
  if (input.styleId) {
    for (const id of ids) {
      const item = (await repo.getItem(id))!;
      if (item.platform === 'blog') continue;
      try { await saveItemCreative(ctx, id, { styleId: input.styleId }); }
      catch (e) { creativeErrors.push(`${item.platform}: ${(e as Error).message}`); }
    }
  }
  let toApproval = 0, needProof = 0;
  for (const id of ids) {
    const r = await qcItem(ctx, (await repo.getItem(id))!);
    if (r.outcome === 'blocked') needProof++; else toApproval++;
  }
  return { topicId, items: ids.length, toApproval, needProof, creativeErrors, costUsd: ctx.adapters.claude.spentUsd - spent };
}

function clamp(v: unknown, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && v != null ? Math.min(max, Math.max(min, n)) : fallback;
}
