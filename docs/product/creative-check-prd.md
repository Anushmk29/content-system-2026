# Creative Check (NeuroCreative AI) — Content OS

| | |
|---|---|
| Product | Content OS (PRATAP AI content pipeline) |
| Feature | Creative Check, marketed as "NeuroCreative AI" |
| Version | 2.0 (supersedes PRD v1.0 of 2026-11-06) |
| Date | 2026-11-06 |
| Status | Approved for build (v1), roadmap for v1.1 / v2 |
| Owner | Content OS product |
| Codebase | Next.js dashboard `src/app/content/`, engine `content-pipeline/`, Postgres schema `content` (`db/schema.sql`) |

## 0. Build decisions (v1, 2026-11-06)

Creative Check is built as a **separate tab with a separate pipeline**, so it is easy to find and can never stall, or be stalled by, the posting pipeline, Decode or any other job. What that changes from the original draft:

| Area | Original draft | As built |
|---|---|---|
| Where | Section in the post drawer | Own tab `/content/check`, own sidebar group "Before posting" |
| Input | A content item (`content_items` + `content_assets`) | Its own creatives: `content.check_creatives` + `content.check_media`. No foreign keys to posting tables |
| Running | In the request (max 300 s) | Background job: POST returns at once (202), the page polls. Own queue (2 at a time per process), 6-minute job timeout, one running check per creative enforced by a DB unique index, orphaned runs auto-failed after 10 min |
| Fixes | `updateItemCopy` / `reviseItem` | Written straight into the creative's hook / caption / CTA (no second model call) |
| Proof for urgency/scarcity/social proof | Looked up in `content.claims` | Always warns "needs proof before publishing" (no read of posting tables) |
| Results beside the check (CC-14) | Metrics of the live post | Deferred: needs a link to a published post, which is the future merge step |
| Shared with the rest of the app (read-only) | | Brand Kit (prompt context), the LLM adapter + daily budget guard, the cost ledger (`feature = creative_check`, `ref_type = check_run`), the login/role guard |

Engine: `content-pipeline/src/creative-check/` (`service.ts` = every operation as `fn(ctx, …)` returning JSON, ready to expose as MCP tools; `report.ts` = facts, attention, validator; `media.ts` = frames/speech; `prompt.ts`; `mechanisms.ts`). API: `src/app/content/api/check/*`.

## 1. Summary

Creative Check reviews a post **before it goes out**: the frames of the video or the images, the spoken words with their timestamps, the hook, the caption and the CTA. It reads all of this against the Brand Kit and returns:

- **measured facts** that code computes (no AI guessing),
- **findings** tied to a timestamp or a text field, each graded for how well the content supports it,
- **psychological triggers** present in the creative,
- **neuroscience mechanisms** each with a citation and a science-strength grade,
- **prioritized fixes**, applied in one tap to the hook, caption or CTA,
- a **comparison** with the previous check after edits,
- the post's **real results** shown next to the check once it's live.

### 1.1 USP (why this is not "just Claude")

| A general chat assistant | Creative Check |
|---|---|
| Reads text you paste | Reads the actual frames, audio and copy of the post in Content OS |
| Gives opinions | Every finding points to a timestamp or a quote, and code drops any that point to nothing |
| May invent brain science | Only cites mechanisms from a curated library with citations and evidence grades; brain-% claims are removed by code |
| Forgets | Keeps every check per post version, compares versions, records which fixes you used |
| Doesn't know results | Shows the post's real results beside the check that came before it |
| Generic | Uses your Brand Kit (voice, audience, pillars, offers) and your approval workflow |

Positioning line: **"Create with insight. Publish with confidence."**
Supporting line: **"Timestamped fixes for your own creative, checked by code, tied to your own results."**

### 1.2 Product principles (binding)

1. Every finding leads to an action, or is labelled as insufficient evidence.
2. Facts measured by code are shown separately from AI interpretation.
3. No brain-activation numbers, no dopamine claims, no guaranteed outcomes. Ever.
4. Plain language a non-technical creator understands.
5. Lives in its own tab (**Creative Check**, `/content/check`) with its own tables, API and job queue. Not wired into the posting pipeline yet (see §0).
6. The creator decides: every fix is optional and editable, nothing auto-publishes.
7. No model training. Pretrained models + rules + creator feedback.
8. Every recommendation names how to test it.
9. Cost per check is recorded and kept low (cache, frame cap, one model call).
10. Credibility beats impressive-looking scores. No overall "brain score".

## 2. Goals → how each is answered

