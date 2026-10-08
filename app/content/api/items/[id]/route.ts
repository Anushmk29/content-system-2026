import { NextResponse } from 'next/server';
import { getContext, editItemCopy, planItem, rewriteWithHook, applyHookOption } from '@pratapai/content-pipeline';
import { handle } from '../../guard';

export const maxDuration = 120;

// PATCH /content/api/items/:id → edit copy before approval, rewrite it with a library hook, or plan the posting time.
// Body: { hook?, body?, cta? }  |  { hookId }  |  { swapHook, pattern? }  |  { plannedAt: ISO string }
// hookId answers with 5 scored openings (best applied); swapHook applies another one, no AI call.
export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = (await req.json()) as Record<string, unknown>;
  const result = 'plannedAt' in body ? await planItem(getContext(), id, body.plannedAt)
    : 'hookId' in body ? await rewriteWithHook(getContext(), id, body.hookId)
    : 'swapHook' in body ? await applyHookOption(getContext(), id, body.swapHook, body.pattern)
    : await editItemCopy(getContext(), id, body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}, { key: 'message' });
