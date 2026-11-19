import { NextResponse } from 'next/server';
import { getContext, startCheck } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

type P = { params: Promise<{ id: string }> };

// POST { fresh? } → start a Creative Check. Returns at once (202) with the running check; the page
// polls GET /content/api/check/:id. Unchanged content returns the stored check (200) unless fresh.
export const POST = handle(async (req: Request, { params }: P) => {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const { check, cached } = await startCheck((await getContext()), (await params).id, { fresh: b.fresh === true });
    return NextResponse.json({ ok: true, check, cached, message: cached ? 'Nothing changed since the last check' : 'Checking…' }, { status: cached ? 200 : 202 });
  } catch (e) {
    if ((e as Error).name === 'CheckBusy') return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 409 });
    throw e;
  }
});
