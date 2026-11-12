// Built-in examples (content-pipeline/assets/examples): designs that work, described for the image
// model so they recreate reliably with our own words. Structure only: none of the originals'
// names, handles, logos or faces carry over (style-service.slidePrompt says so too).
export interface StarterExample { slug: string; name: string; files: string[]; hasPerson: boolean; description: string }

export const STARTER_EXAMPLES: StarterExample[] = [
  {
    slug: 'stories-grid', name: 'Numbered story grid', files: ['stories-grid.png'], hasPerson: false,
    description: 'Landscape-friendly roundup on a light grey (#e9e9e9) background. Top: a huge, heavy black sans-serif title on one line, its last two words in a muted gold (#c8a46a). Below, a 2-column grid of 8 white rounded cards with soft shadows, numbered 1-8 down each column. Each card: a small black square badge with a white number top-left, a bold black card title (1-2 lines) next to it, two lines of smaller grey supporting text under it, and on the right one realistic 3D-style greyscale object or icon that illustrates the card (flags, a padlock, a magnifier, a chart line, glasses, a columned building). Bottom: a full-width black bar with a white bold call to action, one keyword in gold capitals. Clean, editorial, generous spacing.',
  },
  {
    slug: 'journal-carousel', name: 'Founder framework carousel', files: ['journal-carousel-1.png', 'journal-carousel-2.png'], hasPerson: true,
    description: 'Portrait carousel on a flat light grey (#d9d9d9) background with a thin horizontal rule near the top; a small spaced-out sans label sits top-left (author name) and top-right (brand name) on every page. Cover: a big, heavy black sans-serif title over 3-4 lines, left-aligned in the top half, with 2-3 key words in muted gold (#c8a46a); a small monospaced subtitle in spaced letters under it; the bottom half is a cut-out photo of the person from the chest up, smiling, centred, with no background. Content pages: a two-line title (first words gold, rest black, heavy sans) in the upper middle, then 3 bullet lines of small dark grey text with round gold bullets; a small website line bottom-left and a thin gold arrow bottom-right. Minimal, lots of empty grey space.',
  },
  {
    slug: 'my-read-comparison', name: '"My read" comparison', files: ['my-read-comparison.png'], hasPerson: false,
    description: 'Tall infographic on warm off-white (#f5f1e8). Top: a tiny spaced-caps kicker line, then a very large black serif title with its last words on a bright yellow (#ffe14d) highlighter band, and an italic serif subtitle. Next, a white rounded panel showing the product: three screenshot or illustration tiles side by side with short bold labels and one-line captions, joined by small green double arrows, plus a thin footer strip of small caps notes. Below, 4 stacked white rounded rows, each a 3-column table: left = a black rounded number badge and a bold row name with a small "≈ comparison" line; middle = a pale green cell with 1-2 green tick points; right = a pale red cell with 1-2 red cross points. Bottom: a full-width yellow bar with a small caps label "MY READ" and a bold serif one-line verdict. Tiny grey source line at the very bottom.',
  },
  {
    slug: 'story-carousel', name: 'Person story carousel', files: ['story-carousel-1.png', 'story-carousel-2.png'], hasPerson: true,
    description: 'Portrait story carousel on cream (#f3ece0) with a faint dot texture. A thick deep-red (#8b1a1a) ring sits behind the person, cut off by the page edge. Cover: left-aligned text in the top half: a dark grey intro line with one bold phrase, the person\'s role or a short name in large bold deep red, a dark grey line under it, then a bold dark question and two lines of answer. The person, cut out, arms crossed, smiling slightly, stands bottom-right in front of the ring. Bottom-left: a white box with three red chevrons and a bold "swipe" label, and three small lines of teaser text. Story pages: a short paragraph of dark text at the top, then a white rounded speech bubble with big red quote marks holding a one or two line quote in bold, and below it the same person in a working pose (at a laptop) in front of the red ring. Warm, documentary, corporate.',
  },
  {
    slug: 'chalkboard-framework', name: 'Chalkboard framework', files: ['chalkboard-framework.png'], hasPerson: false,
    description: 'A photo of a black glass board mounted on a dark grey wall with four metal pins and a marker tray holding two markers at the bottom. Everything is drawn in hand-written neon marker. Top: a large hand-lettered white title with a pink underline. Left: 6 numbered layers stacked down the board, each in its own colour (green, blue, purple, orange, red, teal), each with a big number, a hand-drawn icon and a two-word layer name. Each layer is a rounded outlined box holding 5 small hand-drawn icons with two-word labels under each, joined to the next layer by small arrows. Right side: three outlined callout boxes ("core idea" with a lightbulb, "why it matters" with ticks, "key takeaway" with a star). Bottom: a red outlined slogan box with three short coloured phrases, and a small doodle of stick people with a speech bubble. Small white brand mark centred at the bottom.',
  },
];
