# QC + Risk Gate (Bible §10) — the CRITICAL CONTROL

The QC agent runs this on every draft BEFORE it can reach `qc_passed`. It also
classifies the **approval lane**. This is the most important control in the system.

> **Two non-negotiable invariants:**
> 1. **Escalate-only.** When in doubt, escalate a lane. **Never downgrade one.**
>    If any Sensitive signal is present, the lane is `sensitive` regardless of
>    everything else.
> 2. **Honest numbers.** Any metric/claim without an attached `proof_url` blocks
>    publish and is sent back to draft.

## Quality checklist — all must pass (§10.3)
- [ ] **Brand voice** — calm, practical, premium, no hype.
- [ ] **Specificity** — concrete examples, not vague claims.
- [ ] **Proof** — every metric/claim supported (row in `claims` with `proof_url`).
- [ ] **Audience fit** — speaks to founders/operators/SMEs (check `prompts/icp.md`).
- [ ] **CTA** — clear next step or soft action.
- [ ] **Platform fit** — native to the platform (`prompts/platform-rules.md`).
- [ ] **Risk classification** — correct approval lane (below).
- [ ] **Formatting** — clean, readable, no broken links.
- [ ] **Repurposing** — linked to an anchor topic where possible (`anchor_id`).

## Risk levels (§10.2)
| Risk | Examples | Action |
|---|---|---|
| **Low** | Approved quote reused as graphic, generic tip, carousel from approved blog. | Auto queue. |
| **Medium** | New educational post, blog article, carousel, founder perspective. | Batch review. |
| **High** | Client results, revenue claims, face/voice, strong opinion, competitor comparison. | Founder approval. |

## The three approval lanes (§10.1)
| Lane (enum) | What goes here | Approval |
|---|---|---|
| `safe_auto` | Template quote cards, repurposed approved content, simple reminders. | Auto after quality check. |
| `review` | New LinkedIn posts, blogs, carousels, offer content, new positioning. | Batch approval. |
| `sensitive` | Face/voice, client claims, metrics, controversial opinions, case studies. | **Founder approval required.** |

## Lane decision logic (implement exactly)
```
if mentions_face_or_voice OR has_client_claim OR has_metric
   OR is_controversial_opinion OR is_case_study OR is_competitor_comparison:
       lane = 'sensitive'           # founder approval
elif is_new_positioning OR is_new_post/blog/carousel/offer:
       lane = 'review'              # batch approval
elif is_template_based AND derived_from_approved_content:
       lane = 'safe_auto'          # (only earned in later phases)
else:
       lane = 'review'              # default to the safer side
```
At v1, `safe_auto` is **disabled** — everything routes to `review` or `sensitive`
until templates are proven (§17 / §10).
