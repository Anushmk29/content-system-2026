// Page primitives + visualizations — pure SVG/divs, zero chart deps. Server-safe (Count is a
// client leaf). Look and behaviour: docs/DESIGN-GUIDE.md.
import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { Count } from './Count';
import {
  PLATFORM, STATUS_COLOR, STATUS_LABEL, PILLAR_COLOR, prettyPillar, compact,
} from './format';

type Vars = CSSProperties & Record<`--${string}`, string>;

// ---- page head -------------------------------------------------------------
/** `title` is the page's sidebar label, so people can tell where they are. `sub`: one short line.
 *  `how`: the steps, folded. `next`: the one thing to do now, as a sentence and a button. */
export function PageHead({ title, sub, how, next, children }: {
  title: string; sub?: ReactNode; how?: ReactNode[]; next?: { text: ReactNode; action?: ReactNode } | null; children?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div style={{ minWidth: 0 }}>
        <h1>{title}</h1>
        {sub && <p className="lede">{sub}</p>}
        {how && (
          <details className="how">
            <summary>How this page works</summary>
            <ol>{how.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </details>
        )}
      </div>
      {children && <div className="acts">{children}</div>}
      {next && (
        <div className="page-next">
          <span className="label">Next</span>
          <span className="grow">{next.text}</span>
          {next.action}
        </div>
      )}
    </header>
  );
}

/** A "?" that opens a short explanation: help text stays one click away instead of on the page. */
export function Hint({ children, label = 'What is this?' }: { children: ReactNode; label?: string }) {
  return (
    <details className="hint">
      <summary aria-label={label} title={label}>?</summary>
      <div className="hint-pop">{children}</div>
    </details>
  );
}

// ---- KPI strip: joined cells, first = ink (the live count), last = lime (money/outcome) --
interface KpiCell { label: string; value: number | string | null; denom?: string; unit?: string; sub?: ReactNode; href?: string; money?: boolean }

export function KpiStrip({ items }: { items: KpiCell[] }) {
  return (
    <div className="kpis">
      {items.map((k) => {
        const body = (
          <>
            <div className="label">{k.label}</div>
            <div className="kpi">
              {typeof k.value === 'number' ? <Count value={k.value} money={k.money} /> : (k.value ?? '—')}
              {k.unit && <small> {k.unit}</small>}
              {k.denom && <small> / {k.denom}</small>}
            </div>
            {k.sub && <div className="kpi-sub">{k.sub}</div>}
          </>
        );
        return k.href
          ? <Link key={k.label} href={k.href} className="kpi-cell">{body}</Link>
          : <div key={k.label} className="kpi-cell">{body}</div>;
      })}
    </div>
  );
}

// ---- section: one heading (the title, else the eyebrow); separated by a rule, never boxed --
/** A string `meta` is explanation, so it folds into a "?"; a node `meta` (a link, controls) stays visible. */
export function Section({ eyebrow, title, meta, children, id }: { eyebrow: string; title?: string; meta?: ReactNode; children: ReactNode; id?: string }) {
  const hint = typeof meta === 'string' && meta ? <Hint>{meta}</Hint> : null;
  return (
    <section className="section" id={id}>
      <div className="section-head">
        {title ? <h2>{title}</h2> : <div className="label">{eyebrow}</div>}
        {hint}
        {meta && !hint && <div className="meta">{meta}</div>}
      </div>
      {children}
    </section>
  );
}

// ---- pane (old name Tile: a paper-2 box with a hairline and a micro-label head) --
export function Tile({ title, hint, link, span, tall, children }: {
  title?: string; hint?: ReactNode; link?: { href: string; label: string };
  span?: 2 | 4; tall?: boolean; children: ReactNode;
}) {
  const cls = ['tile', span ? `span-${span}` : '', tall ? 'row-2' : ''].filter(Boolean).join(' ');
  return (
    <section className={cls}>
      {(title || link) && (
        <div className="tile-head">
          {title && <h2 className="tile-title">{title}</h2>}
          {hint && <span className="tile-hint">{hint}</span>}
          {link && <Link className="tile-link" href={link.href}>{link.label} →</Link>}
        </div>
      )}
      {children}
    </section>
  );
}

// ---- chips -----------------------------------------------------------------
export function Plat({ p, status }: { p: string; status?: string }) {
  const m = PLATFORM[p] ?? { label: p, glyph: p.slice(0, 2), color: 'var(--faint)' };
  const title = status ? `${m.label} · ${STATUS_LABEL[status] ?? status}` : m.label;
  return (
    <span className="plat" title={title} aria-label={title} data-status={status}
      style={{ '--c': m.color, ...(status ? { '--s': STATUS_COLOR[status] ?? 'transparent' } : {}) } as Vars}>
      {m.glyph}
    </span>
  );
}

export function StatusChip({ status }: { status: string }) {
  return <span className="chip" style={{ '--c': STATUS_COLOR[status] ?? 'var(--faint)' } as Vars}>{STATUS_LABEL[status] ?? status}</span>;
}

export function Chip({ color, children, title }: { color: string; children: ReactNode; title?: string }) {
  return <span className="chip" title={title} style={{ '--c': color } as Vars}>{children}</span>;
}

export function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return <span className={`dot${pulse ? ' pulse' : ''}`} style={{ '--c': color } as Vars} />;
}

