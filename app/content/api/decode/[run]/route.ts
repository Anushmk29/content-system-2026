import { NextResponse } from 'next/server';
import { getContext, getDecodeRun, stopDecode } from '@pratapai/content-pipeline';
import { denied } from '../../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /content/api/decode/:run?after=<seq> → the run + posts decoded since `after` (the page polls this).
export async function GET(req: Request, { params }: { params: Promise<{ run: string }> }) {
  const { run } = await params;
  const after = Number(new URL(req.url).searchParams.get('after') ?? 0) || 0;
  try {
    const data = await getDecodeRun(getContext(), run, after);
    return data ? NextResponse.json({ ok: true, ...data }) : NextResponse.json({ ok: false, error: 'run not found' }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

// PATCH /content/api/decode/:run → stop it. The run checks between accounts / batches.
export async function PATCH(req: Request, { params }: { params: Promise<{ run: string }> }) {
  const no = denied(req);
  if (no) return no;
  const { run } = await params;
  await stopDecode(getContext(), run);
  return NextResponse.json({ ok: true, message: 'Stopping…' });
}
