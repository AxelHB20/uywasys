#!/usr/bin/env bash
# Respaldo diario incremental con restic: cada noche sube solo lo que cambió, pero cualquier
# día guardado se restaura completo. Va cifrado (AES-256) con BACKUP_PASSWORD.
set -euo pipefail
source /usr/local/bin/restic-env.sh

KEEP_DAILY="${BACKUP_KEEP_DAILY:-30}"
KEEP_MONTHLY="${BACKUP_KEEP_MONTHLY:-12}"

# Aviso si el respaldo falla o deja de correr: healthchecks.io (gratis) manda un correo
# cuando no recibe el "listo" en 25 horas o recibe un "/fail".
ping() { [ -n "${BACKUP_PING_URL:-}" ] && curl -fsS -m 10 --retry 3 "${BACKUP_PING_URL}$1" >/dev/null 2>&1 || true; }
trap 'echo "[respaldo] $(date "+%F %T") FALLÓ"; ping /fail' ERR

echo "[respaldo] $(date '+%F %T') inicio → $RESTIC_REPOSITORY"
mkdir -p "$BACKUP_DIR"
[ -n "${RCLONE_REMOTE:-}" ] || echo "[respaldo] AVISO: sin RCLONE_REMOTE, el respaldo solo está en este servidor"

# La primera vez se crea el repositorio (código 10 = todavía no existe)
rc=0; restic cat config >/dev/null 2>&1 || rc=$?
if [ "$rc" -eq 10 ]; then
  echo "[respaldo] creando el repositorio de respaldos"
  restic init
elif [ "$rc" -ne 0 ]; then
  echo "[respaldo] no se pudo abrir el repositorio (código $rc): contraseña distinta o sin conexión al destino"
  false
fi

# SQL plano sin comprimir: así restic detecta qué partes cambiaron (él comprime después).
# --stdin-from-command: si pg_dump falla, no se guarda un respaldo a medias.
restic backup --quiet --host "$RESTIC_HOST" --tag diario \
  --stdin-from-command --stdin-filename uywasys.sql -- \
  pg_dump --format=plain --clean --if-exists --no-owner --no-privileges

# Se quedan 30 días (uno por día) y 12 meses (uno por mes); lo demás se borra
restic forget --quiet --host "$RESTIC_HOST" --tag diario \
  --keep-daily "$KEEP_DAILY" --keep-monthly "$KEEP_MONTHLY" --prune

# Copia completa adicional en este disco (opcional, para el primer mes): solo si hay clave de age
if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
  full="$BACKUP_DIR/uywasys_$(date +%Y-%m-%d_%H%M).dump.age"
  pg_dump --format=custom --no-owner --no-privileges | age -r "$BACKUP_AGE_RECIPIENT" > "$full.tmp"
  mv "$full.tmp" "$full"
  find "$BACKUP_DIR" -name 'uywasys_*.dump.age' -mtime +"${BACKUP_FULL_DAYS:-7}" -delete
fi

date -Iseconds > "$BACKUP_DIR/.ultimo-respaldo"
total="$(restic stats --mode raw-data --json 2>/dev/null | sed -n 's/.*"total_size":\([0-9]*\).*/\1/p')"
echo "[respaldo] $(date '+%F %T') listo (espacio usado: $(( ${total:-0} / 1048576 )) MB)"
ping ""
