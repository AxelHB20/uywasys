# Imagen de desarrollo para el backend y el frontend (no es la de producción).
# El código no se copia: se monta desde tu carpeta, así cada cambio se ve al instante.
FROM node:24-slim

# Prisma necesita OpenSSL para aplicar migraciones
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NG_CLI_ANALYTICS=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    TZ=America/Lima

WORKDIR /app
