# Go-Live & Test Guide

Everything in the Bible is **built and tested**. What's left is **wiring** — giving the
engine real accounts (database, LLM, publishing, approvals) and pointing a scheduler at
it. This guide is the operator's checklist: what you provide, how to test each layer, and
exactly what to expect.

> TL;DR for the impatient:
> 1. Create a Postgres DB → run `db/schema.sql` + `db/seed.sql`.
> 2. Copy `.env.content.example` → `.env.content`, fill in `CONTENT_DATABASE_URL` + `CONTENT_OPENROUTER_API_KEY`.
> 3. `cd content-pipeline && npm install && npm test` → expect **48 passing**.
> 4. Drop the package into your Next app (INTEGRATION.md) and open **`/content`** — run the
>    pipeline and do every human step (capture signals, select topics, approve drafts,
>    record results, see leads) from the dashboard. No command line needed.
> 5. Add Postiz + Telegram keys when you want real publishing + an extra approval channel.
>
> **You can run the entire loop from the `/content` dashboard** — the CLI (`npm run pipeline`)
> and curl commands below are just alternatives for headless testing before the UI is wired in.

---

## 1. What you provide

| # | Thing | Required? | Where it goes | Notes |
|---|---|---|---|---|
| 1 | **Supabase database** | ✅ required | `CONTENT_DATABASE_URL` | Supabase project `xaofyedrqdweenubslho`. Everything lives in a `content` schema; Postiz uses its own `postiz` schema in the same project (no local Postgres). |
| 2 | **OpenRouter API key** | ✅ for AI stages | `CONTENT_OPENROUTER_API_KEY` | Powers research, scoring, drafting, triage, weekly review. Get it at openrouter.ai/keys. |
| 3 | LLM model slug | optional | `CONTENT_LLM_MODEL` | Default `anthropic/claude-sonnet-4.5`. Any OpenRouter model works. |
| 4 | **Postiz** (self-hosted) | optional | `CONTENT_POSTIZ_API_URL` + `_API_KEY` | The publishing rail. Without it, publishing degrades (doesn't crash). |
| 5 | **Telegram bot + chat** | optional | `CONTENT_TELEGRAM_BOT_TOKEN` + `_CHAT_ID` | The approval queue. Without it, approval degrades. |
| 6 | Telegram webhook secret | optional | `CONTENT_TELEGRAM_WEBHOOK_SECRET` | Protects the approve/reject webhook. |
| 7 | **Client password** | **required in production** | `CONTENT_RUN_SECRET` | The client's login for the whole dashboard; also the `x-content-secret` header for cron. Production refuses to serve without it. Blank in dev = open. |
| 7b | Admin password | optional | `CONTENT_ADMIN_SECRET` | Your login: also opens System + Training. Changing either password logs everyone out. |
| 8 | A Next.js host app | optional | — | Only needed for the **dashboard + HTTP routes**. The pipeline itself runs headless via `npm run pipeline`. |

**Nothing except the database URL is required to start.** Every integration degrades
gracefully: an unconfigured adapter shows as `unconfigured`/`degraded` on the dashboard
instead of crashing the run.

---

## 2. Setup

### 2.1 Database
Use the Supabase project (or a new one — the `content` schema keeps
it isolated), then:
```bash
psql "$CONTENT_DATABASE_URL" -f db/schema.sql
psql "$CONTENT_DATABASE_URL" -f db/seed.sql      # sample topic + research signals + todos
```
> Supabase: use the **Session/Direct** connection string (port 5432), not the pooler,
> for `psql`. The app can use either.

### 2.2 Env file
```bash
cp .env.content.example .env.content
```
Edit `.env.content` and set at least:
```
CONTENT_DATABASE_URL=postgresql://...
CONTENT_OPENROUTER_API_KEY=sk-or-...
CONTENT_LLM_MODEL=anthropic/claude-sonnet-4.5
```

### 2.3 Build & verify the engine
```bash
cd content-pipeline
npm install
npm test          # expect: 48 passing (no DB / no keys needed)
npm run build     # emits dist/ for a Next bundler to import
```

### 2.4 The dashboard — your control room
The dashboard + HTTP routes (`/content`, `/content/api/*`) drop into an existing Next.js
app — see [INTEGRATION.md](../INTEGRATION.md). **This is the intended way to operate the
system**: once `/content` is live you never need the command line. It gives you:

- **Modules + Run controls** — run the whole pipeline or any single module with one click.
- **Integrations** — DB / LLM / Postiz / Telegram readiness at a glance.
- **Pipeline board** — counts per status + recent items.
- **Operator console** — the five human-in-the-loop steps, all from the page:
  1. **Capture signal** — paste a customer question / trend / result.
  2. **Review topics** — Select the scored topics worth drafting; Drop the rest.
  3. **Approval queue** — read the draft + its claims, then Approve / request Changes / Reject.
  4. **Record performance** — type in the numbers a post earned.
  5. **Leads** — log and see inbound interest with triage scores.

`npm run pipeline` (below) still exists for headless smoke-testing before the UI is wired in,
but it's optional.

---

## 3. Testing — three levels

### Level 1 — Unit tests (zero setup)
```bash
cd content-pipeline && npm test
```
**Expect:** `tests 48 / pass 48 / fail 0`. This proves the safety-critical logic:
honest-numbers gate, escalate-only lanes, scoring bands, approval-decision mapping, lead
routing, UTM, and every LLM-output parser. If this is green, the brain is sound.

### Level 2 — Run the pipeline against your DB (smoke test)
With `.env.content` filled in (DB + OpenRouter):
```bash
cd content-pipeline
npm run pipeline                 # runs all 9 modules in order
npm run pipeline -- scoring      # or run a single module by id
```
Each module prints one line: `STATUS  module  N×  message`. See §4 for what to expect.

> This is the same code path the `/content/api/run` route uses. The CLI just lets you
> drive it before the dashboard is wired in.

### Level 3 — The live loop
Add Postiz + Telegram keys, register the Telegram webhook, point a scheduler at `/run`,
and feed real leads/metrics. See §4.3–§4.5 and §5.

---

## 4. End-to-end walkthrough — what to expect

Assuming you ran `seed.sql` (1 selected topic, 2 research signals, some sample items) and
have **DB + OpenRouter** configured but **Postiz/Telegram not yet**:

### 4.1 First `npm run pipeline`

| Module | What it does on the seed data | Expected line |
|---|---|---|
| `research` | Turns the 2 `research_inputs` signals into 2 new topics (status `new`) | `OK  research  2× — 2 topic(s) created from 2 signal(s)` |
| `scoring` | LLM-scores those 2 new topics on 5 factors; summarizes the queue | `OK  scoring  2× — scored 2 new topic(s); queue: N high, ...` |
| `draft_generator` | Drafts the **selected** seed topic → blog anchor + LinkedIn + X (3 items, status `draft`); marks topic `used` | `OK  draft_generator  3× — 1/1 topic(s) drafted into 3 item(s)` |
| `qc_gate` | Checks the 3 drafts. No claims → lane `review`, status `needs_approval`. Any unproven metric claim → **blocked**, stays `draft` | `OK  qc_gate  3× — 3 to approval, 0 auto-approved, 0 blocked` |
| `approval` | Items await approval but Telegram isn't configured | `DEGRADED  approval  0× — 3 item(s) awaiting approval but Telegram not configured` |
| `publisher` | Nothing approved yet | `OK  publisher  0× — nothing approved & proof-complete to publish` |
| `lead_triage` | No leads yet | `OK  lead_triage  0× — no new leads to triage` |
| `analytics` | No published items with metrics yet | `OK  analytics  0× — no published items with metrics yet` |
| `weekly_review` | Nothing published yet | `OK  weekly_review  0× — no published performance yet — nothing to review` |

> `DEGRADED` is **not an error** — it means "ready, but a key is missing." That's the
> system telling you what to wire next. Nothing fails silently.

> Note: the seed also inserts a few `idea`-status items for the same topic (illustrating
> the anchor→repurpose shape). `draft_generator` creates its own fresh `draft` items — so
> after a run you'll see both. That's expected in the seeded demo.

### 4.2 Mark a researched topic for drafting
Research fills the queue with `new` topics; **you decide** what gets made (human-in-the-loop).

**From the dashboard (recommended):** open `/content` → **Operator console → 2 · Review
topics**. Each scored topic shows its total, pillar, and band — click **Select** to queue it
for drafting or **Drop** to shelve it. Then click **Draft Generator** in Run controls.

**Or via SQL (headless):**
```sql
update content.topics set status = 'selected'
 where priority_band = 'high' and status = 'new'
 limit 1;
```
Either way, the next `draft_generator` run drafts the selected topics.

### 4.3 Approvals
**From the dashboard (no Telegram needed):** open `/content` → **Operator console → 3 ·
Approval queue**. Click **Review** on an item to read the full draft and the claims it makes,
then **✅ Approve**, **✏️ Changes**, or **❌ Reject** (a note is required for the latter two).
Unproven claims are flagged in red — approving still won't let them publish (the honest-numbers
gate blocks them downstream). Every decision writes an audit row to `content.approvals`, exactly
like the Telegram path.

