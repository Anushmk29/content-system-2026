# Studio2 on Hostinger

Content Studio: https://studio2.srv1675029.hstgr.cloud/content

Postiz: https://postiz2.srv1675029.hstgr.cloud

This deployment uses `/srv/studio2`, Linux user `studio2` (UID/GID 1003), Compose projects `studio2` and `studio2-postiz`, and a fresh application database. The user has key-only SSH access and no sudo or Docker group membership. The existing Postiz workspace and four social connections are shared intentionally, as authorized; this is not a separate publishing tenant. The Postiz owner login is `algorithemicedge@gmail.com`. Its password was reset at the user's request on 16 November 2026; HTTPS login and unchanged workspace/social records were verified. The current password is in the private credentials file.

## Isolation and secrets

Both stacks belong to `studio2.slice`: one CPU core in aggregate, memory pressure threshold 3 GiB, hard limit 3.5 GiB, and no swap. Individual services also have CPU, memory, process and log limits. The application runs as UID 1003 with a read-only root filesystem, dropped capabilities, no-new-privileges, restricted writable caches and no Docker socket. Postiz's pinned upstream image needs root and a small capability allowance; its filesystem is writable. Do not describe every container as non-root or read-only.

Only `127.0.0.1:18132` (app) and `127.0.0.1:18133` (Postiz) are published. Databases, Redis, Elasticsearch and Temporal have no published ports. The existing Traefik watches two additional files; its old configuration is unchanged and it was not restarted. TLS, security headers, request limits and Postiz login rate limits apply to these routes.

`postiz-nginx.conf` preserves the pinned image's routing/upload settings and rewrites upstream cookie domains from `.hstgr.cloud` to `postiz2.srv1675029.hstgr.cloud`. Hostinger's shared suffix is on the browser public suffix list, so the upstream cookie domain caused successful password checks to reload back into login. The read-only configuration mount covers cookies from both the backend and frontend, including login, organization selection, OAuth state and logout. Secure/HttpOnly attributes are preserved. Review this Nginx configuration when changing the upstream Postiz image; update the hostname if moving domains. Include it in recovery settings.

The dedicated egress CIDRs are `172.29.240.0/28` and `172.29.240.16/28`. `egress.sh` blocks connections to host/private/metadata addresses. It permits public web traffic, Postiz's external PostgreSQL connection, and this host's public HTTPS port for media/SSR. A private publishing network joins only the new app and Postiz. Check subnet overlap before reusing this configuration elsewhere. These scoped rules do not harden unrelated services or change global SSH/UFW policy. Reapply the service after any administrator replaces the host firewall rules.

`/srv/studio2/private` is root-only; its parent and `ops` are also root-owned to prevent replacement by the unprivileged account. Never commit or print its environment files. `app.env` holds new app/database/session credentials and the existing allowed AI/research keys. `postiz.env` preserves the existing publishing integration secrets but uses a new DML-only `studio2_postiz` database login scoped to the `postiz` schema. Original privileged database credentials remain only in `postiz-backup.env` for administrator backups/maintenance. Existing tables and owners were preserved.

Postiz starts PM2 before launching its processes in parallel, and deliberately skips the upstream automatic `prisma db push --accept-data-loss`. Upgrades require an explicit, reviewed administrator migration with a verified backup. Do not start the old local Postiz stack alongside this one: its workers use the same workspace and workflow history.

## Operations

Run privileged management commands as the server administrator:

```sh
cd /srv/studio2
docker compose -p studio2 --env-file .env -f compose.yml ps
docker compose -p studio2-postiz -f postiz-compose.yml ps
docker compose -p studio2 --env-file .env -f compose.yml logs --tail=100 app
systemctl status studio2-backup.timer studio2-egress.service
systemctl show studio2.slice -p MemoryCurrent -p MemoryMax
```

Review logs privately because upstream dependencies may log sensitive context. For app upgrades, build a new image using a dedicated resource-capped BuildKit worker, update `STUDIO2_IMAGE` in `/srv/studio2/.env`, run the app migration as an administrator, and recreate only this project's app/scheduler. Keep the previous image and a pre-migration backup. The Dockerfile includes CPU transcription tools; its speech model cache is populated and a real transcription was verified.

