import { NextResponse } from 'next/server';
import { getContext, editItemCopy, planItem, rewriteWithHook, applyHookOption, setItemChannels, resubmitItem, updateClaim } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

export const maxDuration = 120;

// PATCH /content/api/items/:id → edit copy before approval, rewrite it with a library hook, or plan the posting time.
// Body: { hook?, body?, cta? } | { hookId } | { swapHook, pattern? } | { plannedAt } | { channels } | { resubmit: true } | { claim: { id, action, ... } }
// hookId answers with 5 scored openings (best applied); swapHook applies another one, no AI call.
export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = (await req.json()) as Record<string, unknown>;
  const result = 'claim' in body ? await updateClaim((await getContext()), id, body.claim, req.headers.get('x-content-role'))
    : 'resubmit' in body ? await resubmitItem((await getContext()), id)
    : 'plannedAt' in body ? await planItem((await getContext()), id, body.plannedAt)
    : 'channels' in body ? await setItemChannels((await getContext()), id, body.channels)
    : 'hookId' in body ? await rewriteWithHook((await getContext()), id, body.hookId)
    : 'swapHook' in body ? await applyHookOption((await getContext()), id, body.swapHook, body.pattern)
    : await editItemCopy((await getContext()), id, body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}, { key: 'message' });
