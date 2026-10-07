'use client';
// One password field. The client's password opens the workspace; the admin password also
// opens System and Training. Returns to the page that sent you here.
import { useState, type FormEvent } from 'react';

export default function Login() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const res = await fetch('/content/api/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }),
    }).catch(() => null);
    if (res?.ok) {
      const next = new URLSearchParams(location.search).get('next');
      window.location.href = next?.startsWith('/content') ? next : '/content';
    } else {
      setErr(res?.status === 401 ? 'Wrong password.' : 'Could not reach the server.');
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, background: 'var(--paper)' }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 340, display: 'grid', gap: 12 }}>
        <span className="label">Content studio</span>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600 }}>Sign in</h1>
        <input className="input" type="password" autoFocus autoComplete="current-password" value={pw}
          onChange={(e) => setPw(e.target.value)} placeholder="Password" aria-label="Password" />
        <button type="submit" className="btn btn-ink" disabled={!pw || busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {err && <span role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</span>}
      </form>
    </main>
  );
}
