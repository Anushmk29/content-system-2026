import { NextResponse } from 'next/server';
import { getContext, uploadFont, deleteFont } from '@pratapai/content-pipeline';
import { handle } from '../../guard';

const MAX_BYTES = 5 * 1024 * 1024;

// POST /content/api/brand/fonts (multipart: file × 1-8, TTF/OTF) → stored under the family named inside each file.
export const POST = handle(async (req: Request) => {
  const files = (await req.formData()).getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) throw new Error('Choose a .ttf or .otf file.');
  if (files.length > 8) throw new Error('At most 8 files at once.');
  if (files.some((f) => f.size > MAX_BYTES)) throw new Error('A font file is over 5 MB.');
  const ctx = getContext();
  const saved = [];
  for (const f of files) saved.push(await uploadFont(ctx, Buffer.from(await f.arrayBuffer())));
  const families = [...new Set(saved.map((s) => s.family))];
  return NextResponse.json({ ok: true, fonts: saved, message: `Added ${families.join(', ')}` });
});

// DELETE /content/api/brand/fonts?family=… → remove every weight of that family.
export const DELETE = handle(async (req: Request) => {
  const family = new URL(req.url).searchParams.get('family');
  if (!family) return NextResponse.json({ ok: false, error: 'family is required' }, { status: 400 });
  await deleteFont(getContext(), family);
  return NextResponse.json({ ok: true, message: 'Removed' });
});
