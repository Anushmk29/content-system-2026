import { NextResponse } from 'next/server';
import { getContext, applyApprovalDecision, core } from '@pratapai/content-pipeline';
import { denied } from '../../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PATCH /content/api/approvals/:id → operator's approval decision from the dashboard
// Body: { action: 'approve'|'changes'|'reject', note? }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const no = denied(req);
  if (no) return no;
  const { id } = await params;
  try {
    const body = (await req.json()) as { action?: string; note?: string };
    if (typeof body.action !== 'string' || !core.isApprovalAction(body.action)) {
      return NextResponse.json({ ok: false, message: `Unknown action "${body.action}".` }, { status: 400 });
    }
    const result = await applyApprovalDecision(getContext(), {
      itemId: id,
      action: body.action,
      decidedBy: 'dashboard',
      note: typeof body.note === 'string' ? body.note : null,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