**Or add Telegram** for phone approvals away from the dashboard:
1. Set `CONTENT_TELEGRAM_BOT_TOKEN` + `CONTENT_TELEGRAM_CHAT_ID` + `CONTENT_TELEGRAM_WEBHOOK_SECRET`.
2. Register the webhook (needs the dashboard deployed at a public URL):
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url="https://<your-host>/content/api/telegram/webhook" \
     -d secret_token="<CONTENT_TELEGRAM_WEBHOOK_SECRET>"
   ```
3. Run the pipeline → `approval` now sends each pending item to Telegram with
   **✅ Approve / ✏️ Changes / ❌ Reject** buttons.
4. **Tap a button.** Expect:
   - Approve → item becomes `approved` (heads to the publish queue).
   - Changes → back to `draft`.
   - Reject → `archived`.
   - The message edits to show the decision; a row is written to `content.approvals`.

> Approving never lowers an item's risk lane (escalate-only). A sensitive item stays
> sensitive in the audit log.

### 4.4 Publishing (after adding Postiz)
Once an item is `approved` **and** has no unproven claims, the next `publisher` run
schedules it via Postiz with a UTM-tagged offer link, and the item moves to `queued`.
**Expect:** `OK  publisher  1× — 1 scheduled`. An item with an unproven claim can never
reach Postiz — blocked in both code and the `v_publish_ready` SQL view.

### 4.5 Leads & analytics (the loop closes)
**From the dashboard:** **Operator console → 5 · Leads** has a *Log lead* box, and **4 ·
Record performance** lets you pick a published/scheduled item and type in its numbers. Then
hit **Analytics** and **Weekly Review** in Run controls.

**Or via HTTP** (for your website form / DM triage / Postiz stats sync to post automatically):
```bash
# capture an inbound lead
curl -X POST https://<host>/content/api/leads \
  -H 'content-type: application/json' \
  -d '{"channel":"linkedin","contact":"jane@acme.com","message":"Can you help us build this? How much?","utm_campaign":"ai_readiness"}'

