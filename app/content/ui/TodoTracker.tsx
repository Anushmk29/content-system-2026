'use client';
// Built-in task list (Weekly Review drops recommendations here). Server data in, refresh after each change.
import { useState } from 'react';
import { useAction } from './actions';

interface Todo { id: string; title: string; detail: string | null; status: string; priority: number }

const STATUS_NEXT: Record<string, string> = { open: 'in_progress', in_progress: 'done', done: 'open' };
const STATUS_COLOR: Record<string, string> = { open: 'var(--muted)', in_progress: 'var(--warn)', done: 'var(--ok)', archived: 'var(--faint)' };

export function TodoTracker({ initial }: { initial: Todo[] }) {
  const a = useAction();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('3');
  const todos = initial.filter((t) => t.status !== 'archived');

  return (
    <div>
      <form style={{ display: 'flex', gap: 8, marginBottom: 10 }}
        onSubmit={async (e) => { e.preventDefault(); if (title.trim() && await a.call('add', 'POST', '/content/api/todos', { title, priority: Number(priority) })) setTitle(''); }}>
        <input className="input" placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="New task" />
        <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)} style={{ width: 76 }} aria-label="Priority">
          {[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>P{p}</option>)}
        </select>
        <button type="submit" className="btn" disabled={a.pending || !title.trim()}>Add</button>
      </form>
      <ul className="row-list">
        {todos.map((t) => (
          <li key={t.id} className="row">
            <button type="button" className="chip" title="Click to move to the next status" disabled={a.pending}
              style={{ '--c': STATUS_COLOR[t.status] ?? 'var(--faint)', cursor: 'pointer' } as React.CSSProperties}
              onClick={() => a.call(t.id, 'PATCH', `/content/api/todos/${t.id}`, { status: STATUS_NEXT[t.status] ?? 'open' })}>
              {t.status.replace('_', ' ')}
            </button>
            <span className="grow t" style={{ textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' ? 'var(--faint)' : undefined }} title={t.detail ?? undefined}>
              {t.title}
            </span>
            <span className="mono faint" style={{ fontSize: 11.5 }}>P{t.priority}</span>
            <button type="button" className="btn btn-sm" aria-label={`Delete ${t.title}`} disabled={a.pending}
              onClick={() => a.call(t.id, 'DELETE', `/content/api/todos/${t.id}`)} style={{ color: 'var(--danger)' }}>✕</button>
          </li>
        ))}
        {!todos.length && <li className="empty">No tasks. You&apos;re clear.</li>}
      </ul>
      <div style={{ marginTop: 6 }}>{a.feedback}</div>
    </div>
  );
}
