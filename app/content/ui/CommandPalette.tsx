'use client';
// ⌘K / Ctrl+K palette: jump to a page, open a recent post, or run a pipeline step.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAction, summarizeRun } from './actions';

interface Cmd { id: string; label: string; group: string; run: () => void }

const PAGES: [string, string][] = [
  ['/content', 'Today'], ['/content/board', 'Board'], ['/content/calendar', 'Calendar'],
  ['/content/approvals', 'Approvals'], ['/content/ideas', 'Ideas & signals'], ['/content/decode', 'Decode'],
  ['/content/hooks', 'Hooks'], ['/content/styles', 'Styles'], ['/content/brand', 'Brand kit'], ['/content/analytics', 'Analytics'],
];
const ADMIN_PAGES: [string, string][] = [['/content/training', 'Training'], ['/content/system', 'System']];

export function CommandPalette({ modules, admin }: { modules: { id: string; title: string }[]; admin: boolean }) {
  const router = useRouter();
  const a = useAction();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [items, setItems] = useState<{ id: string; title: string; platform: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('open-palette', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('open-palette', onOpen); };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ(''); setSel(0); a.clear();
    setTimeout(() => inputRef.current?.focus(), 0);
    fetch('/content/api/pipeline').then((r) => r.json()).then((d) => setItems(d.recent ?? [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const go = (href: string) => () => { setOpen(false); router.push(href); };
  const cmds: Cmd[] = [
    ...[...PAGES, ...(admin ? ADMIN_PAGES : [])].map(([href, label]) => ({ id: href, label, group: 'Go to', run: go(href) })),
    { id: 'new-signal', label: 'Capture a new signal', group: 'Create', run: go('/content/ideas#capture') },
    { id: 'run-all', label: 'Run full pipeline', group: 'Run', run: () => a.call('all', 'POST', '/content/api/run', undefined, summarizeRun) },
    ...modules.map((m) => ({ id: `run-${m.id}`, label: `Run ${m.title}`, group: 'Run', run: () => a.call(m.id, 'POST', `/content/api/modules/${m.id}/run`, undefined, summarizeRun) })),
    ...items.map((it) => ({ id: it.id, label: `${it.title} · ${it.platform}`, group: 'Post', run: go(`/content/board?item=${it.id}`) })),
  ];

  const shown = cmds.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())).slice(0, 40);

  if (!open) return null;
  return (
    <>
      <div className="scrim" style={{ zIndex: 59 }} onClick={() => setOpen(false)} />
      <div className="palette" role="dialog" aria-label="Command palette">
        <input ref={inputRef} value={q} placeholder="Search pages, posts, or run a step…" aria-label="Search"
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, shown.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === 'Enter') shown[sel]?.run();
          }} />
        <ul role="listbox">
          {shown.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => c.run()}>
              {c.label}<span className="grp">{c.group}</span>
            </li>
          ))}
          {!shown.length && <li className="faint">No match.</li>}
        </ul>
        <div style={{ padding: '8px 16px 12px', minHeight: 20 }}>{a.busy ? <span className="faint mono">▸ running…</span> : a.feedback}</div>
      </div>
    </>
  );
}

export function PaletteButton() {
  return (
    <button type="button" className="btn" onClick={() => window.dispatchEvent(new Event('open-palette'))} aria-label="Open command palette">
      ⌕ Search <kbd>Ctrl K</kbd>
    </button>
  );
}
