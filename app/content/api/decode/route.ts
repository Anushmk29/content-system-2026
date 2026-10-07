import { NextResponse } from 'next/server';
import { getContext, startDecode } from '@pratapai/content-pipeline';
import { denied } from '../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /content/api/decode → start a competitor-spy run (or resume one). Returns at once;
// the page then polls GET /content/api/decode/:run?after=<seq>.
// Body: { competitorIds?, platforms?, lookbackDays?, postCap?, resumeRunId? }  |  { self: true } = refresh own results
export async function POST(req: Request) {
  const no = denied(req);
  if (no) return no;
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);
    const run = await startDecode(getContext(), {
      competitorIds: strings(b.competitorIds),
      platforms: strings(b.platforms),
      lookbackDays: typeof b.lookbackDays === 'number' ? b.lookbackDays : undefined,
      postCap: typeof b.postCap === 'number' ? b.postCap : undefined,
      resumeRunId: typeof b.resumeRunId === 'string' ? b.resumeRunId : undefined,
      self: b.self === true,
    });
    return NextResponse.json({ ok: true, run, message: b.self === true ? 'Refreshing your results, takes a few minutes' : 'Decoding…' }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
