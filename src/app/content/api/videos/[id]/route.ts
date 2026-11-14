import { NextResponse } from 'next/server';
import { getContext, transcribeVideo, analyzeVideo, useVideoIdea } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

// Downloading the audio + whisper on the server can take a few minutes for a long video.
export const maxDuration = 600;

// POST /content/api/videos/:id → transcribe (or retry) one decoded video now.
//   { analyze: true, fresh? } → why it worked + two ideas (one LLM call + Jev).
//   { useIdea: 0 | 1 }       → that idea drafted as our script + post, through QC, into Approvals (~1-3 min).
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { analyze?: boolean; fresh?: boolean; useIdea?: unknown };
  const ctx = getContext();
  const result = body.analyze ? await analyzeVideo(ctx, id, { fresh: body.fresh === true })
    : body.useIdea !== undefined ? await useVideoIdea(ctx, id, body.useIdea)
    : await transcribeVideo(ctx, id);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}, { key: 'message' });
