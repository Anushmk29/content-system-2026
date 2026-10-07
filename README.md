# PRATAP AI — Content Pipeline

A **content-to-pipeline engine**, not a "post everywhere" machine.
Turns expertise → ranked topics → platform-native drafts → quality/risk gate →
one-tap approval → Postiz scheduling → published posts → leads → weekly learning.

Governing reference: **`Content_Pipeline_Bible_Final.docx`** (v3). This repo implements it.

> **The rule that shapes everything:** start *approval-gated*, never auto-publish.
> Prove what works under human review, then automate only safe, proven templates.

**Full-code, no workflow engine.** Built as an isolated TypeScript package that drops
into an existing Next.js app without touching what's already there — own DB schema,
own env namespace, own routes. Every module is fault-isolated: if one breaks, the
others keep running and the dashboard shows it. Nothing fails silently.

---

## Architecture

| Concern | Implementation |
|---|---|
| Source of truth / data model (Bible §16.3) | **Postgres** in a dedicated **`content` schema** — `db/schema.sql` |
| Safety-critical logic (scoring, lanes, claims, approvals, leads, UTM) | **`content-pipeline/core/`** — pure, **29 unit tests** |
| Pipeline stages | **`content-pipeline/src/modules/`** — each a fault-isolated `Module` |
| Orchestration | **`content-pipeline/src/modules/orchestrator.ts`** — `Promise.allSettled`, records every run |
| Drafting / QC / scoring / research / triage / review intelligence | **LLM** adapter (`adapters/claude.ts`) — OpenRouter (default) or Anthropic |
| Publishing rail (Bible §12) | **Postiz**, self-hosted — `infra/postiz/` + `adapters/postiz.ts` |
| Approval queue (Bible §10) | **Telegram** adapter |
| Dashboard + Todo tracker | **Next.js** under `app/content/` |
| Brand brain (ICP, voice, pillars, scoring) | **`prompts/`** — versioned markdown |

## Repo layout
```
content-pipeline/      The isolated engine (own package + deps)
  core/                Pure safety-critical logic + tests (29)
  src/
    adapters/          claude · postiz · telegram (graceful when unconfigured)
    db/                pg client (scoped to `content` schema) + typed repo
    modules/           one fault-isolated Module per pipeline stage + orchestrator
    services/          health · pipeline board · todos
app/content/           Next.js dashboard + /content/api/* routes
db/                    schema.sql (content schema) + seed.sql
prompts/               The brand brain
infra/postiz/          Self-hosted Postiz (Docker)
docs/                  Strategy Playbook + Build Spec
INTEGRATION.md         How to drop into an existing Next.js app non-destructively
```

## Quick start (run the dashboard locally)
This repo includes a minimal Next.js host so you can open the dashboard with no extra setup:
```bash
# 1. Database (dedicated Postgres; everything lives in the `content` schema)
psql "$CONTENT_DATABASE_URL" -f db/schema.sql
psql "$CONTENT_DATABASE_URL" -f db/seed.sql      # optional sample data

# 2. Config
cp .env.local.example .env.local                 # fill in CONTENT_DATABASE_URL + CONTENT_OPENROUTER_API_KEY

# 3. Install + run (the engine builds automatically via predev)
npm install
npm run dev                                       # → open http://localhost:3000/content
```
From `/content` you run the pipeline and do every human step (signals, topic selection,
approvals, metrics, leads) — no command line. To drop it into an **existing** Next app
instead, see INTEGRATION.md.

```bash
# Headless alternative (no dashboard): fill .env.content, then
cd content-pipeline && npm install && npm test   # 48 tests
npm run pipeline                                  # runs all 9 modules against your DB
```

> **Setting it up for real?** Follow **`docs/GO-LIVE.md`** — what you provide, how to
> test each layer, and exactly what to expect at every step.

## What the dashboard does (`/content`)
The dashboard is the **control room** — you can run the whole loop here without a terminal:
- **Modules** — every stage with last run, duration, items processed, and health.
- **Integrations** — DB / Claude / Postiz / Telegram readiness at a glance.
- **Pipeline** — counts per lifecycle status + recent items.
- **Run controls** — run the whole pipeline or a single module and watch it update.
- **Operator console** — the human-in-the-loop steps, all in-page:
  capture a signal → Select/Drop scored topics → Approve / Changes / Reject drafts
  (with claims shown) → record performance → log & view leads.
- **Todo tracker** — add / cycle / delete operator tasks.

## Safety guarantees (enforced in code AND SQL)
1. **Honest-numbers gate** — `v_publish_ready` (SQL) + `core.canPublish` (code) both
   block any item with an unproven claim from publishing (Bible §7/§10.3).
2. **Escalate-only approval** — `core.escalateLane` makes lowering a lane impossible (§10).
3. **Fault isolation** — `runModules` never lets one module's failure stop the rest;
   every outcome is written to `content.module_runs` for the dashboard.

## Automate runs (replaces a cron/workflow engine)
```
POST /content/api/run                  # run the whole pipeline
POST /content/api/modules/:id/run      # run one module
```
Point Vercel Cron / a GitHub Action / any scheduler at these (add an auth secret first).

See **`docs/GO-LIVE.md`** (setup + testing), **`docs/BUILD-SPEC.md`** (technical),
and **`docs/STRATEGY-PLAYBOOK.md`** (operator).
