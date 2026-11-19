import { NextResponse } from 'next/server';
import { getContext, saveBrand, type BrandPatch } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

export const maxDuration = 60; // a newly chosen Google font is downloaded on save

// PATCH /content/api/brand { any brand kit fields } → save (fields left out are kept).
export const PATCH = handle(async (req: Request) => {
  const brand = await saveBrand((await getContext()), (await req.json()) as BrandPatch);
  return NextResponse.json({ ok: true, brand, message: 'Saved' });
});
