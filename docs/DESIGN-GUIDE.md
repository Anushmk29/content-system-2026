# /content Design Guide: "Editorial Decode"

Source: reference reel `Video-87634.mp4` (38s, 13 frames reviewed 2026-10-01). It shows a page
called "Decode the Invo deal." in which Jev scraped 1,755 videos from 99 creators and sorted them
into 11 formats, Claude broke down each script, and every video was plotted by views and likes.

**Our version (decided 2026-10-02):** a **competitor spy** at `/content/decode`. Apify scrapes
competitors' public posts on **X, Instagram, LinkedIn and Facebook** so we can see what's working
for them, what they're doing, and what *we* should do about it. The theme is **light only**.
Platform captions are the transcript source. §6e covers how the reel's video-only design adapts to
four platforms.

This guide is the single source of truth for the look and behaviour of every page under `/content`.
It **replaces** the dark "futuristic bento" theme from 2026-10-01. Read it before you touch
`app/content/ui/theme.css`, `viz.tsx` or any page.

---

## 1. The idea in one line

A research paper that updates live. Use cream paper and black ink, mono micro-labels, thin rules
(hairlines) instead of cards and shadows, one black tile and one lime tile per page, and numbers that
count up from real progress. Data is the decoration, so there is no glow, gradient, blur or emoji.

## 2. Tokens (replace the `:root` block in theme.css)

```css
:root {
  --paper:    #f4f3ee;  /* page background, warm off-white */
  --paper-2:  #fbfaf6;  /* raised surfaces: chart area, right panel */
  --ink:      #111111;  /* text, black tile, selected tab */
  --ink-2:    #3a3a3a;  /* body copy */
  --muted:    #6b6b66;  /* secondary text */
  --faint:    #a3a29b;  /* micro-labels, axis ticks */
  --rule:     rgba(17,17,17,.10);   /* hairlines */
  --rule-2:   rgba(17,17,17,.22);   /* stronger hairline / hover */
  --lime:     #e6f28d;  /* THE accent: the cost tile, nothing else large */
  --lime-ink: #2d3300;
  --hilite:   #fbf3d6;  /* selected list row background (pale butter) */
  --ok: #2f8f4e; --warn: #b7791f; --danger: #c2410c; --info: #2f5fb3;
  --radius: 4px;        /* almost square; pills are the only round thing */
  --font-ui:   var(--font-inter), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-jet), ui-monospace, Menlo, Consolas, monospace;
  color-scheme: light;
}
```

**Category palette** (format dots, pillars, chart series). These are muted mid-tones that read on
cream. Use them in this order, and give "no clear format" grey `#b5b4ad`:
`#2f5fb3 #c2410c #2f8f4e #7c3aed #b7791f #0e7490 #be185d #4d7c0f #92400e #475569 #9333ea`

**Platform colours** in `format.ts` stay brand colours but render only as a 6px dot or a mono glyph,
never as filled tiles.

**Status colours** (`STATUS_COLOR` and `RUN_COLOR` in format.ts) are re-tuned darker for cream:
idea `#a3a29b`, draft `#2f5fb3`, qc_passed `#4f46e5`, needs_approval `#b7791f`, approved `#7c3aed`,
queued `#0e7490`, published `#2f8f4e`, archived `#c9c8c1`.

**Banned:** `rgba(255,255,255,…)`, box-shadow (except the spotlight), gradients, `backdrop-filter`,
the `body::before` grid, `text-shadow`, emoji icons. Grep for them after every change.

## 3. Typography

