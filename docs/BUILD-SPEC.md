# Technical Build Spec
*Audience: dev. The technical half of the Bible (§38 split). Full-code, no workflow engine.*

## Stack
- **Postgres** (`content` schema) — source of truth. `db/schema.sql`.
- **TypeScript engine** (`content-pipeline/`) — pure-logic `core/` + fault-isolated `src/modules/`.
- **Claude API** — drafting / QC / scoring intelligence (adapter).
- **Postiz** (self-hosted) — single publishing rail (adapter). `infra/postiz/`.
- **Telegram** — approval queue + digests (adapter).
- **Next.js** (`app/content/`) — dashboard + `/content/api/*`.

## Module contract (`src/modules/module.ts`)
Every pipeline stage implements:
```ts
interface Module {
  id: string; title: string; description: string;
  run(ctx: ModuleContext): Promise<ModuleResult>;   // may throw — orchestrator catches
  healthCheck?(ctx): Promise<HealthReport>;
}
```
`ModuleContext` = `{ db, env, logger, adapters }`, built once in `context.ts`.

## Orchestration & visibility (`src/modules/orchestrator.ts`)
- `runModule` wraps each run in try/catch + timing, then writes a row to
  `content.module_runs` (status, duration, items, message, error). **Never throws.**
- `runModules` uses `Promise.allSettled` — **one module failing never stops the others.**
- The dashboard reads `content.v_module_health` (latest run per module) so a broken
  module is always visible as `error`/`degraded`, never silent.

## Adapters degrade gracefully (`src/adapters/`)
Each integration reports `unconfigured` (not a crash) when its `CONTENT_*` key is
missing, `ok` when reachable, `error` when a live check fails. A module that needs an
unconfigured adapter returns `degraded` with a clear message.

## Content lifecycle (status machine, Bible §12.2)
```
idea → draft → qc_passed → needs_approval → approved → queued → published
     → performance_captured → archived
```

## LLM provider
The intelligence adapter is provider-flexible (`adapters/claude.ts`). It prefers
**OpenRouter** (OpenAI-compatible Chat Completions) when `CONTENT_OPENROUTER_API_KEY`
is set, and falls back to the **Anthropic** Messages API (`CONTENT_ANTHROPIC_API_KEY`).
Model via `CONTENT_LLM_MODEL` (default `anthropic/claude-sonnet-4.5`). Everything
downstream only calls `complete(prompt, {system})`, so swapping providers changes nothing.

## Modules (all live — full pipeline, Bible Table 0)
| id | Module | Notes |
|---|---|---|
| `research` | Research Collector | `research_inputs` signals → grounded topics via LLM (§6) |
| `scoring` | Topic Scorer | auto-scores new topics on 5 factors + summarizes queue by band (§7) |
| `draft_generator` | Draft Generator | each `selected` topic → blog anchor + LinkedIn + X; claims stored unproven (§9, §8.2) |
| `qc_gate` | QC + Risk Gate | honest-numbers + escalate-only lane; auto-approves earned `safe_auto` (§10, §17.6) |
| `approval` | Approval Queue | Telegram buttons; degrades if unconfigured (§10) |
| `publisher` | Postiz Scheduler + UTM | reads `v_publish_ready`; UTM via `core` (§12/§13.2) |
| `lead_triage` | Lead Triage | classifies intent + scores new leads; alerts high-intent (§13.3) |
| `analytics` | Analytics Collector | rolls up metrics + leads, classifies reach×intent signal (§14, Table 30) |
| `weekly_review` | Weekly Review | LLM recommendations → operator todos + Telegram digest (§14.1) |

Lead/metrics data enters via `POST /content/api/leads` and `POST /content/api/metrics`
(the ingest seams for website forms, comment/DM triage, and analytics sync).

## Critical controls (tested in `core/test`, 29 tests)
- **Escalate-only lane:** `escalateLane(current, proposed)` returns the stricter lane.
  `safe_auto` stays off unless `CONTENT_ALLOW_SAFE_AUTO=true` (earned, Bible §17.6),
  and even then only for template-based content derived from approved work.
