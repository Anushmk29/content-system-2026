import { NextResponse } from 'next/server';
import { getContext, draftCarousel } from '@pratapai/content-pipeline';
import { handle } from '../../../guard';

export const maxDuration = 120;

// POST /content/api/styles/:id/draft { topic, slides? } → { text, cta } written to the saved carousel's structure.
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const b = (await req.json()) as Record<string, unknown>;
  const r = await draftCarousel(getContext(), {
    styleId: (await params).id,
    topic: typeof b.topic === 'string' ? b.topic : '',
    slides: typeof b.slides === 'number' ? b.slides : undefined,
  });
  return NextResponse.json({ ok: true, ...r });
});
