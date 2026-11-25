#!/usr/bin/env bash
# Prueba de restauración: revisa que el repositorio esté sano, restaura el último respaldo en
# una base temporal y compara cuántos registros tiene contra la base en uso.
# Un respaldo que nunca se probó no es un respaldo. Uso (al instalar y una vez al año):
#   uywa run --rm backup verify.sh
set -euo pipefail
source /usr/local/bin/restic-env.sh

TEST_DB="uywasys_prueba_restauracion"

echo "[prueba] revisando el repositorio"
restic check --quiet
restic snapshots --host "$RESTIC_HOST" --tag diario --compact | tail -n 4

echo "[prueba] restaurando el último respaldo en la base temporal $TEST_DB"
dropdb --if-exists "$TEST_DB"
createdb "$TEST_DB"
trap 'dropdb --if-exists "$TEST_DB"' EXIT
restic dump --host "$RESTIC_HOST" --tag diario latest /uywasys.sql |
  psql -q -v ON_ERROR_STOP=1 --single-transaction -d "$TEST_DB" >/dev/null

status=0
for table in clinics users clients pets visits charges receipts payments electronic_documents \
  immunizations prescriptions appointments hospitalizations grooming_sessions consents \
  attachment_files stock_movements portal_links audit_logs; do
  live="$(psql -Atc "SELECT count(*) FROM $table")"
  restored="$(psql -d "$TEST_DB" -Atc "SELECT count(*) FROM $table")"
  mark="ok"
  # El respaldo es de la madrugada: la base en uso puede tener más registros, nunca menos
  if [ "$restored" -gt "$live" ] || { [ "$live" -gt 0 ] && [ "$restored" -eq 0 ]; }; then
    mark="REVISAR"; status=1
  fi
  printf '[prueba] %-20s respaldo %-8s en uso %-8s %s\n' "$table" "$restored" "$live" "$mark"
done

[ "$status" -eq 0 ] && echo "[prueba] el respaldo se restaura bien" || echo "[prueba] hay diferencias: revisa"
exit "$status"
