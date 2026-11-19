import { NextResponse } from 'next/server';
import { getContext, createTodo } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

export const POST = handle(async (req: Request) =>
  NextResponse.json(await createTodo((await getContext()), await req.json()), { status: 201 }));
