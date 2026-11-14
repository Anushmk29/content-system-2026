import { NextResponse } from 'next/server';
import { getContext, updateTodo, deleteTodo } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

type Params = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, { params }: Params) => {
  const updated = await updateTodo(getContext(), (await params).id, await req.json());
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(updated);
});

export const DELETE = handle(async (_req: Request, { params }: Params) => {
  await deleteTodo(getContext(), (await params).id);
  return NextResponse.json({ ok: true });
});
