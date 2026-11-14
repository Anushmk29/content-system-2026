# Project structure

The repository has two application layers: a Next.js dashboard in `src/` and an
independently built engine in `content-pipeline/`. Configuration stays at the root.
The folder reorganization preserves the `/content` URLs and engine package exports.

## Where to work

| Task | Start here |
| --- | --- |
| Change a dashboard screen | `src/app/content/<feature>/page.tsx` |
| Change that screen's UI | Its `_components/` folder, if present |
| Change shared UI or actions | `src/app/content/_components/` |
| Change formatting | `src/app/content/_lib/format.ts` |
| Change the dashboard theme | `src/app/content/_styles/theme.css` |
| Change login, sessions or role rules | `src/app/content/_lib/auth.ts` and `src/middleware.ts` |
| Change API authorization or error mapping | `src/app/content/_lib/api-guard.ts` |
| Change an HTTP endpoint | `src/app/content/api/<resource>/route.ts` |
| Change a dashboard operation | `content-pipeline/src/services/` |
| Change a pipeline stage | `content-pipeline/src/modules/` |
| Change writing or model instructions | `content-pipeline/src/prompts/` |
| Change an external integration | `content-pipeline/src/adapters/` |
| Change safety or lifecycle rules | `content-pipeline/core/src/` |
| Change database queries | `content-pipeline/src/db/` |
| Change the database schema | `db/schema.sql` and relevant database tests |
| Change deployment or backups | `Dockerfile`, `infra/` and `.github/workflows/ci.yml` |
| Find setup, product specs or diagrams | [Documentation index](../README.md) |

## Feature map

Paths below are relative to `src/app/content/` for the dashboard and
`content-pipeline/src/` for the engine.

| Feature | Dashboard | Engine |
| --- | --- | --- |
| Today | `page.tsx`, `_components/TodoTracker.tsx` | `services/today-service.ts`, `services/todo-service.ts` |
| Ideas and board | `ideas/`, `board/` | `services/console-service.ts`, `services/board-service.ts` |
| Decode and competitors | `decode/`, `_components/Decode.tsx`, `_components/Competitors.tsx` | `services/decode-service.ts` |
| Creative Check (temporarily disabled) | `check/` | `creative-check/` |
| Brand and setup | `brand/`, `setup/` | `services/brand-service.ts` |
| Hooks | `hooks/` | `services/hook-service.ts` |
| Scripts and videos | `scripts/`, `videos/` | `services/scripts-service.ts`, `services/videos-service.ts`, `services/video-analysis-service.ts` |
| Styles and design | `styles/`, `design/` | `services/style-service.ts`, `services/asset-service.ts` |
| Approvals and calendar | `approvals/`, `calendar/` | `services/approval-service.ts`, `services/calendar-sync-service.ts` |
| Training and decisions | `training/` | `services/dataset-service.ts`, `modules/decision-tasks.ts` |
| Analytics and costs | `analytics/`, `costs/` | `services/analytics-service.ts`, `services/cost-service.ts` |
| System health | `system/` | `services/health-service.ts` |

## Placement rules

Creative Check is hidden from the shared navigation and blocked in `src/middleware.ts`.
Restore both entry points when re-enabling it; the pages, services and saved data are retained.

- Put a screen-only React component beside its page in `_components/`. Shared UI belongs
  in `src/app/content/_components/`. The underscore folders are private to the router.
- Keep shared non-UI helpers in `_lib/` and dashboard CSS in `_styles/`.
- Use `@/` for imports across dashboard folders; it resolves to `src/`. Keep Node test
  imports relative with `.ts` extensions so `node --test` can load them directly.
- Dashboard code calls the engine through `@pratapai/content-pipeline` and its `/core`
  export. Add public engine exports in `content-pipeline/src/index.ts` when needed.
- Keep tests beside the code they exercise (`*.test.ts`); pure core tests stay in
  `content-pipeline/core/test/`.
- Keep SQL at `db/`, deployment at `infra/`, and documentation under the indexed `docs/`
  folders. Preserve the engine's location: installation, migrations and runtime asset
  lookups already depend on it.

## Commands

```sh
npm ci --prefix content-pipeline && npm ci
npm run dev
npm test
npm --prefix content-pipeline run typecheck
npm run build
```

`dev` and `build` build the engine first. CI uses the same build and test commands.
The Docker build copies `src/` with the rest of the repository. Secrets stay in the
root `.env`; `.env.example` documents the settings.

`.next*/`, `node_modules/`, `content-pipeline/dist/`, `*.tsbuildinfo` and `graphify-out/`
are generated or local artifacts. They are not source navigation entry points.
