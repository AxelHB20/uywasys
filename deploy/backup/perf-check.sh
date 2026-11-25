#!/usr/bin/env bash
# Revisión semanal de rendimiento de la base. Busca lo que hace lento al sistema y, si encuentra
# algo, manda el informe por correo (healthchecks.io muestra el texto en el aviso):
#   - consultas lentas en promedio (pg_stat_statements)
#   - tablas grandes que se leen enteras (índice que falta)
#   - limpieza atrasada (filas muertas que autovacuum no alcanzó)
#   - poca memoria para la base (proporción de lecturas desde caché)
#   - disco del servidor casi lleno
# No cambia nada por su cuenta: un índice o un ajuste se decide con el informe en la mano.
# Manual:  uywa exec backup perf-check.sh
set -euo pipefail

SLOW_MS="${PERF_SLOW_MS:-300}"           # consulta lenta: promedio por encima de esto
MIN_CALLS="${PERF_MIN_CALLS:-20}"        # y que se haya usado al menos estas veces
DISK_MAX_PCT="${PERF_DISK_MAX_PCT:-80}"  # aviso de disco desde este porcentaje

ping() {
  [ -n "${PERF_PING_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 --data-binary @- "${PERF_PING_URL}$1" >/dev/null 2>&1 || true
}
q() { psql -X -q -At -F ' | ' -v ON_ERROR_STOP=1 -c "$1"; }

report=""
add() { report+="$1"$'\n'; }

echo "[rendimiento] $(date '+%F %T') revisando"

# Las estadísticas de consultas necesitan la extensión (viene con PostgreSQL)
if ! q "CREATE EXTENSION IF NOT EXISTS pg_stat_statements" 2>/dev/null ||
  ! q "SELECT 1 FROM pg_stat_statements LIMIT 1" >/dev/null 2>&1; then
  add "• No hay estadísticas de consultas: falta shared_preload_libraries=pg_stat_statements en la base."
else
  slow="$(q "
    SELECT round(mean_exec_time)::int || ' ms promedio', calls || ' veces',
           left(regexp_replace(query, '\s+', ' ', 'g'), 160)
    FROM pg_stat_statements
    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND calls >= $MIN_CALLS AND mean_exec_time > $SLOW_MS
      AND query !~* '^\s*(vacuum|analyze|create|alter|drop|copy|begin|commit|set|show)'
    ORDER BY mean_exec_time * calls DESC LIMIT 5")"
  [ -n "$slow" ] && add "• Consultas lentas (más de ${SLOW_MS} ms en promedio):"$'\n'"$slow"
fi

seq="$(q "
  SELECT relname, n_live_tup || ' filas', seq_scan || ' lecturas completas', coalesce(idx_scan, 0) || ' por índice'
  FROM pg_stat_user_tables
  WHERE n_live_tup > 20000 AND seq_scan > 50 AND seq_scan > 2 * coalesce(idx_scan, 0)
  ORDER BY seq_tup_read DESC LIMIT 5")"
[ -n "$seq" ] && add "• Tablas grandes leídas enteras (posible índice que falta):"$'\n'"$seq"

dead="$(q "
  SELECT relname, n_dead_tup || ' filas muertas de ' || n_live_tup,
         coalesce(to_char(greatest(last_autovacuum, last_vacuum), 'YYYY-MM-DD'), 'nunca') || ' última limpieza'
  FROM pg_stat_user_tables
  WHERE n_dead_tup > 10000 AND n_dead_tup > 0.2 * greatest(n_live_tup, 1)
  ORDER BY n_dead_tup DESC LIMIT 5")"
[ -n "$dead" ] && add "• Limpieza atrasada (autovacuum no alcanza):"$'\n'"$dead"

hit="$(q "
  SELECT round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 1)
  FROM pg_stat_database WHERE datname = current_database()")"
if [ -n "$hit" ] && awk "BEGIN{exit !($hit < 95)}"; then
  add "• Solo el ${hit}% de las lecturas sale de memoria (ideal: 99%). Sube shared_buffers o la RAM."
fi

disk="$(df -P /backups | awk 'NR==2 {gsub("%",""); print $5}')"
if [ -n "$disk" ] && [ "$disk" -ge "$DISK_MAX_PCT" ]; then
  add "• Disco del servidor al ${disk}%. Revisa respaldos locales, logs de Docker o amplía el disco."
fi

size="$(q "SELECT pg_size_pretty(pg_database_size(current_database()))")"

# Cada informe cubre solo la última semana
q "SELECT pg_stat_statements_reset()" >/dev/null 2>&1 || true

if [ -n "$report" ]; then
  msg="Uywa: revisión de rendimiento ($(date '+%F')) — base ${size}, disco ${disk:-?}%"$'\n\n'"$report"
  printf '%s' "$msg"
  printf '%s' "$msg" | ping /fail
  exit 1
fi
echo "[rendimiento] todo bien — base ${size}, disco ${disk:-?}%, lecturas desde memoria ${hit:-?}%"
printf 'Todo bien — base %s, disco %s%%' "$size" "${disk:-?}" | ping ""
