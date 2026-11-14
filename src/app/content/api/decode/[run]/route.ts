import { NextResponse } from 'next/server';
import { getContext, getDecodeRun, stopDecode } from '@pratapai/content-pipeline';
import { handle, UUID } from '@/app/content/_lib/api-guard';

const notFound = () => NextResponse.json({ ok: false, error: 'run not found' }, { status: 404 });

// GET /content/api/decode/:run?after=<seq> → the run + posts decoded since `after` (the page polls this).
export const GET = handle(async (req: Request, { params }: { params: Promise<{ run: string }> }) => {
  const { run } = await params;
  if (!UUID.test(run)) return notFound();
  const after = Number(new URL(req.url).searchParams.get('after') ?? 0) || 0;
  const data = await getDecodeRun(getContext(), run, after);
  return data ? NextResponse.json({ ok: true, ...data }) : notFound();
});

// PATCH /content/api/decode/:run → stop it. The run checks between accounts / batches.
export const PATCH = handle(async (_req: Request, { params }: { params: Promise<{ run: string }> }) => {
  const { run } = await params;
  if (!UUID.test(run)) return notFound();
  await stopDecode(getContext(), run);
  return NextResponse.json({ ok: true, message: 'Stopping…' });
});