- **Honest-numbers:** `canPublish` / `hasUnprovenClaims` block unproven claims —
  mirrored by the `content.v_publish_ready` SQL view, so the rule holds even if a
  caller bypasses the code path.
- **Scoring bands:** `scoreTopic` matches the Bible §7.1 worked examples.
- **Approval decisions:** `effectOfDecision` / `parseCallbackData` map a Telegram tap
  to the status machine with no silent default — unknown actions are rejected, not
  guessed — so the webhook can never advance an item on a malformed callback.
- **Lead routing:** `routesToCall` / `classifyIntentFallback` only route a lead to a
  call on genuine high intent + fit; praise/noise defaults to low (Bible Table 29).
- **UTM:** `buildUtmUrl` matches the §13.2 shape, preserves existing query/hash.

## API surface (`app/content/api/`)
| Route | Method | Purpose |
|---|---|---|
| `/content/api/health` | GET | system + module + adapter health |
| `/content/api/pipeline` | GET | status counts + recent items |
| `/content/api/run` | POST | run the whole pipeline |
| `/content/api/modules/:id/run` | POST | run one module |
| `/content/api/todos` | GET/POST | list / create todos |
| `/content/api/todos/:id` | PATCH/DELETE | update / delete todo |
| `/content/api/telegram/webhook` | POST | Telegram approve/changes/reject taps → status machine (§10) |
| `/content/api/leads` | POST | capture an inbound lead (§13); triaged next run |
| `/content/api/metrics` | POST | record a performance snapshot for an item (§14) |

`/run`, `/modules/:id/run`, and `/metrics` honor `CONTENT_RUN_SECRET` when set
(send it as the `x-content-secret` header) — set it before exposing them publicly.

### Telegram approval webhook
The approval module sends each pending item to Telegram with Approve / Changes /
Reject buttons. A tap calls `/content/api/telegram/webhook`, which verifies the shared
secret (`X-Telegram-Bot-Api-Secret-Token` vs `CONTENT_TELEGRAM_WEBHOOK_SECRET`),
checks the chat is the configured approval chat, then `applyApprovalDecision` maps the
button to the status machine via the tested `core.effectOfDecision`:
`approve → approved` · `changes → draft (changes_requested)` · `reject → archived`.
Every decision writes a `content.approvals` audit row; the lane never downgrades.
Register once:
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d url="https://<host>/content/api/telegram/webhook" \
  -d secret_token="<CONTENT_TELEGRAM_WEBHOOK_SECRET>"
```

## Build & test
```bash
cd content-pipeline
npm install
npm test          # core logic + LLM parsers + orchestrator fault-isolation (48)
npm run typecheck # tsc --noEmit
npm run build     # emits dist/ (rewrites .ts import extensions → .js)
```

## Milestones (Bible §17) — all build phases complete
1. ✅ `draft_generator` — LLM prompt chain (anchor → LinkedIn/X children + claims).
2. ✅ Telegram callback webhook → records `approvals`, advances status.
3. ✅ `research` + LLM auto-scoring → fills the queue.
4. ✅ Lead capture (UTM ingest route, intent triage) → `content.leads`.
5. ✅ `analytics` + `weekly_review` → close the learning loop.
6. ✅ Earn `safe_auto` for proven templates (`CONTENT_ALLOW_SAFE_AUTO`).

Remaining = wiring/ops, not engine build: connect real Postiz + Telegram + DB + an
OpenRouter key, register the webhook, point a scheduler at `/run`, and feed real
research signals / metrics. Video Studio (Bible §17 phase 7) is intentionally deferred.

## Open decisions carried from the Bible (§18, Table 36)
| Decision | Recommendation |
|---|---|
| Clone video tool | Start with real short recordings; add HeyGen later for low-risk clips. |
| Static / carousel | Start with Canva/Figma templates; AI for copy/layout, not final visuals. |
| Automation level | Approval-gated to start; semi-auto for approved templates in Phase 2. |
