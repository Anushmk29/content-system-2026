// Video analysis — beyond the transcript: why a video worked, whether it is good for the brand
// (Jev decides), and two ideas built on its proven hook / structure / CTA (Claude writes).
// Cached on content.transcripts.analysis by URL, so a video is analysed once. Runs for the top
// videos of each Decode run (after transcription) and on demand from the Videos page.
import type { ModuleContext } from '../modules/module.ts';
import type { JevQuestion } from '../adapters/jev.ts';
import { createRepo } from '../db/repo.ts';
import { parseJsonObject } from '../modules/llm-json.ts';
import { brandAudienceLine, minConfidence } from '../modules/decision-tasks.ts';
import { buildVideoAnalysisPrompt, videoAnalysisSystem } from '../prompts/video.ts';
import { loadBrand } from './brand-service.ts';
import { addSignal } from './console-service.ts';
import { isHookPattern } from '../hook-patterns.ts';

/** Videos analysed automatically per Decode run (best performers with a transcript). */
export const AUTO_ANALYSE = 3;

export interface VideoIdea { title: string; hook: string; beats: string[]; cta: string; platforms: string[]; why: string }
export interface VideoAnalysis {
  whyItWorked: string;
  hook: { text: string; type: string | null; why: string };
  structure: { beat: string; purpose: string }[];
  cta: { text: string; type: string };
  retention: string[];
  verdict: 'use' | 'adapt' | 'skip';
  verdictWhy: string;
  adapt: string[];
  avoid: string[];
  ideas: VideoIdea[];
  /** Jev's brand-fit read, P(yes) per question; null when Jev is off or failed. */
  jev: { fitsBrand: number; adaptable: number; risky: number } | null;
  analysedAt: string;
}

const s = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v: unknown, max = 8) => (Array.isArray(v) ? v.map((x) => s(x, 300)).filter(Boolean).slice(0, max) : []);

/** LLM reply → analysis. Throws when there is no usable analysis or not two ideas. */
export function parseVideoAnalysis(raw: string): Omit<VideoAnalysis, 'jev' | 'analysedAt'> {
  const o = parseJsonObject(raw);
  const hook = (o.hook ?? {}) as Record<string, unknown>;
  const cta = (o.cta ?? {}) as Record<string, unknown>;
  const ideas = (Array.isArray(o.ideas) ? o.ideas : []).flatMap((i: Record<string, unknown>) => {
    const title = s(i?.title, 160), h = s(i?.hook, 300);
    return title && h ? [{ title, hook: h, beats: list(i.beats), cta: s(i.cta, 300), platforms: list(i.platforms, 10), why: s(i.why, 300) }] : [];
  }).slice(0, 2);
  const why = s(o.whyItWorked, 900);
  if (!why || ideas.length < 2) throw new Error('the analysis came back incomplete');
  const verdict = o.verdict === 'use' || o.verdict === 'skip' ? o.verdict : 'adapt';
  return {
    whyItWorked: why,
    hook: { text: s(hook.text, 300), type: isHookPattern(hook.type) ? hook.type : null, why: s(hook.why, 300) },
    structure: (Array.isArray(o.structure) ? o.structure : []).flatMap((b: Record<string, unknown>) =>
      s(b?.beat) ? [{ beat: s(b.beat, 300), purpose: s(b.purpose, 300) }] : []).slice(0, 10),
    cta: { text: s(cta.text, 300), type: s(cta.type, 40) || 'none' },
    retention: list(o.retention), verdict, verdictWhy: s(o.verdictWhy, 400), adapt: list(o.adapt), avoid: list(o.avoid), ideas,
  };
}

/** Jev's three brand-fit calls on the video (the decisions); built per call from the Brand Kit. */
const fitQuestions = (): Record<string, JevQuestion> => ({
  fits_brand: { type: 'noul', instructions: `${brandAudienceLine()} Would this audience care about this video's subject and approach?` },
  adaptable: { type: 'noul', instructions: `${brandAudienceLine()} Could the brand make its own version of this video without copying it: no celebrity, big budget or the creator's personal story needed?` },
  risky: { type: 'noul', instructions: `${brandAudienceLine()} Does the video's approach rely on hype, fear, or claims the brand could not back up?` },
});