| # | Your question | What answers it | Release |
|---|---|---|---|
| G1 | **Attention**: what catches attention, where might they lose interest? | Measured attention signals (CC-03) + attention-risk segments on the timeline (CC-04). Saliency heatmaps in CC-19. | v1 / v1.1 |
| G2 | **Psychology**: which emotional, cognitive and persuasion triggers are present? | 12-trigger taxonomy with evidence, location, role, overuse risk (CC-06). | v1 |
| G3 | **Neuroscience**: what brain-response patterns might it evoke, and how strong is the evidence? | Mechanism library with two grades per claim: content evidence (A–D) and science strength (Established → Speculative) + citation (CC-07, CC-08). | v1 |
| G4 | **Improvement**: what to change, at which timestamp, and why? | Top 3 fixes + prioritized recommendations with location, reason, edit, uncertainty, experiment (CC-09); one-tap apply (CC-10). | v1 |
| G5 | **Effectiveness**: did the changes improve retention, recall, engagement, clicks, conversions? | Version compare (CC-12), results beside the check (CC-14), retention overlay (CC-17), pre-publish audience test for recall (CC-21), split-test tracking (CC-22). | v1 / v1.1 / v2 |

## 3. Users and roles

### 3.1 Personas
- **Creator / client (primary)**: makes Reels, Shorts, LinkedIn and Instagram posts. Wants to know what's weak before posting and how to fix it fast.
- **Social media manager**: reviews many drafts in Approvals. Wants consistent checks and a reason to approve or send back.
- **Performance marketer**: wants clear value propositions, CTAs and testable variants.
- **Agency (v2)**: several brands, before/after reports for clients.

### 3.2 Roles in Content OS (existing, enforced by `src/app/content/_lib/api-guard.ts`)
| Role | Can view checks | Can run a check | Can apply fixes / give feedback |
|---|---|---|---|
| client | yes | yes | yes |
| admin | yes | no (view-only, except open local dev) | no |
| cron (`x-content-secret`) | — | v1.1 (auto-check on QC) | no |

### 3.3 Jobs to be done
1. "Tell me what's weak about this Reel before I post it."
2. "Show me the exact second I lose people, and why."
3. "Which persuasion techniques am I using, and am I overdoing any?"
4. "Is the brain science behind this advice real or hype?"
5. "Give me a better hook and let me use it in one tap."
6. "Did my edit fix the problem?" (version compare)
7. "Did the fixed version actually do better?" (results)

## 4. Scope

### 4.1 In scope — v1 (this build)
| Area | In v1 |
|---|---|
| Content types | Any content item with hook/body/CTA; images (1–10, PNG/JPEG); carousel (slides analysed in order); one MP4 video |
| Platforms | All `content.platform` values (blog, linkedin, x, instagram, facebook, reddit, email, youtube); platform playbook rules applied |
| Language | English (others are analysed, with a limitation note) |
| Entry point | Creative Check tab (`/content/check`): add a creative (copy + images or one MP4), check it |
| Analysis | Measured facts, attention-risk segments, 6 category statuses, findings, triggers, mechanisms, recommendations, top 3 |
| Fixes | Apply replacement hook / CTA directly; rewrite body via existing revise flow; 3 alternative hooks |
| Versions | Every check stored per content version (hash); compare latest vs previous |
| Feedback | Per recommendation: useful / not useful / incorrect / not relevant / applied / skipped + note |
| Results | Existing metrics shown beside the check, with limits on what they prove |
| Guardrails | Code validation of timestamps, quotes, mechanism ids; banned-claim filter |
| Cost | Cost per check in the Costs page; cache on unchanged content; daily budget guard |

### 4.2 Out of scope — v1 (planned later)
| Item | Release |
|---|---|
| Retention-curve entry and overlay on timeline | v1.1 |
| Personalization from feedback history | v1.1 |
| Saliency heatmaps (predicted gaze) | v1.1, after model-weight license check |
| Auto-check every draft in the QC gate | v1.1 |
| Evaluation set + regression script | v1.1 (gate before selling to other customers) |
| Pre-publish audience test (5-second recall / first-impression survey) | v2 |
| Split-test (A/B) tracking | v2 |
| Platform analytics import (retention, watch time) | v2 |
| Agency multi-brand reports | v2 |
| Long-form video (> 90 s), landing pages, live video | later |

### 4.3 Never (non-goals)
- Claim to measure or predict brain activation, dopamine, or specific emotions felt.
- Predict views, CTR or conversions as numbers.
- Guarantee a viral post.
- Use EEG / fMRI / webcam eye-tracking of creators.
- Integrate Meta TRIBE v2 (CC BY-NC, non-commercial) or any model whose license forbids commercial use.
- Auto-publish or auto-edit a published post.
- Scrape private or unauthorized data.
- Recommend fabricated scarcity, fake social proof, invented testimonials, discounts, certifications or benefits.