# record a performance snapshot for a published item
curl -X POST https://<host>/content/api/metrics \
  -H 'content-type: application/json' -H 'x-content-secret: <CONTENT_RUN_SECRET>' \
  -d '{"contentItemId":"<uuid>","impressions":4200,"comments":11,"qualifiedEngagement":6}'
```
Then run the pipeline:
- `lead_triage` → scores the lead, flags it high-intent, pings Telegram. `OK lead_triage 1× — 1 lead(s) triaged, 1 high-intent`.
- `analytics` → rolls up metrics + leads, classifies the reach×intent signal, marks the item `performance_captured`.
- `weekly_review` → now that something's published+captured, it asks the LLM for next-week
  priorities and **creates todos** (and a Telegram digest). Run this one **weekly**, not in
  the frequent cron.

### 4.6 Automate it
Point Vercel Cron / GitHub Actions / any cron at:
```
POST /content/api/run      (header: x-content-secret: <CONTENT_RUN_SECRET>)
```
Recommended cadence: run the full pipeline a few times a day for the steady stages, and
trigger `POST /content/api/modules/weekly_review/run` once a week.

---

## 5. Endpoint cheat-sheet

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/content/api/health` | GET | — | system + module + adapter health |
| `/content/api/pipeline` | GET | — | status counts + recent items |
| `/content/api/run` | POST | `x-content-secret` | run the whole pipeline |
| `/content/api/modules/:id/run` | POST | `x-content-secret` | run one module |
| `/content/api/signals` | POST | — | capture a raw research signal (dashboard) |
| `/content/api/topics/:id` | PATCH | — | select/drop a scored topic (dashboard) |
| `/content/api/approvals/:id` | PATCH | — | approve/changes/reject a draft (dashboard) |
| `/content/api/console/metrics` | POST | — | record performance (dashboard) |
| `/content/api/leads` | POST | — | capture an inbound lead |
| `/content/api/metrics` | POST | `x-content-secret` | record a performance snapshot (external webhook) |
| `/content/api/telegram/webhook` | POST | secret token | approve/changes/reject taps |
| `/content/api/todos` `/todos/:id` | GET/POST/PATCH/DELETE | — | operator todo tracker |

