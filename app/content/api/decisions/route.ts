import { NextResponse } from 'next/server';
import { getContext, recordHumanLabel } from '@pratapai/content-pipeline';
import { deniedAdmin as denied } from '../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /content/api/decisions → the operator's own label / correction for a decision.
// Body: { task: 'topic_score' | 'qc_signals', subjectId, answer, workspace? }
//   topic_score answer: { leadIntent, reach, brandFit, proof, repurpose (1-5), pillar?, funnelStage? }
export async function POST(req: Request) {
  const no = denied(req);
  if (no) return no;
  const ctx = getContext();
  try {
    const b = (await req.json()) as { task?: string; subjectId?: string; answer?: unknown; workspace?: string };
    await recordHumanLabel(ctx, { task: b.task ?? '', subjectId: b.subjectId ?? '', answer: b.answer, workspace: b.workspace });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
