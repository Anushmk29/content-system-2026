import { NextResponse } from 'next/server';
import { getContext, getCreative, updateCreative, deleteCreative, setCheckFeedback, applyCheckFix } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

type P = { params: Promise<{ id: string }> };

// GET → the creative, its media list, version hash and every check (newest first). Poll it while a check runs.
export const GET = handle(async (_req: Request, { params }: P) => {
  const d = await getCreative((await getContext()), (await params).id);
  if (!d) throw new Error('Not found.');
  return NextResponse.json({ ok: true, ...d });
});

// PATCH { name?, platform?, funnelStage?, hook?, body?, cta? }            → edit the copy
// PATCH { apply: { checkId, recId, replacement? } }                      → use a suggested hook/caption/CTA
// PATCH { feedback: { checkId, recId, verdict, note? } }                 → rate a recommendation
export const PATCH = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const b = (await req.json()) as Record<string, unknown>;
  const s = (o: unknown, k: string) => { const v = (o as Record<string, unknown> | null)?.[k]; return typeof v === 'string' ? v : ''; };
  if (b.apply) {
    const replacement = Number((b.apply as Record<string, unknown>).replacement ?? 0);
    const creative = await applyCheckFix((await getContext()), s(b.apply, 'checkId'), s(b.apply, 'recId'), Number.isInteger(replacement) && replacement >= 0 ? replacement : 0);
    if (creative.id !== id) throw new Error('Not found.');
    return NextResponse.json({ ok: true, creative, message: 'Fix applied. Re-check to see if it worked.' });
  }
  if (b.feedback) {
    await setCheckFeedback((await getContext()), s(b.feedback, 'checkId'), s(b.feedback, 'recId'), s(b.feedback, 'verdict'), s(b.feedback, 'note'));
    return NextResponse.json({ ok: true, message: 'Thanks, noted' });
  }
  const creative = await updateCreative((await getContext()), id, b);
  return NextResponse.json({ ok: true, creative, message: 'Saved' });
});

export const DELETE = handle(async (_req: Request, { params }: P) => {
  await deleteCreative((await getContext()), (await params).id);
  return NextResponse.json({ ok: true, message: 'Creative deleted with its checks' });
});
