// Brand kit — who the client is, their voice, audience, themes, offers and look. Every draft
// and creative reads it, so this is the one place to change how the content sounds and looks.
import { getContext, loadBrand, listFonts, getPhotos, CURATED_FONTS, EMPTY_BRAND, type Brand, type FontRow } from '@pratapai/content-pipeline';
import { PageHead, NeedsDb } from '@/app/content/_components/viz';
import { BrandKit } from '@/app/content/brand/_components/BrandKit';

export default async function BrandPage() {
  let kit: Brand | null = null, fonts: FontRow[] = [], photos = 0, error: string | null = null;
  try {
    const ctx = await getContext();
    const b = await loadBrand(ctx);
    [kit, fonts, photos] = [b.saved ? b : EMPTY_BRAND, await listFonts(ctx), (await getPhotos(ctx)).length];
  } catch (e) { error = (e as Error).message; }
  const head = (
    <PageHead title="Brand kit"
      sub="How your posts sound and look. Every draft follows this." />
  );
  if (!kit) return (<>{head}<NeedsDb error={error} /></>);
  return (<>{head}<BrandKit kit={kit} fonts={fonts} curated={CURATED_FONTS} photos={photos} /></>);
}