/** Analyse one decoded video (needs its transcript). Cached by URL unless `fresh`. */
export async function analyzeVideo(ctx: ModuleContext, postId: string, opts: { fresh?: boolean } = {}): Promise<{ ok: boolean; message: string; analysis?: VideoAnalysis }> {
  if (!ctx.adapters.claude.configured) return { ok: false, message: 'No AI model is configured.' };
  const p = (await ctx.db.query<{
    url: string; platform: string; duration_s: number | null; caption: string; views: number | null; vs: number | null;
    reactions: number; comments: number; creator: string | null; transcript: string | null; analysis: VideoAnalysis | null;
  }>(
    `select p.url, p.platform, p.duration_s, p.caption, p.views, p.vs_own_median::float8 as vs, p.reactions, p.comments,
            coalesce(c.name, p.handle) as creator, tr.text as transcript, tr.analysis
       from content.decoded_posts p left join content.competitors c on c.id = p.competitor_id
       left join content.transcripts tr on tr.norm_url = content.norm_url(p.url)
      where p.id = $1`, [postId])).rows[0];
  if (!p) return { ok: false, message: 'Video not found.' };
  if (!p.transcript) return { ok: false, message: 'Transcribe it first: the analysis reads what is said.' };
  if (p.analysis && !opts.fresh) return { ok: true, message: 'Already analysed', analysis: p.analysis };

  await loadBrand(ctx);
  const input = { platform: p.platform, durationS: p.duration_s, caption: p.caption, transcript: p.transcript, creator: p.creator,
    views: p.views, vsUsual: p.vs != null ? Math.round(p.vs * 10) / 10 : null, reactions: p.reactions, comments: p.comments };
  const state = `${input.platform} video${input.creator ? ` by ${input.creator}` : ''}\nCAPTION:\n${input.caption.slice(0, 1500)}\nTRANSCRIPT:\n${input.transcript.slice(0, 3000)}`;
  const jevRun = ctx.adapters.jev?.configured
    ? ctx.adapters.jev.decide(state, fitQuestions())
      .then(async (r) => {
        await createRepo(ctx.db).logDecision({ task: 'video_fit', subjectId: postId, state, source: 'jev', model: r.model,
          answer: r.answers, used: true, confidence: minConfidence(r.answers) }).catch(() => {});
        return { fitsBrand: r.answers.fits_brand?.noul ?? 0, adaptable: r.answers.adaptable?.noul ?? 0, risky: r.answers.risky?.noul ?? 0 };
      }, (e: Error) => { ctx.logger.warn(`jev video_fit ${postId}: ${e.message}`); return null; })
    : Promise.resolve(null);
  try {
    const raw = await ctx.adapters.claude.complete(buildVideoAnalysisPrompt(input), { system: videoAnalysisSystem(), maxTokens: 3000 });
    const jev = await jevRun;
    const parsed = parseVideoAnalysis(raw);
    // Jev decides the verdict when it is clear; the LLM's verdict stays when Jev is unsure or off.
    const verdict = !jev ? parsed.verdict
      : jev.fitsBrand < 0.3 || jev.risky >= 0.7 ? 'skip'
      : jev.fitsBrand >= 0.7 && jev.adaptable >= 0.7 ? (parsed.verdict === 'skip' ? 'adapt' : parsed.verdict)
      : parsed.verdict;
    const analysis: VideoAnalysis = { ...parsed, verdict, jev, analysedAt: new Date().toISOString() };
    await ctx.db.query(`update content.transcripts set analysis = $2 where norm_url = content.norm_url($1)`, [p.url, JSON.stringify(analysis)]);
    return { ok: true, message: `Analysed: ${verdict === 'skip' ? 'not for us' : 'two ideas ready'}`, analysis };
  } catch (e) {
    return { ok: false, message: `Analysis failed: ${(e as Error).message.slice(0, 200)}` };
  }
}

/** The best transcribed, not-yet-analysed videos of a Decode run (called after transcription). */
export async function analyzeRunVideos(ctx: ModuleContext, runId: string, cap = AUTO_ANALYSE): Promise<number> {
  const ids = (await ctx.db.query<{ id: string }>(
    `select p.id from content.decoded_posts p join content.transcripts tr on tr.norm_url = content.norm_url(p.url)
      where p.run_id = $1 and p.post_type = 'video' and tr.analysis is null and not p.paid
      order by p.vs_own_median desc nulls last limit $2`, [runId, cap])).rows;
  let done = 0;
  for (const { id } of ids) if ((await analyzeVideo(ctx, id)).ok) done++;
  return done;
}

/** "Use this idea": one of the two ideas becomes an Ideas signal, with what it reuses. */
export async function useVideoIdea(ctx: ModuleContext, postId: string, idx: unknown): Promise<{ ok: boolean; message: string }> {
  const i = Number(idx);
  const r = (await ctx.db.query<{ url: string; analysis: VideoAnalysis | null; creator: string | null }>(
    `select p.url, tr.analysis, coalesce(c.name, p.handle) as creator from content.decoded_posts p
       left join content.competitors c on c.id = p.competitor_id
       left join content.transcripts tr on tr.norm_url = content.norm_url(p.url) where p.id = $1`, [postId])).rows[0];
  const idea = r?.analysis?.ideas?.[i];
  if (!r || !idea) return { ok: false, message: 'Idea not found: analyse the video first.' };
  const rawText = `[Video idea] ${idea.title}. Hook: "${idea.hook}". Beats: ${idea.beats.join(' → ')}. CTA: ${idea.cta}.`
    + ` Reuses: ${idea.why || 'the structure'} (from ${r.creator ?? 'a'} video that worked).`;
  await addSignal(ctx, { rawText: rawText.slice(0, 4000), channel: 'decode', sourceUrl: r.url });
  return { ok: true, message: 'Added to Ideas' };
}
