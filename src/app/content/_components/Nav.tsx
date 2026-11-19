'use client';
// Sidebar navigation. Badges are counts that need a human (server-computed in the layout).
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export interface NavBadges { approvals: number; ideas: number; training: number; systemBroken: number; scripts: number; design: number }

/** The one page list: the sidebar and the ⌘K palette both read it. */
// Labels match each page's heading. `keywords` are the other words people search for (⌘K).
export const GROUPS: { label: string; admin?: boolean; links: { href: string; label: string; badge?: keyof NavBadges; danger?: boolean; keywords?: string }[] }[] = [
  { label: 'Your day', links: [
    { href: '/content', label: 'Today', keywords: 'home dashboard tasks to do' },
    { href: '/content/approvals', label: 'Approvals', badge: 'approvals', keywords: 'review sign approve drafts check' },
    { href: '/content/calendar', label: 'Calendar', keywords: 'schedule when going out dates plan' },
    { href: '/content/analytics', label: 'Results', keywords: 'analytics performance reach views numbers metrics how is it going' },
  ] },
  { label: 'Making posts', links: [
    { href: '/content/ideas', label: 'Ideas', badge: 'ideas', keywords: 'topics signals new post write draft' },
    { href: '/content/design', label: 'Design', badge: 'design', keywords: 'visual image carousel picture graphic' },
    { href: '/content/scripts', label: 'Film & post', badge: 'scripts', keywords: 'video script reel short reddit record' },
    { href: '/content/board', label: 'All posts', keywords: 'board every post stage status pipeline search' },
  ] },
  { label: 'Brand', links: [
    { href: '/content/brand', label: 'Brand kit', keywords: 'voice audience logo colours fonts offers settings' },
    { href: '/content/styles', label: 'Design examples', keywords: 'styles templates look examples' },
    { href: '/content/settings', label: 'Keys & settings', keywords: 'api keys openrouter byok models budget connections' },
  ] },
  { label: 'Research', links: [
    { href: '/content/decode', label: 'Competitors', keywords: 'decode spy rivals what works' },
    { href: '/content/videos', label: 'Competitor videos', keywords: 'videos transcripts reels' },
    { href: '/content/hooks', label: 'Opening lines', keywords: 'hooks first line' },
  ] },
  { label: 'Admin', admin: true, links: [
    { href: '/content/training', label: 'Training', badge: 'training' },
    { href: '/content/costs', label: 'Costs', keywords: 'money spend billing' },
    { href: '/content/system', label: 'System', badge: 'systemBroken', danger: true, keywords: 'health connections broken fix settings api keys models budget' },
  ] },
];

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