| Role | Spec | Example from the reel |
|---|---|---|
| Page headline | Inter 600, 40px/1.05, letter-spacing -1.2px, ink | "Decode the Invo deal." |
| Section headline | Inter 600, 22px, -0.4px | "Which formats win?", "every video on the deal, in one picture" |
| Lede | Inter 400, 14px/1.5, muted, max 70ch, **one sentence** of plain English about what the system did | "1,755 videos from 99 creators posting for Invo. jev sorted each one into a format, claude broke down the scripts…" |
| Micro-label | JetBrains Mono 500, 10.5px, uppercase, letter-spacing 1.2px, faint | `VIDEOS DECODED`, `PERFORMANCE MAP`, `INSIDE THE VIDEO`, `SCRIPT ANATOMY` |
| Eyebrow (above a section) | micro-label, prefixed with section purpose | `INSIDE THE ARCHIVE`, `FOLLOW THE EVIDENCE` |
| KPI number | Inter 500, 30px, tabular-nums, -0.8px | `1,755`, `$2.01` |
| KPI denominator | mono 11px, faint, after a slash | `755 / 11 formats` |
| Data text / beats / legend | JetBrains Mono 12px, ink-2 | `0:04  SETUP  Okay I think I got it.` |
| Hook quote (right panel) | Inter 500, 20px/1.25 | "Trading fifteen minutes for some research. Okay." |

Breadcrumb: mono 11px faint, `·`-separated, sitting above the headline
(`pratap ai · content · decode`).

Sentence case everywhere, and lower-case is fine for tabs and labels the way the reel does it
(`format · creator · platform · length`).

## 4. Layout grammar

- **Page** = breadcrumb, headline, lede, KPI strip, then sections. Max width 1440px with 32px gutters
  (16px on phones).
- **Sections** are separated by a 1px `--rule` line and 40px of space, never by boxes. Each section
  opens with eyebrow, section headline and an optional one-line meta in mono
  (`all creators · all platforms · comparing format · 1,755 videos`).
