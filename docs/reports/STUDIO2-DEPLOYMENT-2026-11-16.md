# Hostinger deployment — 16 November 2026 (IST)

Content Studio is deployed at https://studio2.srv1675029.hstgr.cloud/content. Postiz is deployed at https://postiz2.srv1675029.hstgr.cloud. Both use valid HTTPS routes on the existing reverse proxy.

The application has a fresh database and credentials under `/srv/studio2`, with dedicated Linux account `studio2`. Key login works; that account's password is locked and it has neither sudo nor Docker privileges. The server administrator manages the root-owned configuration. Private client/admin login credentials and a recovery copy are stored locally at `tmp/qa/studio2-private/access.json`; this folder is Git-ignored and restricted to the current Windows user. Postiz retains the existing owner account, `algorithemicedge@gmail.com`. Its password was subsequently reset at the user's request on 16 November 2026 and saved in the same private credentials file. HTTPS login, unchanged workspace membership, and unchanged records for all four social connections were verified after the reset.

## What was deployed

- Separate app PostgreSQL database, app/session passwords, cache volumes, private networks and resource limits. No previous app content/brand database was copied into the new app; it opens at brand setup.
- The existing Postiz workspace, four channel IDs, uploads, configuration and Temporal workflow history were preserved. Connected channel types: Instagram, Facebook, LinkedIn and LinkedIn page. The old local Postiz containers are stopped, with their volumes retained for rollback. Exactly one worker stack should run against this workspace.
- Existing configured OpenRouter, Apify, TinyFish and research settings were transferred. CPU transcription dependencies and a speech model cache are installed. The local app's Postiz URL now points to the VPS; a temporary localhost SSH compatibility tunnel also supports its already-running process.
- App runtime UID 1003, read-only root filesystem, dropped capabilities, no-new-privileges and no Docker socket. The upstream Postiz container is a documented root/writable-filesystem exception with a limited capability allowance.
- Both Compose projects share a dedicated cgroup capped at one CPU core and 3.5 GiB RAM, with a 3 GiB memory pressure threshold and no swap. Each service has its own limits. Public Docker ports bind only to loopback; databases/queues are not published.
- Scoped outbound firewall rules block host SSH/private network/metadata access. Public HTTPS remains available for integrations; this host's public HTTPS port is explicitly allowed for media/SSR. Existing global firewall and SSH policies were preserved.
- Postiz's database runtime role is DML-only in its intended schema, without superuser/create-role/create-database/bypass-RLS privileges, and cannot use the separate existing `content` schema. Privileged credentials remain root-only for maintenance/backups. Automatic destructive schema push at container startup is disabled; administrator-reviewed migrations are required for upgrades.
- The scheduler is running but waits for completed brand setup. Automatic topic selection is off and the daily AI spending cap is $3. Approvals can publish to the existing live social accounts after setup.

## Verification completed

| Check | Observed result |
| --- | --- |
| Production build | Passed using a dedicated resource-capped builder |
| Existing containers | All 19 retained their original start times and remained running |
| Existing routes | All eight retained their baseline HTTP status codes |
| Existing proxy files | Original file hashes unchanged; shared Traefik not restarted |
| New deployment | All eight services running; all seven health-checked services healthy |
| Authentication/access | 19 checks passed, including client/admin login, forged cookies/headers, role restrictions, secure cookie flags, cross-origin writes and private-file paths |
| App runtime boundaries | UID, read-only root, dropped capabilities, absent Docker socket, blocked host SSH/metadata and working public HTTPS verified |
| Publishing migration | All four original channel IDs preserved and enabled through the public HTTPS API; workflow records preserved and their queue has an active worker |
| Scheduler setup guard | Fresh-brand run skipped modules; scheduler remains `waiting_for_setup` |
| Transcription | Actual speech fixture transcribed; expected words and segments verified |
| App recovery | Dump restored successfully into a disposable database, which was then removed |
| Backups | Three database dump inventories, media/settings archives, SHA-256 checksums and private permissions verified; initial off-server copy verified |

The daily backup runs at 02:30 IST with up to 15 minutes of randomized delay, retaining 14 days. It covers application, Postiz-schema and Temporal database dumps, Postiz files and private runtime settings. Cold cutover volume archives also remain on the VPS and Windows computer. Maintenance and recovery details are in [the deployment README](../../infra/studio2/README.md).

### Postiz browser-session correction

The first password-reset check verified the login response and secure cookie flags, but missed the cookie's domain. The deployed upstream version set `Domain=.hstgr.cloud`; this is a [public suffix](https://publicsuffix.org/list/public_suffix_list.dat), so browsers reject the cookie. Forcing the cookie manually made the dashboard work, confirming the difference between credential acceptance and browser session persistence.

The Postiz-only Nginx configuration now rewrites that upstream domain to `postiz2.srv1675029.hstgr.cloud` for both frontend and API responses. No secrets, user records, integration tokens or shared Traefik settings were changed. The configuration is a read-only Compose mount and is included in the recovery backup. The upstream routing and upload security settings were compared with the original configuration and retained; Nginx syntax was validated before deployment.

After the correction, ten assertions passed using public HTTPS and curl's persistent cookie jar with public-suffix support: login accepted; the secure cookie was stored for the exact Postiz hostname; the invalid public-suffix cookie domain was absent; the root URL reached `/launches`; a dashboard reload stayed signed in; `/api/user/self` identified the existing account; all four original channels were enabled; logout removed the cookie; a logged-out dashboard returned to login; and all 19 pre-existing container start times plus the original proxy configuration hashes were unchanged. Raw test cookies/headers were removed after verification. This tested HTTP session persistence; a visual browser clickthrough was not repeated after Windows browser inspection had been blocked.

## Remaining limitations

OpenRouter returned HTTP 402 for a small generation request because the existing account lacks sufficient credit. The user requested deployment completion and will fund it later. AI is configured, but a successful paid generation must be verified after funding. No further paid generation retries were made after that instruction.

No live social post was published or OAuth account reauthorization performed during deployment. Preserved channel records/API access do not prove that every provider token can publish indefinitely. Future reconnection may require adding the new HTTPS callback URLs in the respective provider developer portals. Providers that were not configured before were not newly provisioned.

This was a bounded deployment/security verification, not a comprehensive penetration test or full VPS audit. Other applications' settings, ports and global root SSH policy were intentionally left alone. Resource/network separation reduces interference; services still share the VPS kernel, disk and reverse proxy.

The daily databases are individually consistent, not a single atomic snapshot across services. Daily backups exclude Redis/Elasticsearch volumes, whose cold migration baseline was saved. Recurring off-server backup transfer and a complete Postiz disaster-recovery restore rehearsal were not configured/performed. Take new cold volume backups before another migration. Protect recovery copies: they contain credentials.
