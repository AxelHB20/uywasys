# Pendientes y observaciones (10 nov 2026)

## 0. Inicio por rol (revisión del 25 nov) · en espera

Propuesta en el lienzo "Uywa · propuestas", página **Inicio** (tableros I1–I4 y R1–R5). **Esperando la
respuesta de Mitchel** antes de construir.

**Gomez Medic trabaja así:** Mitchel es el dueño **y el médico** (administrador); hay **2 practicantes**
y **otra persona hace el grooming**. No hay cajero ni otro veterinario.

**Preguntar a Mitchel:** ¿qué harán los practicantes? ¿Reciben clientes, cola y citas? ¿Cobran y
emiten boletas? ¿Ayudan en consultas (peso, vacunas)? ¿Pueden ver lo cobrado en el día?

**Decidido:**
- Solo se arma el Inicio de los roles que usa Gomez Medic: **Mitchel** (R1), **practicantes**
  (con el de Recepción, R3, hasta que responda) y **Grooming** (R5). Caja (R4) y Veterinario (R2)
  quedan diseñados para otras clínicas, sin construir.
- Montos (regla: cada uno ve lo que necesita para su trabajo): cobrado del mes y Reportes solo el
  administrador (acordado); cobrado hoy también recepción; **te deben** con monto para el
  administrador y "N clientes por cobrar" sin total para recepción; grooming sin montos.

**Cambios propuestos:**
1. "Clientes 265" → **Te deben** (S/ y clientes, lleva a Caja → Por cobrar).
2. Contraste de la próxima cita (fila resaltada): texto a 4.5:1 (falla de axe).
3. "En atención hace 6 h" → etiqueta ámbar "Abierta hace 6 h" si pasa de 2 h.
4. Refuerzos: en Inicio solo los **vencidos de los últimos 30 días** (el total sigue en Refuerzos).
5. Mitchel: su cola se llama **"Te toca atender"** (es el médico), con alergias a la vista.
6. Administrador sin "Clientes recientes"; en su lugar, resumen de **Grooming de hoy**.
7. Grooming: su tablero del día (por recibir, en proceso, listos, entregados) y WhatsApp para
   los listos; sin la cola clínica (motivos de consulta).
8. Error: el saludo toma "Dra." como nombre → se saltan Dr., Dra., Lic., Mg.
9. Celular: etiquetas cortas ("ATENDIDOS", "EN CLÍNICA") a la misma altura; tablet: los 3 botones
   del saludo debajo del título.

Todo lo observado en la revisión del sistema, de la competencia, de Atenciones y de las pruebas.
Antes de hacer cualquier punto: plan → visto bueno → construir (ver `CLAUDE.md`).

## 1. Funciones que faltan frente a la competencia

| # | Función | Quién la tiene | Prioridad | Notas |
|---|---|---|---|---|
| 1.1 | **Reserva de citas en línea** | AgendaPro, Okvet, QVET | 🔴 Alta | Gratis. Enlace/QR → servicio → hora libre → nombre, celular y mascota → "por confirmar" en la agenda → recepción confirma por WhatsApp. Anti-spam: Cloudflare Turnstile (gratis), máx. 2 pendientes por celular, límite por conexión, tope diario, vencen si no se confirman, bloquear número, botón para apagarlo, celular peruano válido |
| 1.2 | Abono para separar la hora | AgendaPro (con pasarela) | Opcional | **Consultar al cliente**: ¿cobra abono?, ¿cuánto?, ¿en qué servicios? (lo común: grooming y cirugías), ¿se devuelve si no viene? Hacerlo opcional por servicio en Configuración, por Yape manual (sin comisión) |
| 1.3 | ✅ Proveedores y compras (12 nov) | QVET, LOLVET | Hecho | Proveedores, recibir la ficha de compra con lote y vencimiento, historial, anular, Excel del contador. El cliente decidió **sin pedidos ni cuentas por pagar** en el sistema (solo la alerta de stock bajo) |
| 1.4 | Planes de salud | QVET, LOLVET | 🟠 Media | Plan cachorro, vacunas del año pagadas por adelantado: ingreso fijo para la clínica |
| 1.5 | Firma a distancia del consentimiento | Okvet | 🟠 Media | Enlace por WhatsApp para firmar desde el celular |
| 1.6 | Correo masivo y fidelización | QVET, LOLVET | 🟡 Baja | Promociones, puntos |
| 1.7 | Pagos en línea | AgendaPro, LOLVET | 🟡 Baja | En Perú se usa Yape |
| 1.8 | Videoconsulta | Okvet, QVET, AgendaPro, LOLVET | 🟡 Baja | Poco usado en Perú |
| 1.9 | Varias sedes | AgendaPro, LOLVET | 🟡 Baja | Solo clínicas grandes |
| 1.10 | Funciones con IA (resumen de la consulta) | QVET | 🟡 Baja | Llama la atención en una demo |
| 1.11 | Exámenes: valores con rango normal y gráficos | — | 🟡 Baja | Cuando la clínica use el módulo |
| 1.12 | WhatsApp automático (API de Meta) | Todos | Opcional pagado | ≈ S/ 0.10 por mensaje (oct 2026); clínica pequeña S/ 15–30/mes. Se descartó por ahora |

