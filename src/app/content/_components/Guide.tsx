'use client';
// Guided tour: dims the page, rings the thing to do next (pulsing), and puts a short tip beside it.
// Step by step on this page, then "Next page" carries the tour on to the next page in the workflow.
// Starts by itself on a person's first visit to each page; "? Guide" in the top bar restarts it.
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { GROUPS } from '../_lib/pages';
import { guideFor } from '../_lib/guide';

const label = (href: string) => GROUPS.flatMap((g) => g.links).find((l) => l.href === href)?.label ?? '';
const CARRY = 'tour-carry'; // sessionStorage: the tour continues on the next page
const store = (s: 'local' | 'session') => { try { return s === 'local' ? localStorage : sessionStorage; } catch { return null; } };

/** The first visible match, trying each comma-separated selector in order (the later ones are fallbacks). */
function find(selector?: string): HTMLElement | null {
  for (const one of selector?.split(', ') ?? []) {
    try {
      for (const el of document.querySelectorAll<HTMLElement>(one)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return el;
      }
    } catch { /* bad selector: try the next */ }
  }
  return null;
}

export function Guide() {
  const router = useRouter();
  const found = guideFor(usePathname());
  const href = found?.href;
  const steps = found?.guide.steps ?? [];
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Start on the first visit to this page, or when the tour was carried over from the last page.
  useEffect(() => {
    setStep(null);
    if (!href) return;
    const carried = store('session')?.getItem(CARRY) === '1';
    store('session')?.removeItem(CARRY);
    const local = store('local');
    const seen = local ? local.getItem(`guide-seen:${href}`) : '1';
    local?.setItem(`guide-seen:${href}`, '1');
    if (carried || !seen) { const t = setTimeout(() => setStep(0), 400); return () => clearTimeout(t); }
  }, [href]);

  // Follow the target: wait for it to appear (panels open late), scroll to it, track it every frame.
  const target = step === null ? undefined : steps[step]?.at;
  useEffect(() => {
    setRect(null);
    if (step === null || !target) return;
    let el: HTMLElement | null = null;
    let frame = 0;
    const started = performance.now();
    const advance = () => setStep((s) => (s === null ? s : s + 1 < steps.length ? s + 1 : s));
    const tick = () => {
      if (!el || !el.isConnected) {
        el = find(target);
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          // Pressing the ringed button moves the tour on; clicking into a field to type does not.
          if (el.matches('a, button, summary')) el.addEventListener('click', advance, { once: true });
        }
        else if (performance.now() - started > 2500) { setRect(null); return; } // not on screen: tip only
      }
      if (el) {
        const r = el.getBoundingClientRect();
        setRect((old) => old && old.top === r.top && old.left === r.left && old.width === r.width && old.height === r.height ? old : r);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(frame); el?.removeEventListener('click', advance); };
  }, [step, target, steps.length]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setStep(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  if (!found) return null;
  const restart = <button type="button" className="btn" onClick={() => setStep(0)} aria-label={`Start the guide for ${label(found.href)}`}>? Guide</button>;
  if (step === null || !steps[step]) return restart;

  const last = step === steps.length - 1;
  const next = found.guide.next;
  const goNext = () => {
    if (!last) return setStep(step + 1);
    setStep(null);
    if (next) { store('session')?.setItem(CARRY, '1'); router.push(next); }
  };

  // Tip below the ring, or above it when the ring sits in the lower half; centred when there is no ring.
  const pad = 6;
  const vw = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 768 : window.innerHeight;
  const tipStyle: React.CSSProperties = rect
    ? {
        left: Math.max(16, Math.min(rect.left, vw - Math.min(330, vw - 32) - 16)),
        ...(rect.top + rect.height / 2 < vh / 2 ? { top: rect.bottom + pad + 14 } : { bottom: vh - rect.top + pad + 14 }),
      }
    : { top: '30vh', left: '50%', transform: 'translateX(-50%)' };

  return <>
    {restart}
    {rect
      ? <div className="tour-spot" aria-hidden style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      : <div className="tour-dim" aria-hidden />}
    <div className="tour-tip" role="dialog" aria-live="polite" aria-label={`Guide: ${label(found.href)}`} style={tipStyle} key={step}>
      <small className="faint mono">{label(found.href)} · step {step + 1} of {steps.length}</small>
      <p>{steps[step]!.text}</p>
      <div className="tour-row">
        <button type="button" className="btn btn-sm" onClick={() => setStep(null)}>Skip</button>
        <span className="spacer" />
        {step > 0 && <button type="button" className="btn btn-sm" onClick={() => setStep(step - 1)}>Back</button>}
        <button type="button" className="btn btn-primary btn-sm" onClick={goNext} autoFocus>
          {!last ? 'Next' : next ? `Go to ${label(next)} →` : 'Done'}
        </button>
      </div>
    </div>
  </>;
}
