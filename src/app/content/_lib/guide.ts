// Page guide for new clients: what each page is for, what to do there, and where to go next.
// One entry per client page in GROUPS (guide.test.ts checks this).
export interface PageGuide { what: string; steps: string[]; next?: string }

export const GUIDE: Record<string, PageGuide> = {
  '/content': {
    what: 'Your home page. It lists what needs you today, most urgent first.',
    steps: ['Start with "Do first": posts waiting for approval or stuck.', 'Then "Next": ideas to pick and videos to film.', 'Tick off tasks as you finish them.', 'Nothing listed? Add an idea or check Results.'],
    next: '/content/approvals',
  },
  '/content/approvals': {
    what: 'Nothing goes out until you approve it.',
    steps: ['Click Review on a post. It shows exactly how it will look.', 'Fix any words, or add a proof link to claims marked unproven.', 'Approve sends it to the Calendar. Changes or Reject need a short note.'],
    next: '/content/calendar',
  },
  '/content/calendar': {
    what: 'What goes out, and when.',
    steps: ['Approved posts without a time wait in Unplanned.', 'Drag one onto a day, or open it to pick a time.', 'Videos and Reddit posts are on Film & post: you post those yourself.'],
    next: '/content/analytics',
  },
  '/content/analytics': {
    what: 'How your posts performed, and the next move for each.',
    steps: ['Connect your accounts once (the button at the top).', 'Pick a range to compare.', 'Each post shows its next move: repeat it, change it, or drop it.'],
    next: '/content/ideas',
  },
  '/content/ideas': {
    what: 'Pick what gets written next. The AI writes a version for each platform.',
    steps: ['Write anything worth posting about under Capture a signal.', 'Click Make posts to turn it into an idea.', 'Click Score: the best ideas rise to the top.', 'Tick the platforms on an idea you like and click Draft this idea.'],
    next: '/content/design',
  },
  '/content/design': {
    what: 'Make the picture or carousel for each drafted post.',
    steps: ['Open a post marked as needing a visual.', 'Create the visual. It follows your Brand kit and Design examples.', 'Happy with it? The post moves on to Approvals.'],
    next: '/content/approvals',
  },
  '/content/scripts': {
    what: 'Videos and Reddit posts you film and post yourself.',
    steps: ['Open a script under To film and record it.', 'Mark it filmed, then post it on the platform.', 'Paste the post link back so Results can track it.'],
    next: '/content/analytics',
  },
  '/content/board': {
    what: 'Every post, in the column of the step it is at.',
    steps: ['Search or filter to find a post.', 'Click a post to open it.', 'Switch to list view to see more at once.'],
    next: '/content',
  },
  '/content/brand': {
    what: 'How your posts sound and look. Every draft follows this.',
    steps: ['Check your voice, audience and offers are right.', 'Set your logo, colours and fonts.', 'Connect your own accounts so Results can read your numbers.'],
    next: '/content/decode',
  },
  '/content/styles': {
    what: 'Designs you like. The AI recreates them with your words and brand.',
    steps: ['Add an example image of a design you like.', 'Remove any that no longer fit your look.', 'Go to Design to use them.'],
    next: '/content/design',
  },
  '/content/settings': {
    what: 'Your own API keys and everyday settings.',
    steps: ['Paste your OpenRouter key under Connections and save.', 'Saved keys stay hidden. Leave a key blank to keep it.', 'Changes apply right away, no restart needed.'],
    next: '/content',
  },
  '/content/decode': {
    what: 'See what works for your competitors, and make your own version.',
    steps: ['Add a competitor: a handle or page URL works.', 'Press scan to collect their public posts.', 'Start with Make this next: their strongest formats you haven\'t tried.', 'Click make my version to write your own post on the same structure.'],
    next: '/content/ideas',
  },
  '/content/videos': {
    what: 'What competitors\' videos say, and why they worked.',
    steps: ['Open a video to read what it says.', 'Look at why it worked: the hook, the format, the length.', 'Use the best ones as ideas for your own scripts.'],
    next: '/content/hooks',
  },
  '/content/hooks': {
    what: 'The opening lines that worked best for competitors. New drafts borrow their shape.',
    steps: ['Read the top lines for patterns you like.', 'Nothing to do here: drafts use them automatically.', 'Choose an idea to draft with them.'],
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
