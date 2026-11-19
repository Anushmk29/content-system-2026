// Guided tour for new clients: on each page, the things to do in order. `at` is a CSS selector
// for the element to ring; a comma list falls back to the empty state when the list is empty.
// No `at` (or nothing on screen): the tip shows in the middle. One entry per client page in GROUPS
// (guide.test.ts checks this); `next` is where the tour carries on.
export interface TourStep { text: string; at?: string }
export interface PageGuide { steps: TourStep[]; next?: string }

const HEAD = '.page-head h1';

export const GUIDE: Record<string, PageGuide> = {
  '/content': {
    steps: [
      { at: HEAD, text: 'This is Today, your home page. It lists what needs you, most urgent first.' },
      { at: '#needs-you', text: 'Start here. Each card is one thing waiting on you.' },
      { at: '#needs-you .needs .acts .btn-primary, #needs-you > div.attention', text: 'Press the main button on the top card to do it now.' },
      { at: '#tasks', text: 'Your own to-do list. Tick things off as you go.' },
    ],
    next: '/content/brand',
  },
  '/content/brand': {
    steps: [
      { at: HEAD, text: 'Your Brand kit. Every post the AI writes follows it, so fill it in first.' },
      { at: '.kit-meter', text: 'How complete your kit is. The button fills the next gap.' },
      { at: '#your-voice', text: 'How you sound. Check the words feel like you.' },
      { at: '#look', text: 'Your logo, colours and fonts for every visual.' },
      { at: '#your-accounts', text: 'Connect your accounts so Results can read your numbers.' },
    ],
    next: '/content/decode',
  },
  '/content/decode': {
    steps: [
      { at: HEAD, text: 'Competitors: see what works for them, then make your own version.' },
      { at: '.dc-watch li:last-child input[aria-label="Competitor name"], .dc-run button.linkish[aria-expanded]', text: 'Add a competitor here: a handle or page URL works.' },
      { at: '.dc-go .btn-lime, .dc-go .btn-ink', text: 'Press scan. It collects their public posts and breaks them down.' },
      { at: '.next .next-card summary.btn-lime, .dc-bar ~ p.empty', text: 'After a scan, press "make my version" on a top post to write yours on the same structure.' },
    ],
    next: '/content/ideas',
  },
  '/content/ideas': {
    steps: [
      { at: HEAD, text: 'Ideas: pick what gets written next.' },
      { at: '#capture textarea[aria-label="Signal"], #capture', text: 'Write anything worth posting about: a customer question, a win, some news.' },
      { at: '#capture button[type="submit"]', text: 'Save it. It joins the list below.' },
      { at: '.page-next .btn-primary', text: 'This button is always the next thing to do here: make posts, score, or draft.' },
      { at: '.idea-grid > .idea:first-child .idea-foot .btn-primary, .idea-grid > .idea:first-child, #topics ~ p.empty', text: 'On an idea you like, press "Write this". The AI drafts a version for each platform.' },
    ],
    next: '/content/design',
  },
  '/content/design': {
    steps: [
      { at: HEAD, text: 'Design: make the picture or carousel for each drafted post.' },
      { at: 'nav.dz-stages', text: 'Posts move through these steps, left to right.' },
      { at: '.dz-card .cr-create button, .dz-grid > .dz-card:first-child, .dz-empty', text: 'Press Create on a post. It follows your brand and Design examples.' },
      { at: '.dz-card .cr-upload', text: 'Or upload your own picture instead.' },
    ],
    next: '/content/approvals',
  },
  '/content/approvals': {
    steps: [
      { at: HEAD, text: 'Approvals: nothing goes out until you approve it.' },
      { at: '.page-next .btn-primary, .page-next .btn', text: 'Press this to open the oldest draft waiting for you.' },
      { at: '[data-key="approve"]', text: 'Read it, fix any words, then Approve. It goes to the Calendar.' },
      { at: '[data-key="changes"]', text: 'Not right? Ask for changes with a short note saying why.' },
    ],
    next: '/content/calendar',
  },
  '/content/calendar': {
    steps: [
      { at: HEAD, text: 'Calendar: what goes out, and when.' },
      { at: '.page-next .btn-primary', text: 'Approved posts without a date wait here. Press Plan a post to pick a time.' },
      { at: '.cal[role="grid"], .tile[aria-busy="true"]', text: 'Or drag a post onto a day. Click any post to read or change it.' },
      { at: 'nav.seg[aria-label="Calendar view"]', text: 'Switch between month and week.' },
    ],
    next: '/content/scripts',
  },
  '/content/scripts': {
    steps: [
      { at: HEAD, text: 'Film & post: videos and Reddit posts you make yourself.' },
      { at: '#to_film .scr-grid > .scr, #to_film, ol.flow + p.empty', text: 'Each card is a script. Read it and record the video.' },
      { at: '#to_film .scr-foot .btn-primary', text: 'Filmed it? Press this to mark it filmed.' },
      { at: '.scr-foot input[aria-label$=" link"]', text: 'Once it is live, paste the post link here so Results can track it.' },
    ],
    next: '/content/analytics',
  },
  '/content/analytics': {
    steps: [
      { at: HEAD, text: 'Results: what performed, and the next move for each post.' },
      { at: '.page-head a[href="/content/brand#your-accounts"], .page-head .acts span > button', text: 'Connect your accounts once, then refresh to pull your latest numbers.' },
      { at: 'nav.seg[aria-label="Range"]', text: 'Pick the period to look at.' },
    ],
    next: '/content',
  },
  '/content/board': {
    steps: [
      { at: HEAD, text: 'All posts: every post, in the column of the step it is at.' },
      { at: 'input[name="q"]', text: 'Search or filter to find a post.' },
      { at: 'nav.seg[aria-label="View"]', text: 'Switch between board and list.' },
      { at: '.kanban, table.table', text: 'Click any post to open it.' },
    ],
    next: '/content',
  },
  '/content/styles': {
    steps: [
      { at: HEAD, text: 'Design examples: designs you like. The AI recreates them with your words and brand.' },
      { at: 'input[name="file"][type="file"]', text: 'Choose an image of a design you like.' },
      { at: 'form:has(input[name="file"]) button[type="submit"]', text: 'Save it. Design will use it for your next visuals.' },
    ],
    next: '/content/design',
  },
  '/content/settings': {
    steps: [
      { at: HEAD, text: 'Keys & settings: your own API keys.' },
      { at: '#setting-CONTENT_OPENROUTER_API_KEY, form[aria-label="Connections settings"]', text: 'Paste your OpenRouter key here. Saved keys stay hidden.' },
      { at: 'form[aria-label="Connections settings"] button[type="submit"]', text: 'Save. It works right away, no restart.' },
    ],
    next: '/content',
  },
  '/content/videos': {
    steps: [
      { at: HEAD, text: 'Competitor videos: what they say, and why they worked.' },
      { at: 'nav[aria-label="Filter by step"]', text: 'Filter by step.' },
      { at: 'ul.vids, p.empty', text: 'Open a video to read it. Use the best ones as ideas for your own scripts.' },
    ],
    next: '/content/hooks',
  },
  '/content/hooks': {
    steps: [
      { at: HEAD, text: 'Opening lines that worked best for competitors. New drafts borrow their shape.' },
      { at: '.hook-filters', text: 'Filter to the platform or style you want.' },
      { at: 'ul.row-list.hooks, p.empty', text: 'Nothing to do here: drafts use these automatically.' },
    ],
    next: '/content/ideas',
  },
};

/** The guide for a path: the longest page href it falls under, so /content/ideas/1 uses Ideas. */
export function guideFor(path: string): { href: string; guide: PageGuide } | null {
  const href = Object.keys(GUIDE)
    .filter((h) => path === h || (h !== '/content' && path.startsWith(`${h}/`)))
    .sort((a, b) => b.length - a.length)[0];
  return href ? { href, guide: GUIDE[href]! } : null;
}
