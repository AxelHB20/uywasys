# Cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Cada fase cerrada lleva su etiqueta de versión (`git tag v0.3.0`) para poder volver a ella.

## [0.6.0] — 2026-11-01 · Fase 6: grooming

Un día completo del área de baño se maneja solo con el tablero: ingreso con checklist, avance por estados, aviso por WhatsApp, entrega, cobro, constancia y comisiones.

### Agregado (paso 1: ingreso y tablero)
- **Precios por tamaño** (pequeño, mediano, grande, gigante) en los servicios de "Baño y grooming"; si falta un tamaño rige el precio base. El cargo dice el tamaño: "Baño completo (mediano)".
- **Ingreso a grooming** en menos de un minuto: tamaño sugerido por el peso o por la última visita, servicios con su precio, checklist de cómo llega (pulgas, garrapatas, nudos, agresivo, piel, pertenencias), lo que pide el dueño ("como la última vez"), groomer, hora de recojo, movilidad (recojo y entrega a domicilio) y firma opcional del dueño. El checklist no se edita después.
- **Tablero** En espera → Baño → Corte → Listo: se arrastra en escritorio y se avanza con un botón en el celular; se pueden saltar pasos y volver uno atrás. Muestra el tiempo en cada paso, la hora de recojo (en rojo si se pasó), los avisos del checklist y las alergias. Se actualiza solo cada 30 segundos.
- **Aviso por WhatsApp** cuando está listo, con el total por pagar (enlace `wa.me`, sin costo), y marca de "avisado".
- **Entrega** al dueño, a una persona autorizada o a otra persona con su DNI: cierra la atención y, si queda saldo, lleva a caja a cobrar. **Cancelar** (recepción o administrador) quita los cargos y queda en la bitácora.
- La atención de un grooming se maneja desde el tablero: no se cierra a mano, y lo que se le agregue toma el precio de su tamaño.
- Menú **Grooming** para todos los roles; el groomer ingresa, mueve y entrega, y al empezar un baño sin groomer asignado se lo queda.

### Agregado (paso 2: constancia e integraciones)
- **Constancia de grooming** imprimible (A5): cómo llegó la mascota (pulgas, garrapatas, nudos, agresividad, piel, pertenencias), lo que pidió el dueño, servicios con total, firma al dejarla y quién la recogió.
- En la **cola**, una entrada de grooming muestra "Ingreso" y lleva al ingreso con la mascota ya elegida; una **cita de grooming** que llega va directo a su ingreso.
- La **historia clínica** muestra los grooming de la mascota con enlace a su constancia, y tiene botón **Grooming** para ingresarla.
- El **inicio** muestra el grooming del día: en el tablero, listos para entregar y entregados.

### Agregado (paso 3: comisiones)
- **Comisión por groomer** en Usuarios (porcentaje sobre lo cobrado de sus servicios). Se congela al entregar cada servicio: cambiarla después no altera lo ya ganado.
- **Reporte de comisiones** (menú Grooming → Comisiones): esta semana, la pasada, este mes, el pasado o fechas libres; totales, resumen por groomer, detalle por servicio con enlace a la constancia, y **Excel** con resumen y detalle. Lo que falta cobrar aparece aparte y comisiona cuando se cobra; los productos no comisionan. Avisa qué groomer no tiene su porcentaje configurado.
- El groomer entra a **Mis comisiones** y ve solo lo suyo.

### Pruebas
- **Día de grooming en el navegador** (Playwright, también en GitHub Actions): recepción ingresa a la mascota con su checklist y precio por tamaño; un groomer nuevo entra por primera vez y la avanza hasta "Listo" (con el aviso de WhatsApp y el total); recepción la entrega, cobra con vuelto, la constancia guarda cómo llegó y quién la recogió, y el groomer ve su comisión.

### Agregado (demostración)
- **Datos de demostración con historia:** 35 días de atenciones con SOAP, vacunas, recetas, cobros con boletas y facturas simuladas, cierres de caja, compras, citas, grooming y bitácora, todo creado por la API (mismas reglas que el uso real) y llevado a su fecha. Hoy queda la clínica funcionando: cola, consultorio, tablero de grooming, una cirugía con presupuesto y consentimiento firmado, una radiografía adjunta y citas de la semana.
- Si la clínica ya tiene datos, la demo se crea en una clínica aparte (`admin@huellitas.pe`) y nunca se mezcla; `DEMO_RESET=1` la vuelve a crear.

