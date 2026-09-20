#!/bin/sh
# One backup run: pg_dump (custom format, compressed) -> local volume -> off-box storage via rclone.
# Exits non-zero if the dump or the upload fails, so a scheduler or `docker compose run` sees it.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
DIR="${BACKUP_DIR:-/backups}"
FILE="$DIR/tcwab-$STAMP.dump"
LOCAL_KEEP_DAYS="${BACKUP_LOCAL_KEEP_DAYS:-7}"
REMOTE_KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

mkdir -p "$DIR"
echo "[backup] dumping to $FILE"
# Write to a temp name first so a half-written dump is never mistaken for a good one.
pg_dump --format=custom --no-owner --no-privileges --file="$FILE.partial" "$DATABASE_URL"
mv "$FILE.partial" "$FILE"
echo "[backup] dump ok: $(du -h "$FILE" | cut -f1)"

if [ -n "${BACKUP_REMOTE:-}" ]; then
  echo "[backup] uploading to $BACKUP_REMOTE"
  rclone copyto "$FILE" "$BACKUP_REMOTE/tcwab-$STAMP.dump"
  # Prune the remote. --min-age only ever removes files older than the limit.
  rclone delete "$BACKUP_REMOTE" --min-age "${REMOTE_KEEP_DAYS}d" --include "tcwab-*.dump"
  echo "[backup] uploaded; remote pruned past ${REMOTE_KEEP_DAYS} days"
else
  echo "[backup] WARNING: BACKUP_REMOTE is not set, so this backup only exists on this server. Set it to an rclone destination (see hub/.env.example)."
fi

# Local copies are only a convenience for quick restores; the remote is the real backup.
find "$DIR" -name 'tcwab-*.dump' -mtime +"$LOCAL_KEEP_DAYS" -delete
echo "[backup] done"
