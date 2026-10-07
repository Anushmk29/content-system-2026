// Analytics — is the content working? Totals, trends, best performers and per-platform /
// per-pillar roll-ups over 7/30/90 days. Posts without results link straight to metrics entry.
import Link from 'next/link';
import { getContext, getAnalytics, ANALYTICS_RANGES, type Analytics, type AnalyticsRange, type Breakdown, type FormatStat } from '@pratapai/content-pipeline';
import { performanceSignal } from '@pratapai/content-pipeline/core';
import { params, type SearchParams } from '../data';
import { PageHead, KpiStrip, Tile, Area, BarList, Plat, Chip, NeedsDb } from '../ui/viz';
import { ItemDrawer } from '../ui/ItemDrawer';
import { compact, prettyPillar, withParams, ago, when, PLATFORM, TONE } from '../ui/format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIGNAL: Record<string, { label: string; color: string; tip: string }> = {
  repurpose: { label: 'Repurpose', color: TONE.ok, tip: 'Many people saw it and engaged → turn it into a carousel, blog or email' },
  improve_hook: { label: 'Improve hook', color: TONE.warn, tip: 'Beat your usual on a small audience → new hook or format, then repost' },
  awareness_only: { label: 'Awareness', color: TONE.info, tip: 'Seen, but below your usual → make fewer posts like this' },
  archive: { label: 'Archive', color: TONE.faint, tip: 'Low reach and low engagement → let it go' },
};