## [0.5.0] — 2026-10-29 · Fase 5: módulo médico

Una consulta completa, de la cita a la receta y al cobro, sin salir del sistema.

### Agregado (paso 1: consulta SOAP y vacunas)
- **Consulta con método SOAP** en la atención: anamnesis (S); examen físico con peso, temperatura, FC, FR, TLLC, mucosas, hidratación, condición corporal 1-9 y hallazgos (O); diagnóstico presuntivo o definitivo (A); plan y tratamiento (P). En grooming se mantiene la vista simple de signos y notas.
- **Carnet de vacunas y desparasitaciones**: se aplican desde la atención abierta (fecha de hoy, quién aplicó con su colegiatura, laboratorio y lote) o se anotan como antecedente de otra clínica. Atajos para el próximo refuerzo (21 días a 1 año). No se borran: se anulan con motivo y quedan en la bitácora.
- **Historia clínica de la mascota** (`/mascotas/:id`): atenciones con su diagnóstico, carnet con el estado de cada refuerzo (al día, pronto, vencida) y enlace desde la ficha del cliente.
- **Carnet imprimible** en A5 con los datos de la clínica, la mascota y el propietario, y la próxima cita.
- Pantalla **Vacunas**: refuerzos próximos (7 a 60 días) y vencidos, con aviso por WhatsApp listo para revisar y enviar (enlace `wa.me`, sin costo).
- Los datos de demostración traen consultas SOAP completas y carnets con refuerzos próximos y vencidos.

### Agregado (paso 2: recetas)
- **Recetas médicas veterinarias** desde la atención, numeradas por clínica (RX-00001): medicamentos del inventario o escritos a mano, con dosis, vía, frecuencia, duración e indicaciones.
- Lo que **se entrega en la clínica** se carga a la cuenta y baja del stock por FEFO en la misma transacción; los **controlados** llevan el número de la receta como receta retenida.
- Solo emite un veterinario (o administrador) con **N.º de colegiatura (CMVP)** registrado. Anular pide motivo y que antes se quite lo entregado.
- **Receta imprimible** en A5 con datos de la clínica, paciente, alergias, propietario y firma con colegiatura.

### Agregado (paso 3: agenda de citas)
- **Citas** con vista del día por veterinario (y "Sin asignar"), línea de la hora actual y clic en un espacio libre para agendar a esa hora. En celular, lista por hora.
- Estados: por confirmar, confirmada, **llegó** (pasa sola a la cola de hoy), no vino y cancelada con motivo. Reprogramar devuelve la cita a "por confirmar".
- Evita cruces: la misma mascota nunca tiene dos citas a la vez; si el veterinario ya está ocupado, avisa y permite agendar como sobrecupo.
- Recordatorio de la cita por **WhatsApp** y botón **Agendar** desde los refuerzos de vacunas y desde la historia clínica.

### Agregado (paso 4: presupuestos)
- **Presupuestos** (PR-00001) con servicios y productos del catálogo, descuento por línea (con el mismo tope que la caja), vigencia de 7, 15 o 30 días y notas para el dueño.
- **Documento A4** con op. gravada, IGV, total, firma del veterinario y conformidad del propietario; envío por **WhatsApp** con el detalle.
- Estados: por responder, aceptado, no aceptado, vencido y **cargado**. Aceptado, se carga a la atención abierta de la mascota (o abre una) **con el precio presupuestado**: si el catálogo subió, la diferencia entra como descuento "Presupuesto PR-…". Los que llevan controlados piden el N.º de receta.
- La atención avisa si la mascota tiene un presupuesto aceptado por cargar; botón **Presupuesto** en la historia clínica.

### Agregado (paso 5: archivos y consentimientos)
- **Archivos en la historia clínica:** fotos, análisis y radiografías (JPG, PNG, WebP o PDF de hasta 10 MB) desde la historia o desde la atención, con miniaturas y visor. Se revisa que el contenido sea de verdad una imagen o un PDF. No se borran: se anulan con motivo.
- **Consentimientos informados firmados en pantalla** (CI-00001): cirugía, anestesia o sedación, hospitalización, eutanasia u otro. El texto sale de un modelo con los datos del paciente y el veterinario puede ajustarlo; firma el propietario o una persona autorizada, con el dedo o el mouse.
- Documento A4 imprimible con la firma, la fecha y hora y la **huella SHA-256** del contenido. Solo el veterinario o el administrador los toman; se anulan con motivo, nunca se editan.
- La bitácora muestra citas, presupuestos, archivos y consentimientos.

