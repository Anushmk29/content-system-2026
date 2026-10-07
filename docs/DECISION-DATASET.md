# Decision dataset: labelling and building your own training data

This guide covers how the pipeline's decisions are logged, how to add your own labels, and how the logged decisions, your labels and real results combine into one dataset for training a personalised decision model.

---

## 1. What makes decisions, and where

Three decisions are "typed", meaning they pick from fixed options, yes/no or 1–5 scores. All three go through the Jev decision model and the LLM:

| Decision | Module | What is decided |
|---|---|---|
| `topic_score` | [scoring.module.ts](../content-pipeline/src/modules/scoring.module.ts) | leadIntent, reach, brandFit, proof, repurpose (each 1–5), pillar, funnel stage |
| `lead_triage` | [lead-triage.module.ts](../content-pipeline/src/modules/lead-triage.module.ts) | intent (high/low), icpFit, sizeFit, urgency, engagement, buyingIntent (each 1–5) |
| `qc_signals` | [qc-gate.module.ts](../content-pipeline/src/modules/qc-gate.module.ts) | 7 yes/no risk checks on each draft: client claim, metric, controversial opinion, case study, competitor comparison, new positioning, face/voice |

The QC signals can only make a draft's approval lane *stricter* than the format rules alone, never looser. Drafting and the weekly review generate text, so they stay on the LLM only.

Each decision goes through [decide.ts](../content-pipeline/src/modules/decide.ts), which runs in one of three modes:

| `CONTENT_JEV_MODE` | Behaviour |
|---|---|
| `off` | Jev is not called. This is automatic when there is no API key. |
| `shadow` (default) | Jev and the LLM both answer. The LLM's answer is used; Jev's is only logged for comparison. |
| `primary` | Jev decides alone if it is at least `CONTENT_JEV_MIN_CONFIDENCE` sure on every question (default 0.8). Otherwise the LLM decides. |

If Jev is down or slow, the LLM simply decides as usual, so the pipeline never blocks.

With no LLM key at all, Jev decides at any confidence. If Jev isn't available either, lead triage falls back to keyword rules; topic scoring and QC signals are skipped (the QC gate still applies its format rules).

Each decision is defined once in [decision-tasks.ts](../content-pipeline/src/modules/decision-tasks.ts). That definition holds the input text, the Jev questions, the LLM prompt and parser, and any rules. Jev and the LLM always see the same input text.

---

## 2. Setup

1. Apply the schema. It is safe to re-run; it only adds the new `content.decisions` table:
   ```bash
   psql "$CONTENT_DATABASE_URL" -f db/schema.sql
   ```
2. Add the Jev settings to `.env`:
   ```
   CONTENT_TYPESAFE_API_KEY=your-key
   CONTENT_JEV_MODE=shadow
   CONTENT_JEV_MIN_CONFIDENCE=0.8
   ```
3. Restart the app. The health panel shows a `jev` row with the current mode.
4. Leave it in `shadow` for about two weeks before considering `primary` (see section 7).

---

## 3. How the dataset builds itself

Every decision writes a row to `content.decisions`:

| Column | Meaning |
|---|---|
| `task` | `topic_score`, `lead_triage` or `qc_signals` |
| `subject_id` | the topic, lead or draft id |
| `state` | the exact text the model saw |
| `source` | `claude`, `jev`, `rules` (keyword fallback when there is no LLM) or `human` |
| `answer` | the decision itself, in the same format whichever source made it |
| `confidence` | Jev's confidence on its least-sure question (Jev rows only) |
| `used` | whether this answer was the one actually applied |
| `latency_ms` | how long the answer took |
| `workspace` | which customer the data belongs to (`default` for now) |
| `seed` | `true` for LLM-written practice examples (section 4c) |

In shadow mode, **each topic and lead gets two answers, the LLM's and Jev's, at no extra effort.** The export also adds signals the pipeline already records:

- **Your picks:** whether you selected or dropped the topic (`topics.status`), and whether you approved or rejected its posts (`content.approvals`).
- **What happened in the market:** reach and high-intent leads from published posts (`v_content_performance`). These are turned into the same quadrant used in analytics: `repurpose`, `awareness_only`, `improve_hook` or `archive`. Leads your posts brought in that you marked **won** are counted too (`wonLeads`).
- **Lead results:** in the Leads table on the dashboard, mark each lead **Call**, **Won** or **Lost**. A lead's triage decision then carries that as its outcome, the heaviest weight in the dataset.
- **Where a topic came from:** each topic's source channel (`competitor`, `trend`, `reddit`, `question_mining`…) is part of the `state` text (`SOURCE: …`), so you can see how market-driven topics perform against your own ideas.

