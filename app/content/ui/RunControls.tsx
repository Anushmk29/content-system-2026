'use client';
// Top-bar split button: run the whole pipeline, or one step from the menu (each step shows
// its last status). Results land next to the button, coloured by outcome.
import { useEffect, useRef, useState } from 'react';
import { useAction, summarizeRun } from './actions';
import { RUN_COLOR } from './format';

export function RunControls({ modules }: { modules: { id: string; title: string; lastStatus: string }[] }) {
  const a = useAction();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  const run = (path: string, key: string) => { setOpen(false); a.call(key, 'POST', path, undefined, summarizeRun); };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <span style={{ maxWidth: 420 }}>{a.feedback}</span>
      <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
        <button type="button" className="btn btn-brand" style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
          disabled={a.pending} onClick={() => run('/content/api/run', 'all')}>
          {a.busy === 'all' ? '▸ running…' : '▶ run pipeline'}
        </button>
        <button type="button" className="btn btn-brand" aria-haspopup="menu" aria-expanded={open} aria-label="Run one step"
          style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: '1px solid var(--ink-2)', padding: '6px 9px' }}
          disabled={a.pending} onClick={() => setOpen((o) => !o)}>
          {a.busy && a.busy !== 'all' ? '…' : '▾'}
        </button>
        {open && (
          <div className="menu" role="menu">
            <div className="label" style={{ padding: '6px 12px' }}>Run one step</div>
            {modules.map((m, i) => (
              <button key={m.id} role="menuitem" type="button" onClick={() => run(`/content/api/modules/${m.id}/run`, m.id)}>
                <span className="mono faint" style={{ width: 16 }}>{i + 1}</span>
                <span className="dot" style={{ '--c': RUN_COLOR[m.lastStatus] ?? RUN_COLOR.never } as React.CSSProperties} />
                <span style={{ flex: 1 }}>{m.title}</span>
                <span className="faint mono" style={{ fontSize: 11 }}>{m.lastStatus}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
