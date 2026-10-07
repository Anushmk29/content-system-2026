import { NextResponse } from 'next/server';
import { getContext, getSystemHealth } from '@pratapai/content-pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const health = await getSystemHealth(getContext());
  // 200 always — the body carries the real state; degraded ≠ HTTP error.
  return NextResponse.json(health);
}
