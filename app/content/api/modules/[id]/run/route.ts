import { NextResponse } from 'next/server';
import { getContext, runModule, getModule } from '@pratapai/content-pipeline';
import { handle } from '../../../guard';

export const maxDuration = 800;

// POST /content/api/modules/:id/run → run a single module in isolation (skipped if it is already running).
// Protected by CONTENT_RUN_SECRET when set: send it as `x-content-secret`.
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const module = getModule((await params).id);
  if (!module) return NextResponse.json({ error: 'unknown module' }, { status: 404 });
  return NextResponse.json(await runModule(module, getContext()));
});