**Para venderlo como SaaS:** alta de clínica nueva con prueba gratis y cobro de la suscripción;
gastos de la clínica y ganancia real (alquiler, sueldos frente a lo vendido).

**Atenciones (✅ 10 nov):** primera tanda 2.1–2.7, 2.9–2.11; segunda tanda 2.8, 2.13, 2.14 y 2.22–2.24 (2.12 descartado); tercera tanda 2.15–2.21. Atenciones completo (2.18: aves y reptiles sin rango). Datos de prueba (3.3): solo están en la base
de pruebas de Claude, no en tu Docker ni en Azure; desde ahora Playwright no se corre sobre la demo.

**Ya hecho hoy:** recordatorios gratis (avisos al celular, calendario, WhatsApp marcado), exámenes
de laboratorio, historia clínica protegida por rol, grooming rediseñado.

## 2. Atenciones (diseño y uso)

### Lista
| # | Observación | Gravedad | Mejora |
|---|---|---|---|
| 2.1 | ✅ Mezcla consultas y grooming | 🔴 | Pestañas Consultas / Grooming (por defecto Consultas) |
| 2.2 | ✅ Atenciones abiertas hace días, marcadas solo con color | 🔴 | Etiqueta "Abierta hace 2 días" y aviso en Inicio (es plata sin cobrar) |
| 2.3 | ✅ Lo primero que se ve es el monto | 🟡 | Mascota + motivo/diagnóstico primero; monto en segundo plano |
| 2.4 | ✅ Sin buscador ni filtros | 🟡 | Buscar por mascota o dueño; filtros de veterinario y fecha |
| 2.5 | ✅ Lista plana | 🟡 | Agrupar por Hoy / Ayer / fecha; mostrar "por cobrar / pagada" |
| 2.6 | ✅ Filtros "Abiertas/Todas" como botones sueltos | 🟢 | Las mismas pestañas que Vacunas, Exámenes y Grooming |
| 2.7 | ✅ Todas las etiquetas iguales ("En atención") | 🟢 | Color por estado |

