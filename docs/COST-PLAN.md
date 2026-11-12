# API cost: what it costs now, and how to cut it without losing quality

*Prepared 2026-10-12. Unit costs are averages measured from `content.cost_events` (92 real calls,
7–11 Oct 2026, $0.73 total). Lines marked **est** have no logged calls yet and are estimates.*

## Summary

| Pace | Posts per month | Before: per month | Before: per week | After the changes: per month | After the changes: per week |
|---|---|---|---|---|---|
| Light | ~60 | ~$8.00 | ~$1.90 | ~$4.10 | ~$0.95 |
| Standard | ~150 | ~$17.50 | ~$4.10 | ~$9.50 | ~$2.20 |
| Heavy | ~450 | ~$48.00 | ~$11.30 | ~$27.00 | ~$6.30 |

**Standard pace** means one topic drafted a day. Each topic becomes about 5 posts, one each for
LinkedIn, the blog, X, Instagram and Facebook.

The biggest cost today is **research**, not writing. Every incoming Reddit or Hacker News signal
is web-checked and turned into a topic before anyone decides whether it is worth it. So far only
7 of 31 topics were used: 4 were dropped and 19 were never picked.

---

## 1. What each action costs today

| Action | Model(s) | Cost |
|---|---|---|
| Signal → topic (Research) | Perplexity Sonar web check $0.006 + Claude Sonnet 5.5 $0.005 | **$0.011** each |
| Score a topic + choose its platforms | Jev | ~$0.0001 (Sonnet ~$0.005 when Jev is unsure) |
| Draft one topic, 5 platforms | Sonnet (5.6k tokens in / 3.5k out) | **$0.043** |
| Write the topic's 5 angles + its video script | Sonnet | ~$0.035 **est** |
| QC (quality check) | Jev + the human-sounding score (a local rule) | ~$0 |
| Human-sounding rewrite (only when the score is under 70) | Sonnet | $0.021 per post rewritten |
| "Request changes" revision | Sonnet | $0.021 |
| Decode (one competitor scan) | Sonnet $0.05–0.11 + Apify scraping $0.05–0.20 **est** | ~$0.15–0.30 |
| Video analysis ("why it worked") | Sonnet + Jev | $0.022 per video (top 3 per scan run automatically) |
| "Write it →" from a video idea | Sonnet draft + script + QC | ~$0.08 **est** |
| "Write my version" from a competitor post | DeepSeek Flash + Sonnet | $0.023 |
| Brand Studio carousel (4 images) | Qwen Image 3 at $0.034 per image + Sonnet | ~$0.16 |
| Weekly review | Sonnet, once a week | ~$0.03 |
| Transcription, Postiz scheduling, TinyFish | Run on our own server, or free | $0 |

## 2. Where the money goes today (per month)

| Line | Light | Standard | Heavy |
|---|---|---|---|
| *Pace* | 3 topics/week, 10 signals/day, 4 scans | 1 topic/day, 20 signals/day, 8 scans | 3 topics/day, 40 signals/day, a scan every day |
| Research (signals → topics) | $3.30 | $6.60 | $13.20 |
| Scoring that falls back to Sonnet (assumed 20% of decisions) | $0.60 | $1.20 | $2.40 |
| Drafting, angles and scripts | $0.93 | $2.33 | $6.98 |
| Human-sounding rewrites + change requests | $0.59 | $1.58 | $4.73 |
| Competitor scans + video analysis | $1.06 | $2.13 | $10.98 |
| Weekly refresh of our own posts | $0.40 | $0.40 | $0.40 |
| Writing from video ideas and competitor posts | $0.32 | $1.19 | $3.09 |
| Brand Studio images | $0.64 | $1.92 | $6.40 |
| Weekly review | $0.12 | $0.12 | $0.12 |
| **Total per month** | **≈ $8.00** | **≈ $17.50** | **≈ $48.00** |
| **Total per week** (month ÷ 30 × 7) | **≈ $1.90** | **≈ $4.10** | **≈ $11.30** |

### Running costs besides the API

