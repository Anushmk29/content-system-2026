import { NextResponse } from 'next/server';
import { getContext, decideTopic, topicAngles, pickAngle, setTopicPlan, type TopicDecision } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

// PATCH /content/api/topics/:id → operator's draft/drop decision on a scored topic,
// or the angle the draft will argue.
// Body: { decision: 'selected' | 'dropped' }  |  { angle: 0-4 | null }
//     | { platforms?: string[] | null, frameworks?: { [platform]: frameworkId } }  (the idea card's plan)
export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = (await req.json()) as { decision?: string; angle?: unknown; platforms?: unknown; frameworks?: unknown };
  const result = 'angle' in body ? await pickAngle((await getContext()), id, body.angle)
    : 'platforms' in body || 'frameworks' in body ? await setTopicPlan((await getContext()), id, body)
    : await decideTopic((await getContext()), id, body.decision as TopicDecision);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
});

// POST /content/api/topics/:id → (re)find the topic's 5 Contrast-Formula angles (one AI call).
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const angles = await topicAngles((await getContext()), id);
  return NextResponse.json({ ok: true, message: `${angles.length} angles found`, angles });
});
