# Imagen de producción del backend (la de desarrollo está en docker/dev.Dockerfile).
# Al arrancar aplica las migraciones pendientes y luego levanta la API.

FROM node:24-slim AS build
# Prisma necesita OpenSSL
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# postinstall genera el cliente de Prisma
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
# En servidores con poca RAM (1 GB + swap) Node necesita permiso para usar más memoria al compilar
ARG BUILD_MEMORY_MB=2048
RUN NODE_OPTIONS=--max-old-space-size=$BUILD_MEMORY_MB npm run build
# Compacta el JS y borra los mapas de código: en el servidor no queda código fuente legible
COPY scripts/minify-dist.mjs ./scripts/minify-dist.mjs
RUN node scripts/minify-dist.mjs

FROM node:24-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    TZ=America/Lima \
    NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
# Se conservan todas las dependencias: el CLI de Prisma aplica las migraciones y tsx corre el seed
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json prisma.config.ts ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node scripts ./scripts
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/main"]
