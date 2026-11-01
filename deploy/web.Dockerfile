# Frontend compilado servido por Caddy, que además da HTTPS automático y lleva /api al backend.
# Se construye desde la raíz del repositorio:  docker compose -f deploy/docker-compose.yml build

FROM node:24-slim AS build
WORKDIR /app
ENV NG_CLI_ANALYTICS=false NPM_CONFIG_UPDATE_NOTIFIER=false
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM caddy:2.10-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist/frontend/browser /srv
