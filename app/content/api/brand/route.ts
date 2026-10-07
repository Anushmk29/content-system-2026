import { NextResponse } from 'next/server';
import { getContext, saveBrand, type BrandPatch } from '@pratapai/content-pipeline';
import { denied } from '../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // a newly chosen Google font is downloaded on save

// PATCH /content/api/brand { any brand kit fields } → save (fields left out are kept).
export async function PATCH(req: Request) {
  const no = denied(req);
  if (no) return no;
  try {
    const brand = await saveBrand(getContext(), (await req.json()) as BrandPatch);
    return NextResponse.json({ ok: true, brand, message: 'Saved' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
