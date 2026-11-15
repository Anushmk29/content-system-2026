'use client';
// One client-side action path for every button in the dashboard: call an API route,
// show the result (tone-coloured), send to login on 401, then refresh server data.
import { createContext, useContext, useEffect, useState, useSyncExternalStore, useTransition, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Hologram, type OrbState, type Shape } from './Hologram';

type Tone = 'ok' | 'warn' | 'danger' | 'faint';
const TONE_COLOR: Record<Tone, string> = { ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)', faint: 'var(--faint)' };
const RUN_TONE: Record<string, Tone> = { ok: 'ok', degraded: 'warn', error: 'danger', skipped: 'faint' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ReadOnlyActions = createContext(false);

export function ActionScope({ viewOnly, children }: { viewOnly: boolean; children: ReactNode }) {
  return <ReadOnlyActions.Provider value={viewOnly}>{children}</ReadOnlyActions.Provider>;
}

export function useAction({ reload = false }: { reload?: boolean } = {}) {
  const viewOnly = useContext(ReadOnlyActions);
  const router = useRouter();
  const [refreshing, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: Tone } | null>(null);

  async function call(key: string, method: string, path: string, body?: unknown, okText?: (d: Json) => string, title?: string): Promise<Json | null> {
    if (viewOnly && method !== 'GET') {
      setMsg({ text: 'This admin session is view only.', tone: 'faint' });
      return null;
    }
    setBusy(key); setMsg(null);
    const load = startLoad(title ?? titleFor(method, path));
    try {
      const raw = body === undefined || body instanceof FormData; // FormData sets its own multipart header
      const res = await fetch(path, {
        method,
        headers: raw ? undefined : { 'content-type': 'application/json' },
        body: raw ? (body as FormData | undefined) : JSON.stringify(body),
      });
      const data: Json = await res.json().catch(() => ({}));
      if (res.status === 401) { toLogin(); return null; }
      const ok = res.ok && data?.ok !== false && !data?.error;
      const tone: Tone = !ok ? 'danger' : RUN_TONE[data?.status] ?? 'ok';
      const text = ok ? (okText?.(data) ?? data?.message ?? 'Done') : (data?.message ?? data?.error ?? (res.status >= 500 ? `The server failed (${res.status}). Try again; if it repeats, check System.` : `error ${res.status}`));
      setMsg({ text, tone });
      load.end(ok, text, Array.isArray(data) ? data.map((r: Json) => String(r.moduleId ?? '')).filter(Boolean) : []);
      if (ok) {
        if (reload) window.location.reload();
        else start(() => router.refresh());
      }
      return ok ? data : null;
    } catch (e) {
      setMsg({ text: (e as Error).message, tone: 'danger' });
      load.end(false, (e as Error).message, []);
      return null;
    } finally {
      setBusy(null);
    }
  }

  const feedback: ReactNode = msg && <span role="status" style={{ fontSize: 12.5, color: TONE_COLOR[msg.tone] }}>{msg.text}</span>;
  return { call, busy, pending: viewOnly || busy !== null || refreshing, viewOnly, msg, feedback, clear: () => setMsg(null) };
}

// ---- 3D loader: every call() that runs past SHOW_AFTER_MS opens one shared modal --------
// Steps are the request's real lifecycle (no fake timers): Sent → Processing (with elapsed
// seconds) → Done/Failed. A pipeline run also lists each module that ran as one word.
type Load = { id: number; title: string; done: string[]; now: string; failed?: string; since: number; hidden?: boolean; leaving?: boolean };
let current: Load | null = null;
let seq = 0;
const subs = new Set<() => void>();
const setLoad = (l: Load | null) => { current = l; subs.forEach((f) => f()); };
/** Play the exit animation, then unmount (only if this load still owns the modal). */
const closeLoad = (id: number, patch: Partial<Load> = {}) => {
  if (current?.id !== id) return;
  setLoad({ ...current, ...patch, leaving: true });
  setTimeout(() => { if (current?.id === id) setLoad(patch.hidden ? { ...current, leaving: false } : null); }, 240);
};
const SHOW_AFTER_MS = 600; // quick saves and toggles never flash the modal

const TITLES: [RegExp, string][] = [
  [/\/api\/run$/, 'Running the pipeline'],
  [/\/modules\/([^/]+)\/run$/, 'Running $1'],
  [/\/asset$/, 'Making the creative'],
  [/\/brand\/voice$/, 'Reading the brand voice'],
  [/\/decode$/, 'Starting Decode'],
  [/\/decode\/use$/, 'Making posts from it'],
  [/\/check\/[^/]+\/run$/, 'Starting the check'],
];
const VERB: Record<string, string> = { POST: 'Creating', PATCH: 'Updating', PUT: 'Updating', DELETE: 'Removing' };
function titleFor(method: string, path: string): string {
  for (const [re, t] of TITLES) { const m = path.match(re); if (m) return t.replace('$1', m[1] ?? ''); }
  const noun = path.replace(/^\/content\/api\//, '').split('/')[0]?.replace(/s$/, '') ?? '';
  return `${VERB[method] ?? 'Loading'} ${noun}`.trim();
}

function startLoad(title: string) {
  const id = ++seq;
  const since = Date.now();
  const show = setTimeout(() => setLoad({ id, title, done: ['Sent'], now: 'Processing', since }), SHOW_AFTER_MS);
  return {
    end(ok: boolean, text: string, modules: string[]) {
      clearTimeout(show);
      if (current?.id !== id) return; // never shown, or a newer action took the modal
      setLoad(ok
        ? { ...current, done: [...current.done, 'Processed', ...modules, 'Done'], now: '' }
        : { ...current, now: '', failed: text });
      setTimeout(() => closeLoad(id), ok ? 1300 : 3500);
    },
  };
}

// Each page gets its own holographic shape while a call runs: [shape, hue] keyed by the first
// segment after /content.
const SHAPE_FOR: Record<string, [Shape, number]> = {
  '': ['sphere', 225], ideas: ['diamond', 45], approvals: ['cube', 140], design: ['torus', 300],
  calendar: ['cylinder', 210], scripts: ['cone', 0], board: ['pyramid', 350], decode: ['knot', 190],
  videos: ['saturn', 230], hooks: ['coil', 200], brand: ['heart', 340], styles: ['ring', 270],
  analytics: ['bars', 160], check: ['diamond', 120], training: ['galaxy', 280], costs: ['coin', 40], system: ['gear', 220],
};

/** Mounted once in the layout. */
export function Loader3D() {
  const l = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => current, () => null);
  const path = usePathname();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!l?.now) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') closeLoad(l.id, { hidden: true }); };
    window.addEventListener('keydown', esc);
    return () => { clearInterval(t); window.removeEventListener('keydown', esc); };
  }, [l]);
  if (!l || l.hidden) return null;
  const secs = Math.round((Date.now() - l.since) / 1000);
  const state: OrbState = l.failed ? 'fail' : l.now ? 'run' : 'done';
  const [shape, hue] = SHAPE_FOR[path.split('/')[2] ?? ''] ?? SHAPE_FOR['']!;
  const at = (i: number) => ({ '--i': i }) as React.CSSProperties;
  return (
    <div className={`ld-scrim${l.leaving ? ' ld-out' : ''}`}>
      <div className={`ld ld-${state}`} style={{ '--g': `hsl(${hue} 72% 52%)` } as React.CSSProperties} role="status" aria-live="polite" aria-busy={state === 'run'}>
        <Hologram shape={shape} hue={hue} state={state} />
        <span className="ld-kicker">{state === 'run' ? 'Working' : state === 'done' ? 'Complete' : 'Stopped'}</span>
        <b className="ld-title">{l.title}</b>
        <div className="ld-bar" aria-hidden="true"><i /></div>
        <div className="ld-steps">
          {l.done.map((w, i) => <span key={i} className="ld-step ld-ok" style={at(i)}>✓ {w}</span>)}
          {l.now && <span className="ld-step ld-now" style={at(l.done.length)}><i className="ld-spin" />{l.now} · {secs}s</span>}
          {l.failed && <span className="ld-step ld-bad" style={at(l.done.length)}>✕ Failed</span>}
        </div>
        {l.failed && <p className="ld-err">{l.failed}</p>}
        {l.now && <button type="button" className="ld-btn" onClick={() => closeLoad(l.id, { hidden: true })}>Keep working <kbd>Esc</kbd></button>}
      </div>
    </div>
  );
}

