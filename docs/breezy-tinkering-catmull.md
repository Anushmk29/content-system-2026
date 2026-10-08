# Plan: fold competitor-hunter + goviralbro into content-system-2026

> **Status 2026-10-07: all phases (C, 0-6) BUILT.** 128 engine tests pass; both projects typecheck; the live DB is migrated.
> Checked live: Jev via OpenRouter, local transcription, angles, the cost ledger.
> **Not checked live:** YouTube (no `CONTENT_YOUTUBE_API_KEY` yet), a full Decode run with judging, and the learning loop on real results.
> **Deviations from the plan:**
> - The scatter keeps its reactions × conversation axes; hunt score shows in ranking, filters and badges instead.
> - Jev judging calls Jev directly (no LLM teacher per post).
> - YouTube Shorts are opt-in, not part of every draft set, and the publisher skips them.
> - The Whisper script is inline (`python -c`), not a file in `scripts/`.

## Context
We studied two MIT repos by Charles Dove:
- **competitor-hunter**: finds and ranks winning competitor posts (YouTube API scrape, Jev judging, breakout, paid filter, hunt score).
- **goviralbro**: turns winners into angles, hooks and scripts (skeleton ripper, Contrast Formula, hook patterns, learning loop).

Both depend on Claude Code. In this codebase everything runs on its own engine: OpenRouter for the LLM and Jev, Apify, and the YouTube Data API.

Our system already covers about 60% of this: Decode (Apify scrape, `vs_own_median`, LLM breakdown, steal-format), the hook library, Own Results, and Reddit/RSS in market-signals. This plan adds only the missing pieces. Each one is wired into an existing module, not built as a parallel app.

**Decisions taken:**
- **Personalization = per install, from the Brand Kit.** Every Jev question, lane, hook weight and score is built from `brand()` (audience, pillars, offers) and learns from this install's own results. There is no multi-tenant schema.
- **Jev goes through OpenRouter** (`typesafe/jev-1.13`, `POST https://openrouter.ai/api/alpha/decisions`, Bearer = OpenRouter key). This was verified against claude-x-jev's `jev.py`. The TypeSafe key is removed.
- **Transcription runs locally:** yt-dlp + ffmpeg + faster-whisper. The engine must therefore run on a Node host (VPS or Docker), not Vercel serverless. This is noted in GO-LIVE.md.

Paths below are relative to `content-pipeline/src` unless they start with `app/`, `db/` or `docs/`.

---

## Phase C: Cost ledger and super-admin Costs page — ✅ BUILT 2026-10-07
**Status:** done and checked live.
- `content.cost_events` is created on the live DB.
- `cost-ledger.ts` holds the scope and the recorder (the scope lives here, with no separate cost-scope.ts).
- The hooks are in the claude, jev and apify adapters.
- Entry points are tagged in `index.ts`, plus the orchestrator and `startDecode`.
- The data comes from `services/cost-service.ts`. The page is `app/content/costs/page.tsx` and the CSV route is `app/content/api/costs/route.ts`.
- Tests: `cost-ledger.test.ts`, 6 tests.

**Correction to the Apify cause:** a settled run's `usageTotalUsd` is right, including pay-per-event charges. Read the moment the run finishes, it can still be about $0. Cost is now max(`usageTotalUsd`, priced `chargedEventCounts` + per-result pricing).

**Original plan (kept for reference):**
**Why first:** every later phase adds paid calls (Jev, more LLM steps). Each must be logged from day one.

**The problem today (checked 2026-10-07):**
- Only Decode (`decode_runs.cost_ai_usd`, `cost_apify_usd`) and style analysis (`style_refs.analysis_cost_usd`) save a cost.
- Nothing else is saved:
  - drafting
  - research
  - weekly review
  - Jev
  - style image generation (`generateImage`)
  - brand voice
  - hook rewrite
  - QC
- Yesterday (6 Oct) OpenRouter billed about $3.86 for Mon and Tue, but the app logged only about $0.51.
- **Apify bug:** `adapters/apify.ts:76` returns `run.usageTotalUsd`, which is platform compute only (about $0.0001). The actor's per-result charge is missed. Apify billed $0.15 on 6 Oct, but Decode showed $0.0001.

