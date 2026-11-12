// Hook library — every opening line Decode found, ranked by hunt score (then how far it beat its
// account's usual). Drafting already uses the winners; here the client browses, copies, or makes
// their own version. The pattern table is the learning loop: what each kind of opening earns on
// the client's own published posts.
import { getContext, listHooks, listStyles, hookPatternWeights, HOOK_PATTERNS, type HookRow, type PatternWeight } from '@pratapai/content-pipeline';
import { PageHead, NeedsDb, Tile, Chip } from '../ui/viz';
import { Hooks } from '../ui/Hooks';
import { TONE } from '../ui/format';

export default async function HooksPage() {
  let hooks: HookRow[] | null = null;
  let styles: { id: string; name: string }[] = [];
  let weights: PatternWeight[] = [];
  let error: string | null = null;
  try {
    [hooks, styles, weights] = await Promise.all([
      listHooks(getContext(), { limit: 500 }),
      listStyles(getContext()).then((r) => r.map((s) => ({ id: s.id, name: s.name }))),
      hookPatternWeights(getContext()).catch(() => []),
    ]);
  } catch (e) { error = (e as Error).message; }
  const head = (
    <PageHead title="Opening lines"
      sub="The first lines that worked best for competitors. New drafts borrow their shape." />
  );
  if (!hooks) return (<>{head}<NeedsDb error={error} /></>);
  return (
    <>
      {head}
      <Tile title="What works for you" hint="hook patterns on your own posts, last 90 days">
        {weights.length === 0 ? <p className="empty">No results yet. Once your drafted posts are published and their results are in, each kind of opening gets a learned weight here, and drafting leans on the ones that work.</p> : (
          <table className="table">
            <thead><tr><th>Pattern</th><th>Posts</th><th>Learned weight</th><th></th></tr></thead>
            <tbody>
              {weights.map((w) => (
                <tr key={w.pattern}>
                  <td>{w.pattern.replace(/_/g, ' ')} <span className="faint" style={{ fontSize: 12 }}>· {HOOK_PATTERNS[w.pattern as keyof typeof HOOK_PATTERNS] ?? ''}</span></td>
                  <td className="mono">{w.posts}</td>
                  <td className="mono">{w.weight > 0 ? '+' : ''}{w.weight.toFixed(2)}</td>
                  <td>{w.weight > 0.05 ? <Chip color={TONE.ok}>use more</Chip> : w.weight < -0.05 ? <Chip color={TONE.danger}>avoid</Chip> : <Chip color={TONE.faint}>neutral</Chip>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tile>
      <div style={{ height: 16 }} />
      {hooks.length
        ? <Hooks hooks={hooks} styles={styles} />
        : <p className="empty">No opening lines yet. Scan your competitors on Competitors and their opening lines land here.</p>}
    </>
  );
}
