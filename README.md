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

## Primera vez

```bash
# 1. Base de datos
docker compose up -d

# 2. Backend
cd backend
copy .env.example .env            # CMD · PowerShell: Copy-Item .env.example .env · Git Bash: cp .env.example .env
npm install                       # también genera el cliente de Prisma
npx prisma migrate dev            # crea las tablas
npx prisma db seed                # crea la clínica y el administrador (datos SEED_* del .env)
npm run start:dev                 # API en http://localhost:3000/api

# 3. Frontend (en otra terminal)
cd frontend
npm install
npm start                         # app en http://localhost:4200
```

Ingresa con `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD` del `.env`. En el dashboard, el indicador **Sistema en línea** confirma que el frontend, el backend y la base de datos están conectados.

Antes de usarlo con una clínica real, cambia en `.env` el `JWT_SECRET` y la contraseña del administrador.

> Si `npm` avisa de una versión nueva de Prisma marcada como `rc`, no actualices: es una versión de prueba.

## Comandos útiles

| Dónde | Comando | Qué hace |
| --- | --- | --- |
| backend | `npm test` | Pruebas unitarias |
| backend | `npm run test:e2e` | Pruebas de la API contra la base de datos (requiere Docker arriba) |
| backend | `npm run lint` | Revisión de código |
| backend | `npx prisma migrate dev --name <cambio>` | Crea una migración después de editar `prisma/schema.prisma` |
| backend | `npx prisma studio` | Explorador visual de la base de datos |
| backend | `npx prisma db seed` | Crea el primer administrador (si ya existe, no cambia nada) |
| frontend | `npx ng test` | Pruebas del frontend |
| frontend | `npx ng build` | Compilación de producción |

## Reglas del proyecto

- Toda tabla de negocio lleva `clinic_id`: el sistema está preparado para varias clínicas. La clínica sale siempre del usuario logueado (`@CurrentUser()`), nunca de lo que envía el navegador.
- Toda la API exige sesión salvo lo marcado con `@Public()`. Para limitar por rol: `@Roles('ADMIN', 'CASHIER')`.
- Las acciones sensibles (anular, borrar, cambiar precios) se registran con `AuditService`.
- En el frontend, las llamadas HTTP van en archivos `*.service.ts`; los componentes solo manejan la vista.
- Formularios con Reactive Forms y validación también en el backend (DTOs con class-validator).
- Solo Tailwind CSS para estilos; nada de Bootstrap ni librerías de componentes pesadas.
- Cada cambio de base de datos es una migración de Prisma versionada en el repositorio.
