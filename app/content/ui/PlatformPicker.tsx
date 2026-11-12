'use client';
// Jev's plan for an idea: which platforms, in what format, with which writing structure. Shown as
// a short read-only list; the client only opens "Change" when they disagree. Changing is one chip
// per format (plus video scripts you film); the structure is Jev's unless changed there too.
// Saves on every click; nothing to type.
import { useState } from 'react';
import { useAction } from './actions';

export interface PlatformOption {
  id: string; label: string;
  /** Post formats, the first = default (stored as the bare platform id, else `platform:format`). */
  formats: { id: string; label: string }[];
  frameworks: { id: string; name: string }[];
}

/** Jev's platform probabilities plus its format + framework pick per platform. */
export type Fit = Record<string, unknown> & { picks?: Record<string, { format: string; framework: string } | undefined> };

const platformOf = (id: string) => id.split(':')[0]!;

export function PlatformPicker({ topicId, options, on, scripts = [], fit, suggested, chosen, defaults, frameworks }: {
  topicId: string;
  options: PlatformOption[];
  /** Platforms connected in Postiz (null = Postiz not set up). Others can still be ticked, only drafted. */
  on: string[] | null;
  /** Video scripts filmed by a person (Instagram Reel, LinkedIn video, Facebook Reel), shown on their platform's row. */
  scripts?: { id: string; label: string; platform: string }[];
  /** null when platform fit hasn't run for this idea (then the default set is the plan). */
  fit: Fit | null;
  /** Jev's platforms (the engine's suggestedPlatforms: its best few at >= 50%). */
  suggested: string[];
  /** The operator's own pick; null = follow Jev (or the default set). */
  chosen: string[] | null;
  defaults: string[];
  frameworks: Record<string, string> | null;
}) {
  const a = useAction();
  const prob = (p: string) => (typeof fit?.[p] === 'number' ? (fit[p] as number) : null);
  const idFor = (o: PlatformOption, f: string) => (o.formats[0]!.id === f ? o.id : `${o.id}:${f}`);
  // Jev's plan as stored picks: its platforms in its formats.
  const live = (p: string) => !on || on.includes(p);
  const jev = fit ? options.filter((o) => suggested.includes(o.id) && live(o.id)).map((o) => idFor(o, fit.picks?.[o.id]?.format ?? o.formats[0]!.id)) : [];
  const [picked, setPicked] = useState<string[]>(chosen ?? (jev.length ? jev : defaults));
  const [fw, setFw] = useState<Record<string, string>>(frameworks ?? {});
  const [own, setOwn] = useState(!!chosen || Object.keys(frameworks ?? {}).length > 0);
  const [editing, setEditing] = useState(false);
  const path = `/content/api/topics/${topicId}`;

  const save = (next: string[]) => {
    if (!next.some((x) => options.some((o) => o.id === platformOf(x)))) return; // at least one platform to post on
    setPicked(next); setOwn(true);
    void a.call('pick', 'PATCH', path, { platforms: next });
  };
  const postOn = (p: string) => picked.find((x) => !scripts.some((s) => s.id === x) && platformOf(x) === p);
  const pickFormat = (o: PlatformOption, f: string) => {
    const id = idFor(o, f), cur = postOn(o.id);
    save(cur === id ? picked.filter((x) => x !== id) : [...picked.filter((x) => x !== cur), id]);
  };
  const toggleScript = (id: string) => save(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const setFramework = (p: string, id: string) => {
    const next = { ...fw, [p]: id };
    setFw(next); setOwn(true);
    void a.call('fw', 'PATCH', path, { frameworks: next });
  };
  const backToJev = () => {
    setPicked(jev.length ? jev : defaults); setFw({}); setOwn(false); setEditing(false);
    void a.call('pick', 'PATCH', path, { platforms: null, frameworks: {} });
  };

  const formatOf = (o: PlatformOption) => o.formats.find((f) => postOn(o.id) === idFor(o, f.id)) ?? o.formats[0]!;
  const frameworkOf = (o: PlatformOption) => o.frameworks.find((f) => f.id === (fw[o.id] ?? fit?.picks?.[o.id]?.framework)) ?? o.frameworks[0];
  const plan = options.filter((o) => postOn(o.id));
  const vids = scripts.filter((s) => picked.includes(s.id));
  const total = plan.length + vids.length;
  const source = own ? 'Edited by you' : fit ? 'Suggested by Jev' : 'Default plan';
  const Fit = ({ p }: { p: string }) => {
    const v = prob(p);
    if (v == null) return null;
    const pct = Math.round(v * 100);
    return (
      <span className="pp-fit" title={`Jev's estimate of how well this idea suits ${options.find((o) => o.id === p)?.label}: ${pct}%`}>
        <i style={{ '--v': `${pct}%` } as React.CSSProperties} />{pct}% fit
      </span>
    );
  };

  return (
    <div className="pp">
      <div className="pp-head">
        <div>
          <div className="pp-title">What gets written <span className="pp-count">{total} post{total === 1 ? '' : 's'}</span></div>
          <p className="pp-sub">
            {editing
              ? 'Pick one format per platform. Click a picked format again to leave that platform out. Changes save as you click.'
              : fit ? 'Jev picked the platforms this idea suits best, and a format for each. Change it before you draft if you like.'
                : 'The usual platforms for a new idea. Change it before you draft if you like.'}
          </p>
        </div>
        <span className={`pp-src${own ? ' is-own' : ''}`}>{source}</span>
      </div>

      {!editing ? (
        <ul className="pp-plan">
          {plan.map((o) => (
            <li key={o.id}>
              <span className="pp-plat">{o.label}</span>
              <span className="pp-what">
                <span className="pp-fmt">{formatOf(o).label}</span>
                {o.frameworks.length > 1 && <span className="pp-struct">Structure: {frameworkOf(o)?.name}</span>}
                {!live(o.id) && <span className="pp-warn" title="It gets written, but can't be scheduled until this platform is connected in Postiz">Not connected: written, not scheduled</span>}
              </span>
              <Fit p={o.id} />
            </li>
          ))}
          {vids.map((s) => (
            <li key={s.id}>
              <span className="pp-plat">{options.find((o) => o.id === s.platform)?.label}</span>
              <span className="pp-what"><span className="pp-fmt">{s.label} script</span><span className="pp-struct">You film this one and post it yourself</span></span>
              <span />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="pp-plan pp-edit" role="group" aria-label="Platforms and formats to write">
          {options.map((o) => {
            const cur = postOn(o.id);
            const mine = scripts.filter((s) => s.platform === o.id);
            const inPlan = !!cur || mine.some((s) => picked.includes(s.id));
            return (
              <li key={o.id} className={inPlan ? undefined : 'is-off'}>
                <span className="pp-plat">
                  {o.label}
                  <span className="pp-state">{inPlan ? 'Included' : 'Not included'}{!live(o.id) && ' · not connected'}</span>
                </span>
                <span className="pp-what">
                  <span className="chips">
                    {o.formats.map((f) => (
                      <button key={f.id} type="button" className="chip" aria-pressed={cur === idFor(o, f.id)} disabled={a.pending}
                        onClick={() => pickFormat(o, f.id)} aria-label={`${o.label} ${f.label}`}>{f.label}</button>
                    ))}
                    {mine.map((s) => (
                      <button key={s.id} type="button" className="chip" aria-pressed={picked.includes(s.id)} disabled={a.pending}
                        onClick={() => toggleScript(s.id)} title="A video script you film and post yourself">{s.label} script</button>
                    ))}
                  </span>
                  {cur && o.frameworks.length > 1 && (
                    <label className="pp-row">
                      <span>Structure</span>
                      <select className="input" value={frameworkOf(o)!.id} onChange={(e) => setFramework(o.id, e.target.value)} disabled={a.pending}>
                        {o.frameworks.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    </label>
                  )}
                </span>
                <Fit p={o.id} />
              </li>
            );
          })}
        </ul>
      )}

      <div className="pp-foot">
        <button type="button" className={editing ? 'btn btn-sm btn-ink' : 'btn btn-sm'} onClick={() => setEditing(!editing)} aria-expanded={editing}>
          {editing ? 'Done' : 'Change platforms'}
        </button>
        {own && fit && <button type="button" className="linkish" onClick={backToJev} disabled={a.pending}>Go back to Jev’s suggestion</button>}
        {a.pending && <span className="faint">Saving…</span>}
      </div>
      {a.feedback}
    </div>
  );
}
