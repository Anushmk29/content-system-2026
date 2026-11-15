// Examples — designs you like (an image, or a carousel's pages), kept as they are. The image model
// recreates one with your words and brand: here with "Make one", or on any post's creative panel.
import { getContext, listStyles, ensureStarterExamples, POST_FORMATS, type StyleRow } from '@pratapai/content-pipeline';
import Link from 'next/link';
import { PageHead, Section, NeedsDb } from '@/app/content/_components/viz';
import { StyleUpload, StyleCard, type VisualTargets } from '@/app/content/styles/_components/Styles';

const LABEL: Record<string, string> = { linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', x: 'X' };
const targets = (k: 'image' | 'carousel') => Object.entries(POST_FORMATS)
  .filter(([, fs]) => fs.some((f) => f.id === k)).map(([id]) => ({ id, label: LABEL[id] ?? id }));
const TARGETS: VisualTargets = { image: targets('image'), carousel: targets('carousel') };

export default async function StylesPage() {
  let styles: StyleRow[] | null = null;
  let error: string | null = null;
  try {
    const ctx = getContext();
    await ensureStarterExamples(ctx).catch((e) => console.warn('starter examples', (e as Error).message));
    styles = await listStyles(ctx);
  } catch (e) { error = (e as Error).message; }
  const head = (
    <PageHead title="Design examples"
      sub="Designs you like. The AI recreates them with your words and brand.">
      <Link href="/content/design" className="btn btn-primary">Create visuals</Link>
    </PageHead>
  );
  if (!styles) return (<>{head}<NeedsDb error={error} /></>);
  return (
    <>
      {head}
      <Section eyebrow="New" title="Add an example" meta="PNG, JPG or WebP: one image, or every page of a carousel. About 1¢, once.">
        <StyleUpload />
      </Section>
      <Section eyebrow="Library" title={`Your examples (${styles.length})`}>
        {styles.length === 0
          ? <p className="muted">No examples yet.</p>
          : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', gap: 20 }}>
              {styles.map((s) => <StyleCard key={`${s.id}:${s.name}`} s={s} targets={TARGETS} />)}
            </div>}
      </Section>
    </>
  );
}
