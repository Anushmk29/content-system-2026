import { NextResponse } from 'next/server';
import { getContext, markFilmed, markUploaded } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

// PATCH /content/api/scripts/:id → a Short script's filming track.
// Body: { filmed: boolean }  |  { uploadedUrl: 'https://youtube.com/shorts/…' }
export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = (await req.json()) as { filmed?: unknown; uploadedUrl?: unknown };
  const result = 'uploadedUrl' in body
    ? await markUploaded((await getContext()), id, body.uploadedUrl)
    : await markFilmed((await getContext()), id, body.filmed === true);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}, { key: 'message' });