## 5. Inputs and limits (v1)

| Input | Source | Limit | When over the limit |
|---|---|---|---|
| Hook, body, CTA, title, platform, format, pillar, funnel stage | `content.content_items` | body: first 6,000 chars used | Limitation note "only the first part of the copy was read" |
| Images | `content.content_assets` (PNG/JPEG) | 10 images, 50 MB each (existing upload rule) | Upload already refuses |
| Video | `content.content_assets` (MP4) | 1 file, 50 MB (existing), **90 s analysed** | Longer video: first 90 s analysed + limitation note |
| Brand context | Brand Kit (`loadBrand`, `brandBrief`) | — | Missing brand → check runs, limitation "no Brand Kit saved" |
| Objective | Funnel stage of the item (awareness / consideration / conversion …) | — | — |
| Previous check | Latest `creative_checks` row of the same item | — | — |

Frames sent to the model: **max 10**, longest side **768 px**, JPEG.

## 6. Feature list (v1)

Each feature: ID, priority (P0 = must ship in v1, P1 = should), requirements (numbered, testable), acceptance criteria.

---

### CC-01 Start a check — P0
**Story:** As a creator, I open a post and click "Check this post" to get a review in about a minute.

Requirements
- CC-01.1 A "Creative Check" section appears in the post drawer for every content item, under Preview.
- CC-01.2 Button "Check this post" when no check exists; "Re-check" when the content changed since the last check; "Checked · <time ago>" (disabled re-run, with "Run again anyway" link) when unchanged.
- CC-01.3 While running, stage text cycles: Reading frames → Listening → Checking against your brand → Writing fixes.
- CC-01.4 The check runs in the request (max 300 s). If the drawer is closed, the check still finishes and is stored; reopening the drawer shows it.
- CC-01.5 Two checks of the same item can't run at once; a second click while one is running returns "A check is already running".
- CC-01.6 Admin role sees reports but not the buttons that spend or change (guard returns 403).

Acceptance
- A post with only text gets a report. A post with images gets a report. A post with an MP4 gets a report with timestamps.
- Clicking twice quickly does not create two model calls.

---

### CC-02 Media extraction — P0
**Story:** The system pulls what's actually in the creative so findings are grounded.

Requirements
- CC-02.1 Images: each slide downscaled (sharp) and sent in order with its slide number.
- CC-02.2 Video: written to a temp file; transcript with segment timestamps via faster-whisper (`transcribeFile(path)`); frames via PyAV/numpy (installed with faster-whisper).
- CC-02.3 Frame selection: sample every 0.5 s at low resolution; always keep 0.0 s, 1.5 s, 3.0 s and the last frame; add scene-change frames where mean grey-level difference spikes; cap 10 frames; keep a frame → timestamp map.
- CC-02.4 Scene cuts (list of seconds) are returned for measurement.
- CC-02.5 On-screen text and visible subjects are read by the vision model from the frames and labelled Class B (model-read, not OCR-verified).
- CC-02.6 When Python/faster-whisper is not on the host, the video check continues with copy only and the limitation "Video frames and speech weren't available on this server". Health page shows the transcriber status (existing health check).
- CC-02.7 Temp files are deleted after the check (success or failure). Frames and audio are not stored.

Acceptance
- A 30 s MP4 yields ≤ 10 frames including 0.0 s, transcript segments with start/end, and a cut list.
- Without Python, the check still completes and states the limitation.

---

### CC-03 Measured facts (Class A observations) — P0
**Story:** I see hard numbers about my post that no AI made up.

Computed in code, never by the model:
| Fact | How | Applies to |
|---|---|---|
| Duration | PyAV | video |
| Aspect ratio | width:height → 9:16 / 1:1 / 4:5 / 16:9 / other | image, video |
| Cuts and cut rate | cut list; cuts per 10 s | video |
| First spoken word at | first transcript segment start | video |
| Opening silence | first segment start ≥ 1.0 s → "silent for N s" | video |
| Speech pace | words ÷ speaking seconds | video |
| Hook length | words in hook (or first line of body) | all |
| Caption length | words and characters of body, vs platform limit from `platform-playbooks.ts` | all |
| Reading ease | Flesch reading ease of body (simple syllable counter) | all |
| Asks in CTA | count of distinct asks (follow / comment / DM / link / save / share) by keyword | all |
| Human score | existing `humanScore()` | all |
| Slides | count; words per slide (from model-read text, Class B) | carousel |

