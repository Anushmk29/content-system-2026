import { NextResponse } from 'next/server';
import { getContext, getPhotos, setPhotos } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

const MAX_BYTES = 10 * 1024 * 1024;

// GET /content/api/brand/photos?i=0 → one stored headshot (PNG).
export async function GET(req: Request) {
  const i = Number(new URL(req.url).searchParams.get('i') ?? 0);
  const png = (await getPhotos(getContext()).catch(() => []))[i];
  if (!png) return new Response('not found', { status: 404 });
  return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'cache-control': 'private, no-cache' } });
}

// POST /content/api/brand/photos (multipart: file × 1-4) → replace your photos.
export const POST = handle(async (req: Request) => {
  const files = (await req.formData()).getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) throw new Error('Choose a photo.');
  if (files.length > 4) throw new Error('At most 4 photos.');
  if (files.some((f) => f.size > MAX_BYTES)) throw new Error('A photo is over 10 MB.');
  await setPhotos(getContext(), await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer()))));
  return NextResponse.json({ ok: true, message: `${files.length} photo${files.length === 1 ? '' : 's'} saved` });
});

// DELETE /content/api/brand/photos → no photos; designs with a person leave them out.
export const DELETE = handle(async () => {
  await setPhotos(getContext(), []);
  return NextResponse.json({ ok: true, message: 'Photos removed' });
});
