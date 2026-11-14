'use client';
// The only animated number: tweens from the previous value to the new one (600ms ease-out).
// First render shows the value as-is — motion only reports a real change.
import { useEffect, useRef, useState } from 'react';

export function Count({ value, money = false }: { value: number; money?: boolean }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value || matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(value); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 600);
      setShown(start + (value - start) * (1 - (1 - k) ** 3));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  const done = shown === value;
  return <>{money ? `$${shown.toFixed(2)}` : (done ? value : Math.round(shown)).toLocaleString('en-US')}</>;
}
