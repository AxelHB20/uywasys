#!/usr/bin/env bash
# Restaura un respaldo SOBRE la base en uso. Borra lo que haya: úsalo solo ante un desastre.
# Detén antes la API:  uywa stop api
# Ver los respaldos:        uywa run --rm backup restore.sh lista
# Restaurar el último:      uywa run --rm backup restore.sh latest SI-RESTAURAR
# Restaurar uno anterior:   uywa run --rm backup restore.sh 4f2a9c1b SI-RESTAURAR
# Copia completa antigua:   uywa run --rm -v /ruta/clave.agekey:/key:ro backup restore.sh uywasys_2026-11-16_0315.dump.age SI-RESTAURAR
set -euo pipefail
source /usr/local/bin/restic-env.sh

WHICH="${1:?Indica qué respaldo: lista, latest, el código de un respaldo o un archivo .dump.age}"
CONFIRM="${2:-}"

if [ "$WHICH" = "lista" ]; then
  restic snapshots --host "$RESTIC_HOST" --tag diario --compact
  exit 0
fi
if [ "$CONFIRM" != "SI-RESTAURAR" ]; then
  echo "Esto reemplaza TODOS los datos actuales por los del respaldo $WHICH."
  echo "Para confirmar, agrega SI-RESTAURAR al final del comando."
  exit 1
fi

echo "[restaurar] $(date '+%F %T') restaurando $WHICH"
case "$WHICH" in
  *.dump.age)
    [ -f /key ] || { echo "Monta la clave privada de age en /key"; exit 1; }
    age -d -i /key "$BACKUP_DIR/$WHICH" |
      pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error -d "$PGDATABASE" ;;
  *)
    restic dump --host "$RESTIC_HOST" --tag diario "$WHICH" /uywasys.sql |
      psql -q -v ON_ERROR_STOP=1 --single-transaction -d "$PGDATABASE" >/dev/null ;;
esac
echo "[restaurar] listo. Vuelve a levantar la API:  uywa start api"
