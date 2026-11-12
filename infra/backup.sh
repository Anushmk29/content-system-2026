#!/bin/sh
# Nightly backup of everything that can't be rebuilt: the content + postiz schemas (posts, brand kit,
# images, fonts and videos live in Postgres) and the Postiz uploads volume. Keeps 14 days.
# Host crontab:  15 3 * * *  CONTENT_DATABASE_URL=... /path/to/infra/backup.sh >> /var/log/content-backup.log 2>&1
# Restore:       pg_restore --clean --if-exists -d "$CONTENT_DATABASE_URL" db-YYYY-MM-DD.dump
# Copy BACKUP_DIR off the server too (rclone, restic, or your provider's snapshots): a backup on
# the same disk does not survive losing the disk.
set -eu
: "${CONTENT_DATABASE_URL:?set CONTENT_DATABASE_URL}"
DIR="${BACKUP_DIR:-/var/backups/content}"
VOLUME="${POSTIZ_UPLOADS_VOLUME:-postiz_postiz-uploads}"
DAY="$(date +%F)"
mkdir -p "$DIR"

pg_dump "$CONTENT_DATABASE_URL" --schema=content --schema=postiz -Fc -f "$DIR/db-$DAY.dump"
if docker volume inspect "$VOLUME" >/dev/null 2>&1; then
  docker run --rm -v "$VOLUME":/u:ro -v "$DIR":/b alpine tar czf "/b/postiz-uploads-$DAY.tgz" -C /u .
fi
find "$DIR" -type f -mtime +14 -delete
echo "$(date -Is) backup ok: $DIR/db-$DAY.dump"
