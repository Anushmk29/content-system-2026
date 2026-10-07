import { NextResponse } from 'next/server';
import { getContext, saveCompetitor, deleteCompetitor } from '@pratapai/content-pipeline';
import { denied } from '../../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /content/api/decode/competitors → add, or edit when `id` is given.
// Body: { id?, name?, handles?: { x?, instagram?, linkedin?, facebook? }, active? }
export async function POST(req: Request) {
  const no = denied(req);
  if (no) return no;
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const row = await saveCompetitor(getContext(), {
      id: typeof b.id === 'string' ? b.id : undefined,
      name: typeof b.name === 'string' ? b.name : undefined,
      handles: b.handles && typeof b.handles === 'object' ? (b.handles as Record<string, unknown>) : undefined,
      active: typeof b.active === 'boolean' ? b.active : undefined,
    });
    return NextResponse.json({ ok: true, competitor: row, message: 'Saved' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

// DELETE /content/api/decode/competitors?id=… → remove (their decoded posts stay, unlinked).
export async function DELETE(req: Request) {
  const no = denied(req);
  if (no) return no;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
  await deleteCompetitor(getContext(), id);
  return NextResponse.json({ ok: true, message: 'Removed' });
}
