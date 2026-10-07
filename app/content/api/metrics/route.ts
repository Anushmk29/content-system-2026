import { NextResponse } from 'next/server';
import { getContext, recordMetrics } from '@pratapai/content-pipeline';
import { denied } from '../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /content/api/metrics → hand-entered post metrics until an automatic collector exists.
// Body: { itemId, impressions?, reach?, likes?, comments?, shares?, saves?, clicks?, qualifiedEngagement? }
export async function POST(req: Request) {
  const no = denied(req);
  if (no) return no;
  try {
    const { itemId, ...m } = (await req.json()) as Record<string, unknown>;
    if (typeof itemId !== 'string') return NextResponse.json({ ok: false, message: 'itemId is required' }, { status: 400 });
    const result = await recordMetrics(getContext(), itemId, m);
    return NextResponse.json(result, { status: result.ok ? 201 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
