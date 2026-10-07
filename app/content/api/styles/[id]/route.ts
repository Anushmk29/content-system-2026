import { NextResponse } from 'next/server';
import { getContext, renameStyle, deleteStyle, remakeTemplate } from '@pratapai/content-pipeline';
import { denied } from '../../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST /content/api/styles/:id { note?, layout? } → remake the layout template (fix it from a note, or rebuild).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const no = denied(req);
  if (no) return no;
  try {
    const b = (await req.json()) as { note?: unknown; layout?: unknown };
    const r = await remakeTemplate(getContext(), (await params).id, {
      note: typeof b.note === 'string' ? b.note : undefined,
      layout: typeof b.layout === 'string' && b.layout ? b.layout : undefined,
    });
    return NextResponse.json({ ok: true, message: `Template remade · $${r.costUsd.toFixed(2)}` });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

// PATCH /content/api/styles/:id { name } → rename.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const no = denied(req);
  if (no) return no;
  try {
    const b = (await req.json()) as { name?: unknown };
    await renameStyle(getContext(), (await params).id, typeof b.name === 'string' ? b.name : '');
    return NextResponse.json({ ok: true, message: 'Renamed' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

// DELETE /content/api/styles/:id → remove the style.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const no = denied(req);
  if (no) return no;
  await deleteStyle(getContext(), (await params).id);
  return NextResponse.json({ ok: true, message: 'Deleted' });
}