### Dentro de la atención
| # | Observación | Gravedad | Mejora |
|---|---|---|---|
| 2.8 | ✅ Botón Guardar del SOAP al final y apagado | 🔴 | Guardado automático con "Guardado hace 5 s" |
| 2.9 | ✅ Panel derecho casi vacío; el veterinario no ve el contexto | 🔴 | Alergias, agresivo, peso anterior (sube/baja), última atención y diagnóstico, vacunas vencidas |
| 2.10 | ✅ Signos vitales sin aviso de valores fuera de rango | 🟡 | Ámbar/rojo según la especie |
| 2.11 | ✅ "Cancelar" junto a "Cerrar atención" | 🟡 | Menú "⋯", en rojo y con confirmación |
| 2.12 | ✖ Descartado (la barra flotante tapaba el formulario) · Página muy larga | 🟡 | Menú de secciones fijo |
| 2.13 | ✅ Cerrar sin revisión | 🟡 | Resumen previo: exámenes pendientes, cargos por cobrar, diagnóstico vacío |
| 2.14 | ✅ Nada para entregar al dueño | 🟡 | "Indicaciones para el dueño" (diagnóstico, tratamiento, próximo control) para imprimir o WhatsApp |
| 2.15 | ✅ Diagnóstico en texto libre | 🟡 | Sugerir los diagnósticos frecuentes (reportes ordenados) |
| 2.16 | ✅ El peso no se ve en el tiempo | 🟢 | Curva de peso en la ficha |
| 2.17 | ✅ Sin historia completa imprimible | 🟢 | PDF de todas las atenciones (para derivar) |
| 2.18 | ✅ Rangos y condición corporal iguales para todas las especies | 🟢 | Por especie (perro, gato, exóticos) |
| 2.19 | ✅ "Por cobrar" repetido en cada cargo | 🟢 | Una vez junto al total |
| 2.20 | ✅ Exámenes llama más la atención que el diagnóstico | 🟢 | Bajar el peso visual de las barras |
| 2.21 | ✅ Archivos: un PDF en una caja grande vacía | 🟢 | Tarjetas compactas en fila |

### Accesibilidad
- 2.22 ✅ Pasos pendientes y algunas fechas en gris claro (slate-400): pasar a slate-500/600 (contraste 4.5:1).
- 2.23 ✅ Papeleras de los cargos con área de toque chica: mínimo 44 px.
- 2.24 ✅ Fechas de pasos y etiquetas en 11 px: mínimo 12 px.

## 3. Pruebas (huecos encontrados)

| # | Hueco | Qué hacer |
|---|---|---|
| 3.1 | 3 formularios no guardaban y ninguna prueba lo vio (ya corregidos) | Prueba "Guardar envía los datos" en cada formulario + control que falle si un `<form>` usa `ngSubmit` sin `formGroup` |
| 3.2 | Vacunas quedó en blanco con el backend viejo | Probar pantallas con respuestas sin los campos nuevos. Hecho para errores del servidor: `server-errors.spec.ts` (10 pantallas con 500) |
| 3.3 | Playwright deja datos de prueba en la demo ("Peluchin562680", "Baño E2E") | Correrlo en una clínica de pruebas aparte y limpiar al terminar; borrar los que ya están en la base local |
| 3.4 | Flujos sin recorrido completo en el navegador | Presupuesto → cola → atención; venta de mostrador; hospitalización hasta el alta; exámenes; reserva en línea |
| 3.5 | El recorrido de 47 pantallas por rol se corrió a mano | Volverlo prueba fija (errores 4xx/5xx, pantallas en blanco, desborde en celular) |
| 3.6 | Avisos al celular no probados en un teléfono real | Prueba manual en Android cada vez que se toquen |

**Metas:** todo endpoint nuevo con prueba de permisos; todo formulario con prueba de guardado; todo
flujo de `docs/FLUJOS.md` con su recorrido en Playwright; antes de subir al servidor, las 4 suites +
el recorrido de pantallas.

## 4. Revisar con la clínica
- ¿Abono en reservas en línea? (1.2)
- ¿Tiene equipos de laboratorio propios o manda todo afuera? (para el costo y la ganancia de cada examen)
- Qué le faltó cuando probó el sistema.

## 5. Orden recomendado
1. Huecos de pruebas 3.1, 3.2, 3.3 y 3.5.
2. ✅ Atenciones, primera tanda: 2.1–2.7, 2.9, 2.10, 2.11.
3. ✅ Atenciones, segunda tanda: 2.8, 2.12, 2.13, 2.14 y accesibilidad.
4. Reserva de citas en línea (1.1), con la respuesta del cliente sobre el abono.
5. Planes de salud (1.4). ✅ Proveedores y compras (1.3).
