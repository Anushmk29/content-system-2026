import { NextResponse } from 'next/server';
import { getContext, listCreatives, createCreative } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

// Creative Check (its own tab). GET → every creative with its latest check. POST { name, platform, funnelStage, hook, body, cta } → a new one.
export const GET = handle(async () => NextResponse.json({ ok: true, creatives: await listCreatives(getContext()) }));

export const POST = handle(async (req: Request) => {
  const creative = await createCreative(getContext(), (await req.json()) as Record<string, unknown>);
  return NextResponse.json({ ok: true, creative, message: 'Creative added' }, { status: 201 });
});
