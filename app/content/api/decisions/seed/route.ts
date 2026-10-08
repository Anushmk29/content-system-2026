import { NextResponse } from 'next/server';
import { getContext, seedQcExamples } from '@pratapai/content-pipeline';
import { handle } from '../../guard';

// POST /content/api/decisions/seed → LLM writes labelled practice drafts for the QC
// checks, queued for your review. Body: { count?: 1-25 } (default 20).
// Spends LLM tokens on training data: admin only.
export const POST = handle(async (req: Request) => {
  const ctx = getContext();
  const body = (await req.json().catch(() => ({}))) as { count?: number };
  return NextResponse.json({ ok: true, ...(await seedQcExamples(ctx, body.count)) }, { status: 201 });
}, { admin: true });
