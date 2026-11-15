# Deploying and running Content Studio

For Hostinger, start with [the VPS deployment guide](HOSTINGER.md). Run the commands below
from the repository root. Always pass `--env-file .env`: service `env_file` supplies the
container settings, while this option also supplies Compose's `DOMAIN` and scheduler interval.

The supported production setup is **one Linux VPS with Docker**. Serverless hosting (Vercel and
similar) is not supported:
- Pipeline runs and Decode take minutes.
- Decode keeps working after the request returns.
- Transcription runs `yt-dlp` and whisper on the host.
- The rate limiter lives in memory.

None of those survive a function that is frozen or killed after its response.

```
internet ──443──▶ Caddy (HTTPS) ──▶ app (Next.js, port 3000)
                                    scheduler (same image: runs the pipeline every hour)
                  Postiz (infra/postiz, 127.0.0.1:5000)
                  Postgres (Supabase or your own)
```

## 1. First deploy

1. **Database.** Create a Postgres database. On Supabase, use the *session pooler* (port 5432). The transaction pooler (6543) can't hold the locks the pipeline uses.
2. **Settings.** `cp .env.example .env`, then fill in the REQUIRED block and `DOMAIN`.
   - Generate secrets with `openssl rand -hex 32`.
   - Both passwords need 16+ characters, and `CONTENT_SESSION_KEY` needs 32+, or the app answers every request with a 503 that says what is missing.
3. **Build and schema.** Build the image, then run the migration from it (Node.js is not needed on the VPS):
   ```sh
   docker compose --env-file .env -f infra/app/docker-compose.yml build
   docker compose --env-file .env -f infra/app/docker-compose.yml run --rm --no-deps app npm run migrate
   ```
   - The whole of `db/schema.sql` is applied in one transaction: it all applies or nothing changes.
   - The version is recorded in `content.schema_version`.
   - Never run `db/seed.sql` against production. It is demo data, and it duplicates itself on every run.
4. **Postiz.** Follow `infra/postiz/docker-compose.yml`.
   - Set `DISABLE_REGISTRATION=false` only while you create your account.
   - Pin `POSTIZ_VERSION`.
   - Put the API key in `CONTENT_POSTIZ_API_KEY`.
5. **App.** `docker compose --env-file .env -f infra/app/docker-compose.yml up -d app caddy`.
   - Point DNS for `DOMAIN` at the server first; Caddy gets the certificate on its own.
6. **Check.** `curl --fail https://studio.example.com/content/api/healthz` should return `{"ok":true}`.
   Replace `studio.example.com` with your hostname, then log in at `https://YOUR_HOSTNAME/content`.
7. **Scheduler.** Once setup and integrations are verified, start hourly runs:
   `docker compose --env-file .env -f infra/app/docker-compose.yml up -d scheduler`.

## 2. Updating

```sh
git pull
docker compose --env-file .env -f infra/app/docker-compose.yml stop scheduler
docker compose --env-file .env -f infra/app/docker-compose.yml build
docker compose --env-file .env -f infra/app/docker-compose.yml run --rm --no-deps app npm run migrate
docker compose --env-file .env -f infra/app/docker-compose.yml up -d app caddy
# If you use the hourly scheduler, restart it after checking the app:
docker compose --env-file .env -f infra/app/docker-compose.yml up -d scheduler
```
Run the migration **before** the new containers start. New code may read columns the old schema
lacks.

## 3. Scheduling

The `scheduler` container runs every module once an hour (`PIPELINE_INTERVAL_SECONDS` changes
that). Each module holds a Postgres advisory lock while it runs, so a run started from the
dashboard at the same moment is recorded as **skipped (already running)** instead of running twice.

To drive runs from outside instead, POST `/content/api/run` with header `x-content-secret:
$CONTENT_CRON_SECRET`, and remove the scheduler service.

## 4. Spend and safety limits

| Limit | Setting | What happens |
|---|---|---|
| Daily spend cap | `CONTENT_DAILY_BUDGET_USD` | Once the last 24 h of `content.cost_events` reach it, every LLM, image, Jev and Apify call fails with "daily budget reached" until spend rolls off. |
| Retry cap | built in (3) | A topic or signal that fails a step 3 times is no longer picked up. See `attempts` / `last_error` on `content.topics` and `content.research_inputs`; set `attempts = 0` to retry. |
| Double-publish guard | built in | Booking a post locks its row. A second booking or a reject waits for it, and `postiz_id` is unique. If our write fails after Postiz accepted, the Postiz post is deleted again. |
| Login / secret guessing | built in | 10 tries/min per IP for login, 20 for the cron header. The IP is read from the proxy-added `X-Forwarded-For` entry (`CONTENT_PROXY_HOPS`), so never publish the app port directly: only Caddy may reach it. |

## 5. Monitoring

- **Uptime:** point a monitor at `https://$DOMAIN/content/api/healthz`. It returns 200 when the database answers and 503 otherwise. It needs no login and returns no details.
- **Module failures:**
  - Set `CONTENT_ALERT_WEBHOOK` (Slack or Discord incoming webhook) to get a message whenever a module run ends in `error`.
  - The System page shows every module's last run.
  - A run killed midway stays visible as `running`.
- **Logs:** `docker compose --env-file .env -f infra/app/docker-compose.yml logs -f app scheduler`. In production every line is one JSON object (`t`, `level`, `scope`, `msg`); module lines carry `module#runid`.

## 6. Backups and restore

`infra/backup.sh` dumps the `content` and `postiz` schemas and tars the Postiz uploads volume. It
keeps 14 days.

```sh
# host crontab (crontab -e)
15 3 * * *  CONTENT_DATABASE_URL=postgres://... /srv/content/infra/backup.sh >> /var/log/content-backup.log 2>&1
```
Copy the backup directory off the server too (rclone, restic or provider snapshots). On
Supabase, point-in-time recovery on a paid plan covers the database part.

**Restore drill (do it once before you rely on it):**
1. Create an empty database.
2. Run `pg_restore --clean --if-exists -d "$NEW_URL" db-YYYY-MM-DD.dump`.
3. Point a local `npm run dev` at it and open the dashboard.

## 7. Runbook

| Symptom | Check | Fix |
|---|---|---|
| Every page answers 503 with a message | The message names the missing setting | Set it in `.env`, then `docker compose --env-file .env -f infra/app/docker-compose.yml up -d` |
| Module stuck on `running` | Scheduler logs (see Monitoring); the run was killed (deploy, crash, OOM) | Nothing to clean up: the lock died with the process, and the next run proceeds |
| "daily budget reached" | Costs page | Wait, or raise `CONTENT_DAILY_BUDGET_USD` |
| Topic never drafts | `select title, attempts, last_error from content.topics where attempts >= 3` | Fix the cause, then `update content.topics set attempts = 0 where id = ...` |
| Post missing in Postiz | Item's `postiz_id`; Postiz UI; logs for `orphaned Postiz post` | Requeue: set the item back to `approved` with `postiz_id = null` |
| Rotate a password | Change it in `.env`, then `docker compose --env-file .env -f infra/app/docker-compose.yml up -d` | Every session is signed with it, so everyone is logged out |
