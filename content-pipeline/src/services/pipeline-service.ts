// Pipeline board data for the dashboard: counts per lifecycle status + recent items.
import type { ModuleContext } from '../modules/module.ts';
import { createRepo, type ContentItemRow } from '../db/repo.ts';
import { CONTENT_STATUSES } from '../../core/src/index.ts';

export interface PipelineBoard {
  counts: { status: string; count: number }[];
  recent: ContentItemRow[];
}

export async function getPipelineBoard(ctx: ModuleContext): Promise<PipelineBoard> {
  const repo = createRepo(ctx.db);
  const [counts, recent] = await Promise.all([repo.statusCounts(), repo.recentItems(25)]);
  const map = new Map(counts.map((c) => [c.status, c.count]));
  // Always return all statuses in pipeline order, zero-filled.
  const ordered = CONTENT_STATUSES.map((s) => ({ status: s, count: map.get(s) ?? 0 }));
  return { counts: ordered, recent };
}
