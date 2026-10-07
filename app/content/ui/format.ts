// Shared display helpers (server + client safe: no engine imports).

/** "3 min ago" / "in 2 d" — relative to now. */
export function ago(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const ms = new Date(v).getTime() - Date.now();
  const abs = Math.abs(ms);
  const [n, u] =
    abs < 60_000 ? [0, 'now'] :
    abs < 3_600_000 ? [Math.round(abs / 60_000), 'min'] :
    abs < 86_400_000 ? [Math.round(abs / 3_600_000), 'h'] :
    [Math.round(abs / 86_400_000), 'd'];
  if (u === 'now') return 'just now';
  return ms < 0 ? `${n} ${u} ago` : `in ${n} ${u}`;
}

/** Absolute timestamp for tooltips. */
export function when(v: string | Date | null | undefined): string {
  if (!v) return '';
  return new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function shortDate(v: string | Date): string {
  return new Date(v).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function compact(n: number | null | undefined): string {
  // Fixed locale: server and browser must render the same text (hydration), e.g. "1.2k".
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n ?? 0)).toLowerCase();
}

export function prettyPillar(p: string): string {
  return p.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export const PLATFORM: Record<string, { label: string; glyph: string; color: string }> = {
  blog: { label: 'Blog', glyph: 'B', color: '#b7791f' },
  linkedin: { label: 'LinkedIn', glyph: 'in', color: '#0a66c2' },
  x: { label: 'X', glyph: 'X', color: '#111111' },
  instagram: { label: 'Instagram', glyph: 'IG', color: '#c13584' },
  facebook: { label: 'Facebook', glyph: 'f', color: '#1877f2' },
  reddit: { label: 'Reddit', glyph: 'r/', color: '#ff4500' },
  email: { label: 'Email', glyph: '@', color: '#0f766e' },
  youtube: { label: 'YouTube', glyph: '▶', color: '#e02424' },
};

export const STATUS_LABEL: Record<string, string> = {
  idea: 'Idea', draft: 'Draft', qc_passed: 'QC passed', needs_approval: 'Needs approval', approved: 'Approved',
  queued: 'Scheduled', published: 'Published', performance_captured: 'Measured', archived: 'Archived',
};

export const STATUS_COLOR: Record<string, string> = {
  idea: '#a3a29b', draft: '#2f5fb3', qc_passed: '#4f46e5', needs_approval: '#b7791f', approved: '#7c3aed',
  queued: '#0e7490', published: '#2f8f4e', performance_captured: '#2f8f4e', archived: '#c9c8c1',
};

/** Category palette (formats, pillars, chart series), in order. "No clear format" is NO_CATEGORY. */
export const CATEGORY = ['#2f5fb3', '#c2410c', '#2f8f4e', '#7c3aed', '#b7791f', '#0e7490', '#be185d', '#4d7c0f', '#92400e', '#475569', '#9333ea'];
export const NO_CATEGORY = '#b5b4ad';
export const PILLAR_COLOR = CATEGORY.slice(0, 4);

/** Semantic tones as CSS vars, so pages never hard-code a hex. */
export const TONE = {
  ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)', info: 'var(--info)',
  violet: 'var(--violet)', teal: 'var(--teal)', ink: 'var(--ink)', muted: 'var(--muted)', faint: 'var(--faint)',
} as const;

export const RUN_COLOR: Record<string, string> = {
  ok: TONE.ok, degraded: TONE.warn, error: TONE.danger, running: TONE.teal, skipped: TONE.faint, never: '#c9c8c1',
};

export const HEALTH_COLOR: Record<string, string> = {
  ok: TONE.ok, degraded: TONE.warn, error: TONE.danger, unconfigured: TONE.faint,
};

/** Needs attention? Jev and Apify are optional, so leaving them unconfigured is fine. */
export const healthIssue = (a: { id: string; state: string }) =>
  a.state !== 'ok' && !(a.state === 'unconfigured' && (a.id === 'jev' || a.id === 'apify'));

/** Rebuild a URL with some query params changed (null removes). */
export function withParams(path: string, current: Record<string, string | undefined>, patch: Record<string, string | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...patch })) if (v != null && v !== '') q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