**1. One table: `content.cost_events`** (in `db/schema.sql`, idempotent)
- Columns:
  - `id`
  - `at timestamptz default now()`
  - `provider` (openrouter | anthropic | apify | jev | youtube | tinyfish)
  - `kind` (llm | image | scrape | decision)
  - `feature` (decode | draft | research | style_analyze | style_generate | brand_voice | hook_rewrite | qc | scoring | weekly_review | jev_topic | jev_qc | jev_competitor | …)
  - `model`
  - `ref_type` and `ref_id` (decode_run / topic / content_item / style_ref / module_run)
  - `input_tokens`, `output_tokens`, `units` (Apify results, images)
  - `cost_usd numeric(10,6)`
  - `ok boolean`, `error text`
  - `meta jsonb`
- Index on `(at desc)` and `(feature, at desc)`.
- Failed calls are logged too: a 429 retry that OpenRouter still bills must show up.

**2. Log in the adapters (one choke point each), not at every call site**
- `adapters/claude.ts`:
  - `openRouter()` already reads `usage.cost`. Also read `usage.prompt_tokens`, `completion_tokens` and the model.
  - Call a new `cfg.onCost?(event)` hook.
  - For the Anthropic path, compute cost from token counts × a small price map. Mark it `meta.estimated=true`.
- `adapters/jev.ts`: same hook (fits the Phase 0 `spentUsd` work).
- `adapters/apify.ts`:
  - Fix the cost: `usageTotalUsd` plus the actor charge, from `run.chargedEventCounts` × `pricingInfo` event prices, or from `pricingInfo.pricePerUnitUsd` × item count for pay-per-result actors.
  - Verify live against the Apify billing for one run.
  - Then fire the hook.
- `context.ts`: wire `onCost` to one `insert into content.cost_events`. It is fire-and-forget: a logging failure must never break a draft or a run.

**3. "Where" = attribution, with no signature changes**
- New `cost-scope.ts` (about 15 lines) using Node's built-in `AsyncLocalStorage`: `withCostScope({feature, refType, refId}, fn)`. The `onCost` hook reads the current scope.
- Wrap only the entry points:
  - the module runner, which tags each module run with `feature = module_id` and `ref = module_run id`
  - `runDecode`, `stealFormat`, `draftTopic`
  - the style analyze and generate functions
  - brand voice, hook rewrite, research
- Anything not wrapped logs as `feature='untagged'`. The admin page shows untagged spend in red, so a missed path is visible, not silent.
- Keep `decode_runs.cost_*` and `style_refs.analysis_cost_usd`; the existing UI reads them. They can be derived from the ledger later.

**4. Super-admin Costs page: `app/content/costs/page.tsx` plus `app/content/api/costs/route.ts`**
- Admin only: `requireAdmin` in `app/content/api/guard.ts` and the admin-pages list in `app/content/auth.ts:45`. Add a Nav entry visible to admin only.
- **Range picker:** today / yesterday / 7d / month / custom.
- **Totals:** a big number, plus a split by provider.
- **Breakdowns:**
  - by feature (where the money goes)
  - by model
  - by day (a bar chart, reusing `viz.tsx`)
- **Top 20 most expensive operations**, with links to the decode run, item or topic.
- **Unit costs:** cost per draft, per decode run and per published post (join `content_items`). This is the number a client price is built on.
- **Reconcile panel (the "verify" part):** logged total vs what the provider itself reports.
  - OpenRouter: `GET /api/v1/key` gives today, week and month usage. With an optional `CONTENT_OPENROUTER_MGMT_KEY`, `GET /api/v1/activity` gives exact per-day figures.
  - Apify: `GET /v2/users/me/usage/monthly` (daily list).
  - Show the gap in $ and %. A gap above 5% gets a warning, which means a call path is unlogged.
- **CSV export** of the ledger rows for the range.

**5. Tests**
- `cost-ledger.test.ts` on pglite, with stubbed `fetch`:
  - an OpenRouter call writes one row with the right feature from the scope
  - an unscoped call writes `untagged`
  - a logging insert failure doesn't throw
  - Apify cost = compute + actor charge

**Skipped:** budget caps and alerts. Add a daily `$` limit plus a banner once there's a few weeks of baseline data.

---

## Phase 0: Jev on OpenRouter (unblocks everything Jev-related)
**`adapters/jev.ts`**
- URL: `JEV_URL = 'https://openrouter.ai/api/alpha/decisions'`
- Default model: `'typesafe/jev-1.13'`
- Auth: `cfg.apiKey` is now the OpenRouter key.
- Retry on 429 and 500–504 (currently only 429/529). Timeout 60s, up from 15s.
- Add a `spentUsd` getter that sums `usage.cost` from each response, the same pattern as `adapters/claude.ts`.
- Add `applyRules(answers, rules)`, ported from jev.py's `apply_rules` (about 20 lines, `when` → `set`), for the competitor task in Phase 3.
- `healthCheck`: make a real call to `GET https://openrouter.ai/api/v1/models/typesafe/jev-1.13/endpoints` and report up or down plus the mode. Today it only checks that a key exists.
- **Unknown to settle while building:** jev.py sends `state` as an object, but we send a string. Make one live call. If a string gets a 400, wrap it as `{ text: state }` inside the adapter. No caller changes either way.

