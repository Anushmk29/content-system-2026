import { NextResponse } from 'next/server';
import { getContext } from '@pratapai/content-pipeline';
import { configProblem } from '../../_lib/auth';

export const dynamic = 'force-dynamic';

// GET /content/api/healthz → 200 when config is valid and the database answers, else 503. No login (middleware
// lets it through) and no details, so an uptime monitor or load balancer can poll it.
export async function GET() {
  const db = configProblem() ? null : await getContext().then((ctx) => ctx.db.healthCheck()).catch(() => null);
  const up = db?.state === 'ok';
  return NextResponse.json({ ok: up }, { status: up ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