- **KPI strip** = one row of joined cells with no gaps. Cells share 1px hairline dividers, and the
  whole strip has a 1px rule border. Cell 1 is the **ink cell** (black background, cream text): the
  live, primary count. The last cell is the **lime cell** (cost, or the page's "money" number).
  Everything else sits on paper. 4–6 cells, and they wrap to 2 per row under 720px.
- **Three-pane band** (the signature): `[list 220px] [chart 1fr] [detail 340px]`, all on `--paper-2`
  with hairline borders. Under 1180px the detail pane drops below the chart. Under 820px all three
  stack.
- **Spotlight pattern** (used on every page, not only Decode): a list or chart on the left, a detail
  pane on the right that re-renders for the selected item. Selection lives in the URL (`?item=` and
  `?v=`) so it survives refresh and back.
- Tables become **ruled lists**. Rows are separated by hairlines, have no row backgrounds, and the
  selected row gets `--hilite` plus a 2px ink left border.

## 5. Components (map onto existing files)

| Component | File | Spec |
|---|---|---|
| `PageHead` | viz.tsx | breadcrumb, h1 and lede. `children` = right-aligned actions (`Share`, `Stop`, `Run`). Replaces the old 24px title. |
| `KpiStrip` + `Kpi` | viz.tsx | `Kpi` gets `variant?: 'ink' \| 'lime'`. Label is a micro-label; the value uses `<Count>`. A `denom` prop renders `/ 11 formats`. |
| `Count` | new, `ui/Count.tsx` (client) | Animates from the previous value to the new one with `requestAnimationFrame` over 600ms ease-out. It formats with `toLocaleString`; with `money` it renders `$0.00`. Respects reduced-motion (jumps straight to the value). This is the only animated number primitive. |
| `Section` | viz.tsx (replaces most `Tile` use) | eyebrow, h2, meta line, children. No box. |
| `Pane` | viz.tsx | `--paper-2` background, 1px rule, 16px padding, micro-label header with an optional right-side mono status. Replaces `Tile`. |
| `Tabs` | viz.tsx (reuse `.seg`) | Mono 12px lowercase. The selected tab is an ink-filled 3px-radius chip with paper text; the others are plain text. URL-driven `<Link>`s. |
| `RankedList` | viz.tsx | Each row is a colour dot, a 14px/600 title, a 12.5px muted 1-line description (ellipsis), and right-aligned mono stats. The selected row uses `--hilite` and an ink left border. |
| `Pill` | viz.tsx (replaces `.chip`) | mono 11px, 999 radius, 1px border in the category colour, 8% tint. The `"180x the deal median"` pill is green when >1x and grey when <1x. |
| `StatTrio` | viz.tsx | 3 columns of micro-label over a 20px number (`VIEWS 146k · LIKES 9.8k · LIKES/1K 17.6`). |
| `AnatomyBar` | new, viz.tsx | A segmented horizontal bar, 8px tall, where each beat's width is proportional to its duration and the colour comes from its tag. Below it sits an inline mono legend (`■ hook ■ setup ■ {brand} shows up ■ method ■ benefit ■ other ■ cta`, see §6b). |
| `BeatList` | new, viz.tsx | Each beat has a 2px left border in its tag colour, `0:04` mono faint, a TAG micro-label, and the line in mono 12px. |
| `LogScatter` | new, `ui/LogScatter.tsx` (client) | See §6. |
| Buttons | theme.css | `.btn` is a paper background, 1px rule-2 border, 4px radius, Inter 500 13px. `.btn-ink` is ink background with paper text (Stop, primary). `.btn-lime` is reserved for "Use this format". |
| Drawer | ItemDrawer.tsx | ≥1180px: a right-hand **pane** inside the layout (no scrim). <1180px: keep the overlay drawer, restyled to paper. |
| Sidebar | Nav.tsx, theme.css | Paper background with a hairline right border. Labels are micro-labels. The active link is ink text with a 2px ink left bar and no fill. Badges are mono 10.5px ink pills (danger = `--danger`). The brand mark is a 22px ink square, with no conic gradient. |
| Top bar | layout.tsx | A slim 44px bar with a hairline bottom. Left: health as a `● all systems ok` dot plus mono text. Right: `⌘K`, `Share`, Run. |

## 6. The performance map (`LogScatter`)

- An SVG with a `viewBox` and an HTML layer on top for thumbnails (so `<img>` can be 18–24px squares).
- x = `log10(views)` and y = `log10(likes)`. Domain = data extent padded half a decade. Ticks
  1·10·100·1k·10k·100k·1M in mono 10px faint. Axis titles `views →` (bottom-right) and `likes ↑`
  (top-left) in mono.
- **Reference line:** a vertical 1px ink line at the median views, labelled `deal median 839 views`
  at the top in mono.
- **Trend line:** a dashed (`4 4`) 1px ink line at 50% opacity, from a least-squares fit in log space.
- **Points are always thumbnails, never dots.** Each is a small square `<img>` (2px radius, 1px
  white border so stacked tiles stay separable). There are three visual states:
  | State | Size | Look |
  |---|---|---|
  | `fresh` (newest ~15) | 14px | full colour, opacity 1 |
  | `settled` (everything else) | 9px | `opacity:.28; filter: grayscale(1) blur(1.2px)` |
  | `match` (in the selected format) | 14px | full colour plus a 2px border in the **format colour** |

  Tiles move from `fresh` to `settled` over 900ms. Because settled tiles are blurred, grey and
  stacked, 1,700 of them read as a **smoky density cloud** along the trend line (frames 0:21–0:31),
  not as a scatter of dots.
- **Videos with no like count** are pinned on a strip along the bottom of the chart. The footnote
  says so: `videos without like counts sit off the chart`.
- **The fly-in, as the reel actually shows it (0:04–0:13):**
  - Thumbnails leave the **right edge of the "top videos" grid** and travel to their (x, y) in a
    continuous **stream**. Dozens are in flight at once, overlapping, at about 60% opacity, so the
    path between grid and chart looks like a trail of cards.
  - Each card launches at 22px and shrinks to its `fresh` size as it lands.
  - Implementation: per new row, create the `<img>` at the grid's right-edge rect (FLIP: set the
    `transform` to the start offset, then clear it next frame) with `transition: transform 900ms
    cubic-bezier(.2,.8,.2,1), width/height 900ms, opacity 900ms`.
  - Stagger each poll's batch at **40ms per card**, and cap concurrent flights at about 60 (older
    ones snap straight in) so a big batch doesn't freeze the page.
  - While a run is going, the left grid keeps re-sorting **by views**, so a new top video slides
    into the grid. Animate it with a FLIP of each grid cell over 400ms.
