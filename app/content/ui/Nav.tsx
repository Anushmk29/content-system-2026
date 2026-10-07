'use client';
// Sidebar navigation. Badges are counts that need a human (server-computed in the layout).
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavBadges { approvals: number; ideas: number; training: number; systemBroken: number }

const GROUPS: { label: string; admin?: boolean; links: { href: string; label: string; ico: string; badge?: keyof NavBadges; danger?: boolean }[] }[] = [
  { label: 'Workspace', links: [
    { href: '/content', label: 'Today', ico: '01' },
    { href: '/content/board', label: 'Board', ico: '02' },
    { href: '/content/calendar', label: 'Calendar', ico: '03' },
    { href: '/content/approvals', label: 'Approvals', ico: '04', badge: 'approvals' },
    { href: '/content/ideas', label: 'Ideas & signals', ico: '05', badge: 'ideas' },
    { href: '/content/decode', label: 'Decode', ico: '06' },
    { href: '/content/hooks', label: 'Hooks', ico: '07' },
    { href: '/content/styles', label: 'Styles', ico: '08' },
    { href: '/content/brand', label: 'Brand kit', ico: '09' },
  ] },
  { label: 'Growth', links: [
    { href: '/content/analytics', label: 'Analytics', ico: '10' },
  ] },
  { label: 'Admin', admin: true, links: [
    { href: '/content/training', label: 'Training', ico: '11', badge: 'training' },
    { href: '/content/system', label: 'System', ico: '12', badge: 'systemBroken', danger: true },
  ] },
];

export function Nav({ badges, admin, brandName }: { badges: NavBadges; admin: boolean; brandName: string }) {
  const path = usePathname();
  const logout = async () => {
    await fetch('/content/api/login', { method: 'DELETE' }).catch(() => {});
    window.location.href = '/content/login';
  };
  return (
    <nav className="side" aria-label="Content pipeline">
      <Link href="/content" className="brand">
        <span className="brand-mark" />
        <span><b>Content</b><small>{brandName.toLowerCase() || 'studio'}</small></span>
      </Link>
      {GROUPS.filter((g) => admin || !g.admin).map((g) => (
        <div key={g.label} style={{ display: 'contents' }}>
          <div className="nav-label">{g.label}</div>
          {g.links.map((l) => {
            const n = l.badge ? badges[l.badge] : 0;
            const active = l.href === '/content' ? path === '/content' : path.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} className="nav-link" aria-current={active ? 'page' : undefined}>
                <span className="nav-ico" aria-hidden>{l.ico}</span>
                {l.label}
                {n > 0 && <span className="nav-badge" data-tone={l.danger ? 'danger' : undefined}>{n}</span>}
              </Link>
            );
          })}
        </div>
      ))}
      <div className="side-foot">
        <kbd>Ctrl</kbd> <kbd>K</kbd> search &amp; commands
        <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={logout}>Sign out</button>
      </div>
    </nav>
  );
}
