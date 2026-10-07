'use client';
// The performance map (docs/DESIGN-GUIDE.md §6, §6e). x = reactions, y = comments + shares, both
// log scale. Every point is a thumbnail: the newest are full colour ("fresh"), everything else
// settles into a grey blurred cloud, and points in the selected format light up with a border.
// New points fly in as a stream of cards from the right edge of the top-posts grid, shrinking
// as they land. A ring follows the spotlit post. All motion is CSS transitions on real changes.
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { compact } from './format';

export interface ScatterPoint {
  id: string; x: number; y: number;           // raw counts (x = reactions, y = comments + shares)
  seq: number; thumb: string | null; text: string; color: string; platformColor: string;
  tip: [string, string];
}

type Vars = CSSProperties & Record<`--${string}`, string>;
const FRESH = 15, MAX_FLIGHTS = 60, STAGGER = 40;
const lg = (v: number) => Math.log10(Math.max(1, v));

export function Face({ p, words = 6 }: { p: Pick<ScatterPoint, 'thumb' | 'text' | 'platformColor'>; words?: number }) {
  return (
    <span className="thumb" style={{ '--pc': p.platformColor } as Vars}>
      <span className="tt">{p.text.split(/\s+/).slice(0, words).join(' ')}</span>
      {p.thumb && <img src={p.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
    </span>
  );
}

export function LogScatter({ points, match, matchColor, spotId, onPick, origin, status, label }: {
  points: ScatterPoint[];
  match: ((id: string) => boolean) | null;
  matchColor: string | null;
  spotId: string | null;
  onPick: (id: string) => void;
  origin: RefObject<HTMLElement | null>;   // the top-posts grid: cards fly from its right edge
  status: string;
  label: string;
}) {
  const onChart = points.filter((p) => p.x > 0);
  const off = points.filter((p) => p.x <= 0);
  const [hover, setHover] = useState<string | null>(null);

  const g = useMemo(() => {
    const xs = onChart.map((p) => lg(p.x)), ys = onChart.map((p) => lg(p.y));
    const x0 = Math.max(0, Math.floor((Math.min(...xs, 1) - 0.5) * 2) / 2), x1 = Math.ceil((Math.max(...xs, 2) + 0.5) * 2) / 2;
    const y0 = Math.max(0, Math.floor((Math.min(...ys, 0) - 0.5) * 2) / 2), y1 = Math.ceil((Math.max(...ys, 1) + 0.5) * 2) / 2;
    // Rounded: Node and the browser disagree in the last float bits of the log math (hydration).
    const r = (v: number) => Math.round(v * 100) / 100;
    const fx = (v: number) => r(((lg(v) - x0) / (x1 - x0)) * 100);
    const fy = (v: number) => r(100 - ((lg(v) - y0) / (y1 - y0)) * 100);
    // least squares in log space: "typical conversation per reaction"
    const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / (n || 1), my = ys.reduce((a, b) => a + b, 0) / (n || 1);
    const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0), sxy = xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0);
    const slope = sxx ? sxy / sxx : 0;
    const trend = n > 2 ? [x0, x1].map((lx) => [r(((lx - x0) / (x1 - x0)) * 100), r(100 - ((my + slope * (lx - mx) - y0) / (y1 - y0)) * 100)]) : null;
    const sorted = onChart.map((p) => p.x).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = !sorted.length ? null : sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    const decades = (a: number, b: number) => Array.from({ length: Math.floor(b) - Math.ceil(a) + 1 }, (_, i) => Math.ceil(a) + i);
    return { fx, fy, trend, median, xt: decades(x0, x1), yt: decades(y0, y1) };
  }, [points]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rounded so the server's style text and the browser's re-serialised one match (hydration).
  const pct = (v: number) => `${Math.round(v * 100) / 100}%`;
  const pos = (p: ScatterPoint, i: number) => p.x > 0
    ? { left: pct(g.fx(p.x)), top: pct(g.fy(p.y)) }
    : { left: pct(((i + 0.5) / Math.max(off.length, 1)) * 100), top: 'calc(100% + 39px)' };
  // Newest ~15 stay fresh after the run ends too — otherwise a small run's only batch lands and
  // greys out in the same frame, and the fly-in is never seen.
  const freshFrom = Math.max(0, ...points.map((p) => p.seq)) - FRESH;
  const state = (p: ScatterPoint) => (match ? (match(p.id) ? 'match' : 'settled') : p.seq > freshFrom ? 'fresh' : 'settled');

  // ---- fly-in: new ids start at the grid's right edge, 22px, semi-transparent ----
  const els = useRef(new Map<string, HTMLButtonElement>());
  const seen = useRef<Set<string> | null>(null);
  useLayoutEffect(() => {
    const first = seen.current === null;
    const fresh = first ? [] : points.filter((p) => !seen.current!.has(p.id));
    seen.current = new Set(points.map((p) => p.id));
    const src = origin.current?.getBoundingClientRect();
    if (!fresh.length || !src || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    fresh.slice(-MAX_FLIGHTS).forEach((p, i) => {   // older ones in a big batch just appear
      const el = els.current.get(p.id);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = src.right - (r.left + r.width / 2);
      const dy = src.top + ((i * 37) % Math.max(src.height, 1)) - (r.top + r.height / 2);
      el.style.transition = 'none';
      el.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${22 / 14})`;
      el.style.opacity = '.6';
      el.style.filter = 'none';
      el.getBoundingClientRect(); // commit the start frame
      el.style.transition = '';
      el.style.transitionDelay = `${i * STAGGER}ms`;
      el.style.transform = el.style.opacity = el.style.filter = '';
      setTimeout(() => { el.style.transitionDelay = ''; }, 900 + i * STAGGER);
    });
  }, [points, origin]);

  const spot = points.find((p) => p.id === spotId) ?? null;
  const hov = points.find((p) => p.id === hover) ?? null;
  const spotIdx = spot ? off.indexOf(spot) : -1;
  const hovIdx = hov ? off.indexOf(hov) : -1;

  return (
    <div>
      <div className="pane-head">
        <span className="label">Performance map</span>
        <span className="status" role="status">{status}</span>
      </div>
      <div className="scatter" role="img" aria-label={label}>
        <span className="axis-t" style={{ left: 44, top: 0 }}>comments + shares ↑</span>
        <span className="axis-t" style={{ right: 12, bottom: 22 }}>reactions →</span>
        <div className="plot">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            {g.xt.map((d) => <line key={`x${d}`} x1={g.fx(10 ** d)} x2={g.fx(10 ** d)} y1={0} y2={100} stroke="var(--rule)" vectorEffect="non-scaling-stroke" />)}
            {g.yt.map((d) => <line key={`y${d}`} y1={g.fy(10 ** d)} y2={g.fy(10 ** d)} x1={0} x2={100} stroke="var(--rule)" vectorEffect="non-scaling-stroke" />)}
            {g.trend && <line x1={g.trend[0]![0]} y1={g.trend[0]![1]} x2={g.trend[1]![0]} y2={g.trend[1]![1]}
              stroke="var(--ink)" strokeOpacity={0.5} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
            {g.median != null && <line x1={g.fx(g.median)} x2={g.fx(g.median)} y1={0} y2={100} stroke="var(--ink)" vectorEffect="non-scaling-stroke" />}
          </svg>
          {g.xt.map((d) => <span key={`xt${d}`} className="tick" style={{ left: pct(g.fx(10 ** d)), top: 'calc(100% + 4px)', transform: 'translateX(-50%)' }}>{compact(10 ** d)}</span>)}
          {g.yt.map((d) => <span key={`yt${d}`} className="tick" style={{ right: 'calc(100% + 6px)', top: pct(g.fy(10 ** d)), transform: 'translateY(-50%)' }}>{compact(10 ** d)}</span>)}
          {g.median != null && <span className="tick" style={{ left: `calc(${pct(g.fx(g.median))} + 5px)`, top: 2, color: 'var(--ink-2)' }}>median {compact(Math.round(g.median))} reactions</span>}

          {points.map((p) => (
            <button key={p.id} type="button" className="pt" data-s={state(p)} aria-label={p.tip.join(' · ')}
              ref={(el) => { if (el) els.current.set(p.id, el); else els.current.delete(p.id); }}
              style={{ ...pos(p, off.indexOf(p)), '--fc': p.color } as Vars}
              onClick={() => onPick(p.id)} onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover((h) => (h === p.id ? null : h))}>
              <Face p={p} />
            </button>
          ))}
          {spot && (
            <span className="spot" style={{ ...pos(spot, spotIdx), '--ring': matchColor ?? 'var(--ink)' } as Vars}>
              <Face p={spot} words={3} />
            </span>
          )}
          {hov && <span className="tip" style={pos(hov, hovIdx)}>{hov.tip[0]}<br /><span style={{ opacity: 0.7 }}>{hov.tip[1]}</span></span>}
        </div>
        {off.length > 0 && <div className="strip" aria-hidden />}
      </div>
      <div className="foot">
        each tile is one post · log scale both axes · dashed line = typical conversation per reaction (above it = started a discussion)
        {off.length > 0 && ` · ${off.length} post${off.length === 1 ? '' : 's'} with no reactions sit on the strip below`}
      </div>
    </div>
  );
}
