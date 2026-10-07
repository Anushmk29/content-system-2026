# Integration Guide — dropping this into your existing Next.js app

Designed to be **non-destructive**. It touches nothing you already run:

- All DB objects live in a dedicated **`content` Postgres schema** (never `public`).
- All env vars are **`CONTENT_*`** namespaced.
- All routes/UI live under **`/content`** and `/content/api/*`.
- The engine is an **isolated package** (`content-pipeline/`) with its own deps.
- Every module is **fault-isolated** — if one fails, the others keep running and
  the failure shows on the dashboard. Nothing fails silently.

---

## What goes where

| This repo | Copy into your app |
|---|---|
| `content-pipeline/` | A sibling package (or workspace member). The engine. |
| `app/content/` | Your Next.js `app/` directory → gives you `/content` + `/content/api/*`. |
| `db/schema.sql`, `db/seed.sql` | Run once against your dedicated Postgres. |
| `.env.content.example` | Merge the `CONTENT_*` vars into your `.env.local`. |

---

## Step 1 — Database (isolated schema)
Create a **dedicated** Supabase project (or reuse one — the `content`
schema keeps it separate regardless), then:
```bash
psql "$CONTENT_DATABASE_URL" -f db/schema.sql
psql "$CONTENT_DATABASE_URL" -f db/seed.sql   # optional sample data
```

## Step 2 — Add the engine package
Place `content-pipeline/` next to your app and build it (it ships TS source;
the build emits JS your Next bundler imports cleanly):
```bash
cd content-pipeline
npm install
npm test          # 48 tests: core logic + LLM parsers + fault isolation
npm run build     # emits dist/ (rewrites .ts import extensions to .js)
```
Then make your app depend on it. Easiest with a workspace, or:
```bash
# from your Next app root
npm install ../content-pipeline   # installs @pratapai/content-pipeline (file:)
```
> Why a build step? The engine uses explicit `.ts` import extensions so it runs
> under Node's native TypeScript for tests with zero tooling. `npm run build`
> (TypeScript 5.7 `rewriteRelativeImportExtensions`) converts those to `.js` so
> webpack/Turbopack import it without complaint. If you'd rather consume source
> directly, add `transpilePackages: ['@pratapai/content-pipeline']` to
> `next.config.js` and point a tsconfig path at `content-pipeline/src/index.ts`.

## Step 3 — Env
Add to `.env.local` (only `CONTENT_DATABASE_URL` is required; the rest degrade
gracefully when unset):
```
CONTENT_DATABASE_URL=postgresql://...
# LLM (drafting/scoring/research/triage/review): OpenRouter preferred, Anthropic fallback
# CONTENT_OPENROUTER_API_KEY=...   CONTENT_LLM_MODEL=anthropic/claude-sonnet-4.5
# optional: CONTENT_POSTIZ_*, CONTENT_TELEGRAM_*, CONTENT_RUN_SECRET, CONTENT_ALLOW_SAFE_AUTO
```
See `.env.content.example` for the full, annotated list.

## Step 4 — Run
Start your app and open **`/content`**. You'll see:
- **Modules** — every pipeline stage with its last run + health (green/amber/red).
- **Integrations** — DB / Claude / Postiz / Telegram readiness.
- **Pipeline** — counts per lifecycle status + recent items.
- **Todo Tracker** — add/cycle/delete tasks.
- **▶ Run all** / per-module buttons to execute and watch status update.

## Step 5 — Automate the runs
Point a scheduler at the run endpoint (replace n8n cron entirely):
```
POST /content/api/run                 # whole pipeline
POST /content/api/modules/qc_gate/run # one module
```
Use Vercel Cron, a GitHub Action, or any cron hitting these routes. Set
`CONTENT_RUN_SECRET` and send it as the `x-content-secret` header before exposing
them publicly. For the approval gate, register the Telegram webhook once (see
`docs/BUILD-SPEC.md`). Feed leads to `POST /content/api/leads` and performance
snapshots to `POST /content/api/metrics`.

---

## Safety properties you get for free
- **Honest-numbers gate** is enforced in SQL (`v_publish_ready`) *and* in code
  (`core` `canPublish`) — an item with an unproven claim cannot be published.
- **Escalate-only approval** (`core` `escalateLane`) — a lane can never be lowered.
- **Fault isolation** — `runModules` uses `Promise.allSettled` + per-module
  try/catch; one module throwing is recorded as `error` and the rest still run.

## Uninstall (clean removal)
Drop the `content` schema, remove `app/content/`, delete the `CONTENT_*` env vars,
and remove the package dependency. Your app is untouched.
