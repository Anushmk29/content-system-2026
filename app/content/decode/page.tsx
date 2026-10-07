// Decode — the competitor spy. Apify pulls competitors' public posts, the LLM sorts them into
// formats and breaks each one down, and the page shows what works for them and what we
// should make of it. Spec: docs/DESIGN-GUIDE.md §6–§6e.
import { getContext, getDecodeView, listStyles, type DecodeView } from '@pratapai/content-pipeline';
import { loadHealth, params, type SearchParams } from '../data';
import { PageHead, Section, NeedsDb } from '../ui/viz';
import { Decode } from '../ui/Decode';
import { Competitors } from '../ui/Competitors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function DecodePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  let view: DecodeView | null = null;
  let styles: { id: string; name: string }[] = [];
  let error: string | null = null;
  try {
    [view, styles] = await Promise.all([
      getDecodeView(getContext(), sp.run),
      listStyles(getContext()).then((r) => r.map((s) => ({ id: s.id, name: s.name }))),
    ]);
  } catch (e) { error = (e as Error).message; }
  const apify = (await loadHealth()).adapters.find((a) => a.id === 'apify');
  const head = (
    <PageHead crumb="decode" title="Decode the competition."
      sub={view?.run
        ? `${view.run.total.toLocaleString('en-US')} public posts from ${view.run.competitor_ids.length} competitor${view.run.competitor_ids.length === 1 ? '' : 's'}. Apify collected them, the AI sorted each into a format and broke it down, and every post is plotted by reactions and conversation.`
        : 'Add the competitors to watch, then decode: Apify collects their public posts and the AI shows which formats work for them, and which ones we’re not using yet.'} />
  );
  if (!view) return (<>{head}<NeedsDb error={error} /></>);
  const competitors = (
    <Section eyebrow="Who we watch" title="Competitors"
      meta={`${view.competitors.filter((c) => c.active).length} active · public posts only, no logins · a handle or the page URL works`}>
      <Competitors list={view.competitors} />
    </Section>
  );

  return (
    <>
      {head}
      {apify?.state !== 'ok' && (
        <p className="mono" style={{ fontSize: 12, color: 'var(--warn)', margin: '-8px 0 20px' }}>
          Apify {apify?.state ?? 'unconfigured'}: {apify?.message}. Add CONTENT_APIFY_TOKEN to .env and restart to start decoding.
        </p>
      )}
      {view.competitors.length === 0 && competitors}
      <Decode view={view} initial={{ f: sp.f, v: sp.v, by: sp.by }} apifyReady={apify?.state === 'ok'} styles={styles} />
      {view.competitors.length > 0 && competitors}
    </>
  );
}