| Item | Per month |
|---|---|
| Server (2–4 GB RAM; transcription runs on it) | $12–24 |
| Postgres (Supabase) | $0 on the free plan, $25 on Pro (includes backups) |
| Apify | $0: the free plan's $5 monthly credit covers light and standard pace |
| Postiz, Jev, TinyFish | $0 |
| OpenRouter | ~5.5% fee on credit top-ups |
| Instagram, Facebook and LinkedIn publishing | Free |
| **All-in at standard pace** | **≈ $30–65 now, ≈ $22–57 after the changes** |

---

## 3. The changes: cut what never reaches a post, keep paying for what does

**Rule:** anything the reader sees stays on Sonnet: drafts, scripts, revisions, the human-sounding
rewrite and video analysis. Only work that never reaches a post moves to a cheaper path.

**Status (2026-10-12):** Steps 1, 3 and 4 are built and tested. Step 2 is built for topic
extraction only. Nothing is committed yet.

### Step 1: Filter signals before researching them. Built.

**Before:** every signal got a Perplexity web check and a Sonnet topic-extraction call. Jev scored
it only after that.

**Now (`modules/research.module.ts`):**
1. **Relevance check (Jev, ~$0).** Jev answers whether this audience would want a post about the
   signal.
   - Below 0.2 the signal is marked `dropped`, and no LLM call is made.
   - The call is logged as task `signal_relevance`, so the Training page can check it.
   - If Jev is off or fails, the signal goes through. An outage never loses a signal.
2. **Topic extraction on the cheap model** (Step 2), with **no** web check yet.
3. **Scoring is unchanged** (Jev-primary).
4. **The web check runs once, when it matters.**
   - The Draft Generator runs `ensureMarketContext` before it drafts a topic that has no market
     context, and saves the result on the topic.
   - "Make posts" on a signal still checks at once, because it drafts next.
   - If the check fails, the topic is drafted without it, as before.

**Quality:** every drafted topic still gets the web check and Sonnet drafting. Ideas that are never
drafted no longer get one. **Trade-off:** Jev's "reach" score no longer sees market evidence for
batch topics.

**Decided against:** web-checking every high-band topic straight after scoring. It would pay again
for topics nobody drafts.

### Step 2: A cheap model for work nobody reads. Built, narrower than first planned.

**Now:** `CONTENT_CHEAP_MODEL` sets the model. The default is `deepseek/deepseek-v4.1-flash`;
`off` uses the main model. With the Anthropic provider directly, it always uses the main model.
It is used for **topic extraction** (a ~100-token structured reply).

**Kept on Sonnet, on purpose:**
- **Decisions Jev hands back to the LLM.** Those answers are the "teacher" labels Jev is trained
  against, and they include the QC risk flags that pick the approval lane. A weaker teacher would
  weaken both. The saving would only have been ~$0.50 a month.
- **Decode format sorting.** Its hook, value and CTA templates feed "Write my version".
- **Everything the reader sees:** drafts, scripts, revisions, the human-sounding rewrite, video
  analysis and the Decode breakdown.

### Step 3: Never analyse the same competitor post twice. Built, without the incremental scrape.

**Before:** every scan sent every post to the LLM for its breakdown, even posts an earlier scan had
already broken down.

**Now (`services/decode-service.ts`):**
1. Format sorting is told the previous scan's format names and keeps a name when the format recurs.
2. Before the breakdown batches, `reuseBreakdowns` copies the earlier breakdown (hook, beats, hook
   type, value structure, CTA type) to any post with the same URL whose format exists in this scan.
3. Only the remaining posts go to the LLM.
4. Views, reactions and "vs their usual" stay this scan's fresh numbers.

**Decided against:** asking Apify only for posts since the last scan. The "Nx their usual" score
needs each competitor's full look-back sample to work out their median, and Apify scraping already
fits inside the free credit.

### Step 4: Daily spending cap. Done.

- `CONTENT_DAILY_BUDGET_USD=3` is set in `.env`, and `.env.example` now recommends 3.
- At standard pace a normal day spends $0.30–0.60, so $3 leaves room for heavy days and caps the
  worst case (a loop, a bad feed) at ~$90 a month.
