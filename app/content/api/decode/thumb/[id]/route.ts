import { getContext, getPostThumb } from '@pratapai/content-pipeline';
import { handle } from '../../../guard';

// GET /content/api/decode/thumb/:postId → our stored copy of a competitor post's thumbnail (JPEG).
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const jpg = await getPostThumb(getContext(), (await params).id);
  if (!jpg) return new Response('not found', { status: 404 });
  return new Response(new Uint8Array(jpg), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=604800, immutable' } });
});