**Other files**
- **`env.ts`:** remove `CONTENT_TYPESAFE_API_KEY`. Jev uses `CONTENT_OPENROUTER_API_KEY`. Keep `CONTENT_JEV_MODE` (`off` | `shadow` | `primary`), the model and min-confidence settings.
- **`context.ts:25`:** pass `openrouterApiKey` into `createJev`.
- **Docs:** update `docs/DECISION-DATASET.md`, the README env table and `docs/GO-LIVE.md`.
- **Test:** add `adapters/jev.test.ts` with a stubbed `fetch`. It asserts the URL, the Bearer header, the model, cost tracking and retry on 503.

**Better than the repos:** `decide.ts` already logs Jev next to the LLM in `content.decisions`, so going live with OpenRouter immediately starts building the agreement dataset. That gives a real switch point to `primary` mode, which neither repo has.

## Phase 1: Local transcription (shared base for Phases 3 and 4)
**New `adapters/transcriber.ts`**
- Shells out (`child_process.execFile`) to:
  1. `yt-dlp -x` to download audio only
  2. `python scripts/transcribe.py <file>`, a new script of about 30 lines that uses faster-whisper and prints JSON `{text, segments, lang, duration}`
- Env settings:
  - `CONTENT_YTDLP` (default `yt-dlp`)
  - `CONTENT_PYTHON` (default `python`)
  - `CONTENT_WHISPER_MODEL` (default `small`)
  - `CONTENT_TRANSCRIBE_CAP` (default 15 videos per run)
- `configured` is true only when the binaries are found. `healthCheck` names which one is missing.
- Register it in `context.ts` adapters.

**New table `content.transcripts`** (in `db/schema.sql`, idempotent `create table if not exists`)
- Columns: `norm_url` (primary key), `text`, `segments jsonb`, `lang`, `duration_s`, `created_at`.
- It acts as a cache: competitor reruns and our own posts never transcribe twice.

**`services/decode-service.ts`**
- Add a new stage, `transcribing`, between `scrape` and `sortFormats` in `runDecode`.
- It transcribes only video posts, top N by lift.
- On success it sets `decoded_posts.text_source = 'transcript'`. On failure it keeps the caption and logs a warning.

**Better:** Decode currently reads captions only (DESIGN-GUIDE says "No Whisper"), so video hooks are guessed. With transcripts, hooks are the actual spoken first lines.

## Phase 2: YouTube in Decode (from competitor-hunter)
**New `adapters/youtube.ts`**
- Ports hunter's `scrape_youtube_channel` (`hunt.py:357`): `channels?forHandle=` → uploads playlist → `playlistItems` → `videos?part=statistics,contentDetails`.
- Returns `ScrapedPost[]` with `views`, `durationS` and `postType: 'video'`. A video of 180s or less is tagged as a short.
- Env: `CONTENT_YOUTUBE_API_KEY` (free, about 40 quota units per hunt).

**`adapters/apify.ts`**
- Add `'youtube'` to `DECODE_PLATFORMS`.
- Add `scraperFor(platform)` so that `youtube` goes to the YouTube adapter and everything else to Apify.
- `env.ts:36,77` actor-override list: exclude youtube.

**`services/decode-service.ts`**
- `startDecode`: require Apify only when a non-YouTube platform is selected.
- `scrape()`: call `scraperFor`.

**Own channel**
- Add `Brand.ownHandles.youtube` (the type already derives from `DECODE_PLATFORMS`).
- `syncOwnMetrics` then fills our YouTube views for free.

**UI:** add a YouTube handle input in `app/content/ui/Competitors.tsx` and in the Brand Kit own-accounts form.

**Test:** add a case in `services/decode.test.ts` with a stubbed YouTube adapter.

## Phase 3: Hunt scoring (Jev judging, paid filter, better breakout), personalized
**Fix breakout (`decode-service.ts:232`)**
- Today: reactions ÷ median per competitor and platform.
- New: use `views` when the platform reports them, otherwise reactions, partitioned by competitor + platform + `post_type`.
- This is hunter's "same format" rule. A reel is no longer compared with a text post.

