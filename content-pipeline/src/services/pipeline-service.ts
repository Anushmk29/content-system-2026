// Recent items for the dashboard's command palette.
import type { ModuleContext } from '../modules/module.ts';
import { createRepo, type ContentItemRow } from '../db/repo.ts';

interface PipelineBoard {
  recent: ContentItemRow[];
}

export async function getPipelineBoard(ctx: ModuleContext): Promise<PipelineBoard> {
  return { recent: await createRepo(ctx.db).allItems(25) };
}
