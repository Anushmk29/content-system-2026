'use client';
// Sidebar navigation. Badges are counts that need a human (server-computed in the layout).
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavBadges { approvals: number; ideas: number; training: number; systemBroken: number; scripts: number; design: number }

/** The one page list: the sidebar and the ⌘K palette both read it. */
// Labels match each page's heading. `keywords` are the other words people search for (⌘K).
export const GROUPS: { label: string; admin?: boolean; links: { href: string; label: string; ico: string; badge?: keyof NavBadges; danger?: boolean; keywords?: string }[] }[] = [
  { label: 'Your day', links: [
    { href: '/content', label: 'Today', ico: '01', keywords: 'home dashboard tasks to do' },
    { href: '/content/approvals', label: 'Approvals', ico: '02', badge: 'approvals', keywords: 'review sign approve drafts check' },
    { href: '/content/calendar', label: 'Calendar', ico: '03', keywords: 'schedule when going out dates plan' },
    { href: '/content/analytics', label: 'Results', ico: '04', keywords: 'analytics performance reach views numbers metrics how is it going' },
  ] },
  { label: 'Making posts', links: [
    { href: '/content/ideas', label: 'Ideas', ico: '05', badge: 'ideas', keywords: 'topics signals new post write draft' },
    { href: '/content/design', label: 'Design', ico: '06', badge: 'design', keywords: 'visual image carousel picture graphic' },
    { href: '/content/scripts', label: 'Film & post', ico: '07', badge: 'scripts', keywords: 'video script reel short reddit record' },
    { href: '/content/board', label: 'All posts', ico: '08', keywords: 'board every post stage status pipeline search' },
  ] },
  { label: 'Brand', links: [
    { href: '/content/brand', label: 'Brand kit', ico: '09', keywords: 'voice audience logo colours fonts offers settings' },
    { href: '/content/styles', label: 'Design examples', ico: '10', keywords: 'styles templates look examples' },
  ] },
  { label: 'Research', links: [
    { href: '/content/decode', label: 'Competitors', ico: '11', keywords: 'decode spy rivals what works' },
    { href: '/content/videos', label: 'Competitor videos', ico: '12', keywords: 'videos transcripts reels' },
    { href: '/content/hooks', label: 'Opening lines', ico: '13', keywords: 'hooks first line' },
  ] },
  { label: 'Before posting', links: [
    { href: '/content/check', label: 'Creative Check', ico: '14', keywords: 'neurocreative review attention hook fixes triggers psychology video check' },
  ] },
  { label: 'Admin', admin: true, links: [
    { href: '/content/training', label: 'Training', ico: '15', badge: 'training' },
    { href: '/content/costs', label: 'Costs', ico: '16', keywords: 'money spend billing' },
    { href: '/content/system', label: 'System', ico: '17', badge: 'systemBroken', danger: true, keywords: 'health connections broken fix' },
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
      <Link href={admin ? '/content/system' : '/content'} className="brand">
        <span className="brand-mark" />
        <span><b>Content</b><small>{brandName.toLowerCase() || 'studio'}</small></span>
      </Link>
      {(admin ? [...GROUPS.filter((g) => g.admin), ...GROUPS.filter((g) => !g.admin)] : GROUPS.filter((g) => !g.admin)).map((g) => (
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
