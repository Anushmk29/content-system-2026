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
import { DRAFT_PLATFORMS, PLATFORM_FRAMEWORKS } from '../prompts/platform-playbooks.ts';

/** A draft awaiting approval, bundled with the claims a reviewer must check (§10.3). */
interface ApprovalQueueItem {
  item: ContentItemRow;
  claims: ClaimRow[];
}

export interface OperatorConsole {
  /** Raw signals captured but not yet turned into topics (run Research to process). */
  signals: ResearchInputRow[];
  /** Scored topics awaiting a select/drop decision before drafting. */
  reviewTopics: TopicRow[];
  /** Topics already selected, waiting for the Draft Generator. */
  selectedTopics: TopicRow[];
  /** Drafts in needs_approval — review body + claims, then approve/changes/reject. */
  approvalQueue: ApprovalQueueItem[];
}

export async function getOperatorConsole(ctx: ModuleContext): Promise<OperatorConsole> {
  const repo = createRepo(ctx.db);
  const [signals, reviewTopics, selectedTopics, needsApproval] = await Promise.all([
    repo.unprocessedResearchInputs(),
    repo.reviewableTopics(),
    repo.selectedTopics(),
    repo.itemsByStatus('needs_approval'),
  ]);

  // Attach each pending draft's claims so the reviewer sees what they're vouching for.
  const approvalQueue: ApprovalQueueItem[] = await Promise.all(
    needsApproval.map(async (item) => ({ item, claims: await repo.claimsFor(item.id) })),
  );

  return { signals, reviewTopics, selectedTopics, approvalQueue };
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
  return createRepo(ctx.db).insertResearchInput({
    rawText,
    channel: input.channel?.trim() || null,
    sourceUrl: input.sourceUrl?.trim() || null,
  });
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
    const list = input.platforms === null ? null : DRAFT_PLATFORMS.filter((p) => (input.platforms as unknown[]).includes(p));
    if (list && !list.length) return { ok: false, message: 'Pick at least one platform.' };
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
