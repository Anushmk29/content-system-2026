import { NextResponse } from 'next/server';
import { getContext, getLogo, setLogo } from '@pratapai/content-pipeline';
import { denied } from '../../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 5 * 1024 * 1024;

// GET /content/api/brand/logo → the stored logo PNG.
export async function GET() {
  const png = await getLogo(getContext()).catch(() => null);
  if (!png) return new Response('not found', { status: 404 });
  return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'cache-control': 'private, no-cache' } });
}

// POST /content/api/brand/logo (multipart: file) → replace the logo. A transparent PNG looks best.
export async function POST(req: Request) {
  const no = denied(req);
  if (no) return no;
  try {
    const file = (await req.formData()).get('file');
    if (!(file instanceof File) || !file.size) throw new Error('Choose an image.');
    if (file.size > MAX_BYTES) throw new Error('The logo is over 5 MB.');
    await setLogo(getContext(), Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ ok: true, message: 'Logo saved' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

// DELETE /content/api/brand/logo → no logo on creatives.
export async function DELETE(req: Request) {
  const no = denied(req);
  if (no) return no;
  await setLogo(getContext(), null).catch(() => {});
  return NextResponse.json({ ok: true, message: 'Logo removed' });
}
