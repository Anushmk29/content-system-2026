import { NextResponse } from 'next/server';
import { getContext, getItemAsset, saveItemCreative, uploadItemAssets, removeItemAssets } from '@pratapai/content-pipeline';
import { denied } from '../../../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_BYTES = 50 * 1024 * 1024;
type P = { params: Promise<{ id: string }> };

// GET /content/api/items/:id/asset?i=0 → one slide / image / video of the post's creative.
export async function GET(req: Request, { params }: P) {
  const i = Number(new URL(req.url).searchParams.get('i') ?? 0);
  const a = Number.isInteger(i) && i >= 0 ? await getItemAsset(getContext(), (await params).id, i).catch(() => null) : null;
  if (!a) return new Response('not found', { status: 404 });
  return new Response(new Uint8Array(a.bytes), { headers: { 'content-type': a.mime, 'cache-control': 'private, no-cache' } });
}

// POST { styleId, fresh? } → make the creative from a saved style.
// POST multipart (file, file …) → attach the client's own images or one video.
export async function POST(req: Request, { params }: P) {
  const no = denied(req);
  if (no) return no;
  const { id } = await params;
  try {
    if ((req.headers.get('content-type') ?? '').startsWith('multipart/')) {
      const files = (await req.formData()).getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
      if (files.some((f) => f.size > MAX_BYTES)) throw new Error('Each file must be under 50 MB.');
      const r = await uploadItemAssets(getContext(), id, await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer()))));
      return NextResponse.json({ ok: true, message: `Attached ${r.count} file${r.count === 1 ? '' : 's'}` });
    }
    const b = (await req.json()) as Record<string, unknown>;
    if (typeof b.styleId !== 'string' || !b.styleId) throw new Error('Pick a style.');
    const r = await saveItemCreative(getContext(), id, { styleId: b.styleId, fresh: b.fresh === true });
    const n = r.images.length;
    return NextResponse.json({
      ok: true, warnings: r.warnings,
      message: `Made ${n} ${n === 1 ? 'image' : 'slides'} · ${r.costUsd > 0 ? `$${r.costUsd.toFixed(2)}` : 'free'}`,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

// DELETE → the post goes out with no creative (Instagram falls back to plain text slides).
export async function DELETE(req: Request, { params }: P) {
  const no = denied(req);
  if (no) return no;
  try {
    await removeItemAssets(getContext(), (await params).id);
    return NextResponse.json({ ok: true, message: 'Creative removed' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
