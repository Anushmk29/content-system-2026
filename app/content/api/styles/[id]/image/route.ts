import { getContext, getStyleImage, previewStyle } from '@pratapai/content-pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /content/api/styles/:id/image?kind=source|plate|preview&layout=<carousel layout id> → the stored PNG,
// or (preview) the layout template drawn with the example's own words.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const q = new URL(req.url).searchParams;
  const id = (await params).id, layout = q.get('layout') || 'main';
  const png = q.get('kind') === 'preview'
    ? await previewStyle(getContext(), id, layout).catch(() => null)
    : await getStyleImage(getContext(), id, q.get('kind') === 'plate' ? 'plate' : 'source', layout);
  if (!png) return new Response('not found', { status: 404 });
  return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=86400' } });
}
