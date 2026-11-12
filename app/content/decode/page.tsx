// Decode — the competitor spy. Apify pulls competitors' public posts, the LLM sorts them into
// formats and breaks each one down, and the page leads with what to make next, then why.
// Spec: docs/DESIGN-GUIDE.md §6–§6f.
import { getContext, getDecodeView, listStyles, type DecodeView } from '@pratapai/content-pipeline';
import { loadHealth, params, type SearchParams } from '../data';
import { PageHead, NeedsDb, Notice } from '../ui/viz';
import { Decode } from '../ui/Decode';

const HOW = [
  'Add the competitors to watch: a handle or the page URL works.',
  'Press ▶ scan: Apify collects their public posts, then the AI sorts each into a format and breaks it down.',
  'Start with Make this next: the strongest formats you haven’t tried, and their best post.',
  '“make my version” writes your own post on the same structure and sends it to Approvals. Nothing is copied word for word.',
];

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
  const health = await loadHealth();
  const apify = health.adapters.find((a) => a.id === 'apify');
  const youtube = health.adapters.find((a) => a.id === 'youtube');
  const head = (
    <PageHead title="Competitors" how={HOW}
      sub={view?.run
        ? 'What works for your competitors, and what to make of it.'
        : 'Add who to watch, then scan their public posts.'} />
  );
  if (!view) return (<>{head}<NeedsDb error={error} /></>);

  return (
    <>
      {head}
      {apify?.state !== 'ok' && youtube?.state !== 'ok' && (
        <div style={{ margin: '-8px 0 20px' }}>
          <Notice plain="Competitor scanning isn’t switched on yet. You can still add who to watch; Autonoetic Edge switches the scan on.">
            Apify {apify?.state ?? 'unconfigured'}: {apify?.message}. Add CONTENT_APIFY_TOKEN to .env and restart to start decoding.
          </Notice>
        </div>
      )}
      <Decode view={view} initial={{ f: sp.f, v: sp.v, by: sp.by }} apifyReady={apify?.state === 'ok'} youtubeReady={youtube?.state === 'ok'} styles={styles} />
    </>
  );
}
