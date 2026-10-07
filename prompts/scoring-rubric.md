# Topic Scoring Rubric (Bible §7)

The topic scorer agent applies this to every researched idea and writes the five
1–5 scores to the `topics` table. The DB computes `score_total` and `priority_band`.

## The five factors — score each 1–5 (§7, Table 16)
| Factor (column) | The question it asks |
|---|---|
| `score_lead_intent` | Is this close to a problem people pay to solve? |
| `score_reach` | Is there real demand, and is it not already flooded with near-identical takes? |
| `score_brand_fit` | Does it fit our practical, premium, founder-led voice? |
| `score_proof` | Do we have a real edge (first-hand data/experience, contrarian-but-correct, or making the complex plain) plus a real example, metric, screenshot, or experience? "More complete than others" is not an edge. |
| `score_repurpose` | Can this become blog + LinkedIn + X + carousel + email? |

> **Honest-numbers rule baked in:** a topic we cannot prove scores low on
> `score_proof` and falls away. Never inflate proof to lift a topic.

> **Wording change 2026-10-01:** reach and proof now include the topic-gate test
> (demand vs saturation; real edge). Decision labels recorded before this date were
> answered under the old wording. Adapted from iamzifei/show-me-the-money (CC BY-NC 4.0).

## Priority bands — by SUM of the five (5–25) (§7.1)
| Total | Band (`priority_band`) | Action |
|---|---|---|
| 20–25 | `high` | Build this week. |
| 15–19 | `queue` | Good candidate — queue it. |
| 10–14 | `if_timely` | Use only if timely. |
| < 10 | `drop` | Drop or save for later. |

> Note: the Bible also states the formula as a *product* (I×R×B×P×Rp). We store the
> five raw scores so either reading is available; the **bands use the sum**, matching
> the §7.1 worked examples (e.g. 5+4+5+3+5 = 22 → High).

## Worked examples (§7.2, Table 18)
| Topic | I | R | B | P | Rp | Sum | Verdict |
|---|---|---|---|---|---|---|---|
| 3 workflows every SME should automate first | 5 | 4 | 5 | 3 | 5 | 22 | High |
| AI agents will replace managers | 2 | 5 | 2 | 1 | 3 | 13 | Low |
| How we built our own content pipeline | 4 | 4 | 5 | 5 | 5 | 23 | High |
| What is AI readiness? | 5 | 3 | 5 | 4 | 5 | 22 | High |
| 10 AI tools every founder needs | 2 | 4 | 3 | 1 | 4 | 14 | Medium |