/** A 1–5 score as five segments. */
export function ScoreBars({ value, color }: { value: number; color?: string }) {
  return (
    <span className="bars" style={color ? ({ '--c': color } as Vars) : undefined}>
      {[1, 2, 3, 4, 5].map((n) => <span key={n} data-on={n <= value || undefined} />)}
    </span>
  );
}

// ---- ring (progress vs target) ---------------------------------------------
export function Ring({ value, max, size = 92, color = 'var(--ink)', label }: {
  value: number; max: number; size?: number; color?: string; label?: ReactNode;
}) {
  const r = size / 2 - 6, c = 2 * Math.PI * r, frac = Math.min(1, max ? value / max : 0);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${value} of ${max}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--rule)" strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4}
        strokeDasharray={`${frac * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="56%" textAnchor="middle" fill="var(--ink)" fontSize={size / 4.2} fontWeight={500}
        fontFamily="var(--font-ui)">{label ?? `${value}/${max}`}</text>
    </svg>
  );
}

// ---- funnel (per idea): thin ink-coloured bars ------------------------------
export function Funnel({ stages }: { stages: { status: string; count: number }[] }) {
  const flow = stages.filter((s) => s.status !== 'archived');
  const max = Math.max(1, ...flow.map((s) => s.count));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {flow.map((s) => (
        <Link key={s.status} href={`/content/board?stage=${s.status}`} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <span className="mono" style={{ width: 120, fontSize: 11.5, color: 'var(--muted)', textAlign: 'right', flexShrink: 0 }}>{STATUS_LABEL[s.status]}</span>
          <span style={{ flex: 1, height: 8, background: 'var(--rule)' }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.max((s.count / max) * 100, s.count ? 2 : 0)}%`, background: STATUS_COLOR[s.status] ?? 'var(--faint)' }} />
          </span>
          <span className="mono" style={{ width: 26, textAlign: 'right', color: s.count ? 'var(--ink)' : 'var(--faint)' }}>{s.count}</span>
        </Link>
      ))}
    </div>
  );
}

