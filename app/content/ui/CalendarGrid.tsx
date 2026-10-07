'use client';
// Month / week calendar, rendered in the viewer's own timezone. Approved posts that
// haven't gone to Postiz can be dragged onto a day to plan them; everything else is locked.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAction } from './actions';
import { PLATFORM, STATUS_COLOR, STATUS_LABEL } from './format';

export interface CalItem { id: string; title: string; platform: string; status: string; at: string | null; movable: boolean }

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y!, m! - 1, d!); };
const monday = (d: Date) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export function CalendarGrid({ view, anchor, items, unplanned }: {
  view: 'month' | 'week'; anchor: string | null; items: CalItem[]; unplanned: CalItem[];
}) {
  const a = useAction();
  const [today, setToday] = useState<Date | null>(null); // client-only: avoids server/viewer timezone mismatch
  const [over, setOver] = useState<string | null>(null);
  useEffect(() => setToday(new Date()), []);
  if (!today) return <div className="tile" style={{ minHeight: 420 }} aria-busy="true" />;

  const base = anchor ? parse(anchor) : today;
  const start = view === 'week' ? monday(base) : monday(new Date(base.getFullYear(), base.getMonth(), 1));
  const days = view === 'week' ? 7 : Math.ceil(((new Date(base.getFullYear(), base.getMonth() + 1, 0).getTime() - start.getTime()) / 86_400_000 + 1) / 7) * 7;
  const cells = Array.from({ length: days }, (_, i) => addDays(start, i));
  const byDay = new Map<string, CalItem[]>();
  for (const it of items) if (it.at) { const k = key(new Date(it.at)); byDay.set(k, [...(byDay.get(k) ?? []), it]); }

  const step = (n: number) => key(view === 'week' ? addDays(base, 7 * n) : new Date(base.getFullYear(), base.getMonth() + n, 1));
  const href = (p: Record<string, string>) => `/content/calendar?${new URLSearchParams({ view, ...(anchor ? { d: anchor } : {}), ...p })}`;
  const title = view === 'week'
    ? `${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${addDays(start, 6).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : base.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  function drop(day: Date, id: string) {
    setOver(null);
    const moving = [...items, ...unplanned].find((i) => i.id === id);
    if (!moving?.movable) return;
    const t = new Date(day);
    const prev = moving.at ? new Date(moving.at) : null;
    t.setHours(prev ? prev.getHours() : 10, prev ? prev.getMinutes() : 0, 0, 0);
    if (t.getTime() <= Date.now()) t.setTime(Date.now() + 3_600_000); // dropped on today, time already passed
    a.call(id, 'PATCH', `/content/api/items/${id}`, { plannedAt: t.toISOString() });
  }

  const Ev = ({ it }: { it: CalItem }) => (
    <Link href={href({ item: it.id })} scroll={false} className="cal-ev" draggable={it.movable}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', it.id); e.dataTransfer.effectAllowed = 'move'; }}
      style={{ '--c': STATUS_COLOR[it.status] ?? 'var(--faint)' } as React.CSSProperties}
      title={`${it.title} · ${PLATFORM[it.platform]?.label ?? it.platform} · ${STATUS_LABEL[it.status] ?? it.status}${it.at ? ` · ${new Date(it.at).toLocaleString()}` : ''}${it.movable ? ' · drag to reschedule' : it.status === 'queued' ? ' · already in Postiz, reschedule there' : ''}`}>
      <span className="plat" style={{ '--c': PLATFORM[it.platform]?.color ?? 'var(--faint)', fontSize: 10 } as React.CSSProperties}>{PLATFORM[it.platform]?.glyph ?? '?'}</span>
      {it.at && <span className="mono faint">{new Date(it.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</span>
      {!it.movable && it.status === 'queued' && <span className="faint" aria-label="locked">·sent</span>}
    </Link>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 14 }}>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <Link className="btn" href={href({ d: step(-1) })}>←</Link>
        <Link className="btn" href={`/content/calendar?view=${view}`}>Today</Link>
        <Link className="btn" href={href({ d: step(1) })}>→</Link>
        <b style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.4, marginLeft: 6 }}>{title}</b>
        <span style={{ flex: 1 }} />
        {a.feedback}
        <nav className="seg" aria-label="Calendar view">
          <Link href={href({ view: 'month' })} aria-current={view === 'month' ? 'page' : undefined}>Month</Link>
          <Link href={href({ view: 'week' })} aria-current={view === 'week' ? 'page' : undefined}>Week</Link>
        </nav>
      </div>

      {unplanned.length > 0 && (
        <div className="tile" style={{ '--accent': 'var(--warn)', padding: 14 } as React.CSSProperties}>
          <div className="tile-head" style={{ marginBottom: 8 }}>
            <h2 className="tile-title">Approved · no time yet</h2>
            <span className="tile-hint">drag onto a day to plan, or leave it for the scheduler&apos;s next free slot</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {unplanned.map((it) => <div key={it.id} style={{ maxWidth: 280 }}><Ev it={it} /></div>)}
          </div>
        </div>
      )}

      <div className={`cal${view === 'week' ? ' week' : ''}`} role="grid" aria-label={title}>
        {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {cells.map((day) => {
          const k = key(day);
          const list = byDay.get(k) ?? [];
          return (
            <div key={k} className="cal-day" role="gridcell"
              data-out={view === 'month' && day.getMonth() !== base.getMonth() ? '' : undefined}
              data-today={k === key(today) ? '' : undefined}
              data-over={over === k ? '' : undefined}
              onDragOver={(e) => { e.preventDefault(); setOver(k); }}
              onDragLeave={() => setOver((o) => (o === k ? null : o))}
              onDrop={(e) => { e.preventDefault(); drop(day, e.dataTransfer.getData('text/plain')); }}>
              <div className="cal-num">{day.getDate()}{k === key(today) ? ' · today' : ''}</div>
              {list.map((it) => <Ev key={it.id} it={it} />)}
            </div>
          );
        })}
      </div>

      <div className="faint mono" style={{ fontSize: 11, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {['approved', 'queued', 'published', 'performance_captured'].map((s) => (
          <span key={s} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><span className="dot" style={{ '--c': STATUS_COLOR[s] } as React.CSSProperties} />{STATUS_LABEL[s]}</span>
        ))}
        <span>·sent = already in Postiz, reschedule there</span>
      </div>
    </div>
  );
}
