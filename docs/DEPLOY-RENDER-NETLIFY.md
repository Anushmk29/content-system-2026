# Deploying for testing: Render (recommended) and Netlify

This guide puts Content Studio online so you can test it from any browser. For the long-term
production setup (one VPS with Docker), see `docs/DEPLOY.md`.

## Pick a host first

| | **Render** | **Netlify** |
|---|---|---|
| Dashboard, login, Approvals, Calendar | ✅ works | ✅ works |
| "Run pipeline" button, Decode, image generation, voice import (take 1–15 min) | ✅ works | ❌ cut off at ~30 s |
| Uploading a video/carousel to a post (up to 60 MB) | ✅ works | ❌ ~6 MB request cap |
| Hourly automatic pipeline | ✅ Render Cron Job | ⚠️ only with a Render Cron Job next to it |
| Login rate limit (kept in memory) | ✅ one server | ⚠️ resets often (many short-lived functions) |
| Cost for testing | ~$7/month app + ~$1+/month cron | free tier, but you still need Render for the cron |

**Use Render.** Netlify runs every API route as a short serverless function. Most of this app's
real work (drafting, Decode, images) runs for minutes, so on Netlify those buttons time out. Part B
covers Netlify anyway, with what still works there.

What every setup needs, whichever host you pick:

```
Browser ──▶ App (Render or Netlify) ──▶ Supabase Postgres  (all data, images too)
                                    ──▶ OpenRouter         (Claude + Jev)
                                    ──▶ Postiz             (publishing; Cloud or self-hosted)
Render Cron Job ── every hour ──▶ runs the pipeline against the same database
```

All images, logos and fonts are stored in the database, so the app keeps nothing on its own
disk. That's why it can run on Render or Netlify without a disk.

---

## Step 0: Things to get ready (both hosts)

1. **Code on GitHub.** Commit and push the branch you want to test (for example
   `improvements-2026-10`). Render and Netlify both deploy from a GitHub repo.
   - Check that `.env` is in `.gitignore` and was **never** committed. Secrets go into the host's
     settings screen, never into git.
2. **Database (Supabase).**
   - Supabase → Project → **Connect** → copy the **Session pooler** string (port **5432**).
     Don't use the Transaction pooler (6543): the pipeline's locks need a session.
   - Apply the schema **from your own computer**, once (re-running it is safe):
     ```sh
     # in the repo root, with CONTENT_DATABASE_URL set in your local .env
     npm ci --prefix content-pipeline
     npm run migrate
     ```
   - Never run `db/seed.sql` on a database you care about. It's demo data.
3. **Make three secrets** (any terminal with Git Bash or WSL):
   ```sh
   openssl rand -hex 16   # → CONTENT_RUN_SECRET   (client password, 16+ chars)
   openssl rand -hex 16   # → CONTENT_ADMIN_SECRET (your password, 16+ chars)
   openssl rand -hex 32   # → CONTENT_SESSION_KEY  (32+ chars)
   openssl rand -hex 32   # → CONTENT_CRON_SECRET  (only if a cron calls the URL)
   ```
   If any of these is missing or too short, the app shows a 503 page that names the problem.
4. **OpenRouter key** → `CONTENT_OPENROUTER_API_KEY` (openrouter.ai/keys). Set a spend cap for
   testing: `CONTENT_DAILY_BUDGET_USD=5`.
5. **Postiz** (only if you want to test real posting). Pick one:
   - **Postiz Cloud (easiest for testing).** Sign up at postiz.com, connect LinkedIn, X,
     Instagram and Facebook there, then go to Settings → Public API and copy the key. Set
     `CONTENT_POSTIZ_API_URL=https://api.postiz.com` (the app adds `/public/v1` on its own) and
     `CONTENT_POSTIZ_API_KEY=<key>`. Images are uploaded to Postiz Cloud, so Instagram and Facebook
     can fetch them. That fixes the "media on localhost" problem from local testing.
   - **Your own Postiz.** It needs Redis, Temporal and Elasticsearch next to it
     (`infra/postiz/docker-compose.yml`), and that doesn't fit well on Render. Run it on a small
     VPS and point `CONTENT_POSTIZ_API_URL` at its public HTTPS address. The Postiz
     `MAIN_URL` must be public too, otherwise Instagram/Facebook can't download the media.
   - **Skip Postiz.** Everything still works except booking posts. The System page shows Postiz
     as "not configured".

### The settings list (paste into the host's Environment screen)

Required:

