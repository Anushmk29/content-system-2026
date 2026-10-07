'use client';
// The labelling queue: each decision where Jev and the LLM disagreed (or an LLM-written
// QC practice example), answers side by side, and the operator saves the right one
// (POST /content/api/decisions). Human labels are the heaviest-weighted training data
// (docs/DECISION-DATASET.md). The Jev column only appears when Jev actually answered.
import { useState } from 'react';
import { FUNNEL_STAGES } from '@pratapai/content-pipeline/core';
import type { TrainingExample } from '@pratapai/content-pipeline';
import { useAction } from './actions';

type Answer = Record<string, unknown>;

const flat = (a: Answer | null): Answer => ({ ...(a ?? {}) });

type Enums = Record<string, readonly string[]>;

/** camelCase field → "Has metric". */
const human = (k: string) => { const s = k.replace(/([A-Z])/g, ' $1').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };

export function LabelQueue({ queue, pillars }: { queue: TrainingExample[]; pillars: string[] }) {
  const enums: Enums = { pillar: pillars, funnelStage: FUNNEL_STAGES };
  if (queue.length === 0) {
    return <p className="empty">Nothing to label. Disagreements show up here once Jev runs in shadow mode; practice examples appear after you generate them.</p>;
  }
  return <div style={{ display: 'grid', gap: 12 }}>{queue.map((e, i) => <LabelCard key={`${e.task}:${e.subjectId}`} ex={e} n={i + 1} of={queue.length} enums={enums} />)}</div>;
}

function LabelCard({ ex, n, of, enums }: { ex: TrainingExample; n: number; of: number; enums: Enums }) {
  const a = useAction();
  const teacher = flat(ex.teacher), jev = flat(ex.jev);
  const hasJev = Boolean(ex.jev);
  const keys = [...new Set([...Object.keys(teacher), ...Object.keys(jev)])];
  const [draft, setDraft] = useState<Answer>(teacher);
  const save = (key: string, answer: Answer) => a.call(key, 'POST', '/content/api/decisions', { task: ex.task, subjectId: ex.subjectId, answer }, () => 'Saved as a training label');

  return (
    <article className="card" style={{ cursor: 'default' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <span className="mono faint" style={{ fontSize: 12 }}>{n}/{of}</span>
        <span className="chip" style={{ '--c': 'var(--muted)' } as React.CSSProperties}>{ex.task.replace('_', ' ')}</span>
        {ex.seed && <span className="chip" style={{ '--c': 'var(--info)' } as React.CSSProperties}>practice example</span>}
        {ex.picked !== null && <span className="faint" style={{ fontSize: 12 }}>you {ex.picked ? 'selected' : 'dropped'} this</span>}
        {ex.outcome && <span className="faint" style={{ fontSize: 12 }}>· market: {ex.outcome}</span>}
      </div>
      <details open={n === 1}>
        <summary className="muted" style={{ cursor: 'pointer', fontSize: 12.5, marginBottom: 8 }}>What the model saw</summary>
        <pre className="pre" style={{ fontSize: 13, background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 4, padding: 12, marginBottom: 10, maxHeight: 280, overflow: 'auto' }}>{ex.state}</pre>
      </details>
      <table className="table">
        <thead><tr><th>Question</th><th>LLM said</th>{hasJev && <th>Jev said</th>}<th>Your answer</th></tr></thead>
        <tbody>
          {keys.map((k) => {
            const differs = hasJev && JSON.stringify(teacher[k]) !== JSON.stringify(jev[k]);
            return (
              <tr key={k} style={{ background: differs ? 'var(--hilite)' : undefined }}>
                <td className="muted">{human(k)}</td>
                <td className="mono">{show(teacher[k])}</td>
                {hasJev && <td className="mono">{show(jev[k])}</td>}
                <td><Field enums={enums} name={k} value={draft[k] ?? teacher[k] ?? jev[k]} onChange={(v) => setDraft({ ...draft, [k]: v })} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn btn-brand" disabled={a.pending} onClick={() => save('mine', draft)}>Save my answer</button>
        <button type="button" className="btn btn-ok" disabled={a.pending} onClick={() => save('llm', teacher)}>LLM was right</button>
        {hasJev && <button type="button" className="btn" disabled={a.pending} onClick={() => save('jev', jev)}>Jev was right</button>}
        {a.feedback}
      </div>
    </article>
  );
}

const show = (v: unknown) => (v === undefined || v === null ? '—' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));

function Field({ enums, name, value, onChange }: { enums: Enums; name: string; value: unknown; onChange: (v: unknown) => void }) {
  const style = { padding: '4px 8px', width: 'auto' };
  if (typeof value === 'boolean') {
    return (
      <select className="input" style={style} value={value ? 'yes' : 'no'} onChange={(e) => onChange(e.target.value === 'yes')} aria-label={name}>
        <option value="yes">yes</option><option value="no">no</option>
      </select>
    );
  }
  if (typeof value === 'number') {
    return (
      <select className="input" style={style} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={name}>
        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    );
  }
  const options = enums[name];
  if (options) {
    return (
      <select className="input" style={style} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} aria-label={name}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return <span className="faint">{show(value)}</span>;
}

/** Asks the LLM for labelled practice drafts for the QC checks (they queue for review). */
export function SeedButton() {
  const a = useAction();
  return (
    <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <button type="button" className="btn" disabled={a.pending}
        onClick={() => a.call('seed', 'POST', '/content/api/decisions/seed', { count: 20 }, (d) => `Added ${d?.created ?? 0} practice examples to review.`)}>
        {a.busy ? 'Writing examples…' : 'Generate 20 QC practice examples'}
      </button>
      {a.feedback}
    </span>
  );
}
