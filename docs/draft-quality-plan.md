# Plan: personalized per-platform drafting, with Jev making the decisions

## Goal
- Every format gets its **own prompt**, personalized to this install: LinkedIn post, blog article, X thread, carousel, Instagram post and Facebook post. Each one stops being a section of a single shared prompt.
- Every **decision** in drafting is made by **Jev**. The regular LLM still **writes**: Jev is a typed decision model that answers questions, and it can't write copy.

## Where drafting stands (checked 2026-10-07)
- **No skills are used.** `draftTopic` (`modules/draft-generator.module.ts`) makes **one** call that writes all five pieces in one JSON reply, capped at 8,192 tokens.
- **One shared system prompt.** `brandSystem()` (`prompts/brand-brain.ts`) holds every platform's rules in a single "PER-PLATFORM SHAPE" block, so each platform gets a few lines and shares the token budget with the others.
- **Instagram is always the carousel.** There's no single-image Instagram post. The style carousel has its own separate prompt (`draftCarousel` in `services/style-service.ts`).
- **The LLM decides things inside the draft call:** the offer, which proven hook to borrow, and whether a platform is worth making at all (every topic always gets all five).
- **Jev is already wired:** it runs through OpenRouter (`adapters/jev.ts`), and `modules/decide.ts` routes each typed decision.
  - In **primary** mode Jev answers when it's confident; otherwise the LLM "teacher" answers.
  - Every answer is logged to `content.decisions`, which is the training dataset.
  - Topic scoring, QC and the competitor hunt already work this way.
  - Nobody sets `CONTENT_JEV_MODE`, so it runs in **shadow** mode: Jev is only logged and never used.
- **Brand Kit (live DB):** `audience` is **empty**. There are 8 voice samples, of which only 5 are used, and none is tagged by platform.
- **Your feedback is lost:** a hand edit overwrites the AI's text, and "Request changes" notes are stored in `content.approvals` but never read.
- **No performance data yet:** `content.metrics` has 0 rows.

**Not in this plan, because [breezy-tinkering-catmull.md](breezy-tinkering-catmull.md) covers them:** angles (its Phase 5), Decode skeleton templates (Phase 4), the hook-pattern learning loop (Phase 6) and cost logging (Phase C). The shared `HOOK_PATTERNS` taxonomy is reused here.

---

## The new flow for one topic
```
topic
 ├─ JEV  platform_fit   → which of the 6 pieces to make + which offer
 ├─ LLM  LinkedIn prompt → anchor post, with 3 hook options
 ├─ JEV  hook_pick      → the strongest of the 3 hooks
 ├─ JEV  draft_review   → pass, or one rewrite with the failed checks
 ├─ LLM  per-platform prompts, in parallel, from the anchor
 │       blog · X · carousel · Instagram · Facebook (only the ones Jev picked)
 ├─ JEV  draft_review   → for each piece: pass, or one rewrite
 └─ JEV  qc_signals     → as today (risk, honest numbers)
```
Every Jev decision goes through the existing `decide()`, so it's logged, falls back to the LLM when Jev isn't confident, and feeds the training dataset. When you override a decision (pick a different hook, force a skipped platform, edit the copy), that becomes a label Jev learns from.

## P1: Per-platform prompts, personalized
**What changes**
- `brandSystem()` splits into two parts:
  - a shared **brand core**: who, audience, voice, pillars, offers, the honest-numbers rule and CRAFT;
  - a **platform playbook** for each of the 6 kinds.

**Prompt for each piece** = brand core + that platform's playbook + that platform's own examples + proven hooks for that platform.

**Default playbooks (in code, one file `prompts/platform-playbooks.ts`)**
| Kind | Saved as (platform, format) | Shape |
|---|---|---|
| linkedin | linkedin, founder_post | The anchor: 150–300 words, first line ≤ 12 words, no links in the body, written to draw comments, soft CTA |
| blog | blog, article | SEO article expanding the anchor: H2s, concrete examples, short FAQ, CTA |
| x | x, thread | 5–7 tweets under 270 characters each; tweet 1 stands alone; ends with a question |
| carousel | instagram, carousel (also used for the LinkedIn PDF) | 6–8 slides, one idea per slide, ≤ 20 words a slide, cover = hook, last = CTA. `draftCarousel` in style-service uses this same playbook, so there's one carousel prompt and not two |
| instagram | instagram, quote_card | A **single-image post**: one line of image text plus a caption with a hook in the first 125 characters, a story-driven middle and 3–5 niche hashtags |
| facebook | facebook, founder_post | Warm and conversational, 80–150 words, ends with a simple question |

**Personalization (stored per install, edited on `/content/brand`)**
- New column `brand_kit.platform_playbooks jsonb`, shaped `{ linkedin: { rules, samples[] }, … }`.
  - `rules`: your own extra rules for that platform, added on top of the default playbook (e.g. "never use emojis on LinkedIn").
  - `samples`: 2–5 of your real posts **for that platform**. A LinkedIn post and a tweet sound different, so the shared voice samples become the fallback.
