'use client';
// One client-side action path for every button in the dashboard: call an API route,
// show the result (tone-coloured), send to login on 401, then refresh server data.
import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

type Tone = 'ok' | 'warn' | 'danger' | 'faint';
const TONE_COLOR: Record<Tone, string> = { ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)', faint: 'var(--faint)' };
const RUN_TONE: Record<string, Tone> = { ok: 'ok', degraded: 'warn', error: 'danger', skipped: 'faint' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export function useAction() {
  const router = useRouter();
  const [refreshing, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: Tone } | null>(null);

  async function call(key: string, method: string, path: string, body?: unknown, okText?: (d: Json) => string): Promise<Json | null> {
    setBusy(key); setMsg(null);
    try {
      const res = await fetch(path, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data: Json = await res.json().catch(() => ({}));
      if (res.status === 401) { toLogin(); return null; }
      const ok = res.ok && data?.ok !== false && !data?.error;
      const tone: Tone = !ok ? 'danger' : RUN_TONE[data?.status] ?? 'ok';
      setMsg({ text: ok ? (okText?.(data) ?? data?.message ?? 'Done') : (data?.message ?? data?.error ?? `error ${res.status}`), tone });
      if (ok) start(() => router.refresh());
      return ok ? data : null;
    } catch (e) {
      setMsg({ text: (e as Error).message, tone: 'danger' });
      return null;
    } finally {
      setBusy(null);
    }
  }

  const feedback: ReactNode = (
    <>
      {msg && <span role="status" style={{ fontSize: 12.5, color: TONE_COLOR[msg.tone] }}>{msg.text}</span>}
    </>
  );
  return { call, busy, pending: busy !== null || refreshing, msg, feedback, clear: () => setMsg(null) };
}

/** A single-shot button bound to an API route. */
export function ApiButton({ path, method = 'POST', body, label, className = 'btn', showFeedback = true }: {
  path: string; method?: string; body?: unknown; label: ReactNode;
  className?: string; showFeedback?: boolean;
}) {
  const a = useAction();
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <button type="button" className={className} disabled={a.pending} onClick={() => a.call('b', method, path, body)}>
        {a.busy ? '…' : label}
      </button>
      {showFeedback && a.feedback}
    </span>
  );
}

/** Run one pipeline module (e.g. from a Today action). */
export function RunModuleButton({ id, label, className = 'btn btn-sm' }: { id: string; label: string; className?: string }) {
  const a = useAction();
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <button type="button" className={className} disabled={a.pending} onClick={() => a.call('run', 'POST', `/content/api/modules/${id}/run`, undefined, summarizeRun)}>
        {a.busy ? '▸ running…' : `▶ ${label}`}
      </button>
      {a.feedback}
    </span>
  );
}

export function summarizeRun(data: Json): string {
  if (Array.isArray(data)) {
    const bad = data.filter((r: Json) => r.status === 'error' || r.status === 'degraded').length;
    return `${data.length} module(s) ran${bad ? ` · ${bad} need attention` : ''}`;
  }
  return data?.message ? `${data.status}: ${data.message}` : (data?.status ?? 'done');
}

/** Session expired (or never logged in): back to the login page, then return here. */
export function toLogin() {
  window.location.href = `/content/login?next=${encodeURIComponent(location.pathname + location.search)}`;
}

/** Navigate somewhere on Escape (closes the item drawer). */
export function EscTo({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) router.push(href, { scroll: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [href, router]);
  return null;
}

/** Keyboard review: J/K move through `ids` (opening each in the drawer), A approves,
 *  C / R jump to the note (both need one). Ignored while typing. */
export function ReviewKeys({ ids, current, hrefFor }: { ids: string[]; current: string | null; hrefFor: Record<string, string> }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable]')) return;
      const i = current ? ids.indexOf(current) : -1;
      const k = e.key.toLowerCase();
      const go = (n: number) => { const id = ids[n]; if (id) router.push(hrefFor[id]!, { scroll: false }); };
      if (k === 'j') go(Math.min(i + 1, ids.length - 1));
      else if (k === 'k') go(Math.max(i - 1, 0));
      else if (k === 'a') (document.querySelector('[data-key="approve"]') as HTMLButtonElement | null)?.click();
      else if (k === 'c' || k === 'r') { e.preventDefault(); document.getElementById('approval-note')?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ids, current, hrefFor, router]);
  return null;
}