export default async function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const range = (ANALYTICS_RANGES as readonly number[]).includes(Number(sp.range)) ? (Number(sp.range) as AnalyticsRange) : 30;
  let a: Analytics | null = null;
  let error: string | null = null;
  try { a = await getAnalytics(getContext(), range); } catch (e) { error = (e as Error).message; }
  const head = (
    <PageHead crumb="analytics" title="What actually performed." sub="Results per post over the window, and the next move for each one.">
      <nav className="seg" aria-label="Range">
        {ANALYTICS_RANGES.map((r) => <Link key={r} href={`/content/analytics?range=${r}`} aria-current={r === range ? 'page' : undefined}>{r}d</Link>)}
      </nav>
    </PageHead>
  );
  if (!a) return (<>{head}<NeedsDb error={error} /></>);

  const t = a.totals;
  const itemHref = (id: string) => withParams('/content/analytics', sp, { item: id });
  const hasNumbers = (p: Analytics['posts'][number]) => p.impressions != null || p.reach != null || p.engagement != null;
  const noMetrics = a.posts.filter((p) => !hasNumbers(p));
  const x = (v: number | null | undefined) => (v == null ? '—' : `${Number(v).toFixed(1)}x`);
  const label = (at: string) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const span: [string, string] | undefined = a.series.length ? [label(a.series[0]!.at), label(a.series[a.series.length - 1]!.at)] : undefined;

  return (
    <>
      {head}
      <KpiStrip items={[
        { label: 'Published', value: t.published, sub: `in the last ${range} days` },
        { label: 'Reach', value: compact(t.reach), sub: `${compact(t.clicks)} clicks` },
        { label: 'Engagement', value: compact(t.engagement), sub: `likes, comments & shares · ${t.engagementPerPost ?? '—'} per post` },
        { label: 'Vs your usual', value: x(t.vsUsual), sub: t.vsUsual != null ? 'the median post, against your own median'
          : a.own.baseline.length ? 'no results on these posts yet' : 'refresh your results on Today', href: '/content' },
      ]} />
      <div className="bento">
        {noMetrics.length > 0 && (
          <Tile span={4} title="Results missing" hint={`${noMetrics.length} published post${noMetrics.length === 1 ? '' : 's'} with no numbers yet`}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {noMetrics.slice(0, 8).map((p) => (
                <Link key={p.id} href={itemHref(p.id)} scroll={false} className="btn btn-sm"><Plat p={p.platform} /> {p.title.slice(0, 40)} · add →</Link>
              ))}
            </div>
          </Tile>
        )}

        <Tile title="Published" hint={range === 90 ? 'per week' : 'per day'} span={2}>
          <Area points={a.series.map((s) => s.published)} color="var(--ok)" height={70} labels={span} />
          <div className="faint mono" style={{ fontSize: 11, marginTop: 6 }}>
            <span style={{ color: 'var(--ok)' }}>━ published ({a.series.reduce((s, x) => s + x.published, 0)})</span>
          </div>
        </Tile>
        <Tile title="Reach & engagement" hint="by publish date" span={2}>
          <Area points={a.series.map((s) => s.reach)} color="var(--teal)" height={70} />
          <div style={{ height: 8 }} />
          <Area points={a.series.map((s) => s.engagement)} color="var(--violet)" height={70} labels={span} />
          <div className="faint mono" style={{ fontSize: 11, marginTop: 6, display: 'flex', gap: 14 }}>
            <span style={{ color: 'var(--teal)' }}>━ reach</span><span style={{ color: 'var(--violet)' }}>━ likes, comments & shares</span>
          </div>
        </Tile>

        <Tile title="Best by reach" span={2}>
          <BarList color="var(--teal)" rows={a.bestByReach.map((p) => ({ label: <><Plat p={p.platform} /> {p.title}</>, value: Number(p.reach ?? p.impressions ?? 0), href: itemHref(p.id) }))} />
        </Tile>
        {a.bestByUsual.length > 0 ? (
          <Tile title="Beat your usual most" span={2}>
            <BarList color="var(--violet)" rows={a.bestByUsual.map((p) => ({ label: <><Plat p={p.platform} /> {p.title}</>, value: Number(p.vs_usual), shown: x(p.vs_usual), href: itemHref(p.id) }))} />
          </Tile>
        ) : (
          <Tile title="Best by engagement" span={2}>
            <BarList color="var(--violet)" rows={a.bestByEngagement.map((p) => ({ label: <><Plat p={p.platform} /> {p.title}</>, value: Number(p.engagement ?? 0), href: itemHref(p.id) }))} />
          </Tile>
        )}

        <Tile title="By platform" span={2}><BreakdownTable rows={a.byPlatform} name={(k) => <><Plat p={k} /> {PLATFORM[k]?.label ?? k}</>} /></Tile>
        <Tile title="By pillar" span={2}><BreakdownTable rows={a.byPillar} name={(k) => prettyPillar(k)} /></Tile>

        <Tile title="Your formats" hint="latest scrape of your accounts" span={2}><FormatList rows={a.formats.yours} empty="Refresh your results on Today to see which of your formats work." /></Tile>
        <Tile title="Competitors’ formats" hint="latest Decode" span={2}><FormatList rows={a.formats.theirs} empty="Run a Decode to compare." /></Tile>

        <Tile title="Every post" hint={`${a.posts.length}`} span={4}>
          {a.posts.length === 0 ? <p className="empty">Nothing published in this window.</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead><tr><th>Post</th><th>Published</th><th>Vs your usual</th><th>Reach</th><th>Engagement</th><th>Clicks</th><th>Next move</th></tr></thead>
                <tbody>
                  {a.posts.map((p) => {
                    const sig = SIGNAL[p.performance_signal ?? performanceSignal(p)] ?? SIGNAL.archive!;
                    const has = hasNumbers(p);
                    return (
                      <tr key={p.id}>
                        <td><Link href={itemHref(p.id)} scroll={false} style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Plat p={p.platform} />{p.title}</Link></td>
                        <td className="faint" title={when(p.published_at)}>{ago(p.published_at)}</td>
                        <td className="mono">{x(p.vs_usual)}</td>
                        <td className="mono">{has ? compact(p.reach ?? p.impressions) : '—'}</td>
                        <td className="mono">{has ? compact(p.engagement) : '—'}</td>
                        <td className="mono">{has ? compact(p.clicks) : '—'}</td>
                        <td>{has ? <Chip color={sig.color} title={sig.tip}>{sig.label}</Chip> : <Link href={itemHref(p.id)} scroll={false} className="btn btn-sm">Add results</Link>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Tile>
      </div>
      {sp.item && <ItemDrawer id={sp.item} closeHref={withParams('/content/analytics', sp, { item: null })} linkFor={itemHref} />}
    </>
  );
}

function BreakdownTable({ rows, name }: { rows: Breakdown[]; name: (k: string) => React.ReactNode }) {
  if (!rows.length) return <p className="empty">No published posts in this window.</p>;
  return (
    <table className="table">
      <thead><tr><th></th><th>Posts</th><th>Vs usual</th><th>Reach</th><th>Engagement</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td style={{ whiteSpace: 'nowrap' }}>{name(r.key)}</td>
            <td className="mono">{r.posts}</td>
            <td className="mono">{r.vsUsual == null ? '—' : `${r.vsUsual.toFixed(1)}x`}</td>
            <td className="mono">{compact(r.reach)}</td>
            <td className="mono">{compact(r.engagement)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Formats ranked by the median post's "x usual" (their own usual for competitors, yours for you). */
function FormatList({ rows, empty }: { rows: FormatStat[]; empty: string }) {
  if (!rows.length) return <p className="empty">{empty}</p>;
  return (
    <table className="table">
      <thead><tr><th>Format</th><th>Posts</th><th>Median vs usual</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}><td>{r.name}</td><td className="mono">{r.posts}</td><td className="mono">{r.vsUsual == null ? '—' : `${r.vsUsual.toFixed(1)}x`}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