- **House style for each platform:** your last 3 approved posts on that platform, plus your last 3 edits there ("AI wrote → you changed it to"). This needs D3.
- Proven hooks already filter by platform (`provenHooks`).
- On the Brand page: one tab per platform with rules and samples, plus a warning when the audience is empty.

**Files**
- `prompts/brand-brain.ts` (split)
- new `prompts/platform-playbooks.ts`
- `brand.ts` and `services/brand-service.ts` (new field)
- `db/schema.sql`
- `modules/draft-generator.module.ts`
- `services/style-service.ts` (carousel shares the playbook)
- `app/content/ui` Brand page

## P2: Jev decisions in drafting
Three new `DecisionTaskDef`s in `modules/decision-tasks.ts`, built per call from the Brand Kit the same way `topicQuestions()` is.

**1. `platform_fit`** (state: topic + market check)
- One `noul` question per kind, e.g. "Does this topic work as a 7-tweet X thread for {audience}?".
- An `offer` choice over the Brand Kit offers.
- Pieces scoring below 0.4 are skipped and show as "skipped by Jev, make anyway" in the UI.
- This replaces the topic score's single `repurpose` number.

**2. `hook_pick`** (state: topic + platform + the 3 hook options)
- A `choice` question: "Which opening would make {audience} stop scrolling on {platform}?".
- Each option is tagged with its `HOOK_PATTERNS` type.
- The other two stay in the drawer as chips, one click away.

**3. `draft_review`** (state: one piece + its platform)
- `noul`: the hook is a statement, not a question; one core claim; sounds like the voice samples; fits the platform's playbook; the CTA is soft.
- `score`: every line is useful (1–4).
- Length and format limits (characters per tweet, words per slide, number of slides) are **code rules**, not Jev questions: no model needed.
- On a fail: **one** rewrite listing the failed checks; the second result is kept and any remaining issues show as drawer warnings.

**Mode:** set `CONTENT_JEV_MODE=primary`. Jev decides whenever its confidence is at or above `minConfidence`; below that, `decide()` falls back to the LLM automatically, so no new code is needed for fallback. Nothing else changes in `decide.ts`.

**Files:**
- `modules/decision-tasks.ts`: 3 definitions added to `DECISION_TASKS`, so the dataset/Training tab picks them up.
- `modules/draft-generator.module.ts`
- `.env`: `CONTENT_JEV_MODE=primary`.

## P3 (= old D3): Learn from you (works now, no metrics needed)
- **Keep the AI original:** `alter table content.content_items add column if not exists ai_body text`. It is set in `createDraftSet`; `editItemCopy` doesn't touch it.
- **Request changes = redraft:** `changes` with a note triggers `redraftItem(ctx, itemId, note)`, which rewrites that one piece with its own platform prompt plus the note.
- **Dataset labels:**
  - Approved, edited and change-requested pieces are joined to their `draft_review` decision.
  - A swapped hook chip is joined to `hook_pick`.
  - A forced platform is joined to `platform_fit`.

  These are the labels Jev learns your taste from.

## P4 (later): Learn from results
Once about 20 posts have rows in `content.metrics`, add "your top 3 posts by `vs_usual` on this platform" to that platform's house-style block. Breezy Phase 6 adds the hook-pattern weights in the same place.

---

## Cost per topic (rough)
- **Today:** 1 Sonnet call, about $0.06–0.08.
- **New:**
  - 1 anchor call plus up to 5 piece calls, run in parallel. Each is smaller: about $0.01–0.03, and the blog about $0.05.
  - About 8 Jev decisions.
  - At most 6 rewrites, but only for pieces that fail.
  - **Expect about $0.12–0.20 per topic.** Phase C logs the real number.
- **Possible saving:** cache the brand core between the 6 calls (`cache_control` through OpenRouter). Do this when cost matters.

## Build order
1. Fill in the audience on the Brand page (5 minutes, no code).
2. P1: per-platform prompts, the new playbook file and the Brand page tabs.
3. P2: the 3 Jev decisions and `CONTENT_JEV_MODE=primary`.
4. P3.

P4 waits for data.

## Verification
- **Unit tests** (`node --test`, PGlite):
  - each platform gets its own system prompt containing that platform's rules and samples;
  - the carousel and `draftCarousel` share one playbook;
  - a `platform_fit` below 0.4 skips the piece;
  - `hook_pick` sets the hook and keeps the other 2 as options;
  - a `draft_review` fail leads to exactly one rewrite;
  - each of the 3 new decisions logs a row to `content.decisions`;
  - with Jev under its confidence threshold, the LLM decides.
- **Before/after check (about $1):** a one-off script in the scratchpad drafts the same 5 real topics with the old and the new flow, side by side. You read both and pick; the new flow ships only if it wins.
- Then run `tsc --noEmit` on the app and do one live draft from the dashboard. Check the Training tab shows the new decision rows.