- `cost-ledger.ts` `budgetGuard` checks every paid call against it. Raise it on a day you run many
  scans or image sets.

### Already efficient: left as is

- Long system prompts are cached (`adapters/claude.ts`), so repeat calls pay ~10% for them.
- Jev makes the scoring, platform-fit and QC decisions (`CONTENT_JEV_PRIMARY_TASKS`).
- A decision on unchanged input is reused, with no new call (`decide.ts`, step 0).
- Video analysis is cached per URL and runs automatically only for the top 3 videos per scan.
- Angles are written once per topic and saved.
- Transcription runs locally (yt-dlp + whisper).
- Images are made only when someone clicks.
- The human-sounding rewrite runs only under a score of 70, and only on drafts not blocked for
  missing proof.

---

## 4. Expected cost after the changes

This assumes Jev drops about 60% of signals as off-audience. The real rate will show in
`content.research_inputs` (`status = 'dropped'`) and on the Training page (`signal_relevance`).

| Line (standard pace) | Before | After |
|---|---|---|
| Research | $6.60 | ~$0.30 (cheap extraction for ~240 relevant signals; Perplexity for ~30 drafted topics) |
| Scoring fallbacks | $1.20 | ~$0.50 (fewer topics reach scoring; still Sonnet) |
| Competitor scans + video analysis | $2.13 | ~$1.20 |
| Drafting, rewrites, writing from ideas, images, reviews | $7.54 | $7.54 (unchanged on purpose) |
| **Per month** | **≈ $17.50** | **≈ $9.50** |
| **Per week** | **≈ $4.10** | **≈ $2.20** |

| Pace | Before: per month | Before: per week | After: per month | After: per week |
|---|---|---|---|---|
| Light | ~$8.00 | ~$1.90 | ~$4.10 | ~$0.95 |
| Standard | ~$17.50 | ~$4.10 | ~$9.50 | ~$2.20 |
| Heavy | ~$48.00 | ~$11.30 | ~$27.00 | ~$6.30 |

## 5. What was done and how we'll know it worked

| # | Step | Status | Expected saving (standard / heavy) |
|---|---|---|---|
| 1 | Filter before research; web check at draft time | Built + tested | ~$6.30 / ~$12.60 |
| 2 | Cheap model for topic extraction | Built + tested | included in 1 |
| 3 | Decode reuse of earlier breakdowns | Built + tested | ~$0.90 / ~$7.00 |
| 4 | Daily budget cap ($3) | Set | caps the worst case |

**Tests added:**
- `research.test.ts`: an off-audience signal is dropped with no LLM call; batch extraction uses the
  cheap model with no web check; the check runs once at draft time, is saved, and is never paid
  twice; a failed check keeps the topic.
- `decode.test.ts`: a second scan over the same posts makes no breakdown call and keeps hooks and
  formats.

**Checks after rollout:**
- Two weeks in, compare spend per feature (Costs page, or `content.cost_events` grouped by
  `feature`) against section 2, and update this document with real numbers.
- Check the dropped signals now and then:
  `select raw_text from content.research_inputs where status = 'dropped' order by processed_at desc limit 20`.
  If good ones show up there, lower `DROP_BELOW` in `research.module.ts`.
- Quality: watch the Approvals rejection rate and the human-sounding scores. If either gets worse,
  roll back. `CONTENT_CHEAP_MODEL=off` restores Sonnet extraction without a code change.

## 6. Assumptions and limits

- Prices are for the current models (`anthropic/claude-sonnet-5.5`, `perplexity/sonar`,
  `qwen/qwen-image-3`, Jev) through OpenRouter, as of October 2026.
- The 20% Jev-to-Sonnet fallback rate is an assumption. The Training page will show the real rate.
- Apify shows almost $0 in our ledger (free-plan usage), so its line uses public actor prices.
- Signal volume depends on `CONTENT_REDDIT_QUERIES` and `CONTENT_MARKET_FEEDS`. More queries mean
  more signals. After Step 1 that matters much less, because filtered-out signals cost almost
  nothing.
