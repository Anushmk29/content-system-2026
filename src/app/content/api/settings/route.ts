import { NextResponse } from 'next/server';
import { buildContext, settingsView, saveSettings, logAction } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

export const dynamic = 'force-dynamic';
const response = async () => NextResponse.json({ ok: true, ...await settingsView(buildContext().db) }, { headers: { 'cache-control': 'no-store' } });

export const GET = handle(response, { admin: true });

// This is the admin's configuration exception; content editing remains view-only for admins.
export const PATCH = handle(async (req: Request) => {
  if (Number(req.headers.get('content-length') ?? 0) > 64 * 1024) {
    return NextResponse.json({ ok: false, error: 'Settings are too large (64 KB max).' }, { status: 413 });
  }
  const text = await req.text();
  if (Buffer.byteLength(text) > 64 * 1024) return NextResponse.json({ ok: false, error: 'Settings are too large (64 KB max).' }, { status: 413 });
  let patch: unknown;
  try { patch = JSON.parse(text); } catch { return NextResponse.json({ ok: false, error: 'Send valid JSON.' }, { status: 400 }); }
  const ctx = buildContext();
  await saveSettings(ctx.db, patch);
  await logAction(ctx, { role: 'admin', method: 'PATCH', path: '/content/api/settings' });
  return response();
}, { admin: true });
