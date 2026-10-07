import { NextResponse } from 'next/server';
import { getContext, runModule, getModule } from '@pratapai/content-pipeline';
import { denied } from '../../../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /content/api/modules/:id/run → run a single module in isolation.
// Protected by CONTENT_RUN_SECRET when set: send it as `x-content-secret`.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getContext();
  const no = denied(req);
  if (no) return no;
  const { id } = await params;
  const module = getModule(id);
  if (!module) return NextResponse.json({ error: `unknown module: ${id}` }, { status: 404 });
  const record = await runModule(module, ctx);
  return NextResponse.json(record);
}
