// Creative Check: its own creatives, media, runs and job queue (docs/product/creative-check-prd.md).
// Nothing here reads or writes the posting pipeline's tables or waits on its runs, so a stuck
// pipeline/Decode job can't block a check and a check can't block them. Every function takes
// (ctx, …) and returns plain JSON, so an MCP tool or a route can call it directly.
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { ModuleContext } from '../modules/module.ts';
import { withCostScope } from '../cost-ledger.ts';
import { parseJsonObject } from '../modules/llm-json.ts';
import { loadBrand } from '../services/brand-service.ts';
import { brandBrief } from '../prompts/brand-context.ts';
import { sniff } from '../services/asset-service.ts';
import { isRasterImage } from '../creative.ts';
import { readImage, readVideo, MAX_FRAMES } from './media.ts';
import { attentionSegments, measureFacts, validateReport, hookText, type CreativeCheckReport, type Mode, type Segment, type AttentionSegment } from './report.ts';
import { buildCheckPrompt, CHECK_SYSTEM, PROMPT_VERSION, BODY_CAP } from './prompt.ts';

export const CHECK_PLATFORMS = ['instagram', 'linkedin', 'x', 'facebook', 'youtube', 'reddit', 'email'] as const;
export const FUNNEL_STAGES = ['awareness', 'consideration', 'conversion', 'retention'] as const;
export const VERDICTS = ['useful', 'not_useful', 'incorrect', 'not_relevant', 'skipped'] as const;
const MAX_IMAGES = 10;
const MAX_PARALLEL = 2;              // checks running at once in this process
const JOB_TIMEOUT_MS = 6 * 60_000;   // a check that takes longer is marked failed and its slot freed
const STALE = `interval '10 minutes'`; // a 'running' row older than this was orphaned (restart, crash)

export interface CreativeRow {
  id: string; name: string; platform: string; funnel_stage: string; hook: string; body: string; cta: string; proof: string;
  created_at: string; updated_at: string;
}
export interface CheckRow {
  id: string; creative_id: string; input_hash: string; status: 'running' | 'done' | 'error'; stage: string;
  report: CreativeCheckReport | null; feedback: Record<string, { verdict: string; note?: string; at: string }>;
  prompt_version: string | null; model: string | null; message: string | null;
  started_at: string; finished_at: string | null; cost_usd: number;
}
export interface CreativeListRow extends CreativeRow {
  media: { count: number; kind: 'video' | 'images' | 'none' };
  last: { id: string; status: string; stage: string; started_at: string; changed: boolean } | null;
}
export interface CreativeDetail {
  creative: CreativeRow; media: { idx: number; mime: string; size: number }[]; hash: string; checks: CheckRow[];
}

export class CheckBusy extends Error { override name = 'CheckBusy'; }
const notFound = () => new Error('Not found.');

const CHECK_COLS = `r.id, r.creative_id, r.input_hash, r.status, r.stage, r.report, r.feedback, r.prompt_version, r.model, r.message,
  r.started_at::text, r.finished_at::text,
  (select coalesce(sum(cost_usd), 0)::float8 from content.cost_events e where e.ref_type = 'check_run' and e.ref_id = r.id::text) as cost_usd`;

/** Orphaned 'running' rows (server restarted mid-check) become failed, so nothing waits forever. */
const reap = (ctx: ModuleContext) => ctx.db.query(
  `update content.check_runs set status = 'error', finished_at = now(), message = 'The check stopped (the server restarted or it hung). Run it again.'
   where status = 'running' and started_at < now() - ${STALE}`);

// ---- creatives -------------------------------------------------------------------------------

function cleanCopy(p: Record<string, unknown>): Partial<Pick<CreativeRow, 'name' | 'platform' | 'funnel_stage' | 'hook' | 'body' | 'cta' | 'proof'>> {
  const out: Record<string, string> = {};
  const text = (k: string, max: number) => { if (typeof p[k] === 'string') out[k] = (p[k] as string).slice(0, max); };
  text('name', 200); text('hook', 2000); text('body', 40000); text('cta', 1000); text('proof', 4000);
  if (out.name !== undefined) { out.name = out.name.trim(); if (!out.name) throw new Error('Give it a name.'); }
  if (p.platform !== undefined) {
    if (!(CHECK_PLATFORMS as readonly unknown[]).includes(p.platform)) throw new Error('Pick a platform.');
    out.platform = p.platform as string;
  }
  const stage = p.funnelStage ?? p.funnel_stage;
  if (stage !== undefined) {
    if (!(FUNNEL_STAGES as readonly unknown[]).includes(stage)) throw new Error('Pick a goal: awareness, consideration, conversion or retention.');
    out.funnel_stage = stage as string;
  }
  return out;
}

