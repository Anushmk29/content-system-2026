'use client';
// Where an idea gets drafted, picked on the idea card itself: Jev's suggestions come pre-ticked
// (with its confidence), and any other platform is one click away. Each ticked platform can
// switch to another proven writing framework. Saves on every click; nothing to type.
import { useState } from 'react';
import { useAction } from './actions';

export interface PlatformOption { id: string; label: string; frameworks: { id: string; name: string }[] }

export function PlatformPicker({ topicId, options, fit, chosen, defaults, frameworks }: {
  topicId: string;
  options: PlatformOption[];
  /** Jev's probability per platform; null when platform fit hasn't run for this idea. */
  fit: Record<string, number> | null;
  /** The operator's own pick; null = follow Jev (or the default set). */
  chosen: string[] | null;
  defaults: string[];
  frameworks: Record<string, string> | null;
}) {
  const a = useAction();
  const jev = fit ? options.map((o) => o.id).filter((p) => (fit[p] ?? 0) >= 0.5) : [];
  const [picked, setPicked] = useState<string[]>(chosen ?? (jev.length ? jev : defaults));
  const [fw, setFw] = useState<Record<string, string>>(frameworks ?? {});
  const path = `/content/api/topics/${topicId}`;

  const toggle = (p: string) => {
    const next = picked.includes(p) ? picked.filter((x) => x !== p) : options.map((o) => o.id).filter((x) => x === p || picked.includes(x));
    if (!next.length) return; // at least one platform
    setPicked(next);
    void a.call('pick', 'PATCH', path, { platforms: next });
  };
  const setFramework = (p: string, id: string) => {
    const next = { ...fw, [p]: id };
    setFw(next);
    void a.call('fw', 'PATCH', path, { frameworks: next });
  };
  const followJev = () => { setPicked(jev); void a.call('pick', 'PATCH', path, { platforms: null }); };

  return (
    <div className="pp">
      <div className="pp-head">
        <span className="bk-lab">Draft for</span>
        {fit && <span className="faint" style={{ fontSize: 11.5 }}>% = how well Jev thinks it fits</span>}
        {chosen && jev.length > 0 && <button type="button" className="linkish" onClick={followJev} disabled={a.pending}>Use Jev’s pick</button>}
      </div>
      <div className="chips" role="group" aria-label="Platforms to draft for">
        {options.map((o) => (
          <button key={o.id} type="button" className="chip" aria-pressed={picked.includes(o.id)} disabled={a.pending} onClick={() => toggle(o.id)}
            title={jev.includes(o.id) ? 'Suggested by Jev' : undefined}>
            {o.label}{fit?.[o.id] != null && <span className="mono" style={{ opacity: 0.75 }}>{Math.round(fit[o.id]! * 100)}%</span>}
          </button>
        ))}
      </div>
      {options.some((o) => picked.includes(o.id) && o.frameworks.length > 1) && (
        <details className="pp-fw">
          <summary>Writing structure per platform</summary>
          {options.filter((o) => picked.includes(o.id) && o.frameworks.length > 1).map((o) => (
            <label key={o.id} className="pp-row">
              <span>{o.label}</span>
              <select className="input" value={fw[o.id] ?? o.frameworks[0]!.id} onChange={(e) => setFramework(o.id, e.target.value)} disabled={a.pending}>
                {o.frameworks.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
          ))}
        </details>
      )}
      {a.feedback}
    </div>
  );
}
