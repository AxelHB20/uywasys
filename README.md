# UywaSys

Sistema de gestión para veterinarias en Perú: clientes y mascotas, módulo médico, grooming, inventario con lotes (FEFO) y caja con boleta electrónica. Nombre comercial: **Uywa** (en quechua, el animal que se cría y se cuida en casa).

| Parte | Tecnología |
| --- | --- |
| `frontend/` | Angular 22 + Tailwind CSS 4 |
| `backend/` | NestJS 12 + Prisma 7 |
| Base de datos | PostgreSQL 17 (Docker) |

## Requisitos

- Node 24 LTS (incluye npm 11)
- Docker Desktop
- Git

## Primera vez (con Docker: recomendado)

Docker levanta todo: base de datos, backend y frontend. No hace falta `npm start` ni correr migraciones a mano.

```bash
cd backend
copy .env.example .env            # CMD · PowerShell: Copy-Item .env.example .env · Git Bash: cp .env.example .env
cd ..
docker compose up -d --build      # la primera vez tarda unos minutos (instala dependencias)
docker compose logs -f api        # espera "UywaSys API escuchando..." y sal con Ctrl+C
docker compose exec api npx prisma db seed   # solo la primera vez: crea la clínica y el administrador
```

Abre http://localhost:4200 e ingresa con `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD` del `.env`. En el dashboard, el indicador **Sistema en línea** confirma que el frontend, el backend y la base de datos están conectados.

Para que todo arranque solo al prender la PC: en Docker Desktop, **Settings → General → Start Docker Desktop when you sign in**. Los contenedores tienen `restart: unless-stopped`.

**Día a día**

| Situación | Comando |
| --- | --- |
| Ver qué pasa en el backend (errores, arranque) | `docker compose logs -f api` |
| Ver el frontend | `docker compose logs -f web` |
| Llegó un cambio con migración o dependencias nuevas | `docker compose restart api` (o `web` si cambió el frontend) |
| Apagar todo | `docker compose stop` |
| Volver a encender | `docker compose up -d` |

El backend, al arrancar, instala dependencias si cambió `package-lock.json`, aplica las migraciones pendientes (`prisma migrate deploy`) y genera el cliente de Prisma. Los `node_modules` de los contenedores viven en volúmenes de Docker, separados de los de Windows.

### Sin Docker (alternativa)

Si prefieres correr el backend o el frontend directo en Windows, detén antes ese contenedor (`docker compose stop api web`) para que no choquen los puertos:

```bash
docker compose up -d db           # solo la base de datos
cd backend && npm install && npx prisma migrate dev && npm run start:dev
cd frontend && npm install && npm start      # en otra terminal
```

Antes de usarlo con una clínica real, cambia en `.env` el `JWT_SECRET` y la contraseña del administrador.

> Si `npm` avisa de una versión nueva de Prisma marcada como `rc`, no actualices: es una versión de prueba.

## Comandos útiles

| Dónde | Comando | Qué hace |
| --- | --- | --- |
| Docker | `docker compose exec api npm test` | Pruebas unitarias del backend |
| Docker | `docker compose exec api npm run test:e2e` | Pruebas de la API contra la base de datos |
| backend | `npm test` | Pruebas unitarias (sin Docker) |
| backend | `npm run test:e2e` | Pruebas de la API contra la base de datos (requiere Docker arriba) |
| backend | `npm run lint` | Revisión de código |
| backend | `npx prisma migrate dev --name <cambio>` | Crea una migración después de editar `prisma/schema.prisma` |
| backend | `npx prisma studio` | Explorador visual de la base de datos |
| backend | `npx prisma db seed` | Crea el primer administrador (si ya existe, no cambia nada) |
| frontend | `npx ng test` | Pruebas del frontend |
| frontend | `npx ng build` | Compilación de producción |

## Prueba del día completo (navegador)

Recorre en Chrome el día de la clínica: registrar cliente → cola → atención → cobro con vuelto → cierre de caja. Corre sola en GitHub Actions; para correrla en tu PC, con Docker arriba:

```bash
docker compose exec -e E2E_PASSWORD=Pruebas2026clave api node scripts/e2e-clinic.mjs   # una sola vez
cd e2e
npm install
npx playwright install chromium
npx playwright test
```

Corren en una **clínica de pruebas aparte** (`e2e@uywa.pe` / `Pruebas2026clave`, la crea
`scripts/e2e-clinic.mjs`), así la demostración y los datos reales no se llenan de "Cliente E2E"
ni de cobros de prueba. Otra clave: pásala con `E2E_PASSWORD`. Al terminar, `global-teardown`
desactiva lo que crearon. No crees la clínica de pruebas en el servidor de la clínica.

## Producción

Servidor con HTTPS, respaldo diario cifrado y monitoreo: todo está en `deploy/` y la guía paso a paso en [docs/DEPLOY.md](docs/DEPLOY.md). Para probarlo en tu PC: copia `deploy/.env.example` como `deploy/.env` con `DOMAIN=localhost` y corre `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build`.

## Facturación electrónica

Boletas, facturas y notas de crédito por un PSE (Nubefact), con una cola de envío que reintenta sola. Viene en modo **Simulación** para la demo; para conectar el PSE real sigue [docs/FACTURACION.md](docs/FACTURACION.md).

## Reglas del proyecto

- Toda tabla de negocio lleva `clinic_id`: el sistema está preparado para varias clínicas. La clínica sale siempre del usuario logueado (`@CurrentUser()`), nunca de lo que envía el navegador.
- Toda la API exige sesión salvo lo marcado con `@Public()`. Para limitar por rol: `@Roles('ADMIN', 'CASHIER')`.
- Las acciones sensibles (anular, borrar, cambiar precios) se registran con `AuditService`.
- En el frontend, las llamadas HTTP van en archivos `*.service.ts`; los componentes solo manejan la vista.
- Formularios con Reactive Forms y validación también en el backend (DTOs con class-validator).
- Solo Tailwind CSS para estilos; nada de Bootstrap ni librerías de componentes pesadas.
- Cada cambio de base de datos es una migración de Prisma versionada en el repositorio.
