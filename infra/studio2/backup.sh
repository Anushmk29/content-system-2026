#!/bin/sh
set -eu
umask 077
cd /srv/studio2
dir=/srv/studio2/private/backups
test -d "$dir"
work=$(mktemp -d "$dir/.backup-XXXXXX")
trap 'rm -rf "$work"' EXIT HUP INT TERM
docker compose -p studio2 --env-file .env -f compose.yml exec -T db pg_dump -U postgres -d studio2 -Fc > "$work/studio2.dump"
docker run --rm --network studio2-postiz_egress --cgroup-parent studio2.slice --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --memory 128m --cpus 0.25 --env-file private/postiz-backup.env \
  postgres:17-alpine pg_dump --schema=postiz --no-owner -Fc > "$work/postiz.dump"
docker compose -p studio2-postiz -f postiz-compose.yml exec -T temporal-postgresql pg_dump -U temporal -d temporal -Fc > "$work/temporal.dump"
for dump in "$work"/*.dump; do
  docker compose -p studio2 --env-file .env -f compose.yml exec -T db pg_restore --list < "$dump" > /dev/null
done
docker compose -p studio2-postiz -f postiz-compose.yml exec -T postiz tar -czf - -C / uploads config > "$work/postiz-files.tar.gz"
tar -tzf "$work/postiz-files.tar.gz" >/dev/null
tar -czf "$work/settings.tar.gz" .env compose.yml postiz-compose.yml ops/init-db.sh ops/scheduler.mjs ops/egress.sh ops/backup.sh \
  ops/traefik.yml ops/postiz-traefik.yml ops/postiz-nginx.conf ops/systemd \
  private/app.env private/postiz.env private/postiz-backup.env private/postiz-api.json private/access.json \
  private/db-admin-password private/db-app-password private/temporal.env private/temporal-password private/redis-password private/redis.conf
tar -tzf "$work/settings.tar.gz" >/dev/null
(cd "$work" && sha256sum *.dump *.tar.gz > SHA256SUMS && sha256sum -c SHA256SUMS >/dev/null)
mv "$work" "$dir/recovery-$(date -u +%Y%m%dT%H%M%SZ)"
# Only this script's completed backup directories are eligible for retention cleanup.
find "$dir" -mindepth 1 -maxdepth 1 -type d -name 'recovery-20??????T??????Z' -mtime +14 -exec rm -rf -- {} +
find "$dir" -maxdepth 1 -type f -name 'studio2-*.dump' -mtime +14 -delete
echo 'Studio2 and Postiz recovery backup verified (three database dumps, media and private settings)'
