# Configuración común de restic (la cargan backup.sh, restore.sh y verify.sh).
: "${BACKUP_PASSWORD:?Define BACKUP_PASSWORD en deploy/.env: es la contraseña que cifra los respaldos}"
export RESTIC_PASSWORD="$BACKUP_PASSWORD"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
# Con RCLONE_REMOTE los respaldos van fuera del servidor (Google Drive, R2...); sin él, a este disco.
if [ -n "${RCLONE_REMOTE:-}" ]; then
  export RESTIC_REPOSITORY="rclone:${RCLONE_REMOTE}"
else
  export RESTIC_REPOSITORY="$BACKUP_DIR/restic"
fi
export RESTIC_CACHE_DIR="$BACKUP_DIR/.cache"
# Nombre fijo: así la limpieza agrupa bien aunque el contenedor cambie de nombre
RESTIC_HOST="uywasys"
