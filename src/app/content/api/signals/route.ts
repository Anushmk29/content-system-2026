import { NextResponse } from 'next/server';
import { getContext, addSignal } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

// POST /content/api/signals → operator captures a raw signal from the dashboard.
// The Research module turns it into a scored topic on its next run. Body:
// { rawText, channel?, sourceUrl? }
export const POST = handle(async (req: Request) => {
  const body = (await req.json()) as Record<string, unknown>;
  const row = await addSignal((await getContext()), {
    rawText: typeof body.rawText === 'string' ? body.rawText : '',
    channel: typeof body.channel === 'string' ? body.channel : null,
    sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : null,
  });
  return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
});
