import { NextResponse } from 'next/server';
import { getContext, getSystemHealth } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

export const GET = handle(async (req: Request) => {
  const health = await getSystemHealth(getContext());
  // 200 always — the body carries the real state; degraded ≠ HTTP error. Uptime probes use /healthz.
  // Adapter and module error text is for the admin; everyone else gets the overall state.
  if (req.headers.get('x-content-role') !== 'admin') return NextResponse.json({ overall: health.overall, checkedAt: health.checkedAt });
  return NextResponse.json(health);
});
