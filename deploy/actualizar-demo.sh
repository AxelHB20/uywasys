#!/usr/bin/env bash
# Corre en el servidor de demostración (lo llama deploy/subir-demo.bat por SSH).
# Respaldo de la base → archivos nuevos → compila → espera a que el sistema responda.
set -euo pipefail
cd ~/uywasys
DC="docker compose -f deploy/docker-compose.azure-demo.yml --env-file deploy/.env"

echo "== Respaldo de la base =="
mkdir -p ~/respaldos
$DC exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > ~/respaldos/demo-$(date +%F-%H%M).sql.gz
# Se guardan los 7 últimos
ls -1t ~/respaldos/*.sql.gz | tail -n +8 | xargs -r rm --

echo "== Archivos nuevos =="
cd ~
unzip -oq uywasys.zip
rm -f uywasys.zip
cd ~/uywasys

echo "== Compilando (10 a 20 minutos; la demo sigue funcionando) =="
$DC up -d --build --remove-orphans

echo "== Esperando al sistema =="
for _ in $(seq 1 60); do
  if $DC exec -T api node -e "fetch('http://localhost:3000/api/health').then(r=>r.json()).then(j=>process.exit(j.database==='up'?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    $DC ps
    docker image prune -f >/dev/null
    echo "✓ Sistema actualizado"
    exit 0
  fi
  sleep 5
done
echo "✗ El api no respondió. Últimas líneas:"
$DC logs --tail 60 api
exit 1
