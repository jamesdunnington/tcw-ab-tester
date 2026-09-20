FROM alpine:3.20
# pg_dump must be the same major version as the server (postgres:16-alpine in the compose file).
RUN apk add --no-cache postgresql16-client rclone tzdata
COPY hub/backup/backup.sh /usr/local/bin/backup.sh
COPY hub/backup/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
