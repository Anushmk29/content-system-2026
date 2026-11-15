# Content Studio navigation and UI verification

Verified on 15 November 2026 against the local app at port 3001.

## Coverage

All 19 routes were reviewed in Chrome during this UI pass and returned HTTP 200 in the final authenticated route check. `/content/check` intentionally redirects to Today while Creative Check is paused.

| Area | Routes |
| --- | --- |
| Daily work | Today, Approvals, Calendar, Results |
| Content creation | Ideas, Design, Film & post, All posts |
| Brand | Brand kit, Design examples |
| Research | Competitors, Competitor videos, Opening lines |
| Entry and setup | Sign in, Setup, paused Creative Check |
| Admin | System, Costs, Training |

The final browser checks covered desktop and intermediate layouts, responsive navigation at 200% and 400% zoom, page selection and menu closing, keyboard search, no-match recovery, Calendar planning, account-section navigation, expired video thumbnails, setup exit, and admin view-only controls. Chrome zoom simulates narrower layouts; this was not a physical-phone test.

## Changes verified

- The responsive page menu replaces the long horizontal navigation strip. The selected page and pending counts stay visible. Expanded navigation remains usable at high zoom.
- Desktop navigation scrolls separately from its footer. Page loading has an accessible status, and a keyboard skip link targets the main content.
- View-only admin sessions disable shared write actions and omit pipeline commands from search. System Run controls and example upload/generation/rename controls were checked in the browser.
- Results provides a useful empty state and account connection shortcut instead of empty graphs when no posts have been published in the selected period.
- Brand kit has section links. Results and Today link directly to Your accounts. Setup includes a return to the studio for onboarded clients.
- Design examples links to Design, and Opening lines links to Ideas. The All posts board has a bounded, keyboard-focusable scroll region.
- Failed video thumbnails become a readable Video link rather than a broken image.
- Sign in reads the native password field on submit. An autofilled password was successfully submitted in Chrome without exposing or changing the credential.
- Calendar includes expired, unbooked approvals in Unplanned. Four previously hidden approvals became visible in the current calendar. The Plan a post shortcut opened the posting-time panel. No posting times or bookings were changed during this check.

## Automated validation

- `npm test` passed all 191 tests: 5 host tests and 186 engine tests.
- A new Calendar regression test covers undated approvals, expired plans, future plans, booked posts, manual scripts, and preservation of the saved date.
- `npx tsc --noEmit` passed.
- The production build passed using a separate output directory. Its temporary TypeScript include was restored afterward.
- The design detector passed for the changed navigation, thumbnail, Results, Calendar, login, and loading components.
- Authenticated GET checks passed for all 19 routes, using the appropriate client or admin role.

## Limits

Live publishing, real paid generation/scanning, new uploads, credential changes, and deployment were not exercised. Existing scheduling failures and historical activity remain visible for the operator to resolve. No content was published, rescheduled, or deleted during the final navigation checks.
