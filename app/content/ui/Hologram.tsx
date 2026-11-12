'use client';
// Loader hologram: a rotating 3D shape of ~1100 particles, a different shape per page, with an
// iridescent hue drift, a scan band sweeping through and a faint flicker. It leans toward the
// pointer; on finish it pulses and turns green (done) or orange (failed). Plain canvas 2D, hand-rolled 3D.
import { useEffect, useRef } from 'react';

const N = 1100;
const TAU = Math.PI * 2;
export type OrbState = 'run' | 'done' | 'fail';
type P = [number, number, number];
const R = Math.random;
const jit = ([x, y, z]: P, k: number): P => [x + (R() - .5) * k, y + (R() - .5) * k, z + (R() - .5) * k];
const sphere = (i: number): P => { const y = 1 - (2 * (i + .5)) / N, r = Math.sqrt(1 - y * y), t = i * 2.39996; return [Math.cos(t) * r, y, Math.sin(t) * r]; };

/** Point generators in a unit box, y up. */
export const SHAPES = {
  sphere,
  cone: (): P => { const a = R() * TAU; if (R() < .25) { const r = .75 * Math.sqrt(R()); return [r * Math.cos(a), -.7, r * Math.sin(a)]; } const h = R(), r = .75 * (1 - h); return [r * Math.cos(a), -.7 + h * 1.5, r * Math.sin(a)]; },
  ring: (): P => { const a = R() * TAU, w = .85 + (R() - .5) * .12; return [w * Math.cos(a), (R() - .5) * .12, w * Math.sin(a)]; },
  torus: (): P => { const a = R() * TAU, b = R() * TAU, w = .72 + .3 * Math.cos(b); return [w * Math.cos(a), .3 * Math.sin(b), w * Math.sin(a)]; },
  cube: (): P => { const f = Math.floor(R() * 6), s = f % 2 ? .7 : -.7, u = (R() - .5) * 1.4, v = (R() - .5) * 1.4; return f < 2 ? [s, u, v] : f < 4 ? [u, s, v] : [u, v, s]; },
  diamond: (): P => { const x = R() - .5, y = R() - .5, z = R() - .5, l = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1; return [x / l, 1.3 * y / l, z / l]; },
  cylinder: (): P => { const a = R() * TAU, c = R(); if (c < .3) { const r = .75 * Math.sqrt(R()); return [r * Math.cos(a), c < .15 ? .7 : -.7, r * Math.sin(a)]; } return [.75 * Math.cos(a), (R() - .5) * 1.4, .75 * Math.sin(a)]; },
  helix: (i: number): P => {
    const t = R() * TAU * 2;
    if (i % 3 === 2) { const ts = Math.round(t * 1.6) / 1.6, s = R() * 2 - 1; return [s * .5 * Math.cos(ts), ts / (TAU * 2) * 1.8 - .9, s * .5 * Math.sin(ts)]; } // rungs
    const a = t + (i % 3 ? Math.PI : 0);
    return [.5 * Math.cos(a), t / (TAU * 2) * 1.8 - .9, .5 * Math.sin(a)];
  },
  pyramid: (): P => {
    if (R() < .25) return [(R() - .5) * 1.5, -.65, (R() - .5) * 1.5];
    const h = R(), s = .75 * (1 - h), e = R() * 4, f = Math.floor(e), u = (e - f) * 2 - 1;
    const [x, z] = f === 0 ? [s, u * s] : f === 1 ? [-s, u * s] : f === 2 ? [u * s, s] : [u * s, -s];
    return [x, -.65 + h * 1.4, z];
  },
  knot: (): P => { const t = R() * TAU; return jit([(Math.sin(t) + 2 * Math.sin(2 * t)) / 3.2, (Math.cos(t) - 2 * Math.cos(2 * t)) / 3.2, -Math.sin(3 * t) / 3.2], .16); },
  saturn: (i: number): P => {
    if (i % 5 < 3) { const [x, y, z] = sphere(i); return [x * .55, y * .55, z * .55]; }
    const a = R() * TAU, r = .8 + R() * .25, z = r * Math.sin(a);
    return [r * Math.cos(a), -z * .39, z * .92];
  },
  coil: (): P => { const u = R(), t = u * TAU * 4; return jit([.6 * Math.cos(t), u * 1.8 - .9, .6 * Math.sin(t)], .1); },
  heart: (): P => {
    const t = R() * TAU, s = Math.sqrt(R());
    const x = 16 * Math.sin(t) ** 3 / 17, y = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17;
    return [x * s, y * s + .1, (R() < .5 ? -1 : 1) * .35 * Math.sqrt(1 - s * s)];
  },
  wave: (): P => { const x = R() * 2 - 1, z = R() * 2 - 1; return [x * .9, .28 * Math.sin(x * 4) * Math.cos(z * 3), z * .9]; },
  bars: (): P => { const k = Math.floor(R() * 5), h = [.6, 1.1, .8, 1.5, 1.2][k]!; return [-.8 + k * .4 + (R() - .5) * .24, -.75 + R() * h, (R() - .5) * .24]; },
  galaxy: (): P => {
    const r = R() ** .7, a = r * 4.5 + Math.floor(R() * 3) * TAU / 3 + (R() - .5) * .5, x = r * Math.cos(a), y = (R() - .5) * .12 * (1 - r), z = r * Math.sin(a);
    return [x, y * .54 - z * .84, y * .84 + z * .54];
  },
  coin: (): P => { const a = R() * TAU, c = R(); if (c < .3) return [.8 * Math.cos(a), .8 * Math.sin(a), (R() - .5) * .2]; const r = .8 * Math.sqrt(R()); return [r * Math.cos(a), r * Math.sin(a), c < .65 ? .1 : -.1]; },
  gear: (): P => {
    const a = R() * TAU, tooth = Math.cos(a * 10) > 0 ? .2 : 0, rim = R() < .4;
    const r = rim ? .75 + tooth : .4 + R() * (.35 + tooth); // rim edge, or a face between hub and teeth
    return [r * Math.cos(a), r * Math.sin(a), rim ? (R() - .5) * .3 : R() < .5 ? -.15 : .15];
  },
} satisfies Record<string, (i: number) => P>;
export type Shape = keyof typeof SHAPES;

