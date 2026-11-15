# PRATAP AI — Content Pipeline

A **content-to-pipeline engine**, not a "post everywhere" machine.
Turns expertise → ranked topics → platform-native drafts → quality/risk gate →
one-tap approval → Postiz scheduling → published posts → weekly learning.

Governing reference: **`docs/product/reference/Content_Pipeline_Bible_Final.docx`** (v3). This repo implements it.

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
| Safety-critical logic (scoring, lanes, claims, approvals, UTM) | **`content-pipeline/core/`** — pure, unit tested |
| Pipeline stages | **`content-pipeline/src/modules/`** — each a fault-isolated `Module` |
| Orchestration | **`content-pipeline/src/modules/orchestrator.ts`** — `Promise.allSettled`, records every run |
| Writing (drafts, angles, research, review) | **LLM** adapter (`adapters/claude.ts`) — Claude via OpenRouter (default) or Anthropic |
| Decisions (scores, QC signals, competitor judging) | **Jev** (`adapters/jev.ts`) routed by `modules/decide.ts`, LLM fallback |
| Publishing rail (Bible §12) | **Postiz**, self-hosted — `infra/postiz/` + `adapters/postiz.ts` |
| Approval queue (Bible §10) | Dashboard **Approvals** page |
| Dashboard | **Next.js** under `src/app/content/` |
| Brand brain (voice, audience, pillars, offers) | **Brand Kit** in `content.brand_kit`, edited at `/content/brand`; prompts in `content-pipeline/src/prompts/` |

## Repo layout

Start with the [project navigation guide](docs/development/PROJECT-STRUCTURE.md) or the
[documentation index](docs/README.md).

```
content-pipeline/      The isolated engine (own package + deps)
  core/                Pure safety-critical logic + tests
  src/
    adapters/          one file per external API: claude (LLM + images) · jev · postiz · apify ·
                       youtube · tinyfish · transcriber. All HTTP goes through these.
    prompts/           every prompt: brand-context (shared brand block) · platform-playbooks ·
                       draft · decisions · decode · review
    modules/           one fault-isolated Module per pipeline stage + orchestrator;
                       decide.ts + decision-tasks.ts = the single road for typed decisions
    services/          what the dashboard calls (brand, decode, styles, today, approvals, …)
    db/                pg client (scoped to `content` schema) + typed repo
src/app/content/      Dashboard pages and API routes (URLs stay under /content)
  _components/        Shared dashboard UI
  _lib/               Auth, API guard, data loading and formatting + tests
  _styles/            Dashboard theme
  <feature>/          Page and its private _components/ when needed
  api/                HTTP handlers calling the engine's public exports
src/middleware.ts     Login, role headers, rate limits and CSRF
db/                    schema.sql (content schema) + seed.sql
infra/postiz/          Self-hosted Postiz (Docker)
docs/
  development/         Structure, integration, design and build guides
  operations/          Deployment, go-live, platform and strategy guides
  product/             Product requirements and original Word references
  architecture/        System diagrams and workflow sources
  plans/               Proposals and roadmaps
  reports/             Dated audits
  archive/             Historical deployment notes
```

## Quick start (run the dashboard locally)
This repo includes a minimal Next.js host so you can open the dashboard with no extra setup:
```bash
# 1. Database (dedicated Postgres; everything lives in the `content` schema)
cp .env.example .env                             # fill in CONTENT_DATABASE_URL + CONTENT_OPENROUTER_API_KEY
npm ci --prefix content-pipeline && npm ci
npm run migrate                                   # applies db/schema.sql in one transaction
psql "$CONTENT_DATABASE_URL" -f db/seed.sql      # optional sample data — never in production

# 2. Run (the engine builds automatically via predev)
npm run dev                                       # → open http://localhost:3001/content
```
From `/content` you run the pipeline and do every human step (signals, topic selection,
approvals, metrics) — no command line. To drop it into an **existing** Next app
instead, see the [integration guide](docs/development/INTEGRATION.md).

```bash
# Headless alternative (no dashboard)
npm test                                          # app + engine tests
npm run pipeline                                  # runs every module once against your DB
```

> **Setting it up for real?** Deploy with **`docs/operations/DEPLOY.md`** (VPS + Docker, scheduling,
> backups, monitoring, runbook); **`docs/operations/GO-LIVE.md`** covers each integration and how to test it.

For Hostinger VPS, follow the [Hostinger deployment guide](docs/operations/HOSTINGER.md).

## What the dashboard does (`/content`)
The dashboard is the **control room** — you can run the whole loop here without a terminal:
- **Modules** — every stage with last run, duration, items processed, and health.
- **Integrations** — DB / LLM / Jev / Postiz / Apify readiness at a glance (admin).
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
The Docker setup (`infra/app`) already runs the pipeline hourly. An external scheduler can call
these with the `x-content-secret: $CONTENT_CRON_SECRET` header instead. A module that is already
running is skipped, never run twice. See `docs/operations/DEPLOY.md`.

See **`docs/operations/GO-LIVE.md`** (setup + testing), **`docs/development/BUILD-SPEC.md`** (technical),
and **`docs/operations/STRATEGY-PLAYBOOK.md`** (operator).
