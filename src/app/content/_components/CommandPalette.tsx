'use client';
// ⌘K / Ctrl+K palette: jump to a page, open a recent post, or run a pipeline step.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAction, summarizeRun } from './actions';
import { GROUPS } from './Nav';

interface Cmd { id: string; label: string; group: string; run: () => void; keywords?: string }


export function CommandPalette({ modules, admin }: { modules: { id: string; title: string }[]; admin: boolean }) {
  const router = useRouter();
  const a = useAction();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [items, setItems] = useState<{ id: string; title: string; platform: string }[]>([]);
  const dlg = useRef<HTMLDialogElement>(null);

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
    if (!open) { dlg.current?.close(); return; }
    dlg.current?.showModal(); // focuses the search box (first focusable)
    setQ(''); setSel(0); a.clear();
    fetch('/content/api/pipeline').then((r) => r.json()).then((d) => setItems(d.recent ?? [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const go = (href: string) => () => { setOpen(false); router.push(href); };
  const cmds: Cmd[] = [
    ...GROUPS.filter((g) => admin || !g.admin).flatMap((g) => g.links).map(({ href, label, keywords }) => ({ id: href, label, keywords, group: 'Go to', run: go(href) })),
    { id: 'new-signal', label: 'Capture a new signal', group: 'Create', run: go('/content/ideas#capture') },
    { id: 'run-all', label: 'Run full pipeline', group: 'Run', run: () => a.call('all', 'POST', '/content/api/run', undefined, summarizeRun) },
    ...modules.map((m) => ({ id: `run-${m.id}`, label: `Run ${m.title}`, group: 'Run', run: () => a.call(m.id, 'POST', `/content/api/modules/${m.id}/run`, undefined, summarizeRun) })),
    ...items.map((it) => ({ id: it.id, label: `${it.title} · ${it.platform}`, group: 'Post', run: go(`/content/board?item=${it.id}`) })),
  ];

  const shown = cmds.filter((c) => `${c.label} ${c.keywords ?? ''}`.toLowerCase().includes(q.toLowerCase().trim())).slice(0, 40);

  // Native modal: Escape closes it (onClose), a click on the backdrop lands on the dialog itself.
  return (
    <dialog ref={dlg} className="palette" aria-label="Command palette" onClose={() => setOpen(false)}
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <input value={q} placeholder="Search pages, posts, or run a step…" aria-label="Search"
        onChange={(e) => { setQ(e.target.value); setSel(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, shown.length - 1)); }
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
    </dialog>
  );
}

export function PaletteButton() {
  return (
    <button type="button" className="btn" onClick={() => window.dispatchEvent(new Event('open-palette'))} aria-label="Open command palette">
      ⌕ Search <kbd>Ctrl K</kbd>
    </button>
  );
}
