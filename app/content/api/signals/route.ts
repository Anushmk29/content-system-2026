import { NextResponse } from 'next/server';
import { getContext, addSignal } from '@pratapai/content-pipeline';
import { denied } from '../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /content/api/signals → operator captures a raw signal from the dashboard.
// The Research module turns it into a scored topic on its next run. Body:
// { rawText, channel?, sourceUrl? }
export async function POST(req: Request) {
  const no = denied(req);
  if (no) return no;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const row = await addSignal(getContext(), {
      rawText: typeof body.rawText === 'string' ? body.rawText : '',
      channel: typeof body.channel === 'string' ? body.channel : null,
      sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : null,
    });
    return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
