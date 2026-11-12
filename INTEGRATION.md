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
| `db/schema.sql` | Apply with `npm run migrate` (one transaction; re-run after every update). `db/seed.sql` is demo data, never for production. |
| `.env.example` | Merge the `CONTENT_*` vars into your `.env.local`. |

---

## Step 1 — Database (isolated schema)
Create a **dedicated** Supabase project (or reuse one — the `content`
schema keeps it separate regardless), then:
```bash
npm run migrate                                # applies db/schema.sql, all or nothing
psql "$CONTENT_DATABASE_URL" -f db/seed.sql   # optional sample data (dev only)
```

## Step 2 — Add the engine package
Place `content-pipeline/` next to your app and build it (it ships TS source;
the build emits JS your Next bundler imports cleanly):
```bash
cd content-pipeline
npm install
npm test          # core logic, LLM parsers, fault isolation, SQL against an in-process Postgres
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
# CONTENT_IMAGE_MODEL=qwen/qwen-image-3   (carousel/image visuals; qwen/qwen-image-3-pro for higher quality)
# optional: CONTENT_POSTIZ_*, CONTENT_RUN_SECRET, CONTENT_CRON_SECRET
```
See `.env.example` for the full, annotated list.

## Step 4 — Run
Start your app and open **`/content`**. You'll see:
- **Modules** — every pipeline stage with its last run + health (green/amber/red).
- **Integrations** — DB / LLM / Jev / Postiz readiness.
- **Pipeline** — counts per lifecycle status + recent items.
- **Todo Tracker** — add/cycle/delete tasks.
- **▶ Run all** / per-module buttons to execute and watch status update.

## Step 5 — Automate the runs
Point a scheduler at the run endpoint (replace n8n cron entirely):
```
POST /content/api/run                 # whole pipeline
POST /content/api/modules/qc_gate/run # one module
```
Use any cron on a long-running server (not serverless: runs take minutes; see docs/DEPLOY.md),
or the bundled scheduler in `infra/app`. Set `CONTENT_CRON_SECRET` and send it as the
`x-content-secret` header; it opens only the run routes. Approvals happen on the dashboard
Approvals page. Feed performance snapshots to `POST /content/api/metrics` (`{ itemId, ... }`).

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
