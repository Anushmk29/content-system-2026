import { NextResponse } from 'next/server';
import { getContext, draftCarousel } from '@pratapai/content-pipeline';
import { denied } from '../../../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST /content/api/styles/:id/draft { topic, slides? } → { text, cta } written to the saved carousel's structure.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const no = denied(req);
  if (no) return no;
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const r = await draftCarousel(getContext(), {
      styleId: (await params).id,
      topic: typeof b.topic === 'string' ? b.topic : '',
      slides: typeof b.slides === 'number' ? b.slides : undefined,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
