// Draft Generator (Bible §9, §8.2) — the "intelligence" the custom build exists for.
// Anchor-first: for each topic the operator marks 'selected' (ideas come mostly from X
// and Reddit via Market Signals), Claude writes ONE LinkedIn anchor post, then repurposes
// it into a blog article, an X thread, an Instagram carousel and a Facebook post. Every specific/metric claim is stored UNPROVEN, so the honest-numbers
// rule (QC gate + v_publish_ready) blocks publish until a human attaches proof.
import type { Module, ModuleContext, ModuleResult } from './module.ts';
import { ok, degraded } from './module.ts';
import { createRepo, type TopicRow, type NewContentItem, type Angle } from '../db/repo.ts';
import { suggestedPlatforms } from './decision-tasks.ts';
import { createContentItems } from '../db/content-items.ts';
import { brandSystem } from '../prompts/brand-context.ts';
import { buildDraftPrompt, buildAnglePrompt } from '../prompts/draft.ts';
import { DRAFT_PLATFORMS, DEFAULT_DRAFT_PLATFORMS, type DraftPlatform } from '../prompts/platform-playbooks.ts';
import { parseDraftResponse, type DraftSet, type DraftPiece } from './draft-parse.ts';
import { provenHooks, patternAdvice, hookPatternWeights, scoreHookOptions } from '../services/hook-service.ts';
import { parseJsonObject } from './llm-json.ts';
import type { ModuleContext as Ctx } from './module.ts';

// platform → content_format (must match the content.content_format enum).
const FORMAT: Record<DraftPlatform, string> = {
  linkedin: 'founder_post',
  blog: 'article',
  x: 'thread',
  instagram: 'carousel',
  facebook: 'founder_post',
  reddit: 'reddit_answer',
  youtube: 'short_script',
};

export const draftGeneratorModule: Module = {
  id: 'draft_generator',
  title: 'Draft Generator',
  description: 'Turns each selected topic into a LinkedIn anchor + blog + X thread + Instagram carousel + Facebook post via Claude (Bible §9).',

  async run(ctx: ModuleContext): Promise<ModuleResult> {
    if (!ctx.adapters.claude.configured) {
      return degraded('Claude not configured (CONTENT_ANTHROPIC_API_KEY) — cannot draft');
    }

    const repo = createRepo(ctx.db);
    const topics = await repo.selectedTopics();
    if (topics.length === 0) return ok(0, "no topics marked 'selected' to draft");

    let drafted = 0;
    let itemsCreated = 0;
    const failures: string[] = [];

    for (const topic of topics) {
      try {
        itemsCreated += (await draftTopic(ctx, topic, { platforms: platformsFor(topic, ctx.env.platformFit), frameworks: topic.frameworks ?? undefined })).length;
        drafted++;
      } catch (e) {
        // Per-topic isolation: one bad topic never blocks the rest of the batch.
        failures.push(`${topic.title}: ${(e as Error).message}`);
      }
    }

    const message =
      `${drafted}/${topics.length} topic(s) drafted into ${itemsCreated} item(s)` +
      (failures.length ? `, ${failures.length} failed` : '');
    return {
      status: failures.length > 0 ? 'degraded' : 'ok',
      itemsProcessed: itemsCreated,
      message,
      meta: { drafted, itemsCreated, failures },
    };
  },
};

/** Where a topic is drafted: the operator's pick on the idea card, else Jev's (when platform fit is on),
 *  else undefined = the default set. Unknown names are dropped. */
export function platformsFor(topic: Pick<TopicRow, 'platforms' | 'platform_fit'>, useFit: boolean): DraftPlatform[] | undefined {
  const own = (topic.platforms ?? []).filter((p): p is DraftPlatform => (DRAFT_PLATFORMS as readonly string[]).includes(p));
  if (own.length) return own;
  const jev = useFit ? suggestedPlatforms(topic.platform_fit) : [];
  return jev.length ? jev : undefined;
}

/** Parse the angle reply: up to 5 valid angles, strongest first. */
export function parseAngles(raw: string): Angle[] {
  const list = parseJsonObject(raw).angles;
  return (Array.isArray(list) ? list : []).flatMap((a) => {
    const belief = typeof a?.belief === 'string' ? a.belief.trim() : '', truth = typeof a?.truth === 'string' ? a.truth.trim() : '';
    if (!belief || !truth) return [];
    const strength = Math.min(10, Math.max(1, Math.round(Number(a.strength) || 5)));
    return [{ belief, truth, strength, proof_method: typeof a.proof_method === 'string' ? a.proof_method.trim() : '' }];
  }).slice(0, 5);
}

/** The topic's 5 angles, generated once (one LLM call) and saved on the topic. */
export async function ensureAngles(ctx: Ctx, topic: Pick<TopicRow, 'id' | 'title' | 'customer_language' | 'market_context' | 'angles'>, fresh = false): Promise<Angle[]> {
  if (topic.angles?.length && !fresh) return topic.angles;
  const angles = parseAngles(await ctx.adapters.claude.complete(buildAnglePrompt(topic), { system: brandSystem(), maxTokens: 1500 }));
  if (!angles.length) throw new Error('no usable angles in the reply');
  await ctx.db.query(`update content.topics set angles = $2, angle_idx = null where id = $1`, [topic.id, JSON.stringify(angles)]);
  return angles;
}

