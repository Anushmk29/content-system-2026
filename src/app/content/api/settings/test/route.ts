import { NextResponse } from 'next/server';
import { getContext, testConnection } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

export const dynamic = 'force-dynamic';

// POST { name } → probe that connection with the saved key ("Configured" ≠ working).
export const POST = handle(async (req: Request) => {
  const { name } = (await req.json().catch(() => ({}))) as { name?: unknown };
  if (typeof name !== 'string') return NextResponse.json({ ok: false, error: 'Send { name }.' }, { status: 400 });
  const r = await testConnection(await getContext(), name);
  return NextResponse.json(r.ok ? { ok: true, message: `Works: ${r.message}` } : { ok: false, error: r.message });
}, { adminCanWrite: true });
