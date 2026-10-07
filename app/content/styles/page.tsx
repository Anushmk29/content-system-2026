// Styles — reusable visual references. Upload an example creative once; it's analysed into a
// saved style prompt + blank template, so future creatives reuse it without re-analysing.
import { getContext, listStyles, PLACEMENTS, type StyleRow } from '@pratapai/content-pipeline';
import { PageHead, Section, NeedsDb } from '../ui/viz';
import { StyleUpload, StyleCard, type PlacementOpt } from '../ui/Styles';

const PLACEMENT_OPTS: PlacementOpt[] = Object.entries(PLACEMENTS).map(([id, p]) => ({ id, label: p.label, w: p.w, h: p.h }));

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function StylesPage() {
  let styles: StyleRow[] | null = null;
  let error: string | null = null;
  try { styles = await listStyles(getContext()); } catch (e) { error = (e as Error).message; }
  const head = (
    <PageHead crumb="styles" title="Styles."
      sub="Upload a post you like. It’s rebuilt once as your own template, with the same fonts, colours and layout and room for your words. Check it against the example, say what to fix, and every post after that costs nothing to make." />
  );
  if (!styles) return (<>{head}<NeedsDb error={error} /></>);
  return (
    <>
      {head}
      <Section eyebrow="New" title="Add a style" meta="PNG, JPG or WebP · up to 15 MB · about 10–40¢ once">
        <StyleUpload />
      </Section>
      <Section eyebrow="Library" title="Saved styles" meta={`${styles.length} saved`}>
        {styles.length === 0
          ? <p className="muted">No styles yet.</p>
          : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', gap: 20 }}>
              {styles.map((s) => <StyleCard key={`${s.id}:${s.name}`} s={s} placements={PLACEMENT_OPTS} />)}
            </div>}
      </Section>
    </>
  );
}
