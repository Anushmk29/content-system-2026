# Blocker-only retest — 15 November 2026

**Implementation follow-up:** proof-link editing, audited claim correction/removal, and automatic draft-to-QC handoff have now been implemented and verified. See the [implementation and verification report](CLAIM-WORKFLOW-FIX-2026-11-15.md). The table below records the earlier retest before those changes.

Retested the four non-OpenRouter blockers from the original audit. **One is resolved; three remain.** No fixes were made during this retest.

| Blocker | Current result | Fresh evidence |
|---|---|---|
| Postiz connectivity | **Resolved** | The real adapter reports `ok`; the authenticated integrations endpoint returns HTTP 200. Enabled channel types include `linkedin-page`, `instagram`, `facebook` and `linkedin`. |
| Production settings | **Still blocked** | The production workspace returns HTTP 503. Both configured passwords remain below the required minimum, and the session-signing key does not meet the 32-character requirement. |
| Attaching claim proof | **Still blocked** | Browser automation opened an existing post with five unproven claims. The Claims section displayed the warnings but contained **zero inputs or actions** for attaching proof. |
| Draft → QC → Approvals | **Still blocked** | The real draft-generator module ran successfully against an isolated database using static AI responses. Its output remained `draft`. Running QC separately changed it to `needs_approval`; the page's single-module action still does not perform that handoff. |

## Scope and controls

- OpenRouter was excluded, including Jev, research, writing, vision, voice and image operations. The test runner attempted **zero OpenRouter requests**. The temporary browser-test server had an empty OpenRouter key and Jev disabled.
- Postiz was checked with read-only connection/channel requests. No test post was scheduled, moved, cancelled or published.
- A temporary production server using the current real settings reproduced the 503. A second temporary production server using valid **process-only** test credentials rendered the workspace successfully with OpenRouter disabled. The persistent `.env` file and the user's credentials were not changed.
- The proof safety control passed in isolation: missing proof excluded an approved fixture from the publish-ready view; adding a proof URL directly to that isolated database made it eligible. The remaining problem is the missing user-facing proof action.
- AI responses were replaced with local static fixtures only for the handoff test. This verifies lifecycle behavior, not AI quality.

## Cleanup and evidence

No persistent test records were created. Browser API writes were intercepted; zero write attempts occurred. Both temporary production servers were stopped, and the automated browser was closed. The existing development server on port 3001 was left running.

[Machine-readable retest evidence](qa-2026-11-15/blockers-retest.json)

This retest did not repeat the wider UX/accessibility audit or certify live publishing. It establishes that Postiz is reachable again and that the three other non-OpenRouter blockers remain reproducible.
