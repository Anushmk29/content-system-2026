import { NextResponse } from 'next/server';
import { buildContext, settingsView, saveSettings } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

export const dynamic = 'force-dynamic';
const response = async () => NextResponse.json({ ok: true, ...await settingsView(buildContext().db) }, { headers: { 'cache-control': 'no-store' } });

// Client and admin both manage keys (bring your own key). denied() logs every change with its role.
export const GET = handle(response);

export const PATCH = handle(async (req: Request) => {
  if (Number(req.headers.get('content-length') ?? 0) > 64 * 1024) {
    return NextResponse.json({ ok: false, error: 'Settings are too large (64 KB max).' }, { status: 413 });
  }
  const text = await req.text();
  if (Buffer.byteLength(text) > 64 * 1024) return NextResponse.json({ ok: false, error: 'Settings are too large (64 KB max).' }, { status: 413 });
  let patch: unknown;
  try { patch = JSON.parse(text); } catch { return NextResponse.json({ ok: false, error: 'Send valid JSON.' }, { status: 400 }); }
  await saveSettings(buildContext().db, patch);
  return response();
}, { adminCanWrite: true });