| Name | Value |
|---|---|
| `CONTENT_DATABASE_URL` | Supabase session pooler string (port 5432) |
| `CONTENT_RUN_SECRET` | client password (16+) |
| `CONTENT_ADMIN_SECRET` | your password (16+); opens System, Training, Costs |
| `CONTENT_SESSION_KEY` | 32+ random characters |
| `CONTENT_OPENROUTER_API_KEY` | `sk-or-...` |
| `NODE_ENV` | `production` |

Strongly suggested for testing:

| Name | Value | Why |
|---|---|---|
| `CONTENT_DAILY_BUDGET_USD` | `5` | Stops all paid calls for the day once $5 is spent |
| `CONTENT_LOG_FORMAT` | `json` | Readable in the host's log viewer |
| `CONTENT_POSTIZ_API_URL` / `CONTENT_POSTIZ_API_KEY` | see Step 0.5 | Real posting |
| `CONTENT_REVISE_ON_CHANGES` | `1` | "Request changes" rewrites the post |
| `CONTENT_POSTIZ_SYNC` | `1` | Planning on the Calendar books it in Postiz right away |
| `CONTENT_CRON_SECRET` | random 32+ | Only if a cron calls the URL instead of running the pipeline itself |

Optional (copy from your local `.env` if you use them): `CONTENT_APIFY_TOKEN`,
`CONTENT_YOUTUBE_API_KEY`, `CONTENT_TINYFISH_*`, `CONTENT_MARKET_FEEDS`,
`CONTENT_REDDIT_QUERIES`, `CONTENT_X_*`, `CONTENT_PLATFORM_FIT`, `CONTENT_ALERT_WEBHOOK`,
`CONTENT_LLM_MODEL`, `CONTENT_IMAGE_MODEL`. Leave out `CONTENT_YTDLP`, `CONTENT_PYTHON` and
`CONTENT_WHISPER_MODEL`. Video transcription isn't in the image; Decode still works without it.

---

## Part A: Render (recommended)

You create two things on Render: a **Web Service** (the dashboard) and a **Cron Job** (the hourly
pipeline). Both build from the repo's `Dockerfile`.

### A1. Web Service

1. render.com → **New** → **Web Service** → connect GitHub → pick this repo.
2. Settings:
   - **Branch:** the branch you pushed.
   - **Language / Runtime:** **Docker** (Render finds the `Dockerfile` in the root).
   - **Region:** the one nearest your Supabase region (Supabase → Settings → General). Every page
     talks to the database, so distance shows up as slowness.
   - **Instance type:** **Starter** or higher. Don't use Free: it sleeps after 15 minutes idle,
     takes about a minute to wake, and a sleeping app can't finish a long run.
3. **Environment** → add every variable from the settings list above, plus:
   - `PORT` = `3000` (the image listens on 3000).
   - `CONTENT_PROXY_HOPS` = `1`.
4. **Advanced:**
   - **Health Check Path:** `/content/api/healthz`.
   - **Auto-Deploy:** on (each push to the branch redeploys).
5. Click **Create Web Service**. The first build takes about 5–10 minutes. When the log shows
   `Ready` and the status is **Live**, Render gives you a URL like
   `https://content-studio-xxxx.onrender.com`.

### A2. Check it works

1. Open `https://<your-url>/content/api/healthz` → `{"ok":true}`.
   - 503: the database URL is wrong, or Supabase blocks the connection (check
     Supabase → Database → Network restrictions).
2. Open `https://<your-url>/content` → the login page → enter `CONTENT_ADMIN_SECRET`.
3. **System** page: Database, LLM and Postiz should be green. Anything grey is just not set.
4. Click **Run pipeline** (top bar) and wait. Each step shows its result. A full first run can
   take several minutes, and that's normal.

### A3. Cron Job (pipeline every hour)

1. Render → **New** → **Cron Job** → same repo and branch.
2. **Language:** Docker.
3. **Schedule:** `0 * * * *` (every hour, on the hour, UTC). For a cheaper test, use
   `0 */4 * * *` (every 4 hours).
4. **Docker Command:** `npm --prefix content-pipeline run pipeline`
5. **Environment:** the same variables as the Web Service. Render → **Environment Groups**
   lets you make one group and attach it to both, so you only type them once.
6. Create it, then click **Trigger Run** once and read the log. Each module prints one line
   (`OK research 2× …`).

If a run from the dashboard and a cron run overlap, nothing doubles. The second one shows as
"skipped (already running)".

### A4. Your own domain (optional)

Web Service → **Settings → Custom Domains** → add `studio.yourdomain.com` → add the CNAME record
Render shows at your DNS provider. Render issues the HTTPS certificate itself.

