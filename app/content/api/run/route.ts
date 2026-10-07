import { NextResponse } from 'next/server';
import { getContext, runModules, MODULES } from '@pratapai/content-pipeline';
import { denied } from '../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /content/api/run  → run the whole pipeline once (also wire this to a cron).
// Protected by CONTENT_RUN_SECRET when set: send it as `x-content-secret`.
export async function POST(req: Request) {
  const ctx = getContext();
  const no = denied(req);
  if (no) return no;
  const records = await runModules(MODULES, ctx);
  return NextResponse.json(records);
}
