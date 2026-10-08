import { NextResponse } from 'next/server';
import { getContext, recordMetrics } from '@pratapai/content-pipeline';
import { handle } from '../guard';

// POST /content/api/metrics → hand-entered post metrics until an automatic collector exists.
// Body: { itemId, impressions?, reach?, likes?, comments?, shares?, saves?, clicks?, qualifiedEngagement? }
export const POST = handle(async (req: Request) => {
  const { itemId, ...m } = (await req.json()) as Record<string, unknown>;
  if (typeof itemId !== 'string') return NextResponse.json({ ok: false, message: 'itemId is required' }, { status: 400 });
  const result = await recordMetrics(getContext(), itemId, m);
  return NextResponse.json(result, { status: result.ok ? 201 : 400 });
}, { key: 'message' });
