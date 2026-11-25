# Respaldo de PostgreSQL: incremental y cifrado con restic, fuera del servidor con rclone.
# age queda para la copia completa opcional del primer mes.
FROM alpine:3.22
RUN apk add --no-cache postgresql17-client age restic rclone tzdata bash curl
ENV TZ=America/Lima \
    RCLONE_CONFIG=/config/rclone/rclone.conf
COPY backup.sh verify.sh restore.sh restic-env.sh perf-check.sh /usr/local/bin/
COPY crontab /etc/crontabs/root
RUN chmod +x /usr/local/bin/*.sh && mkdir -p /backups
# crond en primer plano; los respaldos salen en  docker compose logs backup
CMD ["crond", "-f", "-l", "8"]
