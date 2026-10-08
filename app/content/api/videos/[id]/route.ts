import { NextResponse } from 'next/server';
import { getContext, transcribeVideo } from '@pratapai/content-pipeline';
import { handle } from '../../guard';

// Downloading the audio + whisper on the server can take a few minutes for a long video.
export const maxDuration = 600;

// POST /content/api/videos/:id → transcribe (or retry) one decoded video now.
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const result = await transcribeVideo(getContext(), id);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}, { key: 'message' });