### Pruebas
- **Consulta completa en el navegador** (Playwright, también en GitHub Actions): recepción agenda la cita y marca la llegada; una veterinaria nueva entra por primera vez, cambia su clave, atiende con SOAP, aplica una vacuna, emite la receta, toma el consentimiento firmado y cierra; recepción cobra y la historia clínica queda completa. Las pruebas de punta a punta corren una tras otra porque comparten la caja del día.

### Corregido
- Una cita nueva para hoy propone el próximo horario del reloj en vez de las 9:00, que después de esa hora se rechazaba por quedar en el pasado.
- La firma no se pierde si cambia el ancho de la pantalla (al girar la tablet o aparecer la barra de desplazamiento).
- Guardar una mascota desde la ficha del cliente y los formularios de anular (vacuna, receta) y cancelar cita no respondían al botón.
- La edad de la mascota en la atención salía un año más cuando la fecha venía con hora.
- La prueba de punta a punta elige la nota de venta cuando la clínica tiene comprobantes activos.

## [0.4.0] — 2026-10-28 · Fase 4: comprobantes electrónicos (listos para conectar el PSE)

### Agregado
- **Boleta, factura y nota de crédito electrónicas** desde la caja y la venta de mostrador. El comprobante se numera en la misma transacción del cobro (series por clínica, sin huecos). Factura solo con RUC; boleta desde S/ 700 con documento del cliente; "clientes varios" debajo de ese monto.
- **Cola de envío a SUNAT** que no frena la caja: envía en segundo plano, reintenta sola (1 min a 12 h), consulta las boletas que esperan el resumen diario y deja "Reintentar" para el administrador. Una nota de crédito nunca sale antes que su comprobante.
- **Anular un cobro** con boleta o factura emite su nota de crédito (BC01/FC01).
- **Proveedores intercambiables:** Simulación (para la demo, sin valor tributario) y Nubefact (API JSON). El token del PSE se guarda cifrado con AES-256-GCM y nunca vuelve al navegador.
- **Representación impresa** en el ticket: razón social, RUC, cliente, importe en letras, QR de SUNAT y resumen (hash). En pagos a cuenta, el comprobante muestra solo lo pagado.
- Pantalla **Comprobantes** (estado ante SUNAT, motivo de cada problema, PDF del PSE, reintentos) y **Excel del registro de ventas** para el contador; configuración en **Comprobantes → Configurar**; aviso en la campana si algo se rechaza o no sale.
- Los datos de demostración emiten boletas en simulación. Guía `docs/FACTURACION.md` con los pasos para conectar Nubefact y los casos a probar.

## [0.3.6] — 2026-10-28 · Hito de demo: listo para un servidor

### Agregado
- **Producción con Docker Compose** (`deploy/`): imagen de la API que aplica las migraciones al arrancar; Caddy sirve la app con HTTPS automático, cabeceras de seguridad, compresión y caché; la base y la API no quedan expuestas a internet; logs con rotación.
- **Respaldo diario cifrado** (03:15): `pg_dump` cifrado con age (la clave privada nunca está en el servidor), copia fuera del servidor con rclone, 30 días de retención, prueba de restauración (`verify.sh`) y restauración ante desastres con confirmación (`restore.sh`).
- **Datos de demostración** (`scripts/demo-data.mjs`): un día completo de clínica cargado por la API (equipo, catálogo con stock, clientes, cola, atenciones, caja). Solo corre sobre una clínica vacía.
- **Horario de atención** en Configuración; sale al pie del ticket.
- Guía de despliegue paso a paso (`docs/DEPLOY.md`) y job de CI `produccion` que construye las imágenes, levanta todo con HTTPS, carga la demo y prueba el respaldo.

## [0.3.5] — 2026-10-28 · Fase 3.5: Pulido profesional

Revisión de todo lo hecho antes de mostrarlo a una clínica.

