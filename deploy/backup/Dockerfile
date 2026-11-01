# Respaldo de PostgreSQL: pg_dump cifrado con age, copia fuera del servidor con rclone.
FROM alpine:3.22
RUN apk add --no-cache postgresql17-client age rclone tzdata bash
ENV TZ=America/Lima \
    RCLONE_CONFIG=/config/rclone/rclone.conf
COPY backup.sh verify.sh restore.sh /usr/local/bin/
COPY crontab /etc/crontabs/root
RUN chmod +x /usr/local/bin/*.sh && mkdir -p /backups
# crond en primer plano; los respaldos salen en  docker compose logs backup
CMD ["crond", "-f", "-l", "8"]