/** A single-shot button bound to an API route. */
export function ApiButton({ path, method = 'POST', body, label, busyLabel = '…', okText, className = 'btn', reload = false }: {
  path: string; method?: string; body?: unknown; label: ReactNode; busyLabel?: ReactNode;
  okText?: (d: Json) => string; className?: string; reload?: boolean;
}) {
  const a = useAction({ reload });
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <button type="button" className={className} disabled={a.pending} onClick={() => a.call('b', method, path, body, okText, typeof label === 'string' ? label : undefined)}>
        {a.busy ? busyLabel : label}
      </button>
      {a.feedback}
    </span>
  );
}

/** Run one pipeline module (e.g. from a Today action). */
export function RunModuleButton({ id, label, className = 'btn btn-sm' }: { id: string; label: string; className?: string }) {
  return <ApiButton path={`/content/api/modules/${id}/run`} label={`▶ ${label}`} busyLabel="▸ running…" okText={summarizeRun} className={className} />;
}

export function summarizeRun(data: Json): string {
  if (Array.isArray(data)) {
    const bad = data.filter((r: Json) => r.status === 'error' || r.status === 'degraded').length;
    return `${data.length} step${data.length === 1 ? '' : 's'} done${bad ? ` · ${bad} had a problem (see Today)` : ''}`;
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
