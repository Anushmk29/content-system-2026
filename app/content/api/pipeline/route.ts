import { NextResponse } from 'next/server';
import { getContext, getPipelineBoard } from '@pratapai/content-pipeline';

export async function GET() {
  try {
    const board = await getPipelineBoard(getContext());
    return NextResponse.json(board);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