export async function createCreative(ctx: ModuleContext, input: Record<string, unknown>): Promise<CreativeRow> {
  const c = cleanCopy({ name: 'Untitled creative', ...input });
  return (await ctx.db.query<CreativeRow>(
    `insert into content.check_creatives (name, platform, funnel_stage, hook, body, cta, proof)
     values ($1, coalesce($2, 'instagram'), coalesce($3, 'awareness'), coalesce($4, ''), coalesce($5, ''), coalesce($6, ''), coalesce($7, ''))
     returning id, name, platform, funnel_stage, hook, body, cta, proof, created_at::text, updated_at::text`,
    [c.name, c.platform ?? null, c.funnel_stage ?? null, c.hook ?? null, c.body ?? null, c.cta ?? null, c.proof ?? null])).rows[0]!;
}

export async function updateCreative(ctx: ModuleContext, id: string, patch: Record<string, unknown>): Promise<CreativeRow> {
  const c = cleanCopy(patch);
  const keys = Object.keys(c) as (keyof typeof c)[];
  const r = await ctx.db.query<CreativeRow>(
    `update content.check_creatives set ${keys.map((k, i) => `${k} = $${i + 2}`).concat('updated_at = now()').join(', ')}
     where id = $1 returning id, name, platform, funnel_stage, hook, body, cta, proof, created_at::text, updated_at::text`,
    [id, ...keys.map((k) => c[k])]);
  if (!r.rows[0]) throw notFound();
  return r.rows[0];
}

export async function deleteCreative(ctx: ModuleContext, id: string): Promise<void> {
  await ctx.db.query(`delete from content.check_creatives where id = $1`, [id]);
}

/** Replace the creative's media: up to 10 images (WebP etc. become PNG) or one MP4. */
export async function setCreativeMedia(ctx: ModuleContext, id: string, files: Buffer[]): Promise<{ count: number }> {
  const out: { buf: Buffer; mime: string }[] = [];
  for (const buf of files) {
    const mime = sniff(buf);
    if (mime) { out.push({ buf, mime }); continue; }
    if (!isRasterImage(buf)) throw new Error('Use PNG, JPG or WebP images, or an MP4 video.');
    try { out.push({ buf: await sharp(buf, { limitInputPixels: 4e7 }).rotate().png().toBuffer(), mime: 'image/png' }); }
    catch { throw new Error('Use PNG, JPG or WebP images, or an MP4 video.'); }
  }
  if (out.some((f) => f.mime === 'video/mp4') && out.length > 1) throw new Error('Attach one video on its own, or images only.');
  if (out.length > MAX_IMAGES) throw new Error(`At most ${MAX_IMAGES} images.`);
  await ctx.db.tx(async (q) => {
    if (!(await q.query(`update content.check_creatives set updated_at = now() where id = $1`, [id])).rowCount) throw notFound();
    await q.query(`delete from content.check_media where creative_id = $1`, [id]);
    for (const [i, f] of out.entries()) await q.query(`insert into content.check_media (creative_id, idx, mime, bytes) values ($1, $2, $3, $4)`, [id, i, f.mime, f.buf]);
  });
  return { count: out.length };
}

export async function getCreativeMedia(ctx: ModuleContext, id: string, idx: number): Promise<{ mime: string; bytes: Buffer } | null> {
  const r = (await ctx.db.query<{ mime: string; bytes: Uint8Array }>(
    `select mime, bytes from content.check_media where creative_id = $1 and idx = $2`, [id, idx])).rows[0];
  return r ? { mime: r.mime, bytes: Buffer.from(r.bytes) } : null;
}

