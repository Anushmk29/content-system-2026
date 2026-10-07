# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Operator (primary, daily):** runs the pipeline from `/content`. That means capturing signals, selecting topics, running steps, fixing broken connections, scheduling, and entering results. Autonoetic Edge does this for the client.
- **Vijendra (client, founder of PRATAP AI, non-technical):** approves or rejects drafts and reads results. He must never need IG Insights, LinkedIn analytics or Google Analytics to know how marketing is going.

## Product Purpose

PRATAP AI's content-to-pipeline engine, growing into a simplified **Marketing OS**: every marketing KPI in one place for the client.

- **Content** is the first branch: expertise → scored topics → platform-native drafts → quality and risk gate → human approval → Postiz scheduling → published posts → leads → a weekly learning loop.
- **Later branches:** website traffic (GA4 and Search Console), then paid ads (Meta and LinkedIn Ads).

**Success:** the client sees all marketing results in one place, and the operator runs the whole loop without leaving it. Within content, the main metric is still **qualified conversations started**, not impressions.

## Positioning

A "content-to-pipeline" engine, not a "post everywhere" machine. Each post traces from the idea that produced it to the leads it brought in, through UTMs on every link (`core/utm.ts`) and `leads.source_content_item_id`. Content is anchor-first: one strong anchor piece, repurposed per platform and linked by `anchor_id`.

## Operating Context

- **Weekly cadence (docs/STRATEGY-PLAYBOOK.md):**
  - Monday: research and scoring
  - Tuesday: anchor content
  - Wednesday: repurpose
  - Thursday: QC, approval and scheduling
  - Friday: engagement and analytics review
- **Platforms:** LinkedIn, X, blog, Instagram, Facebook, Reddit and email, with per-platform output targets. The weekly post target constant is 5.
- **Brand brain:** lives in `prompts/` (ICP, brand voice, pillars, platform rules, QC checklist, scoring rubric).
- **Governing reference:** `Content_Pipeline_Bible_Final.docx` (v3).

## Capabilities and Constraints

- **Never auto-publish.** A human approves every post. Automate only safe, proven templates, and only later.
- **No command line.** Every human step and pipeline run must be doable by clicking in `/content`.
- **Phone-friendly.** Approvals and checking results must work on a phone.
- **Fault-isolated modules.** A broken step must show as broken, with its fix; nothing fails silently.
- **Write routes are guarded** by `CONTENT_RUN_SECRET`. The lead webhook is the only public write.
- **Stack:** Next 15 / React 19, with the engine package `@pratapai/content-pipeline` on Postgres (`content` schema), an OpenRouter/Anthropic LLM, self-hosted Postiz, and Apify for the competitor Decode page.
- **Undecided:**
  - when the website and paid-ads branches start
- **Decided 2026-10-03:** the client uses the same dashboard as the operator, worded for a non-technical reader. Fixes are in plain English, with technical detail behind a disclosure.

## Brand Commitments

- **Brand:** PRATAP AI INNOVATIONS.
- **Voice:** practical, for founder-led SMEs. It is never enterprise ("governance", "ROI and risk" are research inputs, not our publishing voice). See `prompts/icp.md` and `prompts/brand-voice.md`.
- **Dashboard look (binding, user-confirmed):** the light "Editorial Decode" look defined in `docs/DESIGN-GUIDE.md`.

## Evidence on Hand

- **Real pipeline data is in Postgres:** items, approvals, module runs, leads, decisions.
- **There are no published-post performance numbers yet.** Metrics are entered by hand until a collector exists.
- **The competitor Decode page has never run on real Apify data**, because the token isn't set.
- **There are no testimonials, case studies or client results to show.** Do not invent them.

## Product Principles

1. **Say what to do next.** Every count should come with its next step; a dashboard that only reports has failed.
2. **Trace content to revenue.** Prefer metrics that link a post to leads and conversations over vanity reach.
3. **A human approves before anything goes out.** Speed never bypasses approval.
4. **Broken is loud.** Failures show where they happen, with the exact fix.
5. **One place.** If the client has to open another tool to understand marketing, the product has a gap.
