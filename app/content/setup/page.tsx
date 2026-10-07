// First-run setup: the brand kit one step at a time, then competitors. The layout sends a client
// here until it's finished (brand_kit.onboarded_at).
import { getContext, loadBrand, listFonts, listCompetitors, CURATED_FONTS, EMPTY_BRAND, type Brand, type CompetitorRow, type FontRow } from '@pratapai/content-pipeline';
import { NeedsDb } from '../ui/viz';
import { Setup } from '../ui/Setup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  let kit: Brand | null = null, fonts: FontRow[] = [], competitors: CompetitorRow[] = [], error: string | null = null;
  try {
    const ctx = getContext();
    const b = await loadBrand(ctx);
    [kit, fonts, competitors] = [b.saved ? b : EMPTY_BRAND, await listFonts(ctx), await listCompetitors(ctx)];
  } catch (e) { error = (e as Error).message; }
  if (kit) return <Setup kit={kit} fonts={fonts} curated={CURATED_FONTS} competitors={competitors} />;
  return <main className="setup-fail"><NeedsDb error={error} /></main>;
}