async function loadMedia(ctx: ModuleContext, id: string) {
  return (await ctx.db.query<{ idx: number; mime: string; bytes: Uint8Array }>(
    `select idx, mime, bytes from content.check_media where creative_id = $1 order by idx`, [id])).rows.map((m) => ({ ...m, bytes: Buffer.from(m.bytes) }));
}
async function getRow(ctx: ModuleContext, id: string): Promise<CreativeRow | null> {
  return (await ctx.db.query<CreativeRow>(
    `select id, name, platform, funnel_stage, hook, body, cta, proof, created_at::text, updated_at::text from content.check_creatives where id = $1`, [id])).rows[0] ?? null;
}

/** The version identity (CC-12.1): copy + settings + every media byte. */
function versionHash(c: CreativeRow, media: { bytes: Buffer }[]): string {
  const h = createHash('sha256').update(JSON.stringify([c.platform, c.funnel_stage, c.hook, c.body, c.cta, ...(c.proof ? [c.proof] : [])]));
  for (const m of media) h.update(m.bytes);
  return h.digest('hex');
}

export async function listCreatives(ctx: ModuleContext): Promise<CreativeListRow[]> {
  await reap(ctx);
  const rows = (await ctx.db.query<CreativeRow & { media_count: number; video: boolean; last: CreativeListRow['last'] & { input_hash: string } | null }>(
    `select c.id, c.name, c.platform, c.funnel_stage, c.hook, c.body, c.cta, c.proof, c.created_at::text, c.updated_at::text,
       (select count(*)::int from content.check_media m where m.creative_id = c.id) as media_count,
       exists (select 1 from content.check_media m where m.creative_id = c.id and m.mime = 'video/mp4') as video,
       (select json_build_object('id', r.id, 'status', r.status, 'stage', r.stage, 'started_at', r.started_at, 'input_hash', r.input_hash)
          from content.check_runs r where r.creative_id = c.id order by r.started_at desc limit 1) as last
     from content.check_creatives c order by c.updated_at desc`)).rows;
  // "Changed since the check" needs the hash, which needs the media bytes: only for the rows that have a check.
  return Promise.all(rows.map(async ({ media_count, video, last, ...c }) => ({
    ...c,
    media: { count: media_count, kind: video ? 'video' as const : media_count ? 'images' as const : 'none' as const },
    last: last && { id: last.id, status: last.status, stage: last.stage, started_at: last.started_at, changed: last.input_hash !== versionHash(c, await loadMedia(ctx, c.id)) },
  })));
}

export async function getCreative(ctx: ModuleContext, id: string): Promise<CreativeDetail | null> {
  await reap(ctx);
  const creative = await getRow(ctx, id);
  if (!creative) return null;
  const media = await loadMedia(ctx, id);
  const checks = (await ctx.db.query<CheckRow>(`select ${CHECK_COLS} from content.check_runs r where r.creative_id = $1 order by r.started_at desc limit 50`, [id])).rows;
  return { creative, media: media.map((m) => ({ idx: m.idx, mime: m.mime, size: m.bytes.length })), hash: versionHash(creative, media), checks };
}

export async function getCheck(ctx: ModuleContext, checkId: string): Promise<CheckRow | null> {
  await reap(ctx);
  return (await ctx.db.query<CheckRow>(`select ${CHECK_COLS} from content.check_runs r where r.id = $1`, [checkId])).rows[0] ?? null;
}

// ---- running a check ------------------------------------------------------------------------

// ponytail: in-process queue; each web instance runs its own MAX_PARALLEL. The one-running-per-creative
// rule is in the database (check_runs_one_running), so it holds across instances anyway.
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout;
  return Promise.race([p, new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error('The check took too long and was stopped. Try again.')), ms); })])
    .finally(() => clearTimeout(timer));
};

/** Start a check. Returns at once with the running row (or the stored one when nothing changed
 *  and `fresh` is not set). Poll getCheck(id) until status is 'done' or 'error'. */
