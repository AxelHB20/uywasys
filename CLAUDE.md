# UywaSys — reglas del proyecto

SaaS de gestión veterinaria para Perú (una clínica piloto; se venderá a varias). Backend NestJS +
Prisma + PostgreSQL 17; frontend Angular (standalone, signals, OnPush) + Tailwind.

## Antes de cualquier cambio: el flujo primero

Leer `docs/FLUJOS.md` y responder, sin preguntar al dueño del proyecto:

1. **¿En qué flujo vive?** (consulta, cita, grooming, presupuesto, mostrador, hospitalización,
   inventario, comprobantes, avisos). Ponerlo **donde la persona ya trabaja ese flujo**, no en una
   pantalla nueva ni en la de otro flujo. Ejemplo: el aviso de una cita va en la agenda, no en
   Vacunas; cargar un presupuesto va dentro de la atención, no abre otra.
2. **¿Quién lo hace?** Rol (admin, veterinario, recepción, caja, groomer) y permisos en backend y
   en la ruta. Caja no ve lo clínico; el groomer solo lo suyo.
3. **¿Qué pasa antes y después?** El cambio no debe romper el paso siguiente: cola → atención →
   caja → comprobante → reportes. Si cambia montos, revisar que cuadren caja, inicio y reportes.
4. **¿Qué pide la ley?** Ley 29733 (datos mínimos, consentimiento, ARCO), SUNAT (boleta con DNI
   desde S/ 700, notas de crédito), DIGEMID (controlados con receta).
5. **¿Cuesta dinero a la clínica?** Preferir lo gratis (WhatsApp con enlace, avisos web,
   calendario) antes que servicios pagados por mensaje.
6. **¿Qué decidió el cliente?** Sin comisiones de grooming, sin firma del dueño en el ingreso de
   grooming, portal sin carnet por defecto (tampoco resultados de exámenes en el portal), sin pedidos
   ni deudas con proveedores (solo la alerta de stock bajo). No volver a agregarlo.
7. **Historia clínica** (atenciones, recetas, consentimientos, adjuntos, exámenes): solo
   veterinario, recepción y administrador (`CLINICAL_ROLES`). Caja cobra desde la cuenta; el groomer
   solo ve atenciones de grooming. Al dueño no se le avisa un resultado sin revisión del veterinario.
8. **Menú:** cada opción va en el grupo de quien la usa (Recepción, Clínica, Grooming, Caja,
   Gestión). Atenciones es solo consultas e internamientos; el grooming vive en su tablero.
   Historias clínicas lista pacientes y abre la ficha existente (no se duplica la ficha). Compras y
   Proveedores son pestañas de Inventario (administrador y veterinario); el costo se guarda sin IGV.

Si la petición choca con el flujo, se dice en una línea y se propone dónde va; no se construye en
el lugar equivocado.

## Cómo se trabaja

- Avanzar sin preguntar; respuestas en español y breves. El dueño hace los commits.
- Solo Tailwind. Llamadas HTTP solo en `*.service.ts`. Reactive Forms con validaciones.
- Cada cambio: pruebas (backend `npx vitest run` y `-c vitest.config.e2e.ts`, frontend
  `npx ng test --watch=false`), prettier, `ng build`. Si toca un flujo de la tabla, correr su
  Playwright (`cd e2e && npx playwright test`).
- El valor de un `rxResource` se lee con `loaded()` (`shared/utils/resource.ts`), no con `value()`:
  si el servidor falla, `value()` lanza y la pantalla queda en blanco. Cada recurso con su aviso y
  Reintentar (`resource.error()`).
- La web debe tolerar un backend un paso atrás (campos nuevos opcionales con valor por defecto):
  así no queda una pantalla en blanco si el backend no se reinició.
- Migraciones nuevas en `backend/prisma/migrations/<fecha>_<nombre>/migration.sql`; el api las
  aplica al arrancar (Docker local y servidor).
- Formularios: `(ngSubmit)` solo funciona con `[formGroup]`. Un `<form>` sin `[formGroup]` usa
  `(submit)="$event.preventDefault(); guardar()"` (si no, el botón Guardar no hace nada).
- Antes de agregar algo nuevo, **planearlo y mostrar el plan** (flujo, roles, qué se construye y qué
  no) y esperar el visto bueno.
- Registrar el avance en `CHANGELOG.md` y `docs/PLAN.md`; si cambia o se agrega un flujo,
  **actualizar `docs/FLUJOS.md` y este archivo** en el mismo cambio.

## Correr y actualizar

- PC (Docker): doble clic en `actualizar-local.bat` → http://localhost:4200.
- Demo Azure: doble clic en `deploy\subir-demo.bat` (respalda, sube, compila y verifica). Subir
  solo cuando el dueño lo pida.
- Login demo: admin@huellitas.pe / Demo2026clave. Refrescar demo: `DEMO_REFRESH=1 node scripts/demo-data.mjs`.