- **Spotlight:** a 3px rounded-square ring (radius 6px) around an **enlarged full-colour thumbnail
  (28px)**, with a white inner gap (`outline` plus `outline-offset:2px`) and
  `box-shadow: 0 0 0 6px rgba(17,17,17,.08)`. That's the only shadow allowed.
  - The ring is ink normally and the **format colour** when a format filter is on.
  - It eases between points over 300ms. While running it auto-follows the newest point.
  - Clicking a point pins it, and so do `?v=<id>` and the ←/→ arrow keys. Pinned state shows
    `pinned · esc to follow`.
- **Hover tooltip:** an ink box with paper text, mono 11px and 3px radius, sitting above the point:
  `@handle · 454k views · 18k likes`, and the format name on line 2.
- **Status (top-right of pane, mono uppercase):** `▸ DECODING · 1,558 / 1,755` while running.
  Otherwise it describes the selection: `28 VIDEOS · MEDIAN 76K · 90.8X THE DEAL`.
- **Footnote** under the chart (mono 10.5px faint): `each tile is one video · log scale both axes ·
  dashed line = typical likes per view · videos without like counts sit off the chart`.
- **Legend** under the footnote: an inline wrap of `● format name (count)` in mono 11.5px, starting
  with `● all formats (1,755)` and ending with `● no clear format (n)`.
  - Clicking a format puts its points in the `match` state and leaves everything else in the cloud.
  - The status line and the "Which formats win?" row both switch to that format.
  - The left grid filters to that format's top videos.
- Accessibility: the SVG gets `role="img"` and an `aria-label` summary, and a visually hidden
  `<table>` of the top 50 points comes after it.

### 6b. "Inside the video" pane (top to bottom, exactly as in the reel)

1. Header row: micro-label `INSIDE THE VIDEO` on the left. On the right, mono `#28 OF 1,755`, which
   is the video's **rank by views** across the run, not the decode order.
2. Thumbnail (about 80×100, 9:16 crop, 3px radius) on the left. To its right:
   - `@handle` (Inter 600 14px)
   - `2026-06-27 · instagram · 37s` (mono 11px faint)
   - the format tag as a grey-tint mono chip with a colour dot, wrapping to 2 lines
   - `original post ↗` (mono 11px, underlined)
