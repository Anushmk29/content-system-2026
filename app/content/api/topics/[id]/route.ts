import { NextResponse } from 'next/server';
import { getContext, decideTopic, topicAngles, pickAngle, type TopicDecision } from '@pratapai/content-pipeline';
import { handle } from '../../guard';

// PATCH /content/api/topics/:id → operator's draft/drop decision on a scored topic,
// or the angle the draft will argue.
// Body: { decision: 'selected' | 'dropped' }  |  { angle: 0-4 | null }
export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = (await req.json()) as { decision?: string; angle?: unknown };
  const result = 'angle' in body
    ? await pickAngle(getContext(), id, body.angle)
    : await decideTopic(getContext(), id, body.decision as TopicDecision);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
});

// POST /content/api/topics/:id → (re)find the topic's 5 Contrast-Formula angles (one AI call).
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const angles = await topicAngles(getContext(), id);
  return NextResponse.json({ ok: true, message: `${angles.length} angles found`, angles });
});
