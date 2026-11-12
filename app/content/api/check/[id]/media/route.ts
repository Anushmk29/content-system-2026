import { NextResponse } from 'next/server';
import { getContext, getCreativeMedia, setCreativeMedia } from '@pratapai/content-pipeline';
import { handle } from '../../../guard';

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 10;
type P = { params: Promise<{ id: string }> };

// GET ?i=0 → one image / the video of the creative.
export const GET = handle(async (req: Request, { params }: P) => {
  const i = Number(new URL(req.url).searchParams.get('i') ?? 0);
  const m = Number.isInteger(i) && i >= 0 ? await getCreativeMedia(getContext(), (await params).id, i) : null;
  if (!m) return new Response('not found', { status: 404 });
  return new Response(new Uint8Array(m.bytes), { headers: { 'content-type': m.mime, 'cache-control': 'private, no-cache' } });
});

// POST multipart (file, file …) → replace the creative's media: up to 10 images or one MP4. No files = remove.
export const POST = handle(async (req: Request, { params }: P) => {
  const files = (await req.formData()).getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_FILES) throw new Error(`Attach at most ${MAX_FILES} files.`);
  if (files.some((f) => f.size > MAX_BYTES)) throw new Error('Each file must be under 50 MB.');
  const r = await setCreativeMedia(getContext(), (await params).id, await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer()))));
  return NextResponse.json({ ok: true, message: r.count ? `Attached ${r.count} file${r.count === 1 ? '' : 's'}` : 'Media removed' });
});
