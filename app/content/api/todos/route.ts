import { NextResponse } from 'next/server';
import { getContext, createTodo } from '@pratapai/content-pipeline';
import { denied } from '../guard';

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