### Corregido
- El logo de la clínica se ve completo en el menú y en Configuración, sea cuadrado u horizontal.
- Un solo formato de fecha y hora en todo el sistema (28/10/2026 · 13:39, hora de Lima).
- Las pantallas de módulos por venir dicen "Próximamente", sin números de fase internos.
- Una dirección que no existe muestra "Esta página no existe" en vez de mandar al inicio sin aviso.
- Textos sueltos ("Ver cuenta del cliente").

### Agregado
- **Actividad:** el administrador ve la bitácora con filtros por área, persona y fechas; lo que conviene revisar (anulaciones, ajustes de stock, cambios de precio, accesos fallidos) va marcado.
- **Alertas en la campana** y panel de **insumos usados sin stock** en Inventario para regularizarlos.
- **Derechos ARCO** en la ficha del cliente (solo administrador): descargar todos sus datos y borrar sus datos personales con motivo y confirmación, conservando atenciones y cobros sin ellos.
- **Consentimiento versión 2**: informa que la clínica es la responsable, que el sistema y la facturación son encargados suyos y que los servidores pueden estar fuera del Perú.
- Páginas públicas de **Términos del servicio** y **Política de privacidad**, enlazadas desde el login, y borradores en `docs/legal/` (guía para el abogado y contrato de encargo de tratamiento).

### Seguridad
- Límite de intentos de login por conexión, además del bloqueo por cuenta, y límite general de peticiones.
- Al cambiar o restablecer una contraseña se cierran las sesiones abiertas en otros equipos.
- Cada error inesperado muestra un código de referencia que también queda en los registros del servidor.
- Variables nuevas: `API_RATE_LIMIT`, `LOGIN_RATE_LIMIT`, `TRUST_PROXY`.

## [0.3.0] — 2026-10-28 · Fase 3: Atención y cobro

El circuito completo de la clínica: llega → espera → se atiende → se cobra → queda en el historial.

### Agregado
- **Atenciones:** "Atender" desde la cola o la ficha; alertas de la mascota (agresiva, alergias), motivo, peso (actualiza la ficha), temperatura y notas. Cerrada, solo admite adendas con autor y fecha. Lista de atenciones abiertas (también de días anteriores) y recientes.
- **Cargos:** servicios del catálogo y productos por presentación, con precio e IGV congelados. Los insumos se descuentan por FEFO al registrar; si falta un insumo, el servicio se cobra igual y queda una alerta para el administrador. Controlados con receta y veterinario colegiado. Descuentos con motivo y tope por clínica (10 % por defecto). Quitar un cargo devuelve el stock a su mismo lote.
- **Caja:** apertura con monto inicial, "por cobrar", cobro con varios medios (efectivo con vuelto, Yape/Plin/transferencia con código, tarjeta), pagos parciales, venta de mostrador a "Cliente varios", egresos de caja chica, anulación de cobros con devolución y cierre con arqueo (diferencia con motivo en la bitácora).
- **Ticket** imprimible en 80 mm (nota de venta interna `NV-000001`, numerada por clínica).
- **Cuenta del cliente** en la ficha: lo que debe, sus cobros y su historial de atenciones.
- **Dashboard:** ventas del día para quien maneja la caja. Reporte de ventas por día y medio de pago (administrador).
- **Correlativos por clínica** (`C-00012`, `HC-00045`, `NV-000001`) y búsqueda por código.
- **Entorno de desarrollo en Docker:** base de datos, API y app con `docker compose up -d`; las migraciones se aplican solas.
- **Prueba de punta a punta** (Playwright) del día completo, en GitHub Actions.

### Seguridad
- Pruebas de aislamiento entre clínicas en inventario, servicios, atenciones, cargos y caja.
- Cobros sin duplicados (clave por cobro), bloqueo de filas en caja, cargos y stock.

## [0.2.0] — 2026-10-28 · Fase 2: Inventario farmacéutico
- Productos con presentaciones, lotes y vencimientos; FEFO, kardex, compras con proveedor, mermas, conteo físico, semáforo de vencimientos, libro de controlados, catálogo de servicios con insumos e importación desde Excel.

## [0.1.0] — 2026-10-27 · Fases 0 y 1: Cimientos, clientes y mascotas
- Login con roles, usuarios, datos de la clínica y bitácora.
- Clientes con DNI/RUC y consentimiento (Ley 29733), mascotas, personas autorizadas, cola del día con urgencias, importación desde Excel y dashboard.
