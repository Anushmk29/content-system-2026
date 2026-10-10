import { NextResponse } from 'next/server';
import { getContext, decideSignal } from '@pratapai/content-pipeline';
import { handle } from '../../guard';

// PATCH /content/api/signals/:id → the operator picks one waiting signal.
// Body: { action: 'use' }  turn just this signal into a topic, queued for drafting
//     | { action: 'drop' } shelve it
export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { action } = (await req.json()) as { action?: string };
  const result = await decideSignal(getContext(), id, action as 'use' | 'drop');
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
});
