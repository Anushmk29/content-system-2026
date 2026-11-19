'use client';

import { useState, type FormEvent } from 'react';
import type { SettingView } from '@pratapai/content-pipeline';
import { ActionScope, useAction } from '@/app/content/_components/actions';

export function SettingsForm({ fields, ready, open = false }: { fields: SettingView[]; ready: boolean; open?: boolean }) {
  const groups = [...new Set(fields.map((f) => f.group))];
  return <details open={open} style={{ margin: '24px 0' }}>
    <summary style={{ cursor: 'pointer' }}><b>Keys &amp; settings</b> <span className="muted">— connections, models, workflow and research</span></summary>
    <p className="muted">Save provider keys and everyday settings here. Changes apply to new operations without restarting the server.</p>
    <p className="bk-note">Saved keys stay hidden. Blank key fields keep the existing key. Server values come from your VPS environment file.</p>
    {!ready && <p role="alert">Settings storage is not installed yet. Run the database migration on your server, then reload this page.</p>}
    <ActionScope viewOnly={false}>
      <div className="bk-sheet">
        {groups.map((group) => <SettingsGroup key={group} group={group} initial={fields.filter((f) => f.group === group)} ready={ready} />)}
      </div>
    </ActionScope>
    <p className="bk-note">Database credentials, login passwords, session keys and server paths are managed on the VPS.</p>
  </details>;
}

function SettingsGroup({ group, initial, ready }: { group: string; initial: SettingView[]; ready: boolean }) {
  const [fields, setFields] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, string | null>>({});
  const a = useAction();
  const changed = Object.keys(drafts).length > 0;
  async function save(e: FormEvent) {
    e.preventDefault();
    const data = await a.call('save-settings', 'PATCH', '/content/api/settings', drafts, () => 'Saved. New operations will use these settings.');
    if (data) {
      setFields((data.fields as SettingView[]).filter((f) => f.group === group));
      setDrafts({});
    }
  }
  return <form className="bk-sec" onSubmit={save} aria-label={`${group} settings`}>
    <div className="bk-head"><h3>{group}</h3><p>{group === 'Connections' ? 'Replace a key without opening a terminal.' : group === 'Models' ? 'Choose the models used by the pipeline.' : group === 'Workflow' ? 'Control spending and routine automation.' : 'Keep your market sources and searches current.'}</p></div>
    <fieldset className="bk-body" disabled={!ready || a.pending} style={{ border: 0, margin: 0, padding: 0 }}>
      <legend className="sr-only">{group}</legend>
      {fields.map((f) => {
        const reset = drafts[f.name] === null;
        const value = reset ? '' : drafts[f.name] ?? f.value ?? '';
        const id = `setting-${f.name}`;
        const update = (value: string) => setDrafts((d) => ({ ...d, [f.name]: value }));
        const props = { id, className: 'input', value, disabled: reset, 'aria-describedby': `${id}-hint`, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => update(e.target.value) };
        return <div className="bk-field" key={f.name}>
          <label className="bk-lab" htmlFor={id}>{f.label}</label>
          {f.options ? <select {...props}>
            <option value="">Built-in default</option>
            {f.options.map((v) => <option key={v} value={v}>{v === '1' ? 'On' : v === '0' ? 'Off' : v}</option>)}
          </select> : f.multiline ? <textarea {...props} rows={3} maxLength={8000} />
            : <input {...props} type={f.secret ? 'password' : f.min !== undefined ? 'number' : 'text'} autoComplete="off" spellCheck={false}
              min={f.min} max={f.max} step={f.integer ? 1 : 'any'} maxLength={8000}
              placeholder={f.secret ? f.configured ? 'Key configured - enter a replacement' : 'No key configured' : undefined} />}
          <span className="bk-note" id={`${id}-hint`}>{f.hint}</span>
          <div className="bk-line">
            <span className="bk-note">{reset ? 'Will use server value after saving' : f.source === 'saved' ? 'Saved in app' : f.source === 'server' ? 'Using server value' : 'Using built-in default'}{f.secret && !reset ? f.configured ? ' · Key configured' : ' · No key' : ''}</span>
            {f.source === 'saved' && <label className="bk-note"><input type="checkbox" checked={reset} onChange={(e) => setDrafts((d) => {
              const next = { ...d };
              if (e.target.checked) next[f.name] = null;
              else delete next[f.name];
              return next;
            })} /> Use server value</label>}
          </div>
        </div>;
      })}
      <div className="bk-save"><button type="submit" className="btn btn-primary" disabled={!changed || !ready || a.pending}>{a.busy ? 'Saving…' : `Save ${group.toLowerCase()}`}</button>{a.feedback}</div>
    </fieldset>
  </form>;
}