Acceptance
- Every fact shows its value and a one-line meaning, e.g. "First spoken word at 2.4 s — viewers see 2.4 s with no voice".
- Facts are identical on two runs of unchanged content.

---

### CC-04 Attention review — P0
**Story:** I see where attention is likely to drop, second by second.

Requirements
- CC-04.1 The video is split into segments (between cuts, or 3 s blocks when there are no cuts).
- CC-04.2 Each segment gets an attention risk: low / medium / high, with reasons from a fixed list: no voice, long static shot (> 4 s with no cut), dense on-screen text, main benefit not stated yet, no face or subject visible, slow speech, repeated point.
- CC-04.3 Risk levels from measured reasons (no voice, static shot) are Class A; from model-read reasons, Class B.
- CC-04.4 Shown as a horizontal strip under the video; clicking a segment seeks the video.
- CC-04.5 Labelled "Attention risk (estimated from the content, not measured on viewers)".
- CC-04.6 Images: first-glance focus — what the model reads as the focal point, text readability, clutter (Class B).

Acceptance
- A video with 4 s of silence at the start shows a high-risk first segment with the reason "no voice", Class A.

---

### CC-05 Creative structure review — P0
**Story:** I get a status for each part of the post.

Six categories, each **Good / Needs review / Insufficient evidence** (text + icon + colour, never colour alone):
| Category | What is judged |
|---|---|
| Hook | First visible/spoken message, relevance to audience, clarity of promise, time to the main benefit |
| Visual | Readability, contrast, hierarchy, subject visible, distracting overlays, pacing |
| Message | One core message, consistent claims, support, density, audience fit |
| Story | Problem → development → payoff, logical order, continuity |
| CTA | Present, wording, visibility/timing, one ask vs several, fits the funnel stage |
| Audience | Fit with Brand Kit audience and pillar |

Acceptance
- Each category with "Needs review" has at least one finding behind it.
- No numeric overall score anywhere.

---

### CC-06 Psychological triggers — P0
**Story:** I see which persuasion techniques my post uses and their risks.

Taxonomy (fixed list in code):
curiosity · novelty · social proof · credibility · urgency · scarcity · loss framing · emotional storytelling · identity relevance · cognitive simplicity · reciprocity · narrative tension.

Each detected trigger returns: name, evidence (quote or frame time), location, persuasive role, possible benefit, overuse/misread risk, suggestion (optional), evidence class.

Rules
- CC-06.1 Always worded "trigger present" or "potential trigger", never "the viewer feels".
- CC-06.2 Urgency, scarcity and social proof must point to the exact claim; if the claim has no proof in `content.claims`, the risk field says "needs proof before publishing" (honest-numbers rule).
- CC-06.3 "None detected" is a valid result.

Acceptance
- A caption "Only 3 spots left" yields scarcity with the quote, and a proof warning when no claim proof exists.

---

### CC-07 Neuroscience mechanism layer — P0
**Story:** I learn what the brain science says about a pattern in my post, and how solid that science is.