export async function startCheck(ctx: ModuleContext, creativeId: string, opts: { fresh?: boolean } = {}): Promise<{ check: CheckRow; cached: boolean }> {
  const creative = await getRow(ctx, creativeId);
  if (!creative) throw notFound();
  const hash = versionHash(creative, await loadMedia(ctx, creativeId));
  if (!opts.fresh) {
    const same = (await ctx.db.query<CheckRow>(
      `select ${CHECK_COLS} from content.check_runs r where r.creative_id = $1 and r.input_hash = $2 and r.status = 'done' order by r.started_at desc limit 1`,
      [creativeId, hash])).rows[0];
    if (same) return { check: same, cached: true };
  }
  if (!ctx.adapters.claude.configured) throw new Error('No AI model is set up (CONTENT_OPENROUTER_API_KEY), so checks can’t run yet.');
  await reap(ctx);
  let id: string;
  try {
    id = (await ctx.db.query<{ id: string }>(
      `insert into content.check_runs (creative_id, input_hash) values ($1, $2) returning id`, [creativeId, hash])).rows[0]!.id;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new CheckBusy('A check is already running for this creative.');
    throw e;
  }
  void slot(() => withTimeout(withCostScope({ feature: 'creative_check', refType: 'check_run', refId: id }, () => runCheck(ctx, id, creativeId)), JOB_TIMEOUT_MS))
    .catch(async (e) => {
      const err = e as Error;
      const message = err.name === 'BudgetExceeded' ? 'Daily AI budget reached. Checks start again when the 24-hour spend drops.'
        : /OpenRouter|fetch failed|TimeoutError|aborted/i.test(`${err.name} ${err.message}`) ? 'The AI provider didn’t answer. Try again in a minute.'
        : err.message;
      ctx.logger.error('creative check failed', { id, error: err.message });
      await ctx.db.query(`update content.check_runs set status = 'error', finished_at = now(), message = $2 where id = $1 and status = 'running'`, [id, message.slice(0, 500)])
        .catch(() => {});
    });
  return { check: (await getCheck(ctx, id))!, cached: false };
}

const stage = (ctx: ModuleContext, id: string, s: string) =>
  ctx.db.query(`update content.check_runs set stage = $2 where id = $1 and status = 'running'`, [id, s]);

/** The job: read media → measure → one model call → validate → store. Throws on failure. */
async function runCheck(ctx: ModuleContext, id: string, creativeId: string): Promise<void> {
  await stage(ctx, id, 'reading');
  const creative = await getRow(ctx, creativeId);
  if (!creative) throw new Error('The creative was deleted.');
  const media = await loadMedia(ctx, creativeId);
  const limitations: string[] = [];
  const images: string[] = [];
  let mode: Mode = 'copy-only';
  let video: Parameters<typeof measureFacts>[0]['video'] = null;
  let attention: AttentionSegment[] = [];
  let transcript: Segment[] = [];
  let frameTimes: number[] = [];
  const stills: { width: number; height: number }[] = [];

  if (media[0]?.mime === 'video/mp4') {
    await stage(ctx, id, 'listening');
    const v = await readVideo(media[0].bytes, { python: ctx.env.python, whisperModel: ctx.env.whisperModel });
    if (!v) limitations.push('Video frames and speech weren’t available on this server, so only the copy was checked.');
    else {
      mode = v.transcript ? 'video+speech' : 'video-no-speech';
      limitations.push(...v.limitations);
      transcript = v.transcript?.segments ?? [];
      if (v.transcript?.lang && v.transcript.lang !== 'en') limitations.push(`Spoken language detected: ${v.transcript.lang}. The rules are tuned for English.`);
      video = { durationS: v.durationS, width: v.width, height: v.height, cuts: v.cuts, segments: v.transcript ? transcript : null };
      attention = attentionSegments(v.durationS, v.cuts, video.segments);
      frameTimes = v.frames.map((f) => f.t);
      images.push(...v.frames.map((f) => `data:image/jpeg;base64,${f.jpeg.toString('base64')}`));
    }
  } else if (media.length) {
    mode = 'images';
    for (const m of media.slice(0, MAX_FRAMES)) {
      const r = await readImage(m.bytes);
      stills.push({ width: r.width, height: r.height });
      images.push(`data:image/jpeg;base64,${r.jpeg.toString('base64')}`);
    }
  }
  if (creative.body.length > BODY_CAP) limitations.push('Only the first part of the caption was read.');
  if (!hookText(creative) && !creative.body.trim() && !images.length) throw new Error('Add a hook, a caption or some media first.');

  const facts = measureFacts({ platform: creative.platform, hook: creative.hook, body: creative.body, cta: creative.cta, video, images: stills });
  const prev = (await ctx.db.query<{ report: CreativeCheckReport }>(
    `select report from content.check_runs where creative_id = $1 and status = 'done' and id <> $2 order by started_at desc limit 1`, [creativeId, id])).rows[0]?.report;
  const previous = prev?.findings.map((f) => ({ id: f.id, category: f.category, title: f.title })) ?? [];

  await stage(ctx, id, 'checking');
  const prompt = buildCheckPrompt({
    brand: brandBrief(await loadBrand(ctx)), platform: creative.platform, funnelStage: creative.funnel_stage, mode,
    hook: creative.hook, body: creative.body, cta: creative.cta, proof: creative.proof, facts, attention, transcript, frameTimes,
    slideCount: mode === 'images' ? images.length : 0, previous, limitations,
  });
  const raw = await ctx.adapters.claude.complete(prompt, { system: CHECK_SYSTEM, images, maxTokens: 12_000 });
  const report = validateReport(parseJsonObject(raw), {
    promptVersion: PROMPT_VERSION, model: ctx.adapters.claude.model, mode, facts, attention,
    durationS: video?.durationS ?? null, slideCount: mode === 'images' ? images.length : 0, transcript,
    copy: { hook: creative.hook, body: creative.body, cta: creative.cta, proof: creative.proof }, previousFindingIds: previous.map((f) => f.id), limitations,
  });
  await ctx.db.query(
    `update content.check_runs set status = 'done', stage = 'done', report = $2, prompt_version = $3, model = $4, finished_at = now()
     where id = $1 and status = 'running'`, [id, JSON.stringify(report), PROMPT_VERSION, ctx.adapters.claude.model]);
}

