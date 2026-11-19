'use client';
// Top-bar split button: run the whole pipeline, or one step from the menu (each step shows
// its last status). Results land next to the button, coloured by outcome.
import { useRef, type ToggleEvent } from 'react';
import { useAction, summarizeRun } from './actions';
import { RUN_COLOR } from '@/app/content/_lib/format';

export function RunControls({ modules }: { modules: { id: string; title: string; lastStatus: string }[] }) {
  const a = useAction();
  const menu = useRef<HTMLDivElement>(null);
  // The menu is a native popover (top layer; outside click and Escape close it), pinned under the split button.
  const place = (e: ToggleEvent<HTMLDivElement>) => {
    if (e.newState !== 'open') return;
    const r = e.currentTarget.parentElement!.getBoundingClientRect();
    e.currentTarget.style.top = `${r.bottom + 6}px`;
    e.currentTarget.style.right = `${document.documentElement.clientWidth - r.right}px`;
  };

  const run = (path: string, key: string) => { menu.current?.hidePopover(); a.call(key, 'POST', path, undefined, summarizeRun); };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <span style={{ maxWidth: 420 }}>{a.feedback}</span>
      <div style={{ display: 'inline-flex' }}>
        <button type="button" className="btn btn-brand" style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
          disabled={a.pending} onClick={() => run('/content/api/run', 'all')}>
          {a.busy === 'all' ? '▸ starting…' : '▶ run pipeline'}
        </button>
        <button type="button" className="btn btn-brand" aria-haspopup="menu" popoverTarget="run-menu" aria-label="Run one step"
          style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: '1px solid var(--ink-2)', padding: '6px 9px' }}
          disabled={a.pending}>
          {a.busy && a.busy !== 'all' ? '…' : '▾'}
        </button>
        <div ref={menu} id="run-menu" className="menu" role="menu" popover="auto" onBeforeToggle={place}>
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
      </div>
    </div>
  );
}
