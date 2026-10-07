'use client';
// Hook library list: every decoded opening, best "x their usual" first, filtered in the browser.
import { useMemo, useState } from 'react';
import type { HookRow } from '@pratapai/content-pipeline';
import { Plat } from './viz';
import { MakeMine, type StyleOpt } from './Decode';
import { PLATFORM } from './format';

const SOURCES = [['all', 'all'], ['them', 'competitors'], ['you', 'you']] as const;

export function Hooks({ hooks, styles }: { hooks: HookRow[]; styles: StyleOpt[] }) {
  const [plat, setPlat] = useState('all');
  const [src, setSrc] = useState<(typeof SOURCES)[number][0]>('all');
  const [fmt, setFmt] = useState('');
  const [copied, setCopied] = useState('');
  const plats = useMemo(() => [...new Set(hooks.map((h) => h.platform))], [hooks]);
  const formats = useMemo(() => [...new Set(hooks.flatMap((h) => h.format ?? []))].sort(), [hooks]);
  const shown = hooks.filter((h) => (plat === 'all' || h.platform === plat)
    && (src === 'all' || (src === 'you') === h.self) && (!fmt || h.format === fmt));
  const copy = async (h: HookRow) => {
    await navigator.clipboard.writeText(h.hook).catch(() => {});
    setCopied(h.id);
  };

  return (
    <>
      <div className="hook-filters">
        <nav className="seg" aria-label="Platform">
          {['all', ...plats].map((p) => <button key={p} type="button" aria-current={plat === p ? 'page' : undefined} onClick={() => setPlat(p)}>{PLATFORM[p]?.label ?? p}</button>)}
        </nav>
        <nav className="seg" aria-label="Whose posts">
          {SOURCES.map(([k, l]) => <button key={k} type="button" aria-current={src === k ? 'page' : undefined} onClick={() => setSrc(k)}>{l}</button>)}
        </nav>
        {formats.length > 0 && (
          <select className="input" value={fmt} onChange={(e) => setFmt(e.target.value)} aria-label="Format" style={{ width: 'auto' }}>
            <option value="">every format</option>
            {formats.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
        <span className="faint mono" style={{ fontSize: 11.5 }}>{shown.length} of {hooks.length}</span>
      </div>
      {!shown.length ? <p className="empty">No hooks match these filters.</p> : (
        <ul className="row-list rank hooks">
          {shown.map((h) => (
            <li key={h.id}>
              <div className="row">
                <b className="lift mono" data-win={h.lift > 1 || undefined}>{h.lift.toFixed(1)}x</b>
                <div className="grow">
                  <p className="hook-t">{h.hook}</p>
                  <div className="d"><Plat p={h.platform} /> {h.source}{h.format ? ` · ${h.format}` : ''} · <a href={h.url} target="_blank" rel="noreferrer">open post</a></div>
                </div>
                <span className="acts">
                  <button type="button" className="btn btn-sm" onClick={() => copy(h)}>{copied === h.id ? 'Copied' : 'Copy'}</button>
                  <MakeMine target={{ postId: h.id }} platform={h.platform} styles={styles} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
