'use client';
// Weekly Review and manually added tasks share the same list and API.
import { useEffect, useRef, useState } from 'react';
import { useAction } from './actions';

interface Todo { id: string; title: string; detail: string | null; status: string; priority: number }

const PRIORITY = ['Highest', 'High', 'Normal', 'Low', 'Lowest'];

export function TodoTracker({ initial }: { initial: Todo[] }) {
  const a = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('3');
  const active = initial.filter((t) => t.status === 'open' || t.status === 'in_progress').sort((a, b) => a.priority - b.priority);
  const completed = initial.filter((t) => t.status === 'done');

  useEffect(() => {
    const reveal = () => { if (window.location.hash === '#tasks') setExpanded(true); };
    const followTaskLink = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('a[href="#tasks"]')) setExpanded(true);
    };
    reveal();
    window.addEventListener('hashchange', reveal);
    document.addEventListener('click', followTaskLink);
    return () => {
      window.removeEventListener('hashchange', reveal);
      document.removeEventListener('click', followTaskLink);
    };
  }, []);

  useEffect(() => { if (adding) input.current?.focus(); }, [adding]);

  const row = (t: Todo) => (
    <li key={t.id} className="row task-row">
      <input type="checkbox" checked={t.status === 'done'} disabled={a.pending}
        aria-label={`${t.status === 'done' ? 'Reopen' : 'Complete'} ${t.title}`}
        onChange={(e) => a.call(t.id, 'PATCH', `/content/api/todos/${t.id}`, { status: e.target.checked ? 'done' : 'open' })} />
      <div className="grow task-copy" data-done={t.status === 'done' || undefined}>
        <span>{t.title}</span>
        {t.detail && <small>{t.detail}</small>}
      </div>
      <span className="task-priority">P{t.priority} · {PRIORITY[t.priority - 1]}</span>
      {t.status === 'open' && <button type="button" className="btn btn-sm" disabled={a.pending}
        onClick={() => a.call(t.id, 'PATCH', `/content/api/todos/${t.id}`, { status: 'in_progress' })}>Start task</button>}
      {t.status === 'in_progress' && <span className="chip">In progress</span>}
      <button type="button" className="btn btn-sm" aria-label={`Delete ${t.title}`} disabled={a.pending}
        onClick={() => a.call(t.id, 'DELETE', `/content/api/todos/${t.id}`)}>×</button>
    </li>
  );

  return (
    <section id="tasks" className="today-tasks" aria-label="Tasks">
      <div className="task-toolbar">
        <button type="button" className="task-toggle" aria-expanded={expanded} aria-controls="task-list" onClick={() => setExpanded(!expanded)}>
          <span aria-hidden>{expanded ? '▾' : '▸'}</span> Tasks <span className="muted">{active.length} open</span>
        </button>
        <button type="button" className="btn btn-sm" aria-expanded={adding && expanded} aria-controls="task-form"
          onClick={() => { setExpanded(true); setAdding(expanded ? !adding : true); }}>Add task</button>
      </div>
      <div id="task-list" hidden={!expanded}>
        {adding && <form id="task-form" className="task-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (title.trim() && await a.call('add', 'POST', '/content/api/todos', { title, priority: Number(priority) })) {
              setTitle('');
              setAdding(false);
            }
          }}>
          <input ref={input} className="input" placeholder="What needs doing?" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} aria-label="New task" required />
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
            {PRIORITY.map((label, i) => <option key={label} value={i + 1}>P{i + 1} · {label}</option>)}
          </select>
          <button type="submit" className="btn btn-primary" disabled={a.pending || !title.trim()}>{a.busy === 'add' ? 'Adding…' : 'Add'}</button>
        </form>}
        <ul className="row-list">
          {active.map(row)}
          {!active.length && <li className="empty">No open tasks. Add a task when you need one.</li>}
        </ul>
        {completed.length > 0 && <details className="completed-tasks">
          <summary>Completed · {completed.length}</summary>
          <ul className="row-list">{completed.map(row)}</ul>
        </details>}
      </div>
      {a.feedback && <div className="task-feedback">{a.feedback}</div>}
    </section>
  );
}
