import { NextResponse } from 'next/server';
import { getContext, renameStyle, deleteStyle, makeFromExample, isVisualKind } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

export const maxDuration = 300;

// POST /content/api/styles/:id { topic, platform, kind: 'image' | 'carousel' } → "Make one": the AI writes
// a post on the topic and recreates this example with it; the post lands on Design / Approvals.
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const b = (await req.json()) as { topic?: unknown; platform?: unknown; kind?: unknown };
  if (!isVisualKind(b.kind)) throw new Error('Pick Image or Carousel.');
  const r = await makeFromExample((await getContext()), {
    styleId: (await params).id, kind: b.kind,
    topic: typeof b.topic === 'string' ? b.topic : '',
    platform: typeof b.platform === 'string' ? b.platform : '',
  });
  const failed = r.creativeErrors.length > 0;
  return NextResponse.json({
    ok: true, itemId: r.itemIds[0], status: failed ? 'degraded' : 'ok',
    message: failed ? `Post written, but the visual failed: ${r.creativeErrors.join('; ')}` : `Made · ${r.needProof ? 'needs proof for a number first' : 'waiting in Approvals'} · $${r.costUsd.toFixed(2)}`,
  });
});

// PATCH /content/api/styles/:id { name } → rename.
export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const b = (await req.json()) as { name?: unknown };
  await renameStyle((await getContext()), (await params).id, typeof b.name === 'string' ? b.name : '');
  return NextResponse.json({ ok: true, message: 'Renamed' });
});

// DELETE /content/api/styles/:id → remove the style.
export const DELETE = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  await deleteStyle((await getContext()), (await params).id);
  return NextResponse.json({ ok: true, message: 'Deleted' });
});
