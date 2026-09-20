#!/bin/sh
# Runs backup.sh on a schedule (BACKUP_CRON, default 03:17 every day). Pass a command to run it instead,
# e.g. `docker compose run --rm backup /usr/local/bin/backup.sh` for an on-demand backup.
set -eu

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

# cron jobs do not inherit the container environment, so hand it over in a file.
printenv | grep -E '^(DATABASE_URL|BACKUP_|RCLONE_|TZ)' | sed "s/'/'\\''/g; s/=\(.*\)/='\1'/; s/^/export /" > /etc/backup.env
echo "${BACKUP_CRON:-17 3 * * *} . /etc/backup.env; /usr/local/bin/backup.sh > /proc/1/fd/1 2>&1" > /etc/crontabs/root
echo "[backup] scheduled: ${BACKUP_CRON:-17 3 * * *} (timezone ${TZ:-UTC})"
exec crond -f -l 8
