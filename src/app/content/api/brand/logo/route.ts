import { NextResponse } from 'next/server';
import { getContext, getLogo, setLogo } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

const MAX_BYTES = 5 * 1024 * 1024;

// GET /content/api/brand/logo → the stored logo PNG.
export async function GET() {
  const png = await getLogo((await getContext())).catch(() => null);
  if (!png) return new Response('not found', { status: 404 });
  return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'cache-control': 'private, no-cache' } });
}

// POST /content/api/brand/logo (multipart: file) → replace the logo. A transparent PNG looks best.
export const POST = handle(async (req: Request) => {
  const file = (await req.formData()).get('file');
  if (!(file instanceof File) || !file.size) throw new Error('Choose an image.');
  if (file.size > MAX_BYTES) throw new Error('The logo is over 5 MB.');
  await setLogo((await getContext()), Buffer.from(await file.arrayBuffer()));
  return NextResponse.json({ ok: true, message: 'Logo saved' });
});

// DELETE /content/api/brand/logo → no logo on creatives.
export const DELETE = handle(async () => {
  await setLogo((await getContext()), null);
  return NextResponse.json({ ok: true, message: 'Logo removed' });
});
