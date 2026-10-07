# Strategy & Operator Playbook
*Audience: founder + content operator. The non-technical half of the Bible (§38 split).*

For ICP, voice, pillars, scoring, QC and platform rules see the living `prompts/`
folder — this playbook is the weekly operating view.

## The pipeline in one line (Bible Table 0)
Research → Topic Scoring → Weekly Calendar → Anchor Content → Platform Repurposing →
Quality Check → Approval / Auto Queue → Publishing → Lead Capture → Performance Review →
back to Research.

## Main metric (§4.1)
**Qualified conversations started** — not impressions. Secondary: site visits from
content, CTA clicks, form submissions, intent DMs/comments, discovery calls booked,
email subscribers, repeat engagement from target accounts.

## The weekly cadence (§15.1)
| Day | Focus |
|---|---|
| Monday | Research, question mining, topic scoring. |
| Tuesday | Create anchor content: blog, founder post, or case study. |
| Wednesday | Repurpose into LinkedIn, X, Instagram, Facebook, Reddit, email. |
| Thursday | Quality check, approval, scheduling. |
| Friday | Engagement, replies, community, analytics review. |
| Weekend (optional) | Founder story, behind-the-scenes, light repurposing. |

## Output targets (§15.2)
| Channel | Phase 1 | Phase 2 |
|---|---|---|
| LinkedIn | 3 posts | 4–5 posts |
| X / Twitter | 3–5 posts or 1 thread | 5–10 posts |
| Blog | 1 article / 1–2 weeks | 1 article weekly |
| Instagram | 1 carousel | 2 carousels / Reels |
| Facebook | 1 repurposed post | 2 repurposed posts |
| Reddit | 2–3 helpful answers | 5 helpful answers |
| Email | Optional | 1 newsletter |

## Anchor-first model (§8.2)
Don't create disconnected posts. Build **one strong anchor** (blog / founder essay /
case study / workflow teardown / video), then repurpose it everywhere. In the DB the
anchor is a `content_items` row with `anchor_id = NULL`; every repurposed piece points
back to it via `anchor_id`.

## Funnel balance (§4.3)
Every idea maps to one funnel stage so the calendar balances reach and conversion:
awareness · education · trust · consideration · conversion · retention.

## Lead handling (§13.3)
Score each lead 1–5 on ICP fit, size/revenue fit, urgency, engagement, buying intent.
High-intent ("Can you help us build this?", "How much would this cost?", "We have this
problem") → route to a call. Low-intent ("Great post", "Interesting") → nurture or ignore.

## Weekly learning loop (§14.1)
Ask every Friday: which posts got qualified engagement? which topics produced real
questions? which got reach but no intent? best platform? underused pillar? what to
double down on / stop / turn into a blog or offer page? Answers become Monday's topics.

## Promotion rules (§14.2)
| Signal | Action |
|---|---|
| High reach + high intent | Repurpose into blog, carousel, email. |
| High reach + low intent | Use for awareness; reduce volume. |
| Low reach + high intent | Improve hook/format and repost. |
| Low reach + low intent | Drop or archive. |
| Strong comment questions | Turn into next week's topics. |
