'use client';
// Who Decode watches. Add / edit / pause competitors inline; handles can be @handles or page URLs.
import { useState } from 'react';
import type { CompetitorRow } from '@pratapai/content-pipeline';
import { useAction } from './actions';

const NETS = [['x', 'X handle'], ['instagram', 'Instagram handle'], ['linkedin', 'LinkedIn company page URL'], ['facebook', 'Facebook page URL']] as const;

export function Competitors({ list }: { list: CompetitorRow[] }) {
  return (
    <ul className="row-list">
      {list.map((c) => <Row key={`${c.id}:${JSON.stringify(c.handles)}:${c.active}:${c.name}`} c={c} />)}
      <Row key={`new:${list.length}`} c={null} />
    </ul>
  );
}

function Row({ c }: { c: CompetitorRow | null }) {
  const a = useAction();
  const [name, setName] = useState(c?.name ?? '');
  const [handles, setHandles] = useState<Record<string, string>>({ ...(c?.handles ?? {}) });
  const dirty = !c || name !== c.name || NETS.some(([k]) => (handles[k] ?? '') !== (c.handles[k] ?? ''));
  const save = (extra: Record<string, unknown> = {}) => a.call('save', 'POST', '/content/api/decode/competitors', { id: c?.id, name, handles, ...extra });
  return (
    <li className="row" style={{ flexWrap: 'wrap', opacity: c && !c.active ? 0.55 : 1 }}>
      <input className="input" placeholder={c ? 'Name' : 'Add a competitor…'} value={name} onChange={(e) => setName(e.target.value)} style={{ width: 170 }} aria-label="Competitor name" />
      {NETS.map(([k, label]) => (
        <input key={k} className="input mono" placeholder={label} aria-label={label} value={handles[k] ?? ''}
          onChange={(e) => setHandles({ ...handles, [k]: e.target.value })} style={{ flex: '1 1 150px', fontSize: 12 }} />
      ))}
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        {c && <label className="mono faint" style={{ fontSize: 11, display: 'inline-flex', gap: 4 }}>
          <input type="checkbox" checked={c.active} disabled={a.pending} onChange={(e) => save({ active: e.target.checked })} /> active
        </label>}
        <button type="button" className={c ? 'btn btn-sm' : 'btn btn-sm btn-ink'} disabled={a.pending || !name.trim() || !dirty} onClick={() => save()}>{c ? 'Save' : 'Add'}</button>
        {c && <button type="button" className="btn btn-sm" disabled={a.pending} onClick={() => confirm(`Remove ${c.name}?`) && a.call('del', 'DELETE', `/content/api/decode/competitors?id=${c.id}`)}>Remove</button>}
        {a.feedback}
      </span>
    </li>
  );
}
