import { NextResponse } from 'next/server';
import { getContext, createStyle } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

export const maxDuration = 300;

const MAX_BYTES = 15 * 1024 * 1024;

// POST /content/api/styles (multipart: name, file × 1-10) → save the image(s) as an example (one vision call describes it).
export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  // One file = a single image; several = a carousel's pages, in upload order.
  const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) throw new Error('choose an image');
  if (files.length > 10) throw new Error('at most 10 pages');
  if (files.some((f) => f.size > MAX_BYTES)) throw new Error('an image is over 15 MB');
  const style = await createStyle((await getContext()), {
    name: String(form.get('name') ?? ''),
    images: await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer()))),
  });
  return NextResponse.json({
    ok: true, style,
    message: `${style.kind === 'carousel' ? `Carousel example saved · ${style.pages} pages` : 'Example saved'} · $${style.analysis_cost_usd.toFixed(2)}`,
  });
});
