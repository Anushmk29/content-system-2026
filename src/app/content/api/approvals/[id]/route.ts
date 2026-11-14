import { NextResponse } from 'next/server';
import { getContext, applyApprovalDecision } from '@pratapai/content-pipeline';
import { isApprovalAction } from '@pratapai/content-pipeline/core';
import { handle } from '@/app/content/_lib/api-guard';

// PATCH /content/api/approvals/:id → operator's approval decision from the dashboard
// Body: { action: 'approve'|'changes'|'reject', note?, reasons?: string[] }
export const maxDuration = 60; // a change request may rewrite the post (one LLM call)
export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = (await req.json()) as { action?: string; note?: string; reasons?: unknown };
  if (typeof body.action !== 'string' || !isApprovalAction(body.action)) {
    return NextResponse.json({ ok: false, message: `Unknown action "${body.action}".` }, { status: 400 });
  }
  const result = await applyApprovalDecision(getContext(), {
    itemId: id,
    action: body.action,
    decidedBy: 'dashboard',
    note: typeof body.note === 'string' ? body.note : null,
    reasons: body.reasons,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}, { key: 'message' });
