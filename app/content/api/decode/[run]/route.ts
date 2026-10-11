import { NextResponse } from 'next/server';
import { getContext, getDecodeRun, stopDecode } from '@pratapai/content-pipeline';
import { handle } from '../../guard';

// Run ids are uuids; anything else would reach Postgres as a cast error (a 500), not a 404.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
