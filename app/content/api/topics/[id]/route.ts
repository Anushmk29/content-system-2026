import { NextResponse } from 'next/server';
import { getContext, decideTopic, type TopicDecision } from '@pratapai/content-pipeline';
import { denied } from '../../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PATCH /content/api/topics/:id → operator's draft/drop decision on a scored topic.
// Body: { decision: 'selected' | 'dropped' }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const no = denied(req);
  if (no) return no;
  const { id } = await params;
  try {
    const body = (await req.json()) as { decision?: string };
    const result = await decideTopic(getContext(), id, body.decision as TopicDecision);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