3. **Hook / headline:** Inter 500 20px/1.25. Use the spoken hook if there is one, else the post
   caption (the reel shows raw captions with hashtags and emoji, so don't clean them).
4. `StatTrio`: `VIEWS 454k · LIKES 18k · LIKES / 1K 39.1`.
5. Multiplier pill: `180x the deal median`, in mono 11px on a pale green tint (grey if under 1x).
6. `SCRIPT ANATOMY` micro-label, then a segmented bar (8px, square ends). Segment widths follow
   beat durations and **cta is always ink black**. Under it, an inline legend of `■ tag`.
7. Beat list. The rail is one continuous 2px left border, each beat colouring its own stretch with
   its tag colour. Each beat is `-0:03 · INVO SHOWS UP` (mono 10.5px faint, uppercase tag), then the
   line in Inter 13px ink-2.
8. The pane has a fixed height that matches the chart and **scrolls internally**. Its scrollbar is
   visible and styled thin.

**Beat tags** are a fixed set plus one brand tag: `hook · setup · {brand} shows up · method ·
benefit · other · cta`. The brand tag is the moment the product appears ("invo shows up"). It's
the most useful beat for us, because it shows *when* top creators reveal the product. Colours:
hook `#7c3aed`, setup `#b7791f`, brand `#c2410c`, method `#4d7c0f`, benefit `#2f8f4e`,
other `#a3a29b`, cta `#111111`.

### 6c. "Which formats win?" section

- Eyebrow `FOLLOW THE EVIDENCE`, h2 "Which formats win?", then a meta line in mono:
  `all creators · all platforms · comparing format · 1,755 videos`.
- `Tabs`: `format | creator | platform | length`. The selected tab is an ink chip.
- Two columns. On the left, a `RankedList` of formats: each row is a dot, a bold name such as
  `15 minutes on the clock app walkthrough`, and a 1-line muted description. On the right, a sticky
  stat stack: `MATCHING VIDEOS 28` and `MEDIAN VIEWS 35k`, each with the format name as a faint
  caption under it.
- The selected row (butter background with an ink left bar) is **linked both ways** with the chart
  legend. Selecting either one updates the chart, the status line, the stat stack and the left grid.
- Each row gets a lime `use this format →` button on hover or selection. This is our addition, not in
  the reel; it creates an Ideas entry.

### 6d. Page header details from the reel

- Breadcrumb is `·`-separated: `creator collectives · format hunt · decode`. For us that's
  `pratap ai · content · decode`.
- Top-right of the page shows a **data freshness stamp** in mono faint:
  `collection-time snapshot · 2026-09-29`. Every page gets one (`data as of <ts>`).
- The cost cell label is `AI COST · EST`.
- The eyebrow above the three-pane band is `INSIDE THE ARCHIVE`, and the section h2 is lower-case:
  "every video on the deal, in one picture".
- The `Share` button and the window controls in the reel belong to the claude.ai artifact viewer,
  not the page. **Don't copy them.**

### 6e. Adapting the reel to a competitor spy (X · Instagram · LinkedIn · Facebook)

The reel decodes one brand deal of short videos ranked by **views**. Our corpus differs in three
ways, and the design adapts as follows.

1. **There's no common "views" metric.** LinkedIn and most Facebook and Instagram image posts expose
   no views. X does, and Instagram/Facebook only for video. So the map plots what every platform has:
   - **x = reactions** (likes / reactions / hearts), log scale, labelled `reactions →`
   - **y = conversation** (comments + shares/reposts), log scale, labelled `comments + shares ↑`
   - the dashed trend line is "typical conversation per reaction". **Above the line means the post
     started a discussion**, which is the signal worth copying.
   - the vertical reference line is the **median reactions** across the run.
   - `views` is shown in the detail pane when the platform gives it, and is never invented.
2. **Accounts differ wildly in size,** so raw numbers would just rank the biggest competitor. The
   key comparison is **each post against that competitor's own median**:
   - the pill reads `4.2x their usual`, not `x the deal median`
   - the `#rank OF total` is by this outperformance ratio
   - the top-posts grid is sorted by it too
   - the status line reads `28 POSTS · MEDIAN 312 REACTIONS · 3.1X THEIR USUAL`
3. **Most posts aren't videos.**
   - *Thumbnails:* use the post's image or video poster. Text-only posts (common on X and LinkedIn)
     get a **text tile**: a paper square with the first ~6 words in Inter 600 and a platform glyph in
     a corner. These are rendered in CSS, so no image is needed.
   - *Anatomy:* video posts use caption timestamps (`-0:03`). Text and carousel posts use the same
     `AnatomyBar` and `BeatList`, but the beats are **lines or slides** (`¶1`, `¶2`, or `slide 3`)
     instead of timestamps.
   - *Beat tags:* `hook · setup · proof · offer shows up · method · benefit · other · cta`. The
     brand beat becomes **"offer shows up"**, the moment the competitor pitches their own product.

**KPI strip for Decode:** **Posts decoded** (ink) · competitors · sorted into a format `/ n formats`
· median reactions · **AI cost · est** (lime).

**Tabs for "Which formats win?":** `format | competitor | platform | post type | length`.

**"What we can do"**, our addition that turns spying into action. Each format row and each post gets
two lime-outline actions:
- `use this format →` creates an Ideas entry carrying the format, its best example link and its
  anatomy as the template. The existing draft generator writes it in PRATAP's voice.
- `counter-angle →` asks the LLM for our take: what the competitor left out, or where we'd
  disagree. That also lands in Ideas.

There's also a third section under "Which formats win?":
- Eyebrow `FOLLOW THE GAPS`, h2 "What they do that we don't."
- A ranked list of formats with strong competitor performance and **zero matching PRATAP posts** in
  `content_items`.

**Competitors are managed in the dashboard** (no CLI, per the dashboard-first rule). A `Competitors`
pane on the Decode page lists name, platform handles/URLs (X, IG, LinkedIn page, FB page), and an
active toggle, with add/edit inline. Each run picks competitors, platforms and a lookback window
(default 90 days), plus a per-run post cap so Apify spend stays bounded.

**Scraping rules:**
- Public posts only, through Apify actors that need **no login cookie** (LinkedIn company pages,
  FB pages, IG profiles, X profiles). That keeps us within the earlier public-pages posture.
- Apify spend is shown next to AI cost in the lime cell as `$ ai + $ apify`.

## 7. Motion rules (apply everywhere)

1. Motion only reports something real, such as a count changing, a row arriving or the selection
   moving. Nothing animates on page load "for flavour" (delete the `rise` keyframe).
2. Counters animate only on value change and never fake progress. The Decode page polls
   `GET /content/api/decode/:run?after=<n>` every 1000ms while `status='running'`, and each poll's
   delta drives the counters and the fly-ins.
3. Easing is `cubic-bezier(.2,.8,.2,1)` everywhere (durations are in rule 7).
4. `prefers-reduced-motion` turns every one of these into an instant state change (this block already
   exists in theme.css; keep it).
5. A running job always shows `▸ <VERB>ING x / total` and an ink **`⏸ stop`** button (lowercase,
   right-aligned above the detail pane). Stopping is a PATCH, and the module checks for it between
   items. When the run ends or stops, the button becomes a **lime `▶ decode`** button that re-runs or
   resumes.
6. The detail pane swaps content when the spotlight moves with a 150ms crossfade (opacity only, no
   slide), so the panel keeps pace with the spotlight without flicker.
7. Durations: fly-in 900ms, fresh→settled 900ms, grid re-sort 400ms, counters 600ms, spotlight
   300ms, pane crossfade and row highlight 150ms.

**Measured vs estimated:** the *behaviours* above were seen in frames sampled every 0.5s (stream
of cards, shrink on landing, grey blurred cloud, ring around an enlarged thumb, colour on filter,
stop→decode). The exact *millisecond values* are my estimates. Tune them by eye against the reel.

## 8. Every page in this language

| Page | Headline (sentence, period) | KPI strip (ink … lime) | Body |
|---|---|---|---|
| Today `/content` | "Here's what needs you." | **Needs you** · published this week `/ target` · runway days · blocked · **leads 7d** | Section "work top to bottom": a ranked list of actions with inline buttons and the detail pane on the right. Then "up next" ruled list, then "pipeline" funnel as thin ink bars. |
| Board | "Every idea, by stage." | **In flight** · drafts · in QC · awaiting you · **live** | Keep kanban columns, but columns are hairline-separated paper and cards are ruled rows with no shadow. |
| Calendar | "What goes out, and when." | **Scheduled** · next 7d · gaps · **runway** | A hairline month grid. Events are mono rows with a platform dot. Today has an ink top border. |
| Approvals | "Read it, then sign it." | **Waiting** · oldest h · approved 7d · **auto-approved** | Spotlight: queue on the left, platform preview on the right (`ItemDrawer` as a pane). |
| Ideas & signals | "Where the next posts come from." | **Signals** · topics to decide · selected 30d · **from Decode** | Ranked list of signals/topics with source pills (X, Reddit, Decode). |
| **Decode** (new) | "Decode the competition." | **Posts decoded** · competitors · sorted into a format `/ n formats` · median reactions · **AI cost · est** | Competitors pane, then the three-pane band (top posts · performance map · inside the post), "Which formats win?" with `use this format` / `counter-angle`, and "What they do that we don't." (see §6e). |
| Analytics | "What actually performed." | **Impressions 30d** · engagement · leads · cycle days · **cost per lead** | Use the same `LogScatter` for your own posts (views × engagements), plus ranked "which formats win" over your posts. That's one component, two data sources. |
| Leads | "Who raised a hand." | **New** · high intent · called · won · **won value** | Spotlight: ruled lead list on the left, lead detail and Call/Won/Lost on the right. |
| Training | "Teach it your judgment." | **To label** · labelled · agreement % · **Jev vs LLM** | Spotlight label queue. |
| System | "Is the machine healthy." | **Overall** · modules ok · errors 24h · last run · **LLM spend 30d** | Ruled list of modules with a status dot, mono last-run and Run button. |

The lime cell is always the money or cost number. Once AI cost tracking exists (§9), every page that
triggers LLM work shows its spend there.

## 9. Decode data contract (engine side, for reference)

```ts
type Competitor = { id; name; active: boolean;
  handles: { x?: string; instagram?: string; linkedin?: string; facebook?: string } };
type DecodeRun = { id; subject; status: 'running'|'stopped'|'done'|'error';
  competitor_ids; platforms; lookback_days; post_cap;
  total; decoded; sorted; formats: number; competitors: number; median_reactions;
  cost_ai_usd; cost_apify_usd; started_at };
type DecodedPost = { id; run_id; competitor_id; url; platform: 'x'|'instagram'|'linkedin'|'facebook';
  post_type: 'text'|'image'|'carousel'|'video'; handle; thumb|null; posted_at; duration_s|null;
  reactions; comments; shares; views|null;          // views only when the platform reports it
  vs_own_median;                                     // reactions / competitor's median → "4.2x their usual"
  rank;                                              // by vs_own_median → "#28 OF 1,755"
  format_id|null; hook; caption; text_source: 'captions'|'post_text';
  beats: { at: string /* '-0:03' | '¶2' | 'slide 3' */;
           tag: 'hook'|'setup'|'proof'|'offer'|'method'|'benefit'|'other'|'cta'; text: string }[];
  cost_usd };
type DecodeFormat = { id; run_id; name; description; color_idx; our_post_count /* for the gaps list */ };
```

Tables are `content.competitors`, `content.decode_runs`, `content.decoded_posts` and
`content.decode_formats`. Each platform has its own Apify actor behind one adapter
(`adapters/apify.ts`, env `CONTENT_APIFY_TOKEN`, using only actors that need no login cookie). The
adapter normalises each actor's output into `DecodedPost` and records the Apify run cost. The LLM
adapter must return OpenRouter `usage.cost` so `cost_ai_usd` is real.

"Which formats win?" is a SQL `GROUP BY format | competitor | platform | post_type | length bucket`
with `percentile_cont(.5)` of reactions and of `vs_own_median`. The gaps list is formats with a high
median `vs_own_median` and `our_post_count = 0`.

## 10. Build order

1. **Theme pass:** new tokens and fonts in theme.css. Delete the glow, gradients and grid. Delete
   `ui/styles.ts` (no importers). Re-tune format.ts colours. Replace the ~50 hard-coded colours in
   pages (`grep -rE "rgba\(255|#[0-9a-f]{6}" app/content`).
2. **Primitives:** `PageHead`, `KpiStrip`/`Kpi` variants, `Count`, `Section`, `Pane`, `Tabs`,
   `RankedList`, `Pill`, `StatTrio`. Keep the export names of the old `Tile`/`Kpi` until every page
   has moved, then delete them.
3. **Re-skin pages** in the order Today, Approvals (spotlight pane), Leads, Ideas, Board, Calendar,
   Analytics, Training, System.
4. **Decode:** schema, Apify adapter, `decode.module.ts`, the API routes (`POST /decode`,
   `GET /decode/:run?after=`, `PATCH /decode/:run` to stop, `POST /decode/formats/:id/use`), then the
   page with `LogScatter`, `AnatomyBar` and `BeatList`.
5. **Analytics** reuses `LogScatter` on `content.metrics` once metrics are recorded.

**Status (2026-10-02):** steps 1–4 are built. Step 4 code map: `db/schema.sql` (DECODE block, applied
on Supabase), `content-pipeline/src/adapters/apify.ts`, `src/services/decode-service.ts` (+ `decode.test.ts`),
routes under `app/content/api/decode/`, page `app/content/decode/page.tsx`, UI `ui/Decode.tsx`,
`ui/LogScatter.tsx`, `ui/Competitors.tsx`. Departures from this guide: "use this format" is one route
(`POST /decode/use` with `formatId` or `postId`), not `/decode/formats/:id/use`; the run stops/resumes
via `PATCH /decode/:run` and `POST /decode {resumeRunId}`; anatomy widths follow beat text length (no
timestamps without Whisper). Not yet verified against a real Apify token; actor ids are overridable
(`CONTENT_APIFY_ACTOR_X|INSTAGRAM|LINKEDIN|FACEBOOK`).

## 11. Done checklist (run per page)

- [ ] No banned values (`rgba(255`, `gradient`, `backdrop-filter`, `box-shadow` except the spotlight, emoji).
- [ ] Breadcrumb, headline ending in a period, and a one-sentence lede.
- [ ] KPI strip has an ink first cell, a lime last cell, mono micro-labels, and `<Count>` on every number.
- [ ] Sections are separated by rules, not boxes. Lists are ruled, and the selected row is butter
      with an ink bar.
- [ ] Selection is in the URL, and the detail pane updates without a full navigation.
- [ ] Usable at 390px wide with no horizontal scroll. Reduced-motion shows no movement.
- [ ] `next dev` on :3001 is running, so **do not `next build`**. Check visually in the browser instead.

## 12. Evidence, confidence and open decisions

### How this guide was made
- **Pass 1** (2026-10-01): 13 scene-change frames from the 38s reel. This gave the layout,
  tokens and components. The reel has no audio transcript (only burned-in captions).
- **Pass 2** (2026-10-02): 27 more frames sampled every 0.5s over 0:05–0:13 and 0:21–0:31 (the
  animated parts). These corrected and added the motion details below.

### What pass 2 changed (look here first if something seems off)
| Area | Pass 1 assumed | Reel actually shows (now in the guide) |
|---|---|---|
| Fly-in | one card at a time from its grid cell | a continuous **stream** of overlapping semi-transparent cards leaving the grid's right edge, each **shrinking as it lands** (§6) |
| Cloud | small, slightly blurred thumbs | points stay thumbnails, **grey and heavily blurred** and stacked into a smoky cloud along the trend line (§6) |
| Top-videos grid | static | **re-sorts by views** during the run (§6) |
| Format filter | dims the others | matching points go **full colour with a format-colour border**, and the spotlight ring takes the format colour. Legend and ranked list are linked both ways (§6, §6c) |
| Spotlight | ring on a normal point | ring around an **enlarged 28px full-colour thumb** with a white inner gap (§6) |
| Tooltip / no-likes | not covered | ink hover tooltip `@handle · views · likes` plus format. Videos with no likes sit on a bottom strip (§6) |
| Run control | Stop only | `⏸ stop` (ink) turns into lime `▶ decode` when finished (§7) |
| Detail pane | generic detail | exact order: `#rank OF total` (by views), meta line, format chip, `original post ↗`, hook or raw caption, stats, multiplier pill, anatomy bar, beat rail. Scrolls internally and crossfades on change (§6b, §7) |
| Beat tags | hook/setup/proof/payoff/cta | **hook · setup · {brand} shows up · method · benefit · other · cta**. The brand-reveal beat is the most useful for us (§6b, §9) |
| Header | breadcrumb + headline | also a **data-freshness stamp** at top-right and the `AI COST · EST` label. The `Share` button belongs to the claude.ai viewer, so **don't copy it** (§6d) |
| Headline font | serif | tight sans-serif (Inter 600) (§3) |

### Confidence
- **Confirmed from frames:** every layout, component and *behaviour* in §4–§7.
- **Estimated:** all millisecond durations, exact hex values (the reel was filmed off a curved
  monitor, so colours are approximate), and blur and opacity amounts. Tune these by eye against the
  reel. Don't treat them as spec.
- **Not observable:** how Jev and Claude split the work internally, and how the format list is
  generated. §9 is our own design.

### Decisions (resolved 2026-10-02)
1. **Theme:** light only. No dark toggle.
2. **Decode = competitor spy** on **X, Instagram, LinkedIn and Facebook**, using public posts from a
   competitor list managed in the dashboard (§6e).
3. **Scraper:** Apify. `CONTENT_APIFY_TOKEN` still has to be added to `.env` before build step 4
   can run for real. Until then the adapter reports `unconfigured` on System, like Jev does.
4. **Text source:** platform captions or post text. No Whisper.
