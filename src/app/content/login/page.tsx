'use client';
// One password field. The client's password opens the workspace; the admin password also
// opens System and Training. Returns to the page that sent you here.
import { useState, type FormEvent } from 'react';

export default function Login() {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = new FormData(e.currentTarget).get('password');
    setBusy(true); setErr(null);
    const res = await fetch('/content/api/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }),
    }).catch(() => null);
    if (res?.ok) {
      const next = new URLSearchParams(location.search).get('next');
      const { role } = (await res.json().catch(() => ({}))) as { role?: string };
      // The admin lands on its own area; a deep link (anything but the client home) still wins.
      const home = role === 'admin' ? '/content/system' : '/content';
      window.location.href = next?.startsWith('/content') && next !== '/content' ? next : home;
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
        <label htmlFor="studio-password">Password</label>
        <input id="studio-password" name="password" className="input" type="password" autoFocus autoComplete="current-password" required />
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {err && <span role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</span>}
      </form>
    </main>
  );
}