/** Ideas page: (re)generate a topic's 5 angles. */
export async function topicAngles(ctx: Ctx, topicId: string): Promise<Angle[]> {
  const t = (await ctx.db.query<TopicRow>(
    `select id, title, customer_language, market_context, angles from content.topics where id = $1`, [topicId])).rows[0];
  if (!t) throw new Error('topic not found');
  if (!ctx.adapters.claude.configured) throw new Error('No LLM configured');
  return ensureAngles(ctx, t, true);
}

/** Ideas page: the angle the draft will argue (null = the strongest). */
export async function pickAngle(ctx: Ctx, topicId: string, idx: unknown): Promise<{ ok: boolean; message: string }> {
  const i = idx === null ? null : Number(idx);
  if (i !== null && (!Number.isInteger(i) || i < 0 || i > 4)) return { ok: false, message: 'bad angle' };
  const r = await ctx.db.query(`update content.topics set angle_idx = $2 where id = $1 and (angles is not null or $2::int is null)`, [topicId, i]);
  return r.rowCount ? { ok: true, message: i === null ? 'Strongest angle' : `Angle ${i + 1} picked` } : { ok: false, message: 'Find angles first' };
}

/** The operator's pick, else the strongest. */
export const chosenAngle = (angles: Angle[], idx: number | null | undefined): Angle | null =>
  (idx != null ? angles[idx] : undefined) ?? [...angles].sort((a, b) => b.strength - a.strength)[0] ?? null;

/** One selected topic → its draft items (ids, anchor first). `platforms` limits the set (first =
 *  anchor); `steal` is a competitor post whose structure the set copies (Decode). */
export async function draftTopic(
  ctx: ModuleContext, topic: TopicRow,
  opts: { platforms?: readonly DraftPlatform[]; steal?: string; frameworks?: Partial<Record<DraftPlatform, string>> } = {},
): Promise<string[]> {
  const platforms = opts.platforms?.length ? DRAFT_PLATFORMS.filter((p) => opts.platforms!.includes(p)) : DEFAULT_DRAFT_PLATFORMS;
  // A steal already carries its hook pattern; otherwise offer the library's winners.
  const hooks = opts.steal ? null : await provenHooks(ctx, platforms);
  // A steal copies a structure, so it needs no angle; a topic gets its Contrast-Formula angle.
  // An angle failure never blocks the draft.
  let angle: Angle | null = null;
  if (!opts.steal) {
    try { angle = chosenAngle(await ensureAngles(ctx, topic), topic.angle_idx); }
    catch (e) { ctx.logger.warn(`angles for ${topic.id}: ${(e as Error).message}`); }
  }
  const advice = await patternAdvice(ctx).catch(() => null);
  const raw = await ctx.adapters.claude.complete(
    buildDraftPrompt({
      topicTitle: topic.title,
      pillarHint: topic.pillar,
      funnelHint: topic.funnel_stage,
      customerLanguage: topic.customer_language,
      sourceDetail: topic.source_detail,
      marketContext: topic.market_context,
      platforms,
      frameworks: opts.frameworks,
      steal: opts.steal,
      hooks: hooks?.text,
      angle,
      patternAdvice: advice,
    }),
    { system: brandSystem(), maxTokens: 8192 },
  );
  const set = parseDraftResponse(raw, platforms);
  const weights = new Map((await hookPatternWeights(ctx).catch(() => [])).map((x) => [x.pattern, x.weight]));
  return createContentItems(ctx.db).createDraftSet(topic.id, draftPieces(topic, set, platforms, hooks?.ids ?? [], weights), set.claims);
}

/** Anchor first (children link to it), then the repurposed children. Every claim is stored
 *  unproven on every piece, so the honest-numbers gate (QC + v_publish_ready) blocks publish
 *  until a human attaches proof. */
export function draftPieces(topic: TopicRow, set: DraftSet, platforms: readonly DraftPlatform[], hookIds: string[], weights = new Map<string, number>()): NewContentItem[] {
  const riskLevel = set.claims.length > 0 ? 'high' : 'medium';

  const base = (platform: DraftPlatform, piece: DraftPiece): NewContentItem => {
    // Same score as the drawer's rewrite (incl. what each pattern earned on our posts); best opening wins.
    const best = scoreHookOptions(piece.hookOptions ?? [], weights)[0];
    return {
      title: piece.title,
      pillar: set.pillar,
      funnelStage: set.funnelStage,
      platform,
      format: FORMAT[platform],
      hook: best?.hook || piece.hook || null,
      cta: piece.cta || null,
      body: piece.body,
      sourceMaterial: topic.customer_language ?? topic.source_detail ?? topic.title,
      riskLevel,
      offerIdx: set.offer ?? null,
      hookRef: piece.hookFrom ? hookIds[piece.hookFrom - 1] ?? null : null,
      hookPattern: best?.pattern ?? piece.hookPattern ?? null,
    };
  };

  return platforms.map((p) => base(p, set[p]!));
}