**Market signals come in automatically.** The `market-signals` module reads public RSS/Atom feeds and Reddit's public search feed on every run, and saves new items to `content.research_inputs`. It never saves the same link twice. The Research module then turns them into topics, which get scored and flow into the dataset like any other topic. Configure it in `.env`:

```
CONTENT_MARKET_FEEDS=competitor=https://rival.com/feed, https://hnrss.org/newest?q=AI+automation
CONTENT_REDDIT_QUERIES=AI automation small business, n8n for agencies
```

Prefix a feed with `competitor=` to tag it as a competitor. Feeds with no prefix are tagged `trend`. Only public feeds are used: no logins and no scraping behind a sign-in. Each source adds at most 10 new items per run, which keeps the Research module's LLM cost bounded. If a feed fails, the module shows as degraded on the dashboard and the other feeds still run.

---

## 4. Making your own labels

You don't need to go through everything and mark it best or worst. There are three ways to add your judgement, from least to most effort.

### 4a. Do nothing extra: normal dashboard work is already labelling

Every topic you **select or drop** and every post you **approve or reject** on `/content` is recorded and exported. This is your most personal signal, and it costs nothing.

### 4b. Correct the disagreements (the most useful 10 minutes of your week)

When Jev and the LLM disagree, that example is the most informative one to label. Open the **Training** tab on `/content`. The queue shows each disagreement with the LLM's answer, Jev's answer (differences highlighted) and an editable "Your answer" column. Click **Save my answer**, **LLM was right** or **Jev was right**. The tab also shows how often Jev and the LLM agree, and has a download link for the full dataset.

You can do the same through the API. Download only the disagreements, leaving out any you have already labelled:

```bash
curl -H "x-content-secret: $CONTENT_RUN_SECRET" \
  "http://localhost:3000/content/api/dataset?queue=1" -o to-label.jsonl
```

