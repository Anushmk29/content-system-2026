import { NextResponse } from 'next/server';
import { getContext, saveCompetitor, deleteCompetitor } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

// POST /content/api/decode/competitors → add, or edit when `id` is given.
// Body: { id?, name?, handles?: { x?, instagram?, linkedin?, facebook? }, active? }
export const POST = handle(async (req: Request) => {
  const b = (await req.json()) as Record<string, unknown>;
  const row = await saveCompetitor((await getContext()), {
    id: typeof b.id === 'string' ? b.id : undefined,
    name: typeof b.name === 'string' ? b.name : undefined,
    handles: b.handles && typeof b.handles === 'object' ? (b.handles as Record<string, unknown>) : undefined,
    active: typeof b.active === 'boolean' ? b.active : undefined,
  });
  return NextResponse.json({ ok: true, competitor: row, message: 'Saved' });
});

// DELETE /content/api/decode/competitors?id=… → remove (their decoded posts stay, unlinked).
export const DELETE = handle(async (req: Request) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
  await deleteCompetitor((await getContext()), id);
  return NextResponse.json({ ok: true, message: 'Removed' });
});
