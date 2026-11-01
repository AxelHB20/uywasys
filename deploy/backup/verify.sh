#!/usr/bin/env bash
# Prueba de restauración: restaura el último respaldo en una base temporal y compara
# cuántos registros tiene contra la base en uso. Un respaldo que nunca se probó no es un respaldo.
# Uso (una vez al mes, con la clave PRIVADA solo durante la prueba):
#   docker compose -f deploy/docker-compose.yml run --rm -v /ruta/clave.agekey:/key:ro backup verify.sh /key
set -euo pipefail

KEY="${1:?Indica la ruta de la clave privada de age}"
DIR="${BACKUP_DIR:-/backups}"
TEST_DB="uywasys_prueba_restauracion"
latest="$(ls -1t "$DIR"/uywasys_*.dump.age 2>/dev/null | head -n1 || true)"
[ -n "$latest" ] || { echo "[prueba] no hay respaldos en $DIR"; exit 1; }

echo "[prueba] restaurando $(basename "$latest") en la base temporal $TEST_DB"
dropdb --if-exists "$TEST_DB"
createdb "$TEST_DB"
trap 'dropdb --if-exists "$TEST_DB"' EXIT
age -d -i "$KEY" "$latest" | pg_restore --no-owner --no-privileges --exit-on-error -d "$TEST_DB"

status=0
for table in clinics users clients pets visits charges receipts stock_movements audit_logs; do
  live="$(psql -Atc "SELECT count(*) FROM $table")"
  restored="$(psql -d "$TEST_DB" -Atc "SELECT count(*) FROM $table")"
  mark="ok"
  # El respaldo es de la madrugada: la base en uso puede tener más registros, nunca menos
  if [ "$restored" -gt "$live" ] || { [ "$live" -gt 0 ] && [ "$restored" -eq 0 ]; }; then
    mark="REVISAR"; status=1
  fi
  printf '[prueba] %-16s respaldo %-8s en uso %-8s %s\n' "$table" "$restored" "$live" "$mark"
done

[ "$status" -eq 0 ] && echo "[prueba] el respaldo se restaura bien" || echo "[prueba] hay diferencias: revisa"
exit "$status"