**New Brand-driven Jev task in `modules/decision-tasks.ts`**
- `competitorPostQuestions(brand())`, following the same pattern as the existing `topicQuestions()`, which is already built from pillars.
- Questions:

  | Question | Type | Details |
  |---|---|---|
  | `lane` | choice | brand pillar slugs + `adjacent` + `off_niche` |
  | `icp_fit` | score, 4 levels | criteria written from `brand.audience` |
  | `hook_type` | choice | from the shared `HOOK_PATTERNS`, see below |
  | `proof` | score, 4 levels | |
  | `replicable` | noul | |
  | `sponsored` | noul | |
  | `news_pegged` | noul | |

- `rules`: if `sponsored` ≥ 0.8, mark the post as paid.
- State: platform, format, `duration_s`, caption or title, the first 1,500 characters of the transcript, and a creator profile taken from the Brand.
- Wording is adapted from hunter's `jev/competitor-hunt.json`, with MIT credit in a comment.

**New shared file `hook-patterns.ts`**
- One taxonomy used by Jev, the Decode LLM, drafting and the learning loop: `contradiction`, `number_specific`, `newsjack`, `outcome_build`, `how_to`, `question`, `story`, `other`.
- It merges hunter's 6 patterns with goviralbro's.

**New stage `judging` in `runDecode`**, after transcribing
1. **Pilot:** judge 20 posts first and store `decode_runs.jev_health`, the mean of the weakest-answer confidence (reuse `minConfidence()` from decision-tasks.ts).
2. **Full run:** judge the rest with concurrency 8.
3. Log each call to `content.decisions` with task `competitor_post` (add it to the task check at `db/schema.sql:286`).
4. If Jev is off, skip this stage and rank on demand only.

**There is no Claude conductor.** If health is below 0.8, the UI shows a banner and the operator edits the Brand Kit (audience and pillar wording), which is where the questions come from.

**New pure file `services/hunt-score.ts`**, ported from hunter's `rank`
- **Paid filter:** engagement rate (ER) below 0.2%; or ER below 0.6% with more than 3× the median; or Jev `sponsored`.
- **Demand** = 0.5 × min(breakout/8, 1) + 0.25 × ER percentile + 0.25 × reach percentile, within the platform.
- **Fit** = weighted (icp_fit, proof, replicable, freshness) × (1 − P(off_niche)).
- **Hunt** = 100 × √(demand × fit).
- **Test:** add `hunt-score.test.ts` with a hand-checked fixture.

**Schema** (`db/schema.sql`, `add column if not exists`)
- `decoded_posts`: `jev jsonb`, `lane text`, `hook_type text`, `demand real`, `fit real`, `hunt_score real`, `paid boolean`.
- `decode_runs`: `jev_health real`, `cost_jev_usd numeric`.

**Ordering changes**
- `decodeBatch`, `sortFormats`, `bestPost` and `hook-service.ts` all sort by `hunt_score desc nulls last, vs_own_median desc`.
- Paid posts are excluded from the hook library and from steal.

**UI (`app/content/ui/Decode.tsx`)**
- TopGrid scatter: x = breakout, y = reach, size = engagement.
- Lane and hook-type filter chips.
- A "paid" badge.
- The health banner.

## Phase 4: Skeleton ripper in Decode (from goviralbro)
**`decodeBatch` prompt** (`decode-service.ts:286`)
- It already returns `format`, `hook` and `beats`.
- Add `hook_technique` (from `HOOK_PATTERNS`), `value_structure` (steps, single_insight, framework, story, listicle, transformation) and `cta_type`.
- Feed it the transcript when one exists.
- Extend `parseBreakdowns`.
- New columns on `decoded_posts`: `value_structure`, `cta_type`.

**`sortFormats`**
- Becomes format plus skeleton synthesis, adapting goviralbro's `SKELETON_SYNTHESIS_SYSTEM_PROMPT`.
- Each format gets `hook_template`, `value_template` and `cta_template` (new columns on `decode_formats`).

**`stealFormat` / `draftTopic`:** pass the format's templates into `buildDraftPrompt`, so drafts copy the proven structure, not the words.

**Better:** goviralbro runs skeletons as a one-off report. Here they attach to Decode formats and flow straight into drafting and the Gaps view.

