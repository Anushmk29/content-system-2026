// Draft Generator (Bible §9, §8.2) — the "intelligence" the custom build exists for.
// Anchor-first: for each topic the operator marks 'selected' (ideas come mostly from X
// and Reddit via Market Signals), Claude writes ONE LinkedIn anchor post, then repurposes
// it into a blog article, an X thread, an Instagram carousel and a Facebook post. Every specific/metric claim is stored UNPROVEN, so the honest-numbers
// rule (QC gate + v_publish_ready) blocks publish until a human attaches proof.
import type { Module, ModuleContext, ModuleResult } from './module.ts';
import { ok, degraded } from './module.ts';
import { createRepo, type TopicRow, type NewContentItem } from '../db/repo.ts';
import { createContentItems } from '../db/content-items.ts';
import { brandSystem, buildDraftPrompt, DRAFT_PLATFORMS, type DraftPlatform } from '../prompts/brand-brain.ts';
import { parseDraftResponse, type DraftSet, type DraftPiece } from './draft-parse.ts';
import { provenHooks } from '../services/hook-service.ts';

// platform → content_format (must match the content.content_format enum).
const FORMAT: Record<DraftPlatform, string> = {
  linkedin: 'founder_post',
  blog: 'article',
  x: 'thread',
  instagram: 'carousel',
  facebook: 'founder_post',
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
        itemsCreated += (await draftTopic(ctx, topic)).length;
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

/** One selected topic → its draft items (ids, anchor first). `platforms` limits the set (first =
 *  anchor); `steal` is a competitor post whose structure the set copies (Decode). */
export async function draftTopic(
  ctx: ModuleContext, topic: TopicRow,
  opts: { platforms?: readonly DraftPlatform[]; steal?: string } = {},
): Promise<string[]> {
  const platforms = opts.platforms?.length ? DRAFT_PLATFORMS.filter((p) => opts.platforms!.includes(p)) : DRAFT_PLATFORMS;
  // A steal already carries its hook pattern; otherwise offer the library's winners.
  const hooks = opts.steal ? null : await provenHooks(ctx, platforms);
  const raw = await ctx.adapters.claude.complete(
    buildDraftPrompt({
      topicTitle: topic.title,
      pillarHint: topic.pillar,
      funnelHint: topic.funnel_stage,
      customerLanguage: topic.customer_language,
      sourceDetail: topic.source_detail,
      marketContext: topic.market_context,
      platforms,
      steal: opts.steal,
      hooks: hooks?.text,
    }),
    { system: brandSystem(), maxTokens: 8192 },
  );
  const set = parseDraftResponse(raw, platforms);
  return createContentItems(ctx.db).createDraftSet(topic.id, draftPieces(topic, set, platforms, hooks?.ids ?? []), set.claims);
}

/** Anchor first (children link to it), then the repurposed children. Every claim is stored
 *  unproven on every piece, so the honest-numbers gate (QC + v_publish_ready) blocks publish
 *  until a human attaches proof. */
function draftPieces(topic: TopicRow, set: DraftSet, platforms: readonly DraftPlatform[], hookIds: string[]): NewContentItem[] {
  const riskLevel = set.claims.length > 0 ? 'high' : 'medium';

  const base = (platform: DraftPlatform, piece: DraftPiece): NewContentItem => ({
    title: piece.title,
    pillar: set.pillar,
    funnelStage: set.funnelStage,
    platform,
    format: FORMAT[platform],
    hook: piece.hook || null,
    cta: piece.cta || null,
    body: piece.body,
    sourceMaterial: topic.customer_language ?? topic.source_detail ?? topic.title,
    riskLevel,
    offerIdx: set.offer ?? null,
    hookRef: piece.hookFrom ? hookIds[piece.hookFrom - 1] ?? null : null,
  });

  return platforms.map((p) => base(p, set[p]!));
}
