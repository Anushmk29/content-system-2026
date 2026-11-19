'use client';
// Sidebar navigation. Badges are counts that need a human (server-computed in the layout).
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { GROUPS, type NavBadges } from '../_lib/pages';

export { GROUPS, type NavBadges };

export function Nav({ badges, admin, brandName }: { badges: NavBadges; admin: boolean; brandName: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const groups = admin ? [...GROUPS.filter((g) => g.admin), ...GROUPS.filter((g) => !g.admin)] : GROUPS.filter((g) => !g.admin);
  const current = groups.flatMap((g) => g.links).find((l) => l.href === path)?.label ?? 'Pages';
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); menuButton.current?.focus(); }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  const logout = async () => {
    await fetch('/content/api/login', { method: 'DELETE' }).catch(() => {});
    window.location.href = '/content/login';
  };
  return (
    <nav className="side" aria-label="Content pipeline">
      <div className="nav-header">
      <Link href={admin ? '/content/system' : '/content'} prefetch={false} className="brand">
        <span className="brand-mark" />
        <span><b>Content</b><small>{brandName.toLowerCase() || 'studio'}</small></span>
      </Link>
      <button ref={menuButton} type="button" className="mobile-pages" aria-label={open ? 'Close page menu' : `Open page menu, current page ${current}`}
        aria-expanded={open} aria-controls="content-pages" onClick={() => setOpen(!open)}>
        {current}<span aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      </div>
      <div id="content-pages" className="side-pages" data-open={open}>
      {groups.map((g) => (
        <section key={g.label} className="nav-group" aria-label={g.label}>
          <div className="nav-label">{g.label}</div>
          {g.links.map((l) => {
            const n = l.badge ? badges[l.badge] : 0;
            const active = l.href === '/content' ? path === '/content' : path.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} prefetch={false} className="nav-link" aria-current={active ? 'page' : undefined} onClick={() => setOpen(false)}>
                {l.label}
                {n > 0 && <span className="nav-badge" data-tone={l.danger ? 'danger' : undefined} aria-label={`${n} ${l.danger ? 'issues' : 'pending items'}`}>{n}</span>}
              </Link>
            );
          })}
        </section>
      ))}
      </div>
      <div className="side-foot" data-open={open}>
        <span className="nav-shortcut"><kbd>Ctrl</kbd> <kbd>K</kbd> search &amp; commands</span>
        <button type="button" className="btn btn-sm" onClick={logout}>Sign out</button>
      </div>
    </nav>
  );
}
