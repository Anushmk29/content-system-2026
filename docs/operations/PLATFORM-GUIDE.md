# Content Studio — Platform Guide

How to use the content studio, what each button leads to, and where to find things.
It is written for clients and for new team members. You don't need any technical
knowledge to follow it.

> **Where it lives:** everything is under `/content` on your studio's web address
> (for example `https://your-studio.example.com/content`). Locally it is
> `http://localhost:3000/content`.

---

## Contents

1. [What this platform does](#1-what-this-platform-does)
2. [Signing in](#2-signing-in)
3. [First-time setup (6 steps)](#3-first-time-setup-6-steps)
4. [Finding your way around](#4-finding-your-way-around)
5. [The journey of a post: what leads to what](#5-the-journey-of-a-post-what-leads-to-what)
6. [Page by page](#6-page-by-page)
7. ["How do I…?" quick recipes](#7-how-do-i-quick-recipes)
8. [A typical week](#8-a-typical-week)
9. [Safety rules: why something won't go out](#9-safety-rules-why-something-wont-go-out)
10. [Troubleshooting](#10-troubleshooting)
11. [Admin-only pages](#11-admin-only-pages)
12. [Glossary](#12-glossary)

---

## 1. What this platform does

The studio turns what you know into posts that bring in conversations with potential
customers. It does not just "post everywhere". Every post can be traced from the idea
behind it to the results it earned.

The whole flow, start to finish:

```
 Signals            Topics            Drafts             Approval          Scheduled          Live            Results
 (a customer   →   (scored     →   (LinkedIn, X,   →   (you read   →   (Postiz      →   (posted on  →   (reach, engagement,
  question,         1–25 by         blog, Instagram,     and sign)        sends it at      each           "vs your usual",
  a trend,          the AI)         Facebook, Short)                      its time)        platform)      what to do next)
  a competitor)
       ▲                                                                                                          │
       └──────────────────────── the weekly review and hook learning feed back into the next ideas ───────────────┘
```

Three things to know before you start:

- **Nothing is ever posted without a human approving it.** The AI drafts; you decide.
- **You never need the command line.** Every step is a button somewhere in the studio.
- **Broken things are loud.** If a step fails, it shows up as red with a plain-English fix.

---

## 2. Signing in

Go to `/content`. If you are not signed in, you land on the **Sign in** page with one
password field.

| Password | Who uses it | What it opens |
|---|---|---|
| **Client password** | The client (business owner) | The full workspace: Today, Board, Calendar, Approvals, Ideas, Decode, Videos, Scripts, Hooks, Styles, Brand kit, Analytics. You can make changes. |
| **Admin password** | The agency / operator watching the account | Everything above **plus** Training, Costs and System. The admin login is **view only**: it can watch everything but can't change the client's content. |

- After signing in, the client lands on **Today** and the admin lands on **System**.
- If you followed a link to a specific page, you go straight back to it after sign-in.
- **Sign out** is at the bottom of the left sidebar.
- If the password is changed, everyone is signed out and must sign in again.

---

## 3. First-time setup (6 steps)

The first time a client signs in, the studio opens a guided setup instead of the
dashboard. It stays there until setup is finished. Each step saves as you go, so you
can leave and come back; it resumes at the first step that isn't saved yet.

| Step | What you fill in | Why it matters (what it leads to) |
|---|---|---|
| **1 · You** | Your business name and a one-line description of what you do. | Shown on post previews; used in every draft. |
| **2 · Voice** | How your posts should sound. Write it yourself, **or** paste 2–3 posts you've already written (separated by `---`) and let the AI work out your voice. | Every draft is written in this voice. |
| **3 · Audience and themes** | Who you write for, the myths they believe, and 2–6 **themes** (also called *pillars*) with the share of posts each should get. | Topics are scored for fit against this; the **Content mix** chart on Today compares what you post against these shares. |
| **4 · Offers** | What you want people to do: name, link, and a short call to action (e.g. "Free cash-flow review"). | Posts end with one of these offers. Every link gets tracking tags so leads can be traced to the post. |
| **5 · Look** | Logo, fonts and brand colours. | Every image and carousel made from a Style carries these. |
| **6 · Competitors** | The accounts you want to learn from (handle or page URL per platform). | Feeds the **Decode** page. |

Steps 2–5 have **Skip this step**; you can fill them in later on the **Brand kit** page.
Everything in setup can be changed afterwards in **Brand kit** (steps 1–5) and
**Decode → Competitors** (step 6).

---

## 4. Finding your way around

### 4.1 The sidebar

The left sidebar is the main map. Numbers in small badges mean **something needs a
human there**.

| # | Page | One-line purpose | Badge means |
|---|---|---|---|
| 01 | **Today** | Home. What needs you, what goes out next, is everything flowing. | — |
| 02 | **Board** | Every idea, sorted into columns by stage. | — |
| 03 | **Calendar** | What goes out on which day. Drag to plan. | — |
| 04 | **Approvals** | Drafts waiting for your sign-off. | Drafts waiting for you |
| 05 | **Ideas & signals** | Capture ideas, decide which topics get drafted. | Signals + topics waiting for a decision |
| 06 | **Decode** | Study competitors: which formats and hooks work for them. | — |
| 07 | **Videos** | Every competitor/own video found, with transcripts. | — |
| 08 | **Scripts** | YouTube Short scripts for you to film. | Scripts to film or upload |
| 09 | **Hooks** | Library of opening lines that worked. | — |
| 10 | **Styles** | Saved visual templates for images and carousels. | — |
| 11 | **Brand kit** | Your voice, audience, themes, offers, look and accounts. | — |
| 12 | **Analytics** | How posts performed and what to do next with each. | — |
| 13–15 | Training, Costs, System | **Admin only.** See [section 11](#11-admin-only-pages). | System: number of broken things |

### 4.2 The top bar

On every page:

- **⌕ Search (Ctrl K / ⌘K)** opens the command palette. Type to jump to any page, open a
  recent post by its title, capture a new signal, or run a pipeline step.
- **▶ run pipeline** runs every step in order (see [section 5.2](#52-the-pipeline-steps-the-machine-part)).
  The **▾** next to it opens a menu to run **one step only**; each step shows its last
  status (ok / degraded / error / never). The result appears next to the button.
- **Health light** (admin only) shows "all systems ok" or how many issues there are.
  Click it to open System.

### 4.3 The post drawer (opens from almost anywhere)

Click any post on Today, Board, Calendar, Approvals, Analytics or Scripts and a panel
slides in from the right. This drawer is **where you do everything to a single post**.
Press **Esc** or ✕ to close it. The page address gets `?item=…` added, so you can copy
the link and send someone straight to that post.

What's inside, top to bottom:

| Section | What you can do |
|---|---|
| **Header** | See its stage, theme, approval lane and risk level. |
| **Platform copies of this idea** | One idea usually has several copies (LinkedIn, X, blog…). Click a tab to switch between them. |
| **Creative** | Make an image or carousel from a saved **Style**, tick "Add a new picture" for a fresh visual (a few cents), or **Use my own image or video**. Remove it if you don't want one. Not shown for blogs. |
| **Preview** | How it will look on that platform. If the opening line was borrowed from a winning hook, it says which one. |
| **Step 1 · Fix the words** | Edit the hook (first line), body and call to action before approving. Optional: "Want a stronger first line?" lets the AI rewrite the opening in the style of a post that did well. |
| **Step 2 · Decide** | **Approve**, **Changes** or **Reject**. A note is required for Changes and Reject. |
| **Claims** | Every factual claim the AI spotted. Green = has a proof link. Red = "no proof · blocks publish". |
| **Publishing** | Posting time, whether it was sent to Postiz, the live link and the tracked link. For approved posts, pick a posting time here. |
| **Results** | For live posts: the numbers so far, plus a form to type in new numbers (impressions, reach, likes, comments, shares, saves, clicks, qualified engagement). Each save is a new snapshot. |
| **History** | Every decision on this post: who, when, and the note. |

---

## 5. The journey of a post: what leads to what

### 5.1 The stages

Each post moves through these stages. The **Board** has one column per stage, and every
card says what has to happen next.

| Stage | What it means | What moves it forward | Who / where |
|---|---|---|---|
| **Signal** | A raw idea: a customer's question, a trend, a result, a competitor post. | **Research** turns signals into topics. | You (Ideas page) or the **Market Signals** step automatically. |
| **Topic** (new → scored) | A possible post, scored 1–25. | You click **Select to draft** or **Drop**. | You, on **Ideas** or **Today**. |
| **Selected** | Chosen for drafting. | **Draft Generator** writes it. | Button "Draft them now" on Ideas, or run pipeline. |
| **Idea** | An idea card with no draft yet. | Draft it. | Draft Generator. |
| **Draft** | Copy written for each platform. | **QC + Risk Gate** checks it. | Automatic (pipeline). |
| **QC passed** | Passed the quality check. | Routed to approval. | Automatic. |
| **Needs approval** | Waiting on a human. | You **Approve**, ask for **Changes**, or **Reject**. | You, on **Approvals** (or Telegram, if set up). |
| **Approved** | Signed off. | Gets a posting time, then **Postiz Scheduler** sends it. | You set the time (drawer or Calendar drag), or the scheduler picks the next free day. |
| **Scheduled** | Sent to Postiz with a posting time. | Postiz posts it at that time. | Automatic. |
| **Published** | Live on the platform. | Results come in. | **Own Results** / **Analytics Collector** steps, or you type them in. |
| **Measured** | Has performance numbers. | Feeds Analytics, the weekly review and hook learning. | Automatic. |
| **Archived** | Rejected or retired. | — | — |

**What your approval decision leads to:**

- **Approve** → the post moves to *Approved* and joins the publishing queue.
- **Changes** → back to *Draft* with your note, so it can be reworked.
- **Reject** → *Archived*. It won't go out.

### 5.2 The pipeline steps (the machine part)

These are the automatic steps behind the scenes, in order. **▶ run pipeline** runs all of
them; the **▾** menu or the System page runs one at a time.

| # | Step | What it does | Needs |
|---|---|---|---|
| 1 | **Market Signals** | Collects public posts, questions, news and watched competitor pages as new signals. | Optional search/feed keys |
| 2 | **Research Collector** | Turns signals into topics. | AI key |
| 3 | **Topic Scorer** | Scores each new topic on 5 factors (lead intent, reach, brand fit, proof, repurpose). | AI key |
| 4 | **Draft Generator** | Writes every selected topic as a LinkedIn anchor post plus blog, X thread, Instagram carousel and Facebook post. | AI key |
| 5 | **QC + Risk Gate** | Checks quality, flags claims, and sets the approval lane. Sends drafts to Approvals. | AI key |
| 6 | **Postiz Scheduler + UTM** | Schedules approved, proof-complete posts (one per platform per day) with tracked links. | Postiz |
| 7 | **Own Results** | Reads your own accounts to work out "your usual" per platform and fill in results. | Your accounts in Brand kit |
| 8 | **Analytics Collector** | Pulls live numbers for published posts and labels each one (repurpose / improve hook / awareness / archive). | Postiz |
| 9 | **Weekly Review Agent** | Looks at what performed and adds next week's priorities as **Tasks** on Today. | Published results |

A step showing **degraded** is not broken. It means "ready, but a connection isn't set
up yet". For example, approval works fine in the studio even if Telegram isn't connected.

### 5.3 How a topic gets its score

Each topic is scored 1–5 on five factors, and the total (5–25) puts it in a band:

| Total | Band | What to do |
|---|---|---|
| 20–25 | **High: draft now** | Build it this week. |
| 15–19 | **Queue** | Good candidate. Queue it. |
| 10–14 | **Only if timely** | Use only if it's topical right now. |
| under 10 | **Drop** | Drop it or save it for later. |

### 5.4 The other two ways content gets made

Besides signals → topics → drafts, there are two shortcuts:

1. **From a competitor post (Decode → make my version).** Pick a post or a format that
   works for a competitor, click **make my version**, tick the platforms (LinkedIn, X,
   Instagram, Facebook, Blog, YouTube Short) and optionally a picture Style. The AI keeps
   their *structure and hook pattern* but uses your topic, voice and offer. Their numbers,
   names and claims are never copied. About a minute later the drafts are in **Approvals**.
2. **From a Style (Styles → Create with this style).** Make an image or carousel directly
   from a saved template by typing slide text or giving a topic. You download the result
   (PNG, or PDF for LinkedIn carousels).

**YouTube Shorts are never posted automatically.** An approved Short script goes to
**Scripts → To film**. You film it, upload it to YouTube yourself, and paste the link.

---

## 6. Page by page

### Today (`/content`)
**Your home page. Start here every time.**

- **Top numbers:** Needs you · Published this week (vs a target of 5) · Queue runway (days
  of approved content left; under 3 means draft more) · Blocked (approved but can't go out)
  · Reach over 7 days · Best post this week compared with your usual.
- **Your results line:** when your own accounts were last checked, and a **Refresh my
  results** button. If you haven't added your accounts yet, it links to Brand kit.
- **What's waiting on you:** a to-do list, urgent first. Each row has its button right
  there: **Review** (a draft), **Select / Drop** (a topic), **Run / Retry** (a step), **Fix**
  (a broken connection), **View** (a task). Work top to bottom.
- **Up next:** what goes out in the next 7 days.
- **Pipeline:** how many ideas sit at each stage.
- **Content mix:** how your posts split across themes, compared with your targets.
- **Pipeline steps:** last run of each step (green ok, amber degraded, red error).
- **Activity:** recent runs and approvals.
- **Tasks:** a simple to-do list. Add, tick through, delete. The weekly review adds its
  recommendations here.

### Board (`/content/board`)
**Every idea in one place, by stage.**

- Each card is **one idea** with its platform copies shown as small platform icons.
  Amber-highlighted cards are waiting on you. The bottom line of each card says the next step.
- Switch between **board** (columns) and **list** (table) at the top right.
- Filter by title search, platform, theme and stage, then **Apply**. Filters are kept in
  the address, so you can bookmark or share a filtered view.
- Click a card to open the post drawer.

### Calendar (`/content/calendar`)
**What goes out when.**

- Month or week view of planned, scheduled and published posts.
- **Unplanned** lists approved posts with no time yet. **Drag one onto a day** to set its
  posting time. Only approved posts that haven't been sent to Postiz can be moved.
- Top numbers: scheduled, next 7 days, unplanned, published.

### Approvals (`/content/approvals`)
**Read it, then sign it.**

- The queue is **oldest first**. Each row shows the platform, opening line, approval lane
  (*review* in amber, *sensitive* in red) and how many claims lack proof.
- Click **Review →** to open the drawer, edit if needed, then decide.
- Top numbers: waiting · oldest (hours) · over 24h · unproven claims · ready to sign.
- **Keyboard:** `J`/`K` move between drafts · `A` approve · `C` changes · `R` reject ·
  `Esc` close.
- This works on a phone.

### Ideas & signals (`/content/ideas`)
**Where the next posts come from.**

1. **Capture a signal.** Type anything worth a post, like "A clinic owner asked how to cut
   no-shows without hiring staff". Add where it came from (client, reddit…) if you like.
2. **Signals waiting.** Click **Turn into topics (Research)** to have them turned into topics and scored.
3. **Topics to decide.** Each card shows the score ring (out of 25), band, theme, funnel
   stage, a bar for each of the five factors and the customer's own wording. Click
   **Select to draft** or **Drop**.
4. **Selected · waiting to be drafted.** Optionally click **Find angles**. The AI proposes
   5 angles in the form "They think X → We say Y" with a strength score. The strongest is
   used unless you click **Use this** on another. Then click **Draft them now**.

### Decode (`/content/decode`)
**Study the competition.**

- **Competitors:** add the accounts to watch, by handle or page URL. Only public posts are
  used; no logins.
- Start a decode run. The studio collects their public posts, sorts each one into a
  **format**, and breaks each post down (hook, setup, proof, offer, method, benefit, CTA).
  You can watch the posts arrive live; the cost of the run is shown at the top.
- **The map:** every post plotted by reactions against comments + shares. Click a point
  to see **Inside the post** (anatomy, raw caption). Use ← / → to step through the ranking.
- **Top posts:** ranked by how far each beat *that competitor's own usual*. Posts that look
  like bought reach are marked **paid** and hidden by default.
- **Which formats win?** Compare by format, competitor, platform, post type or length.
- **What they do that we don't:** formats that work for them that you haven't used yet,
  strongest first.
- **make my version** on any post or format → drafts land in Approvals (see [5.4](#54-the-other-two-ways-content-gets-made)).
- Also: **Refresh my results** (on Today) runs the same process on *your own* accounts so
  everything can be compared with "your usual".

### Videos (`/content/videos`)
**What competitor videos actually say.**

- Every video Decode found, with length, views, how it did against that account's usual,
  and whether it has a transcript.
- Filter: All · Transcribed · Failed · Not yet.
- Expand **Read transcript** to see the spoken words. **Transcribe / Retry / Redo** runs it
  for one video.
- Needs the transcription tools installed on the server (see System).

### Scripts (`/content/scripts`)
**YouTube Shorts for you to film.**

| Column | What to do |
|---|---|
| **In review** | Drafts still in approval. Opens Approvals. |
| **To film** | Approved. Film it, then click **✓ Filmed**. |
| **Filmed** | Upload it to YouTube, then paste the link. (**Back to film** undoes.) |
| **Uploaded** | Views appear after your next results refresh, compared with your usual. |

Each card shows the spoken hook 🎙, every beat (on-screen text + lines), and the closing line.
To create one: **Decode → make my version → tick YouTube Short**.

### Hooks (`/content/hooks`)
**Opening lines that worked.**

- **What works for you:** once your posts have results, each kind of opening gets a
  learned weight: **use more**, **neutral** or **avoid**. New drafts lean on the winners.
- **The library:** every first line Decode found, ranked. Filter by platform, whose posts
  (yours or competitors') and format. Copy a hook, or open a post to rewrite its opening
  in that style.

### Styles (`/content/styles`)
**Your visual templates.**

1. **Add a style.** Name it and upload a post you like (PNG, JPG or WebP up to 15 MB, or
   every slide of a carousel in order). It's rebuilt **once** as your own template with
   your fonts, colours and room for your words. This costs about 10–40¢, one time.
2. **Check it** against the example. If something's off, open **Fix the template**, say
   what's wrong (e.g. "the headline should be two colours"), and it's remade.
3. **Create with this style.** Pick where it will be posted (size), then type slide text
   or give a topic and let the AI write the slides. Download PNGs or a PDF for LinkedIn.
   Reusing a saved style costs nothing.

Styles also appear in every post drawer's **Creative** section and in Decode's
**make my version**.

### Brand kit (`/content/brand`)
**How your content sounds and looks.** The same sections as setup, editable any time:
Who you are · Your voice · Audience and themes · Offers · Look · **Your accounts**.

**Your accounts** (your own profiles per platform) is what makes "vs your usual" work
everywhere. Without it, posts can't be compared with your normal performance.

> Changing the Brand kit changes **future** drafts and creatives. Posts already drafted
> keep their wording until you edit them.

### Analytics (`/content/analytics`)
**What actually performed.** Pick 7, 30 or 90 days.

- **Top numbers:** published · reach (and clicks) · engagement · the median post against your usual.
- **Results missing:** published posts with no numbers. Click one → add results in the drawer.
- Charts: published per day/week, reach and engagement over time.
- **Best by reach** and **Beat your usual most**.
- **By platform** and **By pillar** (theme) tables.
- **Your formats vs competitors' formats.**
- **Every post** with its **next move**:

| Label | Meaning | What to do |
|---|---|---|
| **Repurpose** | Many saw it and engaged. | Turn it into a carousel, blog or email. |
| **Improve hook** | Beat your usual on a small audience. | New hook or format, then repost. |
| **Awareness** | Seen, but below your usual. | Make fewer posts like this. |
| **Archive** | Low reach and low engagement. | Let it go. |

---

## 7. "How do I…?" quick recipes

| I want to… | Go to | Do this |
|---|---|---|
| Get a new post idea into the system | **Ideas** (or Ctrl K → "Capture a new signal") | Type it in **Capture a signal** → **Turn into topics** |
| Decide what gets written | **Ideas** → Topics to decide | **Select to draft** / **Drop** |
| Get drafts written now | **Ideas** → Selected | **Draft them now** (or ▶ run pipeline) |
| Approve posts | **Approvals** | Review → edit if needed → **Approve** |
| Change the wording of a post | Open the post (any page) | Drawer → **Fix the words** / **Edit copy** |
| Add an image to a post | Open the post | Drawer → **Creative** → pick a Style → **Make creative**, or **Use my own image or video** |
| Choose when a post goes out | **Calendar** (drag) or the post drawer | Set the posting time on an approved post |
| See what goes out this week | **Today** → Up next, or **Calendar** | — |
| Copy a competitor's winning format | **Decode** | Pick the post/format → **make my version** |
| Make a carousel by hand | **Styles** | Pick a style → **Create with this style** |
| Film a Short | **Scripts** | To film → film → **✓ Filmed** → upload → paste link |
| Enter a post's results by hand | Open the post (or Analytics → Results missing) | Drawer → **Results** → type numbers → **Save metrics** |
| Update my results automatically | **Today** | **Refresh my results** |
| See what to repurpose | **Analytics** | Look for **Repurpose** in Every post |
| Change my voice / audience / offers | **Brand kit** | Edit the section and save |
| Add a competitor | **Decode** → Competitors | Name + handles → save |
| Find any page or post fast | Anywhere | **Ctrl K** and type |
| Share a specific post with someone | Open it | Copy the browser address (it includes `?item=…`) |

---

## 8. A typical week

| Day | Focus | Where |
|---|---|---|
| **Monday** | Research and scoring: capture signals, run Research + Scorer, select topics. | Ideas, Decode |
| **Tuesday** | Anchor content: draft the strongest topic properly. | Ideas → Draft them now, post drawer |
| **Wednesday** | Repurpose: check the platform copies, add creatives. | Board, Styles, post drawer |
| **Thursday** | QC, approval and scheduling. | Approvals, Calendar |
| **Friday** | Engagement and review: refresh results, read Analytics, check the weekly review's tasks. | Today, Analytics |

Target: **5 published posts a week**. The Today page tracks it.

---

## 9. Safety rules: why something won't go out

These are built in and can't be switched off from the studio:

1. **Human approval, always.** Nothing publishes without someone approving it.
2. **Honest numbers.** If a post makes a factual claim (a number, a client result) with no
   proof link, it **cannot be published**, even if approved. It shows as **Blocked** on
   Today and as a red "no proof · blocks publish" claim in the drawer. Fix it by rewording
   the claim out of the post, or adding proof.
3. **Approval lanes only go up.** Each draft gets a lane:
   - **review** (amber): normal posts that need a human read.
   - **sensitive** (red): anything mentioning a client claim, a metric, a case study, a
     controversial opinion, a competitor comparison, or someone's face/voice.

   Approving never lowers a lane; a sensitive post stays recorded as sensitive.
4. **One post per platform per day.** The scheduler spreads posts out automatically
   unless you set a time yourself.
5. **Competitor content is never copied.** "make my version" borrows structure only.

---

## 10. Troubleshooting

| What you see | What it means | What to do |
|---|---|---|
| A page says it **needs the database** | The studio can't reach its data. | Tell your operator/admin. |
| A step is **degraded** | Ready, but an optional connection isn't set up. | Nothing urgent. The admin sees which key is missing on System. |
| A step is **error** (red) | It failed. | Click **Retry** on Today. If it fails again, tell your admin; System shows the exact fix. |
| Post is **Blocked** | Approved but has an unproven claim. | Open it → remove the claim or add proof. |
| **Queue runway** is under 3 days | You're running out of approved content. | Capture signals and draft more, or approve what's waiting. |
| Approved post has **no time yet** | It will go out on the next free day for that platform. | Drag it on Calendar if you want a specific day. |
| **"vs your usual"** shows a dash | Your accounts aren't added or results haven't been pulled. | Brand kit → Your accounts, then Today → **Refresh my results**. |
| Decode says **Apify unconfigured** | Competitor collection isn't connected. | Admin adds the Apify token. |
| Videos say **Transcriber unconfigured** | Transcription tools aren't on the server. | Admin installs them (see System). |
| An action says **View only** | You're signed in with the admin password. | Sign in with the client password to make changes. |
| Sent back to **Sign in** | The session ended or the password changed. | Sign in again. |

---

## 11. Admin-only pages

Visible only with the admin password. The admin can watch but not change client content.

### System (`/content/system`)
**Is the machine healthy?** Broken things sort first, each with its fix.

- **Connections:** Database, LLM, Postiz, Apify, TinyFish, YouTube, Transcriber, Jev. Each
  shows its state, what it's for, the settings it uses and, if broken, exactly how to fix it.
- **Pipeline steps:** each step's last status, message, items processed, duration, and a
  **Run** button.
- **Run log** and **Activity** (approvals and runs).
- **Client actions:** every sign-in and change the client made.

### Costs (`/content/costs`)
**Where the money goes.** Every paid call (AI, images, competitor collection, Jev).

- Ranges: Today, Yesterday, 7d, 30d, Month, or custom dates (in IST). **CSV ↓** downloads it.
- By feature, by model, per day, and **unit costs** (per draft, per published post, per
  Decode run). Use these when pricing.
- **Most expensive operations**, each linking to where it happened.
- **Check against provider bills:** compares what was logged with what the provider
  billed. A gap over 5% means a cost isn't being logged. **Untagged** spend in red means
  something needs fixing.

### Training (`/content/training`)
**Teach it your judgment.** Every select/drop and approve/reject is already logged.

- **Label queue:** hard cases where the in-house model (Jev) and the AI disagree, plus
  practice QC examples. Your answers count double.
- **Generate 20 QC practice examples** to add more.
- **Download dataset (JSONL)** exports everything.
- Aim for the Jev ↔ AI agreement rate to reach 85% or more.

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **Signal** | A raw idea: a customer question, trend, result or competitor post. |
| **Topic** | A signal turned into a possible post, with a score out of 25. |
| **Pillar / theme** | One of your 2–6 content themes, set in Brand kit. |
| **Anchor** | The main piece of an idea (usually LinkedIn). The other platforms' copies are repurposed from it. |
| **Angle** | "They think X → We say Y": the argument a post makes. |
| **Hook** | The first line of a post. |
| **CTA** | Call to action: what the reader should do next (your offer). |
| **Claim** | A factual statement in a post. It needs a proof link to publish. |
| **Lane** | How careful the approval must be: *review* or *sensitive*. |
| **QC Gate** | The automatic quality and risk check before approval. |
| **Postiz** | The scheduling tool that posts to LinkedIn, X, Instagram, Facebook. |
| **UTM / tracked link** | Tags on your offer link so a lead can be traced back to the post. |
| **Your usual** | The median result of your own recent posts on a platform. "2× your usual" means twice as good as normal. |
| **Hunt score** | How strongly a competitor post outperformed, used to rank Decode and Hooks. |
| **Format** | A recurring post structure (e.g. "stat card", "myth vs truth"), found by Decode. |
| **Style** | A saved visual template for images and carousels. |
| **Runway** | Days of approved content left before the queue runs dry. |
| **Degraded** | Working, but an optional connection is missing. |
| **Jev** | The in-house decision model that learns from your choices (admin). |