export function Hologram({ shape, hue, state, size = 320 }: { shape: Shape; hue: number; state: OrbState; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ state, hue, since: 0 });
  useEffect(() => { live.current = { state, hue, since: performance.now() }; }, [state, hue]);

  useEffect(() => {
    const cv = ref.current!, ctx = cv.getContext('2d')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = cv.height = size * dpr;
    ctx.scale(dpr, dpr);
    const pts = Array.from({ length: N }, (_, i) => SHAPES[shape](i));
    // Pointer lean: target tilt from the cursor, eased every frame
    const aim = { x: 0, y: 0 }, lean = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      const b = cv.getBoundingClientRect();
      aim.x = Math.max(-1, Math.min(1, (e.clientX - b.left - b.width / 2) / 400));
      aim.y = Math.max(-1, Math.min(1, (e.clientY - b.top - b.height / 2) / 400));
    };
    window.addEventListener('pointermove', onMove);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      const el = now - t0, { state: st, since, hue: h } = live.current;
      lean.x += (aim.x - lean.x) * .06; lean.y += (aim.y - lean.y) * .06;
      const ry = el * .0007 + lean.x * .6, rx = -.32 + lean.y * .5;
      const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
      // Finish pulse: a quick swell that settles (clamped: rAF's timestamp can predate `since`)
      const dt = st === 'run' ? 1 : Math.min(Math.max((now - since) / 600, 0), 1);
      const pulse = st === 'run' ? 0 : Math.sin(dt * Math.PI) * .16;
      const c = size / 2, scale = size * .33 * (1 + pulse);
      const band = Math.sin(el * .0012) * 1.1;                 // bright scan band sweeping up and down
      const flicker = still ? 1 : .92 + .08 * Math.sin(el * .031) * Math.sin(el * .017);
      const base = st === 'run' ? h : st === 'done' ? 140 : 20;
      ctx.clearRect(0, 0, size, size);
      // Soft floor shadow, follows the lean
      ctx.fillStyle = 'rgba(17, 17, 17, .06)';
      ctx.beginPath(); ctx.ellipse(c + lean.x * 6, size * .9, size * .26, size * .035, 0, 0, TAU); ctx.fill();
      for (let i = 0; i < N; i++) {
        const [px, py, pz] = pts[i]!;
        const r = still ? 1 : 1 + .06 * Math.sin(py * 6 + el * .004) + .03 * Math.sin(px * 5 - el * .003);
        let x = px * r, y = py * r, z = pz * r;
        [x, z] = [x * cy - z * sy, x * sy + z * cy];   // spin + lean
        [y, z] = [y * cx - z * sx, y * sx + z * cx];   // tilt + lean
        const p = 2.8 / (z + 2.8), depth = (z + 1) / 2; // 0 front .. 1 back
        const glow = st === 'run' ? Math.max(0, 1 - Math.abs(py - band) * 4) : 0;
        const alpha = Math.min(1, .12 + .75 * (1 - depth) + glow * .35) * flicker;
        // Iridescence: hue drifts across the surface and over time, like foil catching light
        const hh = base + 50 * Math.sin(py * 2.2 + px * 1.6 + el * .0015);
        ctx.fillStyle = `hsla(${hh}, 78%, ${42 + glow * 16}%, ${alpha})`;
        ctx.beginPath();
        ctx.arc(c + x * scale * p, c * .92 - y * scale * p, .45 + 1.35 * (1 - depth) + glow * .8, 0, TAU);
        ctx.fill();
      }
      if (!still) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', onMove); };
  }, [shape, size]);
  return <div className="ld-holo"><canvas ref={ref} style={{ width: size, height: size }} aria-hidden="true" /></div>;
}