// ---- after a check ---------------------------------------------------------------------------

/** CC-13: one verdict per recommendation; the last one wins. */
export async function setCheckFeedback(ctx: ModuleContext, checkId: string, recId: string, verdict: string, note?: string): Promise<void> {
  if (!(VERDICTS as readonly string[]).includes(verdict)) throw new Error('Pick useful, not useful, incorrect, not relevant or skipped.');
  const run = await getCheck(ctx, checkId);
  if (!run?.report?.recommendations.some((r) => r.id === recId)) throw notFound();
  const entry = { verdict, ...(note?.trim() ? { note: note.trim().slice(0, 500) } : {}), at: new Date().toISOString() };
  await ctx.db.query(`update content.check_runs set feedback = feedback || jsonb_build_object($2::text, $3::jsonb) where id = $1`, [checkId, recId, JSON.stringify(entry)]);
}

/** CC-10: write a suggested hook / caption / CTA into the creative (no model call) and mark it applied. */
export async function applyCheckFix(ctx: ModuleContext, checkId: string, recId: string, replacement = 0): Promise<CreativeRow> {
  const run = await getCheck(ctx, checkId);
  const rec = run?.report?.recommendations.find((r) => r.id === recId);
  const text = rec?.replacements[replacement];
  if (!run || !rec || !text) throw notFound();
  if (rec.target !== 'hook' && rec.target !== 'body' && rec.target !== 'cta') throw new Error('This fix is an editing instruction: make it in your video or design tool.');
  const c = await updateCreative(ctx, run.creative_id, { [rec.target]: text });
  await ctx.db.query(`update content.check_runs set feedback = feedback || jsonb_build_object($2::text, $3::jsonb) where id = $1`,
    [checkId, recId, JSON.stringify({ verdict: 'applied', note: `replacement ${replacement + 1}`, at: new Date().toISOString() })]);
  return c;
}

/** CC-12.4: what changed between two checks of the same creative. */
export function compareChecks(older: CreativeCheckReport, newer: CreativeCheckReport) {
  const resolved = new Set(newer.resolved);
  const before = new Map(older.facts.map((f) => [f.key, f]));
  // ponytail: findings get fresh ids per check, so "new" = a category+title the older check didn't have.
  const key = (f: { category: string; title: string }) => `${f.category}:${f.title.toLowerCase()}`;
  const old = new Set(older.findings.map(key));
  return {
    resolved: older.findings.filter((f) => resolved.has(f.id)),
    stillOpen: older.findings.filter((f) => !resolved.has(f.id)),
    new: newer.findings.filter((f) => !old.has(key(f))),
    facts: newer.facts.flatMap((f) => {
      const b = before.get(f.key);
      return b && b.value !== f.value ? [{ key: f.key, label: f.label, before: b.value, after: f.value }] : [];
    }),
  };
}