## Phase 5: Angle step (Contrast Formula) and video scripts
**Angles**
- `prompts/brand-brain.ts`: new `buildAnglePrompt(topic, brand)` returns 5 angles `{belief, truth, strength 1–10, proof_method}` (from goviralbro `viral-angle.md`).
- New column `topics.angles jsonb`. The chosen angle is stored as `topics.angle_idx`.
- `modules/draft-generator.module.ts`, in `draftTopic` (:65): generate angles if missing, take the operator's pick or the highest strength, and pass it into `buildDraftPrompt`. This adds one LLM call per topic.
- **Personal:** a new optional Brand Kit field, `audienceBeliefs: string[]` (the myths this audience holds). The angle prompt flips these first.
- **UI:** the Ideas topic drawer lists the 5 angles with a pick button.

**Video scripts**
- Add `'youtube'` to `DRAFT_PLATFORMS` (`prompts/brand-brain.ts:9`) with format `short_script`: a filming card with hook, beats, on-screen text and CTA, following `prompts/platform-rules.md:38`, which already specifies a 45-second Short.
- Long-form scripts are deferred.

## Phase 6: Learning loop (goviralbro analyze/update-brain), personalized from our own results
- Add `content_items.hook_pattern`, set at draft time. The model returns it next to `hookFrom`.
- **New view `content.v_hook_pattern_weights`:** per `hook_pattern` over 90 days, `avg(ln(vs_usual))` from `v_content_performance`, shrunk by n/(n+5). A view rather than a weights table means no stored state and no job.
- **`services/hook-service.ts` `provenHooks`:** rank by lift × (1 + pattern weight). Tell the draft prompt "patterns that work for you: …, avoid: …".
- **`buildHookRewritePrompt`:** return 5 scored options, composite = 0.4 × contrast fit + 0.35 × pattern strength + 0.25 × platform fit, plus the learned weight (goviralbro's formula). The drawer shows the scores.
- **UI:** the Hooks page shows each pattern's learned weight.

## Deliberately skipped
- The Claude conductor and auto-tuning: replaced by the health banner plus Brand Kit edits.
- Ask AI chat, My Studio and Kanban: we already have Analytics, Own Results and Board.
- Instaloader and last30days' `bird-search`: they use logged-in sessions and break the public-pages-only rule.
- `scoring/engine.py`: keyword heuristics are weaker than Jev and the existing scorer.
- PDF lead magnets and long-form scripts: add later if asked.
- Reddit: already in market-signals (`CONTENT_REDDIT_QUERIES`).

## Build order
| # | Phase | Size | Needs |
|---|---|---|---|
| C ✅ | Cost ledger + admin Costs page | M | — (optional OpenRouter management key) |
| 0 | Jev on OpenRouter | S | OpenRouter key (have) |
| 1 | Transcription | M | yt-dlp, ffmpeg, faster-whisper on the host |
| 2 | YouTube in Decode | M | `CONTENT_YOUTUBE_API_KEY` |
| 3 | Hunt scoring | L | 0, 2 (1 optional) |
| 4 | Skeleton ripper | M | 1 |
| 5 | Angles + short scripts | M | — |
| 6 | Learning loop | M | 4 or 5 + some published results |

Each phase ships on its own and is gated by tests.

## Verification
- After every phase: `npm run engine:test` (node --test on pglite with the real `db/schema.sql`) and `tsc --noEmit`.
- **Phase C:**
  - Run one draft, one style analysis and one small Decode from the dashboard. Each one shows up on `/content/costs` under the right feature.
  - Untagged is $0.
  - The reconcile gap against the OpenRouter `/key` daily usage is under 5%.
  - The Apify row matches Apify's billing for that run.
- **Phase 0:** a one-off live smoke with one real `decide()` call through OpenRouter, checking that the answers parse, cost is above 0 and `/content/system` health is green.
- **Phase 1:** transcribe one public YouTube Short locally and check that the row lands in `content.transcripts`. The health check shows a missing binary clearly.
- **Phases 2 and 3:** run Decode from the dashboard on 2 YouTube competitor channels plus our own. Check:
  - posts have views
  - `hunt_score` is filled
  - paid posts are flagged
  - `jev_health` shows
  - `cost_jev_usd` is about $0.01 for around 100 posts
  - the scatter and filters render
- **Phase 4:** decoded video posts show `text_source='transcript'`, `hook_technique` and format templates. Steal-format drafts follow the template.
- **Phase 5:** a selected topic gets 5 angles, and the draft visibly uses the chosen belief → truth.
- **Phase 6:** seed metrics in a test, then assert that the view's weights reorder `provenHooks`.
- Licence: keep MIT credit comments in the files that contain ported prompts or formulas.
