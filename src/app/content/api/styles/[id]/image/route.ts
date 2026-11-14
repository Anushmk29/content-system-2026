import { getContext, getStyleImage } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

// GET /content/api/styles/:id/image?page=0 → one page of the example (PNG).
export const GET = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const page = Math.max(0, Math.floor(Number(new URL(req.url).searchParams.get('page')) || 0));
  const png = await getStyleImage(getContext(), (await params).id, page);
  if (!png) return new Response('not found', { status: 404 });
  return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=86400' } });
});