### A5. Updating

1. If `db/schema.sql` changed, run `npm run migrate` from your computer **first**.
2. Then push to the branch. Render rebuilds and swaps over with no downtime (it waits for the
   health check).

### A6. Render problems and fixes

| Symptom | Fix |
|---|---|
| Every page shows a 503 with a sentence | It names the missing or short setting. Fix it in Environment, then **Save, rebuild and deploy**. |
| Build fails on `npm ci` | `package-lock.json` is out of sync. Run `npm install` locally, commit both lock files, push. |
| Healthz 503 | Wrong `CONTENT_DATABASE_URL`, the transaction pooler (6543) was used, or Supabase network restrictions block Render. |
| "Too many requests" right after a test run | That's the rate limiter. Wait one minute. |
| Logged out after a deploy | Only happens when `CONTENT_SESSION_KEY` or a password changed. |
| Post failed in Postiz | Open Postiz: the channel usually needs re-connecting (Instagram tokens expire). |
| Out of memory during image generation | Move up one instance size (Standard). |

---

## Part B: Netlify (limited, dashboard only)

Read the table at the top first. On Netlify, these buttons time out: **Run pipeline**, single
module runs, Decode runs, "Write my version", image/creative generation, brand voice import, and
media upload over ~6 MB. Use Netlify only to click through pages and approve or plan posts, with the
heavy work done by a Render Cron Job (Part A3).

### B1. Add a Netlify config file

Create `netlify.toml` in the repo root and commit it:

```toml
[build]
  command = "npm run build"
  publish = ".next"

[build.environment]
  NODE_VERSION = "22"
```

Netlify sees Next.js and uses its Next.js runtime on its own. No plugin needs installing.

### B2. Create the site

1. app.netlify.com → **Add new site** → **Import an existing project** → GitHub → this repo.
2. **Branch to deploy:** your branch. Build command and publish folder come from `netlify.toml`.
3. **Environment variables:** every variable from the settings list. Add
   `CONTENT_PROXY_HOPS` = `1`. Don't add `PORT`.
4. **Deploy site.** You get `https://<name>.netlify.app`.

### B3. Check it works

1. `https://<name>.netlify.app/content/api/healthz` → `{"ok":true}`.
2. Log in at `/content`, then open Today, Ideas, Approvals and Calendar.
3. Don't press Run pipeline here. Let the Render Cron Job do the runs.

### B4. The pipeline on Netlify

Set up the **Render Cron Job** exactly as in Part A3. It runs the pipeline straight against the
same database and never goes through Netlify, so there's no time limit. New drafts appear on the
Netlify dashboard after each run.

### B5. Netlify problems and fixes

| Symptom | Fix |
|---|---|
| Build fails on `middleware` (Node runtime) | Netlify's runtime doesn't support Node-runtime middleware in your version. Use Render. |
| A button spins, then shows "error" or 502/504 | That action takes longer than Netlify allows. Run it from the Render-hosted app or let the cron do it. |
| Uploads fail | Netlify caps request bodies at about 6 MB. Upload on Render. |
| Logged out a lot / rate limits feel random | Each function instance has its own memory. That's expected on Netlify. |

---

## Testing checklist (after deploy)

1. Healthz says `{"ok":true}`.
2. Log in as admin, then as client (`CONTENT_RUN_SECRET`). The client must **not** see System,
   Training or Costs.
3. **Brand** page: fill the Brand Kit (voice, audience, pillars), then save.
4. **Ideas** → add a signal → **Run pipeline** (Render) or wait for the cron → a scored idea
   appears.
5. Pick platforms on the idea → **Draft now** → drafts appear in **Approvals**.
6. Request changes with a chip → the post is rewritten (needs `CONTENT_REVISE_ON_CHANGES=1`).
7. Approve, then drag it onto the **Calendar** → it shows up in Postiz (needs Postiz + sync on).
8. **Costs** (admin) → spend shows and stays under `CONTENT_DAILY_BUDGET_USD`.
9. Leave it for a few hours → the System page shows the cron's hourly runs.

## Cost while testing (rough)

| Item | Approx. |
|---|---|
| Render Web Service, Starter | ~$7/month |
| Render Cron Job | billed per minute it runs, $1/month minimum |
| Supabase | free tier is fine for testing |
| OpenRouter | capped by `CONTENT_DAILY_BUDGET_USD` |
| Postiz Cloud | their plan (has a trial) |

Check current prices on render.com/pricing and postiz.com before you rely on these numbers.
