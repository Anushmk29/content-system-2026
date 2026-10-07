import { NextResponse } from 'next/server';
import { getContext, seedQcExamples } from '@pratapai/content-pipeline';
import { deniedAdmin as denied } from '../../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /content/api/decisions/seed → LLM writes labelled practice drafts for the QC
// checks, queued for your review. Body: { count?: 1-25 } (default 20).
// Spends LLM tokens on training data: admin only.
export async function POST(req: Request) {
  const ctx = getContext();
  const no = denied(req);
  if (no) return no;
  try {
    const body = (await req.json().catch(() => ({}))) as { count?: number };
    return NextResponse.json({ ok: true, ...(await seedQcExamples(ctx, body.count)) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
