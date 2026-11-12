import { NextResponse } from 'next/server';
import { getContext, createTodo } from '@pratapai/content-pipeline';
import { handle } from '../guard';

export const POST = handle(async (req: Request) =>
  NextResponse.json(await createTodo(getContext(), await req.json()), { status: 201 }));
