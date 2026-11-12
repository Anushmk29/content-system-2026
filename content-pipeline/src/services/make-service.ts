// A topic straight to finished posts: draft → creative (from an example or reference images) →
// QC, synchronously (~1-3 min). Shared by Decode's "Write my version / Recreate", the
// Examples page's "Make one" and the Videos page's "Use this idea".
import type { ModuleContext } from '../modules/module.ts';
import { createRepo } from '../db/repo.ts';
import { draftTopic } from '../modules/draft-generator.module.ts';
import { qcItem } from '../modules/qc-gate.module.ts';
import { saveItemCreative } from './asset-service.ts';
import { DRAFT_PLATFORMS, POST_FORMATS, type DraftPlatform, type ScriptTarget } from '../prompts/platform-playbooks.ts';

export interface MakeResult { topicId: string; itemIds: string[]; items: number; toApproval: number; needProof: number; creativeErrors: string[]; costUsd: number }

export async function makePosts(ctx: ModuleContext, p: {
  title: string; source: string; sourceDetail?: string; platforms: readonly DraftPlatform[];
  formats?: Partial<Record<DraftPlatform, string>>; steal?: string; styleId?: string; refs?: Buffer[]; hookRef?: string;
  scripts?: readonly ScriptTarget[];
}): Promise<MakeResult> {
  if (!ctx.adapters.claude.configured) throw new Error('No LLM configured');
  const spent = ctx.adapters.claude.spentUsd;
  const repo = createRepo(ctx.db);
  const topicId = await repo.insertTopic({ title: p.title, source: p.source, sourceDetail: p.sourceDetail, status: 'selected' });
  const topic = (await repo.selectedTopics()).find((t) => t.id === topicId)!;
  const ids = await draftTopic(ctx, topic, { platforms: p.platforms, exact: true, formats: p.formats, steal: p.steal, scripts: p.scripts });
  if (p.hookRef) await ctx.db.query(`update content.content_items set hook_ref = $1 where id = any($2)`, [p.hookRef, ids]);

  // Creatives before QC: a post is still a draft here, so it can carry one.
  const creativeErrors: string[] = [];
  if (p.styleId || p.refs?.length) {
    for (const id of ids) {
      const item = (await repo.getItem(id))!;
      if (item.platform === 'blog') continue;
      try { await saveItemCreative(ctx, id, { styleId: p.styleId, refs: p.refs }); }
      catch (e) { creativeErrors.push(`${item.platform}: ${(e as Error).message}`); }
    }
  }
  let toApproval = 0, needProof = 0;
  for (const id of ids) {
    const r = await qcItem(ctx, (await repo.getItem(id))!);
    if (r.outcome === 'blocked') needProof++; else toApproval++;
  }
  return { topicId, itemIds: ids, items: ids.length, toApproval, needProof, creativeErrors, costUsd: ctx.adapters.claude.spentUsd - spent };
}

export type VisualKind = 'image' | 'carousel';
export const isVisualKind = (k: unknown): k is VisualKind => k === 'image' || k === 'carousel';

/** The format override for an image / carousel on a platform; throws when the platform has no such format. */
export function visualFormat(platform: string, kind: VisualKind): Partial<Record<DraftPlatform, string>> {
  const p = DRAFT_PLATFORMS.find((x) => x === platform);
  if (!p || !POST_FORMATS[p].some((f) => f.id === kind)) throw new Error(`${platform} has no ${kind} post`);
  return { [p]: kind };
}

/** "Make one": a topic → one image or carousel post on a platform, made from an example. */
export async function makeFromExample(ctx: ModuleContext, input: { styleId: string; topic: string; platform: string; kind: VisualKind }): Promise<MakeResult> {
  const topic = input.topic.trim();
  if (!topic) throw new Error('add a topic');
  const formats = visualFormat(input.platform, input.kind);
  return makePosts(ctx, { title: topic, source: 'example', platforms: Object.keys(formats) as DraftPlatform[], formats, styleId: input.styleId });
}