For each line, read `state`, compare `label` (the LLM's answer) with what you believe is right, and send your answer.

**Topic example:**
```bash
curl -X POST http://localhost:3000/content/api/decisions \
  -H "content-type: application/json" -H "x-content-secret: $CONTENT_RUN_SECRET" \
  -d '{ "task": "topic_score", "subjectId": "<subjectId from the file>",
        "answer": { "leadIntent": 5, "reach": 3, "brandFit": 5, "proof": 2, "repurpose": 4,
                    "pillar": "proof_and_use_cases", "funnelStage": "trust" } }'
```

**Lead example:**
```bash
curl -X POST http://localhost:3000/content/api/decisions \
  -H "content-type: application/json" -H "x-content-secret: $CONTENT_RUN_SECRET" \
  -d '{ "task": "lead_triage", "subjectId": "<subjectId>",
        "answer": { "intent": "high", "icpFit": 4, "sizeFit": 3, "urgency": 5,
                    "engagement": 3, "buyingIntent": 5 } }'
```

Allowed values:
- **Scores:** whole numbers 1–5. Anything outside is clamped into range.
- **pillar:** `practical_ai_for_operators`, `proof_and_use_cases`, `founder_build_notes` or `ai_readiness_and_offer`.
- **funnelStage:** `awareness`, `education`, `trust`, `consideration`, `conversion` or `retention`.
- **intent:** `high` or `low`.

A few rules keep your labels consistent:
- **Score what you would bet on, not what you hope.** The honest-numbers rule applies: if a topic can't be backed with real proof, `proof` is low.
- **Be consistent over time.** If you change your mind about what a "4" means, write the new meaning down so later labels match.
- **Label a spread.** Include clear yeses, clear noes and borderline cases, not only the interesting ones.
- **20–50 corrections a week is enough.** After about 3 months you'll have several hundred high-weight examples.

### 4c. Seed examples for things the system never sees

Some decisions have little history yet, such as the QC signals ("is this a client claim?", "is this controversial?", "is this a competitor comparison?"). For these:

1. In the **Training** tab, click **Generate 20 QC practice examples**. The LLM writes 20 varied short drafts, about half risky and half safe, with a label for each check. If Jev is on, it answers them too.
2. They appear in the queue marked **practice example**, after any real disagreements. Correct any wrong answers, then save.
3. Repeat until you have reviewed around 200.

Practice examples are **left out of the training export until you have reviewed them**, so the model never learns from the LLM's unchecked labels. Once reviewed, they count as `human` labels. Generating them costs LLM tokens, so the button needs `CONTENT_RUN_SECRET` if you have set one.

---

## 5. The exported dataset

To download everything:

```bash
curl -H "x-content-secret: $CONTENT_RUN_SECRET" \
  "http://localhost:3000/content/api/dataset" -o decisions.jsonl
```

Query options:
- `?queue=1`: only the unlabelled disagreements.
- `?workspace=<id>`: one customer's data.

The file has one JSON object per line:

| Field | Meaning |
|---|---|
| `task`, `subjectId`, `state` | what was decided and the exact input text |
| `label` | the target answer: your correction if you made one, otherwise the LLM's answer |
| `labelSource` | `human` or `teacher` |
| `picked` | `true` if you selected the topic, `false` if dropped, `null` if not yet decided or picked by autopilot (`CONTENT_AUTO_SELECT_TOPICS`) |
| `approved` | `true` if approved, `false` if rejected, `null` if not reviewed |
| `outcome` | market result once published: `repurpose`, `awareness_only`, `improve_hook`, `archive`, or `null` |
| `disagreement` | `true` if Jev and the LLM answered differently |
| `weight` | how much this example should count in training (see below) |

The export includes lead messages, which are personal data, so the route needs `CONTENT_RUN_SECRET`. Don't commit exported files.

---

## 6. How the three sources combine without losing what works

Each example gets a weight from the strongest signal it has:

| Signal | Weight | Role |
|---|---|---|
| **Market outcome** (real reach and leads) | **3** | Ground truth: what actually worked |
| **Your picks and corrections** | **2** | Personalisation: your taste and positioning |
| **LLM answer only** | **1** | Volume: many cheap examples of a sensible baseline |

This ordering is what prevents personalisation from eroding good decisions. The model follows your preferences, but when your preference and real results disagree, the results count for more.

Market data enters the dataset two ways:
- **Your own results,** through `outcome`.
- **What's running in the market,** through research inputs from competitor, trend, Reddit and SEO channels. Those are turned into topics, which are then scored and logged like any other decision.

### Plan for a personalised product with many customers

1. **Shared base model:** trained on all customers' outcome-weighted data plus market signals. This carries the "what works" knowledge.
2. **Per-customer layer:** fine-tuned on that customer's own picks and corrections, using their `workspace` slice. This carries the personal taste.
3. **Safety net:** keep a held-out set of outcome-labelled examples. If a personalised model scores worse on it than the base model, don't ship it.

The customer-facing message is: *"It learns from your choices, and it's anchored to what's actually performing, so it adapts to you without drifting away from what works."*

---

## 7. When to trust Jev, or train your own model

**Before switching to `primary`,** check that Jev agrees with the LLM on about 85% or more of decisions, and that it agrees with you at least as often as the LLM does. This query shows the agreement rate per task:

```sql
select task,
       avg((j.answer = c.answer)::int) as agreement,
       count(*) as n
from content.decisions j
join content.decisions c
  on c.task = j.task and c.subject_id = j.subject_id and c.source in ('claude','rules')
where j.source = 'jev'
group by task;
```

**Training your own model** (for example, fine-tuning Laya to run locally) is worth doing once you have:
- a few hundred `human` or outcome-weighted examples per task, and
- a real reason to move off Jev: cost, speed, privacy, or wanting to own the model.

Until then, the dataset is simply accumulating.

---

## 8. Known gaps

- **QC signals have no market outcome.** Their labels come from you and the LLM only. A post's performance says little about whether it contained a client claim.
- **Reddit rate-limits unauthenticated readers.** If the Reddit source often shows `HTTP 429`, use fewer queries. Reddit's OAuth API would be the proper fix.
- **One LLM call per draft for QC signals.** Once Jev proves reliable in shadow mode, `primary` mode removes most of that cost.
- **Not tested against the live Jev API.** Keep shadow mode on until the first real runs look right.
