# Owner to-do (after the Oct–Nov 2026 hardening)

Tick each box when it's done. None of these need code changes.

## 1. Database TLS (do this first)
At the moment the app encrypts the database connection but does not check the server's certificate.

- [ ] Download the CA certificate from Supabase: Dashboard → Project Settings → Database → SSL Configuration → Download certificate.
- [ ] Put it on the server next to the app, for example `/opt/content/prod-ca.crt`.
- [ ] In the server `.env`, add `CONTENT_DATABASE_CA=/opt/content/prod-ca.crt`.
- [ ] Make sure the server `.env` does **not** have `CONTENT_DATABASE_SSL=disable`. When the CA is set it takes priority over `no-verify` or `require`.
- [ ] Restart the app and the scheduler. Then open `/content/api/healthz`; it should return 200.
  - If it returns a certificate error, the certificate file is the wrong one. Download it again; don't remove the setting.

## 2. Image cost check
Make sure the image costs we record match what OpenRouter actually charges.

- [ ] In the Supabase SQL editor, run:
  ```sql
  select at, model, cost_usd from content.cost_events
  where kind = 'image' order by at desc limit 20;
  ```
- [ ] Compare those rows with OpenRouter → Activity for the same times and model.
- [ ] If the amounts differ by more than a few cents per image, tell the developer.
  - Have the rows and the OpenRouter screenshot side by side.
  - The image price in the code needs updating.

## 3. Video transcription tools on the server
Decode needs both of these to transcribe videos. If either is missing, transcription is skipped.

- [ ] On the server, run `yt-dlp --version`. It should print a version number.
  - If not: `pip install yt-dlp`, or set `CONTENT_YTDLP=/full/path/to/yt-dlp`.
- [ ] On the server, run `python -c "import faster_whisper"`. It should print nothing and show no error.
  - If not: `pip install faster-whisper`, or point `CONTENT_PYTHON` at the Python that has it.
- [ ] Check the Health page in the app. Transcription should no longer say a tool is missing.

## 4. E2E test rows in audit_log (your decision)
The October test run wrote 171 rows to `content.audit_log` (role `client`, after 2026-10-15 17:23 UTC). They don't harm anything, so keeping them is fine.

- [ ] Look at them first:
  ```sql
  select count(*), min(at), max(at) from content.audit_log
  where role = 'client' and at > '2026-10-15 17:23:00+00' and at < '2026-10-16 00:00:00+00';
  ```
- [ ] **Keep** them: nothing to do.
- [ ] **Delete** them: only if that count is 171 (the end date keeps later real client activity out).
  - Run the same `where` clause as above, but as `delete from content.audit_log where …`.
  - Ask the developer to do it if you're not sure.

## 5. Not done yet in git
- [ ] Two commits on branch `improvements-2026-10` are not pushed yet: `065ed4c` (hardening) and `05a6f4b` (security fixes).
  - Push the branch and open a PR to `main` when you're ready.
- [ ] One test (`brand.test.ts:132`, the old pillar-enum upgrade) was already failing before these changes.
  - Ask for a fix before relying on that upgrade path.

## 6. Already in the plan; check these were done
- [ ] Supabase DB password rotated, with no `@` in it (or written as `%40` in the URL).
- [ ] Secret settings in the server `.env`:
  - `CONTENT_RUN_SECRET` and `CONTENT_ADMIN_SECRET`: 16+ characters each.
  - `CONTENT_SESSION_KEY`: from `openssl rand -hex 32`.
  - `CONTENT_CRON_SECRET`: set.
- [ ] The app port is never published directly. Only Caddy faces the internet.
