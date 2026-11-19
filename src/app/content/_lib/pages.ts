// The one page list: the sidebar, the ⌘K palette and the page guide all read it.
// Labels match each page's heading. `keywords` are the other words people search for (⌘K).
export interface NavBadges { approvals: number; ideas: number; training: number; systemBroken: number; scripts: number; design: number }

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
