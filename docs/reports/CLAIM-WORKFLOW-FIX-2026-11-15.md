# Claim and review workflow fixes — 15 November 2026

Implemented the operator-facing fixes identified in the blocker retest. OpenRouter was excluded from verification.

## Using the updated workflow

1. Open a post from **All posts** or **Approvals** and find **Claims**.
2. Paste a supporting source into **Proof link** and select **Save proof**.
3. If the claim is wrong or outdated, open **Correct or remove this claim**. Revise the post, explain the correction, confirm that the statement is no longer made, and select **Save corrected copy and remove claim**.
4. Resolve the remaining claims, then select **Send for review**. Review the post in Approvals before approving it again.

The drafting action now runs QC on the newly generated posts. Eligible posts reach Approvals immediately; posts with unproven claims remain in Draft. The result reports both counts. All posts labels now identify drafts as work that may need the operator.

## Safety and implementation

- Proof links accept HTTP/HTTPS URLs, with length, credential and control-character checks. Saving a URL records evidence; it does not verify that the source supports the statement.
- Claim changes revoke any existing approval and preserve the approval lane. They cannot automatically release a post for publication.
- Claim removal saves the corrected copy and removes only that post's selected claim in one transaction. It requires changed copy, a reason and explicit confirmation, rejects an unchanged literal claim, and refuses stale edits.
- History retains the original claim and correction reason. A simulated database failure verified that copy, claim and history roll back together.
- Posts already sent for publishing are locked. Other platform copies and other claims are unchanged.
- Paraphrased statements still require the operator's judgment and subsequent human review; this is not an automated fact-verification feature.
- Claim saves, copy edits, review submission and approval decisions refresh the page after success. This avoids a production route-refresh stall observed during verification. Creation flows retain their existing behavior and returned data. Sidebar destinations no longer all preload automatically.
- No database migration or new production dependency was required.

## Verification

| Check | Result |
|---|---|
| Full automated regression run during implementation | 188 passed; zero failures |
| Final focused regression checks, including transaction rollback | 9 passed; zero failures |
| Current production build and host TypeScript check | Passed |
| Production-browser workflow checks | 10 passed; zero failures |
| Browser runtime errors | Zero |
| OpenRouter calls in the controlled browser workflow | Zero; server key blank and Jev disabled |
| Disposable fixture cleanup | Completed; zero remaining fixture items |

Browser checks used real disposable records and actual API handlers. They covered proof validation and persistence, revoked approval, claim correction, remaining-claim blocking, review resubmission, change requests, manual copy editing and refreshed preview, admin write restrictions, and 390px layout. Postiz was disabled in the test server, and the fixtures were never published.

The shared database has a 15-session connection limit. Verification initially competed with the development process; the final browser run used a one-connection test-server pool. That test-only limit does not change application pool settings. Unrelated concurrent workspace edits were preserved.

[Verification evidence](qa-2026-11-15/claim-workflow-fix.json) · [Desktop proof control](qa-2026-11-15/proof-editor-verified.png) · [Phone proof control](qa-2026-11-15/proof-editor-mobile-verified.png)

Live funded AI generation and public publishing were not exercised. Production credential configuration remains a separate owner task; this implementation does not change the user's login credentials or `.env`.
