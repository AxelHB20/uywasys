#!/usr/bin/env bash
# Restaura un respaldo SOBRE la base en uso. Borra lo que haya: úsalo solo ante un desastre.
# Detén antes la API:  docker compose -f deploy/docker-compose.yml stop api
# Uso: docker compose ... run --rm -v /ruta/clave.agekey:/key:ro backup restore.sh /key uywasys_2026-10-28_0315.dump.age SI-RESTAURAR
set -euo pipefail

KEY="${1:?Indica la ruta de la clave privada de age}"
NAME="${2:?Indica el archivo de respaldo (está en /backups)}"
CONFIRM="${3:-}"
DIR="${BACKUP_DIR:-/backups}"
[ -f "$DIR/$NAME" ] || { echo "No existe $DIR/$NAME"; exit 1; }
if [ "$CONFIRM" != "SI-RESTAURAR" ]; then
  echo "Esto reemplaza TODOS los datos actuales por los de $NAME."
  echo "Para confirmar, agrega SI-RESTAURAR al final del comando."
  exit 1
fi

echo "[restaurar] $(date '+%F %T') restaurando $NAME"
age -d -i "$KEY" "$DIR/$NAME" | pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error -d "$PGDATABASE"
echo "[restaurar] listo. Vuelve a levantar la API:  docker compose -f deploy/docker-compose.yml start api"
