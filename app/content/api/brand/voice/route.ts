import { NextResponse } from 'next/server';
import { getContext, extractVoice, importOwnPosts, DECODE_PLATFORMS, type DecodePlatform } from '@pratapai/content-pipeline';
import { denied } from '../../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // an Apify import can take a few minutes

// POST /content/api/brand/voice
//   { samples: string[] }                → { voice } a voice guide written from the posts (not saved)
//   { platform, handle }                 → { samples } the account's best recent posts (Apify)
export async function POST(req: Request) {
  const no = denied(req);
  if (no) return no;
  try {
    const b = (await req.json()) as { samples?: unknown; platform?: unknown; handle?: unknown };
    const ctx = getContext();
    if (Array.isArray(b.samples)) {
      const r = await extractVoice(ctx, b.samples.filter((s): s is string => typeof s === 'string'));
      return NextResponse.json({ ok: true, ...r, message: 'Voice guide written — edit it, then save' });
    }
    const platform = String(b.platform) as DecodePlatform;
    if (!DECODE_PLATFORMS.includes(platform)) throw new Error('Pick a platform.');
    const r = await importOwnPosts(ctx, platform, typeof b.handle === 'string' ? b.handle : '');
    return NextResponse.json({ ok: true, ...r, message: `Imported ${r.samples.length} posts` });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