Requirements
- CC-07.1 A curated library in code (`content-pipeline/src/mechanisms.ts`), about 15 entries. Each entry: `id`, cue (what in content triggers it), pattern (plain-language explanation), `science` grade, `adLink` grade (how well it's shown to matter for ads/social content), source (author, year, title).
- CC-07.2 The model may attach mechanism ids to findings; it may not write its own neuroscience claims. Unknown ids are dropped by code.
- CC-07.3 Every displayed mechanism shows both grades and the source.
- CC-07.4 Grades: **Established** (replicated, meta-analytic support) · **Supported** (several studies, some limits) · **Emerging** (few studies or mixed replication) · **Speculative** (plausible, not shown).

Initial library (citations verified while writing the file):
| id | Cue | Science | Ad link | Source |
|---|---|---|---|---|
| face_attention | Human face visible early | Established | Supported | Cerf et al. 2008; Kanwisher et al. 1997 |
| visual_saliency | High contrast / colour pop on key element | Established | Supported | Itti, Koch & Niebur 1998 |
| motion_onset | Movement or cut at the start | Established | Supported | Abrams & Christ 2003 |
| cognitive_load | Lots of text + speech at once | Established | Supported | Sweller 1988; Mayer 2009 (redundancy) |
| processing_fluency | Simple words, clean layout | Supported | Supported | Reber, Schwarz & Winkielman 2004 |
| information_gap | Question or open loop in hook | Supported | Emerging | Loewenstein 1994; Kang et al. 2009 |
| picture_superiority | Key idea shown as image, not only said | Established | Supported | Paivio 1971 |
| emotional_memory | Emotional moment tied to the message | Established | Supported | McGaugh 2004 |
| isolation_effect | One element made to stand out | Established | Supported | von Restorff 1933 |
| serial_position | Key point first or last | Established | Supported | Murdock 1962 |
| mere_exposure | Repeated brand/message | Established | Supported | Zajonc 1968; Bornstein 1989 |
| narrative_transport | Story with a character and stakes | Supported | Supported | Green & Brock 2000 |
| loss_aversion | Framed as a loss/cost | Supported (debated) | Supported | Kahneman & Tversky 1979; Gal & Rucker 2018 |
| choice_overload | Several CTAs / options | Emerging (mixed) | Emerging | Iyengar & Lepper 2000; Scheibehenne et al. 2010 |
| reward_anticipation | Promise of a payoff later in the video | Established (fMRI) | Speculative | Knutson et al. 2001 |
| zeigarnik | Unfinished task / cliffhanger | Emerging (weak replication) | Speculative | Zeigarnik 1927; Ghibellini & Meier 2025 |

Acceptance
- A model reply citing "amygdala_hijack" (not in library) shows no mechanism for that finding.
- Every mechanism chip opens a panel with both grades and the source.

---

### CC-08 Evidence system and "Why this?" — P0
**Story:** For every finding I can see why the system thinks it, and how sure it is.

Content evidence classes (every finding and trigger has exactly one):
| Class | Meaning | Example |
|---|---|---|
| **A · Observed** | Measured by code or directly in the content | "First spoken word at 2.4 s." |
| **B · Interpretation** | Read from the content + general principles; viewer response not measured | "Dense on-screen text at 0:05 may be hard to read in time." |
| **C · Hypothesis** | Plausible improvement, not validated for your audience | "Stating the benefit in the first 2 s may improve early retention." |
| **D · Insufficient** | Can't support a conclusion | "Can't judge the music: no audio analysis." |

"Why this?" panel shows: evidence (quote, frame time, or measured fact), interpretation, mechanism(s) with both grades, what's uncertain, how to test it.

Rules
- CC-08.1 No confidence percentages anywhere.
- CC-08.2 The class is shown as a letter + word (accessible), not colour alone.
- CC-08.3 Class A can only be set on findings backed by a measured fact; code downgrades A → B otherwise.

---

### CC-09 Recommendations and top 3 — P0
**Story:** I get specific edits in priority order.

Each recommendation contains: id, linked finding ids, target (hook / body / cta / visual / edit), problem, location (timestamp or field), why, proposed change, replacement text (for hook/body/cta), expected direction ("earlier relevance", "fewer asks"), uncertainty, experiment (what to compare and which metric), priority.

Priorities (fixed criteria, not predicted lift):
| Priority | Criteria |
|---|---|
| Critical | Factual risk, unproven claim, missing CTA on a conversion post, unreadable text, platform limit exceeded |
| High | Clear issue that blocks message delivery or the funnel goal (benefit after 5 s, 3+ asks) |
| Medium | Worthwhile but optional |
| Low | Style alternative or exploration |

Rules
- CC-09.1 Top 3 = the three highest-priority recommendations (ties: earliest in the video first).
- CC-09.2 For the hook, up to **3 alternative hooks** are given.
- CC-09.3 Replacements keep the facts, product details and Brand Kit voice; they may not add testimonials, numbers, discounts, scarcity, certifications or benefits not in the original.
- CC-09.4 Visual/edit recommendations (e.g. "cut 0:00–0:02", "add text at 0:01") are instructions only; no video editing in v1.

Acceptance
- Every recommendation names a location and an experiment.
- A replacement hook that contains a number not present in the original is dropped by code.

---

### CC-10 One-tap fixes — P0
**Story:** I use a suggested hook or CTA with one tap.

Requirements
- CC-10.1 "Use this" on a replacement hook or CTA writes it to the item directly (`updateItemCopy`), no second model call.
- CC-10.2 "Rewrite with this fix" on a body recommendation calls the existing `reviseItem()` with the recommendation as feedback.
- CC-10.3 Only while the item status is editable (idea, draft, qc_passed, needs_approval); otherwise the buttons are hidden.
- CC-10.4 Applying marks the recommendation `applied`, and the section shows "Re-check" (content changed).
- CC-10.5 The human check (`humanScore`) re-runs on the new copy as it does today.

Acceptance
- Applying an alternative hook updates the preview and the copy editor; the check shows "content changed since this check".

---

### CC-11 Validation and guardrails — P0
**Story:** I can trust that nothing in the report is made up.

Code rules applied to every model reply before it is stored:
| ID | Rule | Action |
|---|---|---|
| V-01 | Reply must match the report schema | Repair defaults; if unusable → check fails with a clear message, no cost re-charged on retry of the same hash |
| V-02 | Timestamp outside [0, duration] or on a non-video | Drop the finding |
| V-03 | Quote not found (normalized) in transcript, hook, body, CTA or model-read slide text | Drop the quote; if the finding rested on it, drop the finding |
| V-04 | Mechanism id not in library | Remove the id |
| V-05 | Recommendation points to a missing finding | Drop the recommendation |
| V-06 | Class A without a measured fact | Downgrade to B |
| V-07 | Banned neuroscience claims: brain region + activation/%, "dopamine", "amygdala", "reward center", "neurons fire", "hijack" | Remove the sentence; count it |
| V-08 | Banned outcome claims: "guarantee", "go viral", "will get N views/likes", predicted CTR/conversion numbers | Remove the sentence; count it |
| V-09 | Any `N%` in model text that is not one of the measured facts | Remove the sentence; count it |
| V-10 | Replacement text adds numbers, testimonials, discounts, scarcity or certifications not in the original | Drop the replacement |
| V-11 | List caps: 12 findings, 12 triggers, 8 recommendations, 3 alt hooks | Truncate by priority |
| V-12 | Removed items | Limitation: "Removed N statements we couldn't support" |

Acceptance
- A test reply with "your amygdala activates 89%", a timestamp at 0:45 on a 30 s video and a quote not in the transcript produces a report without any of them and a limitation counting 3 removals.

---

### CC-12 Versions and compare — P0
**Story:** After editing, I see what got better, what's still open and what's new.

Requirements
- CC-12.1 Version identity = SHA-256 of hook + body + CTA + all asset bytes. Each check row stores it.
- CC-12.2 Same hash → the stored check is returned (no model call) unless "Run again anyway".
- CC-12.3 On re-check, the previous check's findings (id, category, title) are sent to the model; it returns `resolved` ids; code keeps only ids that exist in the previous check.
- CC-12.4 Compare view: Resolved · Still open · New, plus a measured-facts diff (e.g. "First spoken word 2.4 s → 0.6 s", "Asks in CTA 3 → 1").
- CC-12.5 History list: all checks of the item, newest first, with date and a "content changed" marker.
- CC-12.6 Compare never says the new version "will perform better"; it says what changed and what to test.

Acceptance
- Edit a hook, re-check: the old hook finding appears under Resolved; the facts diff shows the hook length change.

---

### CC-13 Feedback per recommendation — P0
**Story:** I mark whether each fix was useful so the system learns my preferences.

Requirements
- CC-13.1 Per recommendation: Useful · Not useful · Incorrect · Not relevant to my audience · Skipped (Applied is set automatically by CC-10), plus an optional note (max 500 chars).
- CC-13.2 Stored per recommendation in the check row (`feedback` JSON), with time.
- CC-13.3 Feedback can be changed; last one wins.
- CC-13.4 Feedback counts appear on the Costs/System page as "Creative Check: N checks, X% of fixes marked useful, Y applied" (P1).

---

### CC-14 Results beside the check — P1
**Story:** After posting, I see how the post did next to what the check said.

Requirements
- CC-14.1 When the item is live and has metrics (existing `content.metrics` + MetricsForm), the Creative Check section shows: the last check before publishing, its top 3 and whether each was applied, and the latest metrics with capture date.
- CC-14.2 If the item has a sibling version that was also published (same anchor), show both side by side with the metric definition and dates.
- CC-14.3 Fixed text: "A before/after comparison isn't proof. Audience, timing and distribution also changed." plus the experiments the check suggested.

---

### CC-15 Cost, caching and limits — P0
Requirements
- CC-15.1 One model call per check (vision + text together).
- CC-15.2 Cost recorded under feature `creative_check`, ref = content item (existing cost ledger → Costs page).
- CC-15.3 Existing daily budget guard (`CONTENT_DAILY_BUDGET_USD`) blocks checks when spent; the user sees "Daily AI budget reached" (HTTP 429).
- CC-15.4 Cache by version hash (CC-12.2).
- CC-15.5 Frame cap 10 at 768 px; transcript cap 6,000 chars.
- CC-15.6 Target cost per check: under $0.10 for a 30 s Reel on the default model (to be measured from the ledger in the first week; pricing decisions use measured cost only).

---

### CC-16 Visibility and health — P1
- CC-16.1 A failed check shows the reason in plain words (no stack traces, DB errors hidden by `handle()`).
- CC-16.2 The report stores `prompt_version`, `model`, extraction mode (`video+speech`, `video-no-speech`, `images`, `copy-only`) and the limitations.
- CC-16.3 Health page already shows the transcriber; its message adds "Creative Check video frames: available / not available".

## 7. Report output contract (v1)

```ts
interface CreativeCheckReport {
  version: { promptVersion: string; model: string | null; mode: 'video+speech' | 'video-no-speech' | 'images' | 'copy-only' };
  summary: string;                                   // 2–4 sentences, plain language
  categories: Record<'hook'|'visual'|'message'|'story'|'cta'|'audience', 'good'|'review'|'insufficient'>;
  facts: { key: string; label: string; value: string; meaning: string }[];          // CC-03, code only
  attention: { start: number; end: number; risk: 'low'|'medium'|'high'; reasons: string[]; evidence: 'A'|'B' }[];
  findings: {
    id: string; category: string; title: string; detail: string;
    at: { start: number; end?: number } | { field: 'hook'|'body'|'cta'|'slide'; slide?: number };
    quote?: string; evidence: 'A'|'B'|'C'|'D'; priority: 'critical'|'high'|'medium'|'low';
    mechanisms: string[];                                                            // library ids
  }[];
  triggers: { name: string; evidence: string; at: string; role: string; benefit: string; risk: string; suggestion?: string; class: 'A'|'B'|'C'|'D' }[];
  recommendations: {
    id: string; findingIds: string[]; target: 'hook'|'body'|'cta'|'visual'|'edit';
    problem: string; at: string; why: string; change: string; replacements: string[];
    direction: string; uncertainty: string; experiment: string; priority: 'critical'|'high'|'medium'|'low';
  }[];
  top3: string[];                                    // recommendation ids
  resolved: string[];                                // previous check's finding ids
  limitations: string[];
}
```

## 8. Data model

Three new tables, none referencing the posting tables (`db/schema.sql`, end of file):

- `content.check_creatives`: name, platform, funnel_stage, hook, body, cta.
- `content.check_media`: (creative_id, idx) → mime + bytes. Up to 10 PNG/JPEG images or one MP4.
- `content.check_runs`: creative_id, input_hash (version, CC-12.1), status `running|done|error`, stage `queued|reading|listening|checking|done`, report (`CreativeCheckReport`), feedback `{ [recId]: { verdict, note, at } }`, prompt_version, model, message, started_at, finished_at. A partial unique index allows one `running` row per creative.

Cost per check = sum of `content.cost_events` where `ref_type = 'check_run'` and `ref_id` = the run id.
Deleting a creative deletes its media and checks (cascade). Video frames and audio are never stored.

## 9. API

All wrapped in `handle()` (login, role, audit log, error mapping). The run route is rate-limited as a spend path.

| Route | Method | Body | Returns |
|---|---|---|---|
| `/content/api/check` | GET | — | `{ ok, creatives }` with the latest check of each |
| `/content/api/check` | POST | `{ name, platform, funnelStage, hook, body, cta }` | `{ ok, creative }` |
| `/content/api/check/:id` | GET | — | `{ ok, creative, media, hash, checks }` (poll this while a check runs) |
| `/content/api/check/:id` | PATCH | copy fields · `{ apply: { checkId, recId, replacement } }` · `{ feedback: { checkId, recId, verdict, note } }` | `{ ok, message }` |
| `/content/api/check/:id` | DELETE | — | `{ ok }` |
| `/content/api/check/:id/media` | GET `?i=0` / POST multipart | files (none = remove) | the file / `{ ok, message }` |
| `/content/api/check/:id/run` | POST | `{ fresh?: boolean }` | 202 `{ check }` running, or 200 `{ check, cached: true }` |

Errors: 400 bad input · 401 locked · 403 admin view-only · 404 not found · 409 a check is already running · 429 budget/rate limit. A failed job stores its reason on the run (`status = 'error'`, `message`).

## 10. UI specification (Creative Check tab)

Order inside the section:
1. **Header row**: "Creative Check" · status (Not checked / Checked 3 min ago / Content changed since check) · button (Check this post / Re-check / Run again anyway).
2. **Summary**: 2–4 sentences.
3. **Top 3 fixes**: cards with priority, location chip, change, "Use this" / "Rewrite with this fix".
4. **Categories**: 6 chips, each label + status word + icon.
5. **Video + attention strip** (video posts): `<video controls>` from the existing asset URL; risk strip under it; timestamp chips anywhere in the report seek the video.
6. **Findings**: filter chips (Hook · Visual · Message · Story · CTA · Audience · Psychology); cards with evidence badge (letter + word), location, detail, mechanism chips, "Why this?" `<details>`, feedback buttons.
7. **Triggers**: grouped list; scarcity/urgency/social proof show the proof warning when relevant.
8. **Measured facts**: two-column table.
9. **Compare with previous check** (when one exists): Resolved · Still open · New + facts diff.
10. **Results** (live posts): CC-14.
11. **Limitations**: always shown when non-empty.

Accessibility: keyboard-reachable buttons and chips; status never by colour alone; video has native controls; transcript segments listed under the video.

## 11. Non-functional requirements

| Area | Requirement |
|---|---|
| Speed | Text-only check p50 ≤ 30 s; 30 s Reel p50 ≤ 60 s on CPU whisper `small` (to be benchmarked); hard limit 300 s |
| Reliability | One provider retry (existing adapter behaviour); failure leaves no partial row; same-hash retry doesn't double-charge once a row exists |
| Concurrency | One running check per item (in-process lock). `// ponytail:` single-instance lock; move to a DB advisory lock if more than one web instance runs |
| Security | Existing login cookie + role guard + CSRF in `src/middleware.ts`; media served only through the authenticated asset route; no model keys in the browser |
| Privacy | Media goes only to the configured model provider; frames/audio temp files deleted; checks deleted with the item |
| Auditability | Prompt version, model, mode and limitations stored per check |
| Accessibility | See §10 |

## 12. Success metrics

| Metric | Target (first 30 days) | Source |
|---|---|---|
| Checks completed / started | ≥ 95% | check rows vs failures in logs |
| Fixes marked useful (of rated) | ≥ 70% | `feedback` |
| Fixes applied per check | ≥ 1 on average | `feedback.applied` |
| Re-check after edit | ≥ 40% of checked posts | rows per item |
| Unsupported claims removed per check | trending down; 0 shown to users | V-12 count |
| Brain-activation claims shown | 0 | V-07 |
| Cost per check | measured; under $0.10 for a 30 s Reel | Costs page |

No performance-lift claims until there are results from controlled tests (v2).

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Model invents findings | V-01…V-12 code validation; one fixed schema |
| Generic advice | Brand Kit context, timestamps, platform playbook, measured facts |
| Neuroscience hype | Mechanism library only, two grades, banned-claim filter |
| Host has no Python (Docker image) | Copy-only mode with a clear limitation; optional Docker step (§16) |
| Slow on CPU | Whisper `small`, 90 s cap, frame cap; benchmark in week 1 |
| Cost creep | Hash cache, one call, budget guard, cost ledger |
| Wrong citations | Each source checked when writing `mechanisms.ts` |
| Misleading before/after | Fixed disclaimer text; experiments listed |
| Licensing (saliency weights, TRIBE v2) | Not in v1; license review gate for v1.1 |

## 14. Roadmap

**v1 (this build, ~1 week):** CC-01 … CC-16.

**v1.1 (+2 weeks)**
- CC-17 Retention entry: paste watch-retention points (second → % still watching) per published item; overlay on the attention strip; show where real drop-off matches a flagged segment.
- CC-18 Personalization: last 20 recommendations marked "not relevant" / "not useful" are sent to the prompt as things to avoid; Brand Kit already applies.
- CC-19 Saliency heatmaps: a commercially licensed saliency model on the sampled frames, shown as overlays, Class B "predicted gaze".
- CC-20 Evaluation set: 20–30 legally usable creatives with expected findings; a script that runs them and prints a review sheet; run on every prompt version change. Gate before offering the feature to other customers.
- Auto-check every draft in the QC gate (cost-capped).

**v2 (+4–6 weeks)**
- CC-21 Pre-publish audience test: a private link that shows the creative for 5 s, then asks 3 questions (what was it about, which brand, would you watch on). Results = recall and first-impression scores per version.
- CC-22 Split-test tracking: hypothesis, the one changed variable, target metric, both versions, dates, result, limits.
- CC-23 Platform analytics import (retention/watch time) where the platform API exposes it.
- CC-24 Agency reports: before/after PDF per campaign.

**Research only:** neural response models (e.g. TRIBE v2 is CC BY-NC, so it can't be used commercially), consent-based eye-tracking with real viewers.

## 15. Open questions
1. Add Python + faster-whisper to the Docker image (about +1 GB) so video checks work in Docker? (Recommended: yes.)
2. Should checks run automatically on every new draft (v1.1), or only on click?
3. Which model is the default for checks: the current default via OpenRouter, or a separate `CONTENT_CHECK_MODEL`?
4. Marketing name in the UI: "Creative Check" (recommended, plain) or "NeuroCreative AI"?
