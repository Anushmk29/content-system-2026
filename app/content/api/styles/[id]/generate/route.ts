import { NextResponse } from 'next/server';
import { getContext, generateCreative, isPlacement, toPdf } from '@pratapai/content-pipeline';
import { denied } from '../../../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST /content/api/styles/:id/generate { placement, text, cta?, fresh?, brief? }
// → { images: PNG data URLs (one per "---" slide), costUsd, background, layouts, pdf (LinkedIn carousels) }.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const no = denied(req);
  if (no) return no;
  try {
    const b = (await req.json()) as Record<string, unknown>;
    if (!isPlacement(b.placement)) throw new Error('unknown placement');
    const r = await generateCreative(getContext(), {
      styleId: (await params).id,
      placement: b.placement,
      text: typeof b.text === 'string' ? b.text : '',
      cta: typeof b.cta === 'string' ? b.cta : undefined,
      fresh: b.fresh === true,
      brief: typeof b.brief === 'string' ? b.brief : undefined,
    });
    // LinkedIn carousels are posted as a PDF document.
    const pdf = b.placement === 'linkedin' && r.images.length > 1 ? (await toPdf(r.images)).toString('base64') : null;
    return NextResponse.json({
      ok: true, costUsd: r.costUsd, background: r.background, layouts: r.layouts, warnings: r.warnings,
      images: r.images.map((png) => `data:image/png;base64,${png.toString('base64')}`),
      pdf: pdf && `data:application/pdf;base64,${pdf}`,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
