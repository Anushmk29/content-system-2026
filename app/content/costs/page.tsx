// Costs (admin) — every paid call from the cost ledger: where the money went, what one draft /
// Decode / published post costs, and a check of the ledger against the providers' own billing.
import Link from 'next/link';
import { getContext, getCosts, COST_RANGES, type Costs, type CostRange } from '@pratapai/content-pipeline';
import { params, type SearchParams } from '../data';
import { PageHead, KpiStrip, Tile, Area, BarList, Chip, NeedsDb } from '../ui/viz';
import { withParams, ago, when, TONE } from '../ui/format';

const RANGE_LABEL: Record<CostRange, string> = { today: 'Today', yesterday: 'Yesterday', '7d': '7d', '30d': '30d', month: 'Month', custom: 'Custom' };
const usd = (n: number | null) => (n == null ? '—' : n > 0 && n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const pretty = (k: string) => k.replace(/[-_]/g, ' ');

/** Where an operation's ref lives in the dashboard. */
function refHref(t: Costs['top'][number]): string | null {
  if (!t.refId) return null;
  switch (t.refType) {
    case 'decode_run': return `/content/decode?run=${t.refId}`;
    case 'content_item': return `/content/board?item=${t.refId}`;
    case 'style_ref': return '/content/styles';
    case 'module_run': return '/content/system';
    default: return null;
  }
}

export default async function CostsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const range = (COST_RANGES as readonly string[]).includes(sp.range ?? '') ? (sp.range as CostRange) : '7d';
  const custom = { from: sp.from, to: sp.to };
  let c: Costs | null = null;
  let error: string | null = null;
  try { c = await getCosts(getContext(), range, custom); } catch (e) { error = (e as Error).message; }

  const csv = withParams('/content/api/costs', { range, ...(range === 'custom' ? custom : {}) }, {});
  const head = (
    <PageHead crumb="costs" title="Where the money goes." sub="Every paid call (AI, images, scrapes, Jev), what it was for, and whether it matches the providers’ bills.">
      <nav className="seg" aria-label="Range">
        {COST_RANGES.filter((r) => r !== 'custom').map((r) => (
          <Link key={r} href={`/content/costs?range=${r}`} aria-current={r === range ? 'page' : undefined}>{RANGE_LABEL[r]}</Link>
        ))}
      </nav>
      <a className="btn btn-sm" href={csv}>CSV ↓</a>
    </PageHead>
  );
  if (!c) return (<>{head}<NeedsDb error={error} /></>);

  const span: [string, string] | undefined = c.byDay.length > 1 ? [c.byDay[0]!.day, c.byDay[c.byDay.length - 1]!.day] : undefined;
  const warns = c.reconcile.filter((r) => r.warn).length;

  return (
    <>
      {head}
      <form className="toolbar" action="/content/costs" method="get">
        <input type="hidden" name="range" value="custom" />
        <input className="input" type="date" name="from" defaultValue={c.from} aria-label="From" style={{ width: 160 }} />
        <input className="input" type="date" name="to" defaultValue={c.to} aria-label="To" style={{ width: 160 }} />
        <button className="btn btn-sm" type="submit">Show</button>
        <span className="faint mono" style={{ fontSize: 11 }}>{c.from === c.to ? c.from : `${c.from} → ${c.to}`} · IST</span>
      </form>

      <KpiStrip items={[
        { label: 'Spent', value: usd(c.total), sub: c.byProvider.map((p) => `${p.key} ${usd(p.usd)}`).join(' · ') || 'nothing yet' },
        { label: 'Paid calls', value: c.calls, sub: c.failed ? `${c.failed} failed` : 'none failed' },
        { label: 'Per draft', value: usd(c.units.perItem), sub: `all spend ÷ ${c.units.items} drafts made` },
        { label: 'Untagged', value: usd(c.untagged), sub: c.untagged > 0 ? <span style={{ color: TONE.danger }}>a paid path isn’t tagged — fix it</span> : 'every call has a feature' },
      ]} />

      <div className="bento">
        <Tile title="By feature" hint="what the money was for" span={2}>
          <BarList color="var(--ink)" rows={c.byFeature.map((r) => ({
            label: <span style={r.key === 'untagged' ? { color: TONE.danger } : undefined}>{pretty(r.key)} <span className="faint mono">· {r.calls} calls{r.failed ? `, ${r.failed} failed` : ''}</span></span>,
            value: r.usd, shown: usd(r.usd),
          }))} />
        </Tile>
        <Tile title="By model" span={2}>
          <BarList color="var(--violet)" rows={c.byModel.map((r) => ({
            label: <>{r.key} <span className="faint mono">· {r.calls}</span></>, value: r.usd, shown: usd(r.usd),
          }))} />
        </Tile>

        <Tile title="Per day" hint="IST" span={2}>
          {c.byDay.length > 1
            ? <Area points={c.byDay.map((d) => d.usd)} color="var(--teal)" height={90} labels={span} />
            : <p className="mono" style={{ fontSize: 22, margin: 0 }}>{usd(c.byDay[0]?.usd ?? 0)}</p>}
        </Tile>
        <Tile title="Unit costs" hint="what to price on" span={2}>
          <table className="table">
            <tbody>
              <tr><td>Per draft made</td><td className="mono">{usd(c.units.perItem)}</td><td className="faint">all spend ÷ {c.units.items} drafts</td></tr>
              <tr><td>Per published post</td><td className="mono">{usd(c.units.perPublished)}</td><td className="faint">all spend ÷ {c.units.published} published</td></tr>
              <tr><td>Per Decode run</td><td className="mono">{usd(c.units.perDecode)}</td><td className="faint">decode spend ÷ {c.units.decodes} runs</td></tr>
            </tbody>
          </table>
        </Tile>

        <Tile title="Most expensive operations" hint="one click or run = one row" span={4}>
          {c.top.length === 0 ? <p className="empty">No paid calls in this window.</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead><tr><th>What</th><th>When</th><th>Calls</th><th>Cost</th><th></th></tr></thead>
                <tbody>
                  {c.top.map((t, i) => {
                    const href = refHref(t);
                    return (
                      <tr key={i}>
                        <td style={t.feature === 'untagged' ? { color: TONE.danger } : undefined}>{pretty(t.feature)}{t.refType && t.refType !== 'op' && <span className="faint mono"> · {pretty(t.refType)}</span>}</td>
                        <td className="faint" title={when(t.at)}>{ago(t.at)}</td>
                        <td className="mono">{t.calls}</td>
                        <td className="mono">{usd(t.usd)}</td>
                        <td>{href && <Link href={href} className="btn btn-sm">Open →</Link>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Tile>

        <Tile title="Check against provider bills" hint={warns ? `${warns} gap${warns === 1 ? '' : 's'} over 5%` : 'gap over 5% = a call path isn’t logged'} span={4}>
          {c.reconcile.length === 0 && c.reconcileErrors.length === 0 && <p className="empty">No provider keys set, so there’s nothing to check against.</p>}
          {c.reconcile.length > 0 && (
            <table className="table">
              <thead><tr><th>Provider</th><th>Window</th><th>They billed</th><th>We logged</th><th>Gap</th><th></th></tr></thead>
              <tbody>
                {c.reconcile.map((r, i) => (
                  <tr key={i}>
                    <td>{r.source}</td>
                    <td className="faint">{r.window}</td>
                    <td className="mono">{usd(r.billed)}</td>
                    <td className="mono">{usd(r.logged)}</td>
                    <td className="mono">{usd(r.billed - r.logged)}</td>
                    <td>{r.partial ? <Chip color="var(--faint)" title="this window began before the ledger existed">partial</Chip>
                      : r.warn ? <Chip color={TONE.danger} title="the provider billed more (or less) than we logged">check</Chip>
                      : <Chip color={TONE.ok}>ok</Chip>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {c.reconcileErrors.map((e) => <p key={e} className="faint mono" style={{ fontSize: 11.5 }}>{e}</p>)}
          <p className="faint" style={{ fontSize: 12, marginBottom: 0 }}>
            Ledger since {c.ledgerSince ? when(c.ledgerSince) : '—'}. Provider windows are UTC days. A gap can also be other apps using the same key or Apify account.
            Day-by-day OpenRouter needs <code>CONTENT_OPENROUTER_MGMT_KEY</code>.
          </p>
        </Tile>
      </div>
    </>
  );
}
