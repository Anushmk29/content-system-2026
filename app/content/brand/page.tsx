// Brand kit — who the client is, their voice, audience, themes, offers and look. Every draft
// and creative reads it, so this is the one place to change how the content sounds and looks.
import { getContext, loadBrand, listFonts, CURATED_FONTS, EMPTY_BRAND, type Brand, type FontRow } from '@pratapai/content-pipeline';
import { PageHead, NeedsDb } from '../ui/viz';
import { BrandKit } from '../ui/BrandKit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function BrandPage() {
  let kit: Brand | null = null, fonts: FontRow[] = [], error: string | null = null;
  try {
    const ctx = getContext();
    const b = await loadBrand(ctx);
    [kit, fonts] = [b.saved ? b : EMPTY_BRAND, await listFonts(ctx)];
  } catch (e) { error = (e as Error).message; }
  const head = (
    <PageHead crumb="brand kit" title="Brand kit."
      sub="How your content sounds and looks. Every draft is written in this voice for this audience, and every creative carries your logo, fonts and colours." />
  );
  if (!kit) return (<>{head}<NeedsDb error={error} /></>);
  return (<>{head}<BrandKit kit={kit} fonts={fonts} curated={CURATED_FONTS} /></>);
}