(Auth headers only enforced when the matching secret env var is set.)

---

## 6. Health & troubleshooting

- **See everything at a glance:** open `/content`, or `GET /content/api/health`. Each
  module shows its last run, status, and message; each adapter shows `ok` / `unconfigured`
  / `degraded` / `error`.
- **A module shows `error`:** the orchestrator caught a thrown error; the full message is
  in `content.module_runs.error` and on the dashboard. The other modules still ran.
- **`research`/`scoring`/`draft_generator` say "no LLM configured":** set
  `CONTENT_OPENROUTER_API_KEY`.
- **OpenRouter `400 model not found`:** your `CONTENT_LLM_MODEL` slug is wrong — pick one
  from openrouter.ai/models.
- **`approval` degraded:** add the Telegram vars. **`publisher` degraded:** add Postiz vars.
- **Drafts stuck in `draft` after QC:** they have an **unproven claim**. Attach a proof URL:
  `update content.claims set proof_url = 'https://...', verified = true where content_item_id = '<uuid>';`
  Then re-run `qc_gate`.
- **Nothing publishes:** check the item is `approved` AND every claim has a `proof_url`
  (query `content.v_publish_ready`).

---

## 7. Safety guarantees you can rely on (enforced in code AND SQL)

1. **Honest-numbers gate** — an item with an unproven claim cannot publish (`v_publish_ready` + `core.canPublish`).
2. **Escalate-only approval** — a risk lane can never be lowered (`core.escalateLane`).
3. **Approval-gated by default** — `safe_auto` is OFF unless you set
   `CONTENT_ALLOW_SAFE_AUTO=true`, and even then only for template-based content derived
   from already-approved work (Bible §17 phase 6).
4. **Fault isolation** — one module failing never stops the others; every run is recorded.
5. **No silent failure** — missing integrations show as `degraded`, not crashes.

---

## 8. Intentionally NOT built (Bible §17 phase 7)

- **Video Studio** (talking-head / AI clone / Shorts) — highest complexity, build last.
  The data model and the `sensitive` approval lane already account for it; the generation
  pipeline is out of scope for this engine.
- **Live platform scrapers** for research — instead, drop real signals into
  `content.research_inputs` (operator, comment/DM triage, or a future scraper) and the
  Research Collector turns them into topics. Same interface, no brittle scraping.
- **Real platform analytics fetch** — push performance snapshots to `/content/api/metrics`
  (from Postiz stats, a sheet, or manual entry); `analytics` rolls them up.
