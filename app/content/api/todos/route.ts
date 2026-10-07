import { NextResponse } from 'next/server';
import { getContext, listTodos, createTodo } from '@pratapai/content-pipeline';
import { denied } from '../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get('status') ?? undefined;
  try {
    return NextResponse.json(await listTodos(getContext(), status));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const no = denied(req);
  if (no) return no;
  try {
    const body = await req.json();
    const todo = await createTodo(getContext(), body);
    return NextResponse.json(todo, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
