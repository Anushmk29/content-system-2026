'use client';
// "? Guide" button in the top bar: what this page is for, what to do, where to go next.
// Opens by itself the first time someone visits each page.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { GROUPS } from '../_lib/pages';
import { guideFor } from '../_lib/guide';

const label = (href: string) => GROUPS.flatMap((g) => g.links).find((l) => l.href === href)?.label ?? '';

export function Guide() {
  const found = guideFor(usePathname());
  const dlg = useRef<HTMLDialogElement>(null);
  const href = found?.href;

  useEffect(() => {
    if (!href) return;
    try {
      if (localStorage.getItem(`guide-seen:${href}`)) return;
      localStorage.setItem(`guide-seen:${href}`, '1');
    } catch { return; } // no storage: never auto-open
    dlg.current?.showModal();
  }, [href]);

  if (!found) return null;
  const { guide } = found;
  const close = () => dlg.current?.close();
  return <>
    <button type="button" className="btn" onClick={() => dlg.current?.showModal()} aria-label={`Guide for ${label(found.href)}`}>? Guide</button>
    <dialog ref={dlg} className="palette" aria-label={`Guide: ${label(found.href)}`}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div style={{ padding: '18px 20px' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>{label(found.href)}</h2>
        <p className="muted" style={{ margin: '0 0 12px' }}>{guide.what}</p>
        <ol style={{ margin: '0 0 16px', paddingLeft: 20, lineHeight: 1.6 }}>
          {guide.steps.map((s) => <li key={s}>{s}</li>)}
        </ol>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={close}>Got it</button>
          {guide.next && <Link href={guide.next} className="btn btn-primary" onClick={close}>Next: {label(guide.next)} →</Link>}
        </div>
      </div>
    </dialog>
  </>;
}
