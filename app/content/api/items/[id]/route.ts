import { NextResponse } from 'next/server';
import { getContext, editItemCopy, planItem, rewriteWithHook } from '@pratapai/content-pipeline';
import { denied } from '../../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// PATCH /content/api/items/:id → edit copy before approval, rewrite it with a library hook, or plan the posting time.
// Body: { hook?, body?, cta? }  |  { hookId }  |  { plannedAt: ISO string }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const no = denied(req);
  if (no) return no;
  const { id } = await params;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const result = 'plannedAt' in body ? await planItem(getContext(), id, body.plannedAt)
      : 'hookId' in body ? await rewriteWithHook(getContext(), id, body.hookId)
      : await editItemCopy(getContext(), id, body);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
