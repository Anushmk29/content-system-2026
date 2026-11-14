import { NextResponse } from 'next/server';
import { getContext, recordHumanLabel } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

// POST /content/api/decisions → the operator's own label / correction for a decision.
// Body: { task: 'topic_score' | 'qc_signals', subjectId, answer, workspace? }
//   topic_score answer: { leadIntent, reach, brandFit, proof, repurpose (1-5), pillar?, funnelStage? }
export const POST = handle(async (req: Request) => {
  const ctx = getContext();
  const b = (await req.json()) as { task?: string; subjectId?: string; answer?: unknown; workspace?: string };
  await recordHumanLabel(ctx, { task: b.task ?? '', subjectId: b.subjectId ?? '', answer: b.answer, workspace: b.workspace });
  return NextResponse.json({ ok: true }, { status: 201 });
}, { admin: true });