// ---- pillar mix vs target --------------------------------------------------
export function PillarBars({ mix }: { mix: { pillar: string; count: number; share: number; target: number }[] }) {
  const total = mix.reduce((s, p) => s + p.count, 0);
  if (!total) return <p className="empty">Nothing signed off in the last 30 days yet — the mix fills in as ideas get approved.</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      {mix.map((p, i) => {
        const off = p.share - p.target;
        return (
          <div key={p.pillar}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
              <span>{prettyPillar(p.pillar)}</span>
              <span className="mono muted">
                {p.share}%<span className="faint"> / {p.target}%</span>
                {Math.abs(off) >= 8 && <span style={{ color: off > 0 ? 'var(--warn)' : 'var(--info)', marginLeft: 6 }}>{off > 0 ? `+${off}` : off}</span>}
              </span>
            </div>
            <div style={{ position: 'relative', height: 8, background: 'var(--rule)' }}>
              <div title={`target ${p.target}%`} style={{ position: 'absolute', left: `${p.target}%`, top: -3, bottom: -3, width: 2, background: 'var(--ink)' }} />
              <div style={{ width: `${p.share}%`, height: '100%', background: PILLAR_COLOR[i % 4] }} />
            </div>
          </div>
        );
      })}
      <div className="faint mono" style={{ fontSize: 10.5 }}>share of signed-off ideas, last 30 days · tick = target</div>
    </div>
  );
}

// ---- line on a hairline baseline (no fill) -----------------------------------
export function Area({ points, color = 'var(--ink)', height = 90, labels }: {
  points: number[]; color?: string; height?: number; labels?: [string, string];
}) {
  const w = 300, h = height, max = Math.max(1, ...points), n = Math.max(1, points.length - 1);
  const line = points.map((v, i) => `${i ? 'L' : 'M'}${((i / n) * w).toFixed(1)},${(h - 6 - (v / max) * (h - 14)).toFixed(1)}`).join(' ');
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: h, display: 'block', borderBottom: '1px solid var(--rule)' }} role="img" aria-label={`trend, max ${max}`}>
        {points.length > 1 && <path d={line} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
      </svg>
      {labels && <div className="faint mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, marginTop: 4 }}><span>{labels[0]}</span><span>{labels[1]}</span></div>}
    </div>
  );
}

// ---- ranked ruled list with a 2px value bar ----------------------------------
export function BarList({ rows, color = 'var(--ink)' }: {
  rows: { label: ReactNode; value: number; shown?: ReactNode; href?: string }[]; color?: string;
}) {
  if (!rows.length) return <p className="empty">No data in this window yet.</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--rule)' }}>
      {rows.map((r, i) => {
        const inner = (
          <div style={{ position: 'relative', padding: '8px 2px 10px', borderBottom: '1px solid var(--rule)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ position: 'absolute', left: 0, bottom: -1, height: 2, width: `${(r.value / max) * 100}%`, background: color }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
            <span className="mono">{r.shown ?? compact(r.value)}</span>
          </div>
        );
        return r.href ? <Link key={i} href={r.href} style={{ textDecoration: 'none' }}>{inner}</Link> : <div key={i}>{inner}</div>;
      })}
    </div>
  );
}

export function NeedsDb({ error }: { error?: string | null }) {
  // The raw error can name tables and hosts: log it on the server, show it only in development.
  if (error && typeof window === 'undefined') console.error('[content] page data:', error);
  const shown = process.env.NODE_ENV === 'development' ? error : null;
  return (
    <Section eyebrow="Can’t load this page" title="This page couldn’t load its data.">
      <Notice plain="Try again in a minute. If it keeps happening, tell Autonoetic Edge: nothing you did caused it.">
        Set <code>CONTENT_DATABASE_URL</code> in <code>.env.local</code> and run <code>db/schema.sql</code> + <code>db/seed.sql</code>.
        {shown && <span className="mono"> ({shown})</span>}
      </Notice>
    </Section>
  );
}

/** Something isn't set up: plain words for the client, the technical fix folded for the operator. */
export function Notice({ plain, children }: { plain: ReactNode; children: ReactNode }) {
  return (
    <div className="notice">
      <p>{plain}</p>
      <details><summary>Technical detail</summary><p className="faint mono">{children}</p></details>
    </div>
  );
}
