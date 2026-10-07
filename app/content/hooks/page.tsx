// Hook library — every opening line Decode found, ranked by how far it beat its account's usual.
// Drafting already uses the winners; here the client browses, copies, or makes their own version.
import { getContext, listHooks, listStyles, type HookRow } from '@pratapai/content-pipeline';
import { PageHead, NeedsDb } from '../ui/viz';
import { Hooks } from '../ui/Hooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function HooksPage() {
  let hooks: HookRow[] | null = null;
  let styles: { id: string; name: string }[] = [];
  let error: string | null = null;
  try {
    [hooks, styles] = await Promise.all([
      listHooks(getContext(), { limit: 500 }),
      listStyles(getContext()).then((r) => r.map((s) => ({ id: s.id, name: s.name }))),
    ]);
  } catch (e) { error = (e as Error).message; }
  const head = (
    <PageHead crumb="hooks" title="Openings that worked."
      sub="Every first line Decode broke down, ranked by how far the post beat that account’s usual. New drafts borrow the shape of the winners automatically; open any post to rewrite it with one." />
  );
  if (!hooks) return (<>{head}<NeedsDb error={error} /></>);
  return (
    <>
      {head}
      {hooks.length
        ? <Hooks hooks={hooks} styles={styles} />
        : <p className="empty">No hooks yet. Run a Decode on your competitors and their opening lines land here.</p>}
    </>
  );
}
