// Operator console (Bible §10/§11/§13/§14) — the human-in-the-loop surface the
// dashboard renders. One read (getOperatorConsole) feeds every panel; the small
// actions here back the dashboard's write buttons. Everything routes through the
// tested repo/core so the status machine can't drift.
import type { ModuleContext } from '../modules/module.ts';
import {
  createRepo,
  type ClaimRow,
  type ContentItemRow,
  type TopicRow,
  type ResearchInputRow,
} from '../db/repo.ts';
import { DRAFT_PLATFORMS, PLATFORM_FRAMEWORKS, SCRIPT_TARGETS, parsePick, pickId } from '../prompts/platform-playbooks.ts';
import { researchSignal } from '../modules/research.module.ts';
import { scoreTopic } from '../modules/scoring.module.ts';
import { canDecide } from '../modules/decide.ts';

/** A draft awaiting approval, bundled with the claims a reviewer must check (§10.3). */
interface ApprovalQueueItem {
  item: ContentItemRow;
  claims: ClaimRow[];
}

export interface OperatorConsole {
  /** Raw signals captured but not yet turned into topics (run Research to process). */
  signals: ResearchInputRow[];
  /** Topics Research made that the Topic Scorer hasn't scored yet (hidden from reviewTopics). */
  unscoredTopics: TopicRow[];
  /** Scored topics awaiting a select/drop decision before drafting. */
  reviewTopics: TopicRow[];
  /** Topics already selected, waiting for the Draft Generator. */
  selectedTopics: TopicRow[];
  /** Drafts in needs_approval — review body + claims, then approve/changes/reject. */
  approvalQueue: ApprovalQueueItem[];
}

export async function getOperatorConsole(ctx: ModuleContext): Promise<OperatorConsole> {
  const repo = createRepo(ctx.db);
  const [signals, unscoredTopics, reviewTopics, selectedTopics, needsApproval] = await Promise.all([
    repo.unprocessedResearchInputs(),
    repo.unscoredTopics(),
    repo.reviewableTopics(),
    repo.selectedTopics(),
    repo.itemsByStatus('needs_approval'),
  ]);

  // Attach each pending draft's claims so the reviewer sees what they're vouching for.
  const approvalQueue: ApprovalQueueItem[] = await Promise.all(
    needsApproval.map(async (item) => ({ item, claims: await repo.claimsFor(item.id) })),
  );

  return { signals, unscoredTopics, reviewTopics, selectedTopics, approvalQueue };
}

interface AddSignalInput {
  rawText: string;
  channel?: string | null;
  sourceUrl?: string | null;
}

/** Capture a raw signal from the dashboard. The Research module turns it into a topic. */
export async function addSignal(ctx: ModuleContext, input: AddSignalInput): Promise<ResearchInputRow> {
  const rawText = input.rawText?.trim();
  if (!rawText) throw new Error('rawText is required');
  if (rawText.length > 8000) throw new Error('Signal is too long (8,000 characters max).');
  return createRepo(ctx.db).insertResearchInput({
    rawText,
    channel: input.channel?.trim() || null,
    sourceUrl: input.sourceUrl?.trim() || null,
  });
}

/** The operator picks a waiting signal: "use" turns just that one into a topic and queues it for
 *  drafting (Selected on Ideas, where platforms/angle are chosen); "drop" shelves it. */
export async function decideSignal(ctx: ModuleContext, id: string, action: 'use' | 'drop'): Promise<{ ok: boolean; message: string }> {
  const repo = createRepo(ctx.db);
  if (action === 'drop') return (await repo.dropResearchInput(id)) ? { ok: true, message: 'Dropped' } : { ok: false, message: 'Signal already used (or not found).' };
  if (action !== 'use') return { ok: false, message: `Unknown action "${action}".` };
  const input = await repo.researchInput(id);
  if (!input) return { ok: false, message: 'Signal already used (or not found).' };
  if (!ctx.adapters.claude.configured) return { ok: false, message: 'No AI model configured.' };
  const { topicId } = await researchSignal(ctx, input);
  // Score + platform fit so the card shows them; a failed score never blocks the pick.
  const topic = canDecide(ctx) ? (await repo.unscoredTopics()).find((t) => t.id === topicId) : undefined;
  if (topic) await scoreTopic(ctx, topic).catch((e: Error) => ctx.logger.warn(`score ${topicId}: ${e.message}`));
  await repo.decideTopic(topicId, 'selected');
  return { ok: true, message: 'Topic made · pick platforms below, then Draft' };
}

export type TopicDecision = 'selected' | 'dropped';

/** Operator decides whether a scored topic gets drafted (selected) or shelved (dropped). */
export async function decideTopic(
  ctx: ModuleContext,
  topicId: string,
  decision: TopicDecision,
): Promise<{ ok: boolean; message: string }> {
  if (decision !== 'selected' && decision !== 'dropped') {
    return { ok: false, message: `Unknown decision "${decision}".` };
  }
  if (!(await createRepo(ctx.db).decideTopic(topicId, decision))) {
    return { ok: false, message: 'Topic already drafted (or not found).' };
  }
  return { ok: true, message: decision === 'selected' ? 'Queued for drafting' : 'Dropped' };
}

/** The idea card's platform + framework pick. `platforms: null` = follow Jev again. */
export async function setTopicPlan(
  ctx: ModuleContext, topicId: string, input: { platforms?: unknown; frameworks?: unknown },
): Promise<{ ok: boolean; message: string }> {
  const plan: { platforms?: string[] | null; frameworks?: Record<string, string> | null } = {};
  if (input.platforms !== undefined) {
    if (input.platforms !== null && !Array.isArray(input.platforms)) return { ok: false, message: 'platforms must be a list' };
    let list: string[] | null = null;
    if (input.platforms !== null) {
      const ids = (input.platforms as unknown[]).filter((x): x is string => typeof x === 'string');
      // One written format per platform (the last pick wins), in platform order; then video scripts.
      const posts = new Map(ids.flatMap((id) => { const p = parsePick(id); return p ? [[p.platform, pickId(p.platform, p.format.id)] as const] : []; }));
      list = [...DRAFT_PLATFORMS.flatMap((p) => posts.get(p) ?? []), ...Object.keys(SCRIPT_TARGETS).filter((t) => ids.includes(t))];
      if (!posts.size) return { ok: false, message: 'Pick at least one platform to post on.' };
    }
    plan.platforms = list;
  }
  if (input.frameworks !== undefined) {
    const f = (input.frameworks && typeof input.frameworks === 'object' ? input.frameworks : {}) as Record<string, unknown>;
    plan.frameworks = Object.fromEntries(DRAFT_PLATFORMS.flatMap((p) =>
      PLATFORM_FRAMEWORKS[p].some((x) => x.id === f[p]) ? [[p, f[p] as string]] : []));
  }
  if (!(await createRepo(ctx.db).setTopicPlan(topicId, plan))) return { ok: false, message: 'Topic already drafted (or not found).' };
  return { ok: true, message: plan.platforms ? `Drafting for ${plan.platforms.length} platform${plan.platforms.length === 1 ? '' : 's'}` : 'Saved' };
}
