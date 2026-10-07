import { NextResponse } from 'next/server';
import { getContext, createStyle } from '@pratapai/content-pipeline';
import { denied } from '../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_BYTES = 15 * 1024 * 1024;

// POST /content/api/styles (multipart: name, file × 1-10) → analyse the example once and save it as a style.
export async function POST(req: Request) {
  const no = denied(req);
  if (no) return no;
  try {
    const form = await req.formData();
    // One file = a single-post style; several = a carousel style (slides in upload order).
    const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw new Error('choose an image');
    if (files.length > 10) throw new Error('at most 10 slides');
    if (files.some((f) => f.size > MAX_BYTES)) throw new Error('an image is over 15 MB');
    const style = await createStyle(getContext(), {
      name: String(form.get('name') ?? ''),
      images: await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer()))),
    });
    return NextResponse.json({
      ok: true, style,
      message: (style.spec.tpl || Object.values(style.spec.layouts ?? {}).some((l) => l.tpl))
        ? `${files.length > 1 ? `Carousel style saved · ${Object.keys(style.spec.layouts ?? {}).length} layouts` : 'Style saved'} · $${style.analysis_cost_usd.toFixed(2)}. Check the template below and tell it what to fix if anything is off.`
        : style.has_plate ? 'Style saved with the simpler method (the exact layout could not be rebuilt). Try "Rebuild" on it, or another example.' : 'Style saved, but the blank template failed — try another example',
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
