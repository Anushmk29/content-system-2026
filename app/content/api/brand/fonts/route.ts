import { NextResponse } from 'next/server';
import { getContext, uploadFont, deleteFont } from '@pratapai/content-pipeline';
import { denied } from '../../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 5 * 1024 * 1024;

// POST /content/api/brand/fonts (multipart: file × 1-8, TTF/OTF) → stored under the family named inside each file.
export async function POST(req: Request) {
  const no = denied(req);
  if (no) return no;
  try {
    const files = (await req.formData()).getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) throw new Error('Choose a .ttf or .otf file.');
    if (files.length > 8) throw new Error('At most 8 files at once.');
    if (files.some((f) => f.size > MAX_BYTES)) throw new Error('A font file is over 5 MB.');
    const ctx = getContext();
    const saved = [];
    for (const f of files) saved.push(await uploadFont(ctx, Buffer.from(await f.arrayBuffer())));
    const families = [...new Set(saved.map((s) => s.family))];
    return NextResponse.json({ ok: true, fonts: saved, message: `Added ${families.join(', ')}` });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

// DELETE /content/api/brand/fonts?family=… → remove every weight of that family.
export async function DELETE(req: Request) {
  const no = denied(req);
  if (no) return no;
  const family = new URL(req.url).searchParams.get('family');
  if (!family) return NextResponse.json({ ok: false, error: 'family is required' }, { status: 400 });
  await deleteFont(getContext(), family);
  return NextResponse.json({ ok: true, message: 'Removed' });
}
