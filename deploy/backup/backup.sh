#!/usr/bin/env bash
# Respaldo completo de la base, cifrado con la clave PÚBLICA de age.
# Sin la clave privada (que vive fuera del servidor) nadie puede leerlo, ni quien robe el disco.
set -euo pipefail

: "${BACKUP_AGE_RECIPIENT:?Falta BACKUP_AGE_RECIPIENT (clave pública de age)}"
DIR="${BACKUP_DIR:-/backups}"
KEEP="${BACKUP_RETENTION_DAYS:-30}"
stamp="$(date +%Y-%m-%d_%H%M)"
file="$DIR/uywasys_${stamp}.dump.age"

echo "[respaldo] $(date '+%F %T') inicio → $(basename "$file")"
mkdir -p "$DIR"
# Formato custom de pg_dump: comprimido y restaurable por partes
pg_dump --format=custom --no-owner --no-privileges | age -r "$BACKUP_AGE_RECIPIENT" > "$file.tmp"
mv "$file.tmp" "$file"
size="$(du -h "$file" | cut -f1)"

# Se borran los respaldos locales más viejos que KEEP días
find "$DIR" -name 'uywasys_*.dump.age' -mtime +"$KEEP" -delete

if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy "$file" "$RCLONE_REMOTE" --quiet
  rclone delete "$RCLONE_REMOTE" --min-age "${KEEP}d" --include 'uywasys_*.dump.age' --quiet
  echo "[respaldo] copiado a $RCLONE_REMOTE"
else
  echo "[respaldo] AVISO: sin RCLONE_REMOTE, el respaldo solo está en este servidor"
fi

date -Iseconds > "$DIR/.ultimo-respaldo"
echo "[respaldo] $(date '+%F %T') listo ($size)"
