# Deploy to a Hostinger VPS

This deploys the existing Docker application with Caddy HTTPS and an optional hourly
scheduler. Creative Check remains disabled. The database stays at the PostgreSQL URL
you configure; this stack does not create a database or install Postiz.

## 1. VPS and domain

For a new VPS, Hostinger offers an Ubuntu 24.04 Docker template with Docker and Compose
installed. On an existing VPS, keep its OS and applications; inspect them before installing
anything or binding ports. See [Hostinger's Docker template documentation](https://www.hostinger.com/support/8306612-how-to-use-the-docker-vps-template-at-hostinger/).

Get the server IP and SSH access details from the
[Hostinger VPS dashboard](https://www.hostinger.com/support/5726606-how-to-use-the-vps-dashboard-in-hostinger/).
Use SSH key access. If Docker is missing, follow the
[official Ubuntu installation instructions](https://docs.docker.com/engine/install/ubuntu/).

Point an A record, such as `studio.example.com`, to the VPS IPv4 address. If an AAAA
record exists, its IPv6 address must reach this VPS too. Allow inbound TCP 80 and 443,
along with your SSH port, in the Hostinger and host firewalls. Do not publish port 3000.
If another proxy already owns ports 80/443, integrate with that proxy before starting
this stack's Caddy service.

## 2. Copy the current application

The commands below run on the VPS as root, or with equivalent Docker and directory access.
Substitute your SSH username, port and server IP:

```sh
ssh -p 22 root@YOUR_VPS_IP
docker version
docker compose version
git --version
mkdir -p /srv/content
git clone https://github.com/Anushmk29/content-system-2026.git /srv/content
cd /srv/content
```

The destination must be empty for the first clone. A private repository needs GitHub read
access configured on the VPS. Ensure GitHub contains the intended source changes before
cloning; local edits are not transferred by `git clone`. A source upload can be used instead.

## 3. Production settings

```sh
cp .env.example .env
chmod 600 .env
nano .env
```

Set at least:

| Setting | Value |
| --- | --- |
| `DOMAIN` | Your hostname, for example `studio.example.com`; no scheme or path |
| `CONTENT_DATABASE_URL` | The intended production PostgreSQL connection string |
| `CONTENT_RUN_SECRET` | Client login password, at least 16 characters |
| `CONTENT_SESSION_KEY` | At least 32 random characters |
| `CONTENT_ADMIN_SECRET` | Optional view-only operator password, at least 16 characters if set |
| `CONTENT_OPENROUTER_API_KEY` | Needed for model-powered features |
| `CONTENT_DAILY_BUDGET_USD` | Your daily paid-call cap; the template sets 3 USD |
| `CONTENT_PROXY_HOPS` | `1` with the bundled Caddy proxy |

Generate each login/session secret separately with `openssl rand -hex 32`, then paste
the value into the file. Configure additional integrations from `.env.example` as needed.
Do not commit `.env` or put keys in Docker build arguments.

Use a session-capable database connection: migrations and pipeline advisory locks need
it. Confirm that this is the database you intend to update, and take a backup if it already
contains production data. Never apply `db/seed.sql` to production.

## 4. Build, migrate and start

Run from `/srv/content`. The explicit `--env-file` also supplies Compose's hostname
interpolation; the service-level `env_file` alone does not do that.

```sh
docker compose --env-file .env -f infra/app/docker-compose.yml config --quiet
docker compose --env-file .env -f infra/app/docker-compose.yml build
docker compose --env-file .env -f infra/app/docker-compose.yml run --rm --no-deps app npm run migrate
docker compose --env-file .env -f infra/app/docker-compose.yml up -d app caddy
docker compose --env-file .env -f infra/app/docker-compose.yml ps
```

Stop if the migration fails. The app image includes Node.js, the migration script and SQL;
you do not need a separate Node.js installation on the VPS. Caddy obtains its certificate
when the hostname resolves to the server and ports 80/443 are reachable.

Keep the root PostCSS override when updating dependencies: it replaces Next.js 15's
affected pinned dependency. Remove it only when the upstream dependency passes the audit
without the override.

## 5. Verify before enabling automation

Use your actual hostname:

```sh
curl --fail --show-error https://studio.example.com/content/api/healthz
docker compose --env-file .env -f infra/app/docker-compose.yml logs --tail=100 app caddy
```

The health probe should return `{"ok":true}`. Open
`https://studio.example.com/content`, sign in with `CONTENT_RUN_SECRET`, and verify the
brand kit, saved data and integrations. The System page uses the view-only admin login.
Creative Check APIs return 404, and `/content/check` redirects to the dashboard.

After reviewing integrations and the spend cap, start the hourly scheduler if wanted:

```sh
docker compose --env-file .env -f infra/app/docker-compose.yml up -d scheduler
```

This starts real pipeline runs and can spend integration credits or schedule approved posts.
Postiz publishing requires its separate setup in `infra/postiz/` and API settings.
The current app image does not include `yt-dlp` or `faster-whisper`; video transcription
needs an image with those tools installed. Other Decode features can run without them.

## Updates, backups and recovery

Follow [the deployment runbook](DEPLOY.md) for migrations, monitoring, backups and
updates. Stop the scheduler before updating, build the new image, run the migration,
then recreate the services. Keep production `.env` on the VPS and preserve the
`caddy-data` volume. Database backups need to be copied off the server too.
