import { NextResponse } from 'next/server';
import { getContext } from '@pratapai/content-pipeline';

export const dynamic = 'force-dynamic';

// GET /content/api/healthz → 200 when the app can reach its database, else 503. No login (middleware
// lets it through) and no details, so an uptime monitor or load balancer can poll it.
export async function GET() {
  const db = await getContext().db.healthCheck().catch(() => null);
  const up = db?.state === 'ok';
  return NextResponse.json({ ok: up }, { status: up ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