The scheduler's `automation` profile is enabled. `scheduler.mjs` waits until brand setup has an `onboardedAt` timestamp before starting research, generation or publishing modules. Complete setup in the app, review the connected channels, and approve content deliberately: those channels are the existing live social accounts. Automatic topic selection is off. The configured daily AI cap is $3. OpenRouter credentials are installed, but generation is blocked by account credit balance; the user deferred funding. Adding credits should be followed by a small generation test.

## Backups and recovery

The timer runs daily at 21:00 UTC (02:30 IST), with up to 15 minutes of randomized delay. `backup.sh` creates an atomic, root-only `private/backups/recovery-TIMESTAMP` directory containing application, Postiz-schema and Temporal database dumps, Postiz uploads/config, and private runtime settings. It validates dump inventories, tar archives and SHA-256 checksums, retaining completed backups for 14 days. Database dumps are individually consistent; this is not an atomic snapshot across all services. Credentials are included, so protect every recovery copy as a secret.

The initial recovery set and private `access.json` have been copied over SSH to the current Windows user's protected, Git-ignored `tmp/qa/studio2-private` directory. Cold Postiz volume archives from the cutover remain separately on both machines. Recurring off-server transfer is not configured. Redis/Elasticsearch volumes are not part of the daily logical backup; the cold cutover archives preserve their migration baseline. Before a future full Postiz move, stop only this Postiz stack briefly and take a new consistent cold archive of all its volumes.

An application backup was restored into a disposable database successfully. A full Postiz disaster-recovery restore has not been rehearsed. To recover, stop only the affected new project, preserve its volumes, restore matching image versions/settings and database dumps, and verify locally before exposing the routes. Managed Postiz tables must be restored by an administrator into the intended schema; never overwrite other schemas. Use the database-specific dump rather than copying live PostgreSQL files.

Rollback public access by removing only `studio2.yml` and/or `studio2-postiz.yml` from `/docker/traefik/dynamic`, then stop only the respective Compose project. A Postiz rollback must leave exactly one worker stack running. Preserve private files, volumes and backups. Never run a Docker-wide prune, global firewall reset, or restart of unrelated services for this deployment.

## Upgrade steps (as used for `d935faa`, 20 Nov 2026)

```sh
# Locally: package the pushed commit and upload it
git archive --format=tar.gz -o source-<sha>.tar.gz <sha>
scp source-<sha>.tar.gz root@<vps>:/srv/studio2/

# On the VPS, in /srv/studio2
mkdir app.new && tar -xzf source-<sha>.tar.gz -C app.new
rm -rf app.prev && mv app app.prev && mv app.new app
cd app && docker buildx build --builder studio2-builder -f infra/studio2/Dockerfile \
  -t studio2:<date>-<sha>-isolated --load . && cd ..
# Back up the app database before migrating
docker compose -p studio2 --env-file .env -f compose.yml exec -T db \
  sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "${POSTGRES_DB:-$POSTGRES_USER}"' > private/backups/pre-<sha>-app.dump
STUDIO2_IMAGE=studio2:<date>-<sha>-isolated docker compose -p studio2 --env-file .env -f compose.yml \
  run --rm --no-deps app npm run migrate
cp .env .env.bak-pre-<sha>   # then set STUDIO2_IMAGE in .env to the new tag
docker compose -p studio2 --env-file .env -f compose.yml --profile automation up -d --no-deps app scheduler
docker buildx stop studio2-builder
curl https://studio2.srv1675029.hstgr.cloud/content/api/healthz   # {"ok":true}
```

The app uses this stack's own Postgres container (`db`), not Supabase: schema changes reach it only through `npm run migrate` above. To roll back, copy the `.env.bak-pre-<sha>` file back to `.env` and run the `up -d` line again.

## Deploy log

- **20 Nov 2026, `d935faa`:** QA review fixes (see the root README update log). Migration added `content_items.creative_started_at` and `creative_error`. Pre-migration dump: `private/backups/pre-d935faa-app.dump`. Previous image: `studio2:20261120-e6b7b39-isolated`.
  - **Open issue:** `studio2-backup.service` has failed since 19 Nov because Postiz's `temporal-postgresql` service is not running. There has been no full recovery backup since `recovery-20261118T210756Z`.
