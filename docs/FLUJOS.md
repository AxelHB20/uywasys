# Flujos del sistema y revisión (actualizado 19 nov 2026)

Mapa de qué hace cada persona y por dónde pasa la información. Sirve para revisar un cambio antes
de hacerlo: si toca un flujo, se prueba el flujo completo, no solo la pantalla.

## Los flujos

| Flujo | Recorrido | Quién | Prueba de punta a punta |
|---|---|---|---|
| Día de consulta | Cliente y mascota → **cola** → atención (SOAP, cargos) → cerrar → **caja** cobra → boleta/factura → cierre de caja con reporte | Recepción, veterinario, caja | `e2e/dia-completo` |
| Caja del día | **Abrir** (inicial; "igual que la última vez") → cobrar (efectivo con recibido obligatorio, Yape/Plin/tarjeta, pago dividido) → **egresos** (nunca más que el efectivo del cajón; "Retiro del dueño") → **cerrar** (contar por billetes y monedas, revisar apps, motivo si hay diferencia) → **reporte de cierre** 80 mm/PDF con firmas. Caja de otro día: aviso para cerrarla | Caja, recepción, admin | backend `cash.e2e`, frontend `cash.page.spec`, `closing.page.spec` |
| Consulta con cita | **Agenda** → "Llegó" (pasa a la cola) → SOAP → vacuna → receta → consentimiento → cobro | Recepción, veterinario | `e2e/consulta-completa` |
| Grooming | **Nuevo ingreso** (checklist, recojo y precio de movilidad) → tablero En espera → Baño → Corte → Listo → aviso WhatsApp → entregar → caja | Recepción, groomer | `e2e/grooming-dia` |
| Presupuesto | Crear → el dueño acepta → **mandar a la cola** → el veterinario lo carga dentro de la atención → caja | Recepción, veterinario | backend `estimates.e2e` |
| Venta de mostrador | Caja → "Venta de mostrador" → cliente varios o registrado → cobro (boleta con DNI si supera S/ 700) | Caja | backend `cash.e2e` |
| Exámenes | En la atención: **Pedir examen** (uno o varios, en la clínica o laboratorio externo) → cargo a la cuenta → muestra → resultado (PDF/foto y/o valores, lo sube recepción; en celular "Tomar foto") → **el veterinario revisa e interpreta** (ve especie, raza, edad y peso) → recién ahí "Avisar al dueño" por WhatsApp. Más de 3 días sin resultado: demorado en Exámenes e Inicio. En Exámenes: agrupados por mascota y atención, un botón por fila (el siguiente paso), buscador y lugar. **Cancelar** (médico o admin, antes del resultado): sin pagar se quita de la cuenta; ya pagado el cobro se queda (devolución con nota de crédito) | Veterinario pide, revisa y cancela; recepción toma muestra, sube y avisa | backend `lab-orders.e2e`, frontend `lab-orders.component.spec`, `lab-orders.page.spec` |
| Hospitalización | Internar → indicaciones y registros por turno → alta → cargos a caja | Veterinario | backend `hospitalization.e2e` |
| Carga inicial del inventario | Inventario → **Importar Excel**: plantilla → subir → revisar (errores en rojo, avisos en ámbar) → importar. Varios lotes por producto; nunca sobrescribe; repetir no duplica | Admin | backend `product-import.e2e`, `product-rows.spec` |
| Inventario | **Recibir compra** (ficha del proveedor: varias líneas con lote, vencimiento y costo sin IGV) → salidas por FEFO desde cargos/recetas → conteo y ajuste (solo admin); alerta de stock bajo | Admin, veterinario | `e2e/compra-completa`, backend `inventory.e2e`, `purchases.e2e` |
| Comprobantes | Cobro → cola de envío a SUNAT con reintentos → nota de crédito al anular (administrador, desde el ticket; en Comprobantes ⋯ "Anular cobro…"). **Rechazado** por SUNAT: "Corregir" emite otro del mismo tipo con DNI/RUC/nombre corregido (sin nota de crédito, sin tocar caja) y deja de ser problema. **Cambiar a factura** (⋯): solo dentro del mes de la boleta | Caja, admin | backend `billing.e2e`, frontend `documents.page.spec` |
| Facturación vigilada | Revisión sola de la conexión con el PSE (00, 06, 12 y 18 h) y en cada envío → si el token no sirve o el servicio está cortado: **banner rojo** + un aviso → se sigue cobrando (los comprobantes esperan en cola) → el dueño pega el token / paga → **se reenvían solos**. Sin aceptar pasado un día → aviso al admin | Sistema; admin actúa; caja se entera | backend `billing.e2e` (salud de la conexión), `billing-health.checker.spec` |
| Avisos del sistema | Campana (pendientes de siempre + lo de hoy, por rol) y **banners** arriba de todas las pantallas mientras dure un problema (ver "Quién ve qué aviso") | Todos, según el rol | frontend `system-banners.component.spec`, backend `billing.e2e` |
| Avisos al dueño | Vacunas (lista de refuerzos) y Agenda (cita) → WhatsApp marcado; portal del dueño → avisos al celular y calendario | Recepción, dueño | backend `reminders.e2e`, `portal.e2e` |
| Números | Un cobro aparece igual en caja, inicio y reportes; anularlo lo saca de todos | Admin | `e2e/numeros-cuadran` |

## Quién ve qué aviso

| Aviso | Dónde | Soporte técnico | Dueño (administrador) | Caja y recepción | Veterinario | Groomer |
|---|---|---|---|---|---|---|
| Facturación detenida (token o servicio cortado) | Banner rojo, no se oculta + campana | Sí, con "Actualizar token" | Sí, con "Ver comprobantes": "sigue cobrando, avisa a soporte técnico" (sin hablar de tokens) | Sí, sin botón: "avisa al administrador" | No | No |
| Token de Mifact con 5 meses, cupo del mes, vencimientos (plan, dominio, servidor) | Banner ámbar o rojo | Sí | No | No | No | No |
| Sin conexión con el PSE (3 revisiones sin respuesta) | Banner ámbar, se oculta hasta mañana | Sí | Sí | Sí | No | No |
| Comprobantes con problemas (rechazados o detenidos) | Contador de la campana | Sí | Sí | Sí | No | No |
| Comprobante sin aceptar hace más de un día | Contador de la campana | Sí | No | No | No |
| Comprobante rechazado por SUNAT o con datos mal | Campana (lo de hoy) | Sí | No | No | No |
| Cambio en la configuración de facturación o del token | Campana | Sí | No | No | No |
| Caja abierta desde otro día | Contador + aviso en Caja | Sí | Sí | No | No |
| Urgencias, dosis atrasadas, exámenes por revisar | Contador de la campana | Según su trabajo | Según su trabajo | Sí | — |

Los banners salen en un solo lugar, arriba del contenido: el más grave primero y "+N avisos" para
el resto. Rojo = algo que impide trabajar bien hasta resolverlo; ámbar = conviene saberlo. Nunca
salen en simulación (demo).

**Movimiento de los avisos:** solo `transform` y `opacity`, una vez y corto (entrada 170–220 ms,
salida 110–130 ms; clases `panel-*`, `banner-*`, `bell-ring` en `styles.css`). Nada en bucle, sin
librerías y sin desenfoque en barras que se desplazan. Con "reducir movimiento" todo es un fundido.

## Revisión del 10 de noviembre

- **Pruebas:** backend 119 unitarias y 160 de integración, frontend 183, Playwright 4 recorridos
  completos. Todo en verde.
- **Recorrido de pantallas:** 47 rutas con 6 combinaciones de rol y equipo (administrador en
  escritorio y celular; veterinario, recepción, caja y groomer en escritorio). Sin errores de la
  API (4xx/5xx), sin errores de JavaScript, sin pantallas vacías y sin desborde horizontal en el
  celular. Las rutas sin permiso devuelven al inicio, como corresponde.
- **Datos:** cada boleta cuadra con sus pagos, ningún lote con stock negativo y ningún presupuesto
  convertido sin atención.

### Lo que falló hoy y cómo se evita

| Qué pasó | Causa | Ahora |
|---|---|---|
| Vacunas en blanco | La web nueva con el backend viejo (no se reinició) | `actualizar-local.bat` reinicia el backend y espera a que responda; la pantalla ya no se rompe si falta un dato |
| Puerto 3000 ocupado | Backend de Docker y `npm run start:dev` a la vez | `actualizar-local.bat` lo detecta y avisa |
| Comandos pegados que se juntaban | Copiar y pegar en SSH | `deploy\subir-demo.bat` hace todo en el servidor |
| "Citas de mañana" en Vacunas | Flujo mal ubicado | El aviso de la cita está en la agenda |

### Acceso a la historia clínica (decidido el 10 nov)

- **Veterinario, recepción y administrador** ven la historia completa: atenciones, recetas,
  consentimientos, adjuntos, carnet y la lista de vacunas.
- **Caja** no la ve: cobra desde la cuenta del cliente (Caja y la ficha muestran lo pendiente).
- **Groomer** solo abre las atenciones de grooming (desde el tablero o la cola), sin adjuntos ni
  consentimientos.
- Se controla en el backend (403/404) y en la web (rutas, menú y enlaces ocultos). Prueba:
  `backend/test/clinical-access.e2e-spec.ts`.

### Menú (10 nov)

Ordenado por quién trabaja y en qué paso: Inicio → **Recepción** (cola, citas, clientes) →
**Clínica** (historias clínicas, atenciones, hospitalización, exámenes, refuerzos, presupuestos) → **Grooming**
(tablero) → **Caja** (caja, comprobantes) → **Gestión** (inventario, servicios, plantillas,
reportes, clínica, usuarios, actividad). Cada rol ve solo su parte (`core/layout/nav-items.ts`).
Algo nuevo se agrega en el grupo de quien lo usa; no se crean grupos de una sola opción.

### Compras y proveedores (12 nov)

- Viven en **Inventario** (pestañas Productos · Compras · Proveedores), no en otro menú. Las usan
  administrador y veterinario; recepción y caja no ven costos ni proveedores.
- **Decidido con el cliente:** el sistema **no hace pedidos** a proveedores ni lleva **deudas o
  pagos** a proveedores (eso lo maneja la clínica). Solo la **alerta de stock bajo** (campana,
  Inicio, filtro de Inventario), que depende del stock mínimo de cada producto.
- La clínica pasa la **ficha de compra** que le da el proveedor: una compra = un comprobante, un
  lote por línea. Entra todo o nada; la misma ficha no entra dos veces.
- El **costo se guarda sin IGV** (el margen es venta sin IGV menos costo). Los lotes antiguos
  quedan con el costo que tenían.
- Corregir el comprobante no toca el stock. **Anular** solo si nada se usó; si ya salió algo, se
  corrige con ajuste por conteo. Pagar al proveedor **no sale de la caja del día**.
- El Excel de compras es para el contador (solo administrador).
- **Reportes** (ventas, margen, inventario, control) se ven solo en pantalla, sin Excel; las listas largas tienen "Ver los N restantes".

### Comprobante en A4 y WhatsApp (15 nov)
- Cada comprobante (también la nota de crédito) tiene hoja A4 (`/comprobantes/:id/a4`): imprimir o guardar en PDF desde el navegador; no se guarda archivo.
- WhatsApp: "Abrir chat de WhatsApp" abre el chat del número escrito (aunque no esté en contactos) y ahí se adjunta el PDF guardado. No hay enlaces públicos a comprobantes.

### Insumos de servicios (16 nov)

- Un servicio lista los productos del inventario que gasta siempre (vacuna, jeringa, anestésico en ml,
  sutura, champú en ml). Al registrar el servicio se descuentan solos (FEFO); no se cobran aparte.
  Si falta stock, el servicio igual se registra y queda el faltante en Inventario. Quitar el cargo
  devuelve el stock. Un insumo controlado pide mascota, receta y veterinario con colegiatura.
- **Decisión por defecto (16 nov): no se controla lo de uso general** (guantes, algodón, alcohol, gasas
  no estériles, papel, desinfectante): no se registra en Inventario ni va en los servicios. Se
  controla solo vacunas, medicamentos, controlados, jeringas/agujas (como insumo) y lo que se vende.
  Si la clínica pide controlarlo: se crea el producto en Inventario y se descuenta con Registrar
  salida → Uso interno al abrir una caja (o se pone como insumo del servicio).
- El mismo producto puede ser insumo y venderse suelto (jeringas): comparten el mismo stock.
- El formulario muestra el costo de insumos (último costo de compra sin IGV) frente al precio sin IGV.
  Un producto usado como insumo en servicios activos no se desactiva.
- **Kardex:** lo que descuenta un servicio dice "Servicio" (y su motivo "Insumo de …"); "Uso interno"
  es solo lo registrado a mano con Registrar salida; "Venta", lo vendido suelto.
- **Faltantes:** si se usó sin stock, queda el faltante y **se regulariza solo con la próxima compra**
  de ese producto (se descuenta de lo que entra); si la compra no alcanza, sigue la alerta con lo que
  falta. Quitar el cargo devuelve el stock a sus mismos lotes y cierra su faltante.
- **Una compra solo se anula si no se usó nada de ella.** La unidad mínima no cambia si el producto
  ya tiene movimientos (se crea otro producto).
- **Configuración a revisar al instalar:** cada insumo solo en los servicios donde se usa **siempre**
  y en su unidad mínima (ej.: la jeringa en vacunas e inyectables, no en la consulta general; el suero
  en ml). Un error de cantidad descuenta de más en cada atención: el resumen de costo ("Te queda")
  ayuda a notarlo.

### Presupuestos (16 nov)

- **Para qué:** cualquier cosa que el dueño deba aceptar antes por su costo: cirugías, hospitalización
  estimada, tratamientos por sesiones, paquetes de exámenes, planes (cachorro, chequeo anual),
  productos por encargo, varias atenciones para una empresa o refugio. No para la consulta del día
  ni para la venta sin mascota (eso es venta de mostrador).
- **Estados:** Esperando respuesta → Aceptado → Cargado; o No aceptó. Pasado "Válido hasta" ya no
  se acepta: se hace uno nuevo con precios del día.
- **Mostrarlo:** imprimir (con firma del veterinario y conformidad del dueño) o WhatsApp con el
  resumen, el total con IGV y la vigencia.
- **Cargarlo:** desde el presupuesto aceptado se elige la atención abierta de la misma mascota; si no
  está en atención, "Mandar a la cola de hoy" y el veterinario lo carga al abrirla. Se carga una sola
  vez y recién ahí descuenta stock. Un medicamento controlado pide su receta retenida.
- **Precio:** el dueño nunca paga más de lo presupuestado. Si el catálogo subió, la diferencia va como
  descuento "Presupuesto PR-…"; si bajó, paga el precio nuevo.
- **No es comprobante de pago:** se cobra en caja como cualquier cargo de la atención.

### Comprobante en el cobro (14 nov)
- **Factura y boleta nunca se bloquean.** Si falta el dato, el mismo cobro pide **"Datos del comprador"**: RUC + razón social (dirección y correo opcionales) para la factura; DNI + nombre para la boleta de más de S/ 700 (700.00 justos no lo piden). Si el cliente registrado ya tiene DNI en su ficha, no se pide nada. La venta cargada no se pierde.
- Cliente con DNI que factura a **su empresa**: el RUC va a sus **datos de facturación** (su DNI no cambia) y la próxima factura sale sola ("Factura a … · Cambiar"). Cliente varios: se usa solo para ese comprobante. Se editan en la ficha del cliente.
- Al escribir un RUC o DNI válido se busca el nombre: primero en la clínica (gratis), luego en **APISPERU** si hay token (Configuración → Facturación). Si no aparece, se escribe a mano; RUC dado de baja o no habido → aviso ámbar.
- **Cambiar boleta por factura** (Comprobantes → "A factura"): nota de crédito de la boleta + factura por el mismo detalle; el pago y la caja no cambian. Anular después el cobro anula la factura (siempre el comprobante vigente).
- Con correo del comprador, el PSE (Mifact, Nubefact) le envía el PDF.

### Atenciones (10 nov)

- **Atenciones** = consultas e internamientos. El grooming se trabaja en su tablero; por dentro
  tiene su atención solo para guardar cargos y cobrar en caja (se cierra al entregar).
- Una consulta **abierta de un día anterior** es plata sin cobrar: se nombra en la lista y avisa en
  Inicio/campana (veterinario, recepción, administrador). El grooming sin entregar de días
  anteriores avisa aparte y lleva al tablero (recepción, groomer, administrador).
- El **contexto del paciente** (peso y atención anteriores, refuerzos vencidos) es historia clínica:
  caja no lo ve; el groomer solo ve sus servicios anteriores, sin vacunas.
- La consulta **se guarda sola**; cerrar guarda primero y muestra una revisión (no bloquea).
- **Indicaciones para el dueño** salen de lo guardado en la atención (diagnóstico, plan, receta,
  vacunas) en un clic: WhatsApp (enlace gratis; se corrige en WhatsApp antes de enviar) o impreso.
- **Historias clínicas** (Clínica): lista de pacientes para buscar por mascota, dueño, DNI,
  celular o N° de historia; abre la ficha de siempre. Activos / Inactivos (fallecidos y retirados,
  la historia se conserva). Las mascotas se crean en Clientes (todo paciente tiene dueño).
- **Historia completa imprimible** (ficha de la mascota → Historia completa): solo veterinario,
  recepción y administrador; sin grooming ni anuladas. Curva de peso en la ficha.

### Servicios y precios (18 nov)

- **La categoría decide dónde se cobra:** Grooming → solo tablero de Grooming; Laboratorio → Exámenes
  (y Atención/Caja); Hospitalización → alta (cobro por día); el resto → Atención, Caja y Presupuestos.
- **Desactivar** un servicio o producto: deja de salir en cobros nuevos; lo cobrado no cambia y los
  presupuestos pendientes se cobran igual con su precio.
- El precio se copia al cobrar; subirlo después no cambia cobros ni presupuestos ya emitidos.

### Plantillas clínicas (18 nov)

- **Receta frecuente:** cada medicamento se busca en el inventario. Ligado + "Entregar y cobrar" →
  al usarla en la receta se entrega y se cobra (cantidad guardada). Escrito a mano → receta externa.
- Si el producto se desactiva después, al usar la plantilla queda para farmacia (y se avisa).

### Facturación protegida (18 nov)

- **Configurar facturación, token y RUC (con PSE activo): solo soporte técnico.** Desde el 21 nov el
  dueño ya no ve la configuración ni el token (ni la pantalla, ni el botón "Configurar"); si la
  facturación se detiene, se le pide avisar a soporte. Soporte pega el token nuevo en "Actualizar token".
- Token vencido o pago a Mifact atrasado: la campana lo dice claro; el cobro sigue y los comprobantes
  esperan. Arreglado, **Reintentar todos** en Comprobantes.
- **IGV de productos:** solo el administrador lo cambia.

### Cobro en caja (17 nov)

- **Medios de pago:** uno por defecto; "Dividir el pago" para 2 o 3 medios (el resto se calcula solo).
  Cada medio va una vez. Pagar menos que lo seleccionado deja saldo, como siempre.
- **Efectivo: siempre se anota lo recibido** (botón "Exacto" o billetes rápidos) para que el vuelto
  y el arqueo cuadren.
- **Código de Yape/Plin/transferencia opcional.** El control es al **cerrar caja**: "Revisa en tus
  apps" muestra el total y los pagos sin código de cada medio para cuadrarlo con el celular/POS/banco.
- Anular un cobro dividido devuelve cada parte por su medio (sin cambios).

### Recepción y consultas (21 nov)

- La consulta queda a nombre de quien la abre: **recepción no ve "Atender"** en consultas (cola ni ficha
  del cliente) y el servidor responde 403. Recepción pone en la cola / "En espera"; el veterinario la abre.
  El ingreso de grooming sí lo hace recepción.
- Tablet acostada (1024–1279 px): menú con íconos; táctil: botones de 44 px.

### Atenciones: lista más clara (23 nov)

- **Cobro en la fila:** mientras la atención sigue abierta dice **"Lleva S/ …"** (todavía no se cobra);
  cerrada con saldo, **"Por cobrar S/ …"**; pagada, "Pagada · S/ …".
- Un internamiento cerrado lleva su etiqueta **Internamiento** (abierto ya decía "Internado").
- "Abiertas" muestra cuántas hay (todas las abiertas, sin los filtros de búsqueda).
- Celular: el estado y el cobro van en su propia línea; ya no se corta quién atendió ni la hora.
  Tablet: el buscador va a todo el ancho.
- Accesibilidad: los filtros de estado son botones con `aria-pressed` (no pestañas sin panel), 44 px
  de alto en celular.

### Historias clínicas: encabezado y arreglos (23 nov)

- **Encabezado:** la mascota, **su dueño con enlace a la ficha** y su celular, y la **próxima cita**.
  Acción principal: **Atender** (veterinario/administrador; si ya tenía una atención abierta, la continúa)
  o **A la cola** (recepción, con motivo y urgencia). Al lado: Agendar, Historia completa y **⋯**
  (Presupuesto, Ingreso a grooming, Imprimir carnet de vacunas).
- En tablet vertical y celular los datos van arriba y los botones en una fila debajo (antes el nombre
  se cortaba letra por letra en tablet).
- **Atenciones:** solo las médicas (consultas e internamientos, con su etiqueta); los baños están en
  Grooming, como en la historia completa para imprimir. Antes un internamiento decía "Consulta".
- **Vacunas:** resumen arriba: "Vencido: …" (en rojo) o "Próximo refuerzo: …", contando solo la
  última dosis de cada vacuna.
- "Archivos y consentimientos" va antes de Grooming.
- Pruebas en el navegador: al terminar se desactivan los clientes, mascotas, servicios y usuarios de
  prueba ("E2E", "Dra. Prueba", "Groomer Prueba"); no se acumulan en la demo.

### Clientes: ficha más rápida (23 nov)

- **Barra fija:** al bajar por la ficha, arriba queda el nombre, el documento, lo que debe, Llamar,
  WhatsApp y "+ Mascota".
- **Mascotas:** la tarjeta de siempre, más la **próxima cita** y los botones de acción. Veterinario y
  administrador: Atender · A la cola · ⋯ (Agendar cita, Ingreso a grooming, Editar mascota). Recepción:
  A la cola · Agendar · ⋯ (Ingreso a grooming, Editar mascota). "Agendar" abre Nueva cita con la mascota puesta.
- **Desde 4 mascotas:** "Buscar mascota" y filtros (Todas, por especie, Con alerta); las tarjetas no cambian.
- **"Última visita"** cuenta la atención más reciente (abierta o cerrada, no las anuladas) o el último
  paso por la cola. Antes una atención abierta con "Atender" no aparecía.
- **Cuenta:** si una mascota sigue en atención, avisa que eso se cobra cuando el médico la cierre.
- **Atenciones:** las 5 últimas, filtro por mascota y "Ver las N".
- **Celular:** cuenta, mascotas y atenciones primero; contacto, autorizados, portal y protección de datos al final.
- **Nuevo cliente:** con DNI (o RUC) el nombre se llena solo (lo que ya tiene la clínica o APISPERU,
  el mismo token de Facturación; sin token, sin cupo o sin internet se escribe a mano). No pisa lo
  escrito a mano. Si el celular ya es de otro cliente, avisa con su ficha; no bloquea (puede ser un familiar).
- **Editar cliente:** la factura se agrega con "+ Agregar RUC para facturas"; el RUC trae la razón social
  y la dirección en una tarjeta. El nombre del cliente no cambia.
- La consulta de DNI/RUC también la puede usar el veterinario (registra clientes).
- Lista: hasta 3 mascotas y "+N". La deuda no va en la lista (se ve en la ficha y en Caja).

### Agenda: vista semana (22 nov)

- **Día | Semana** en la barra de la agenda; la agenda recuerda la última vista elegida (y `?vista=semana` en el enlace).
- En Semana, una pestaña por médico (con sus citas de la semana) y **Todo el equipo**. El veterinario
  o groomer entra a **su** semana; recepción y administración, a todo el equipo.
- **Un médico:** 7 columnas por hora con hora, mascota, motivo y cliente; clic en un hueco agenda ahí con ese médico.
  Los días cerrados (horario de Clínica) van sombreados.
- **Todo el equipo:** una fila por médico, hasta 3 citas por día y "+N más" (abre ese día del médico);
  en un día libre, "+ Agendar" con médico y día puestos. Clic en la cabecera de un día abre la vista Día.
- **Celular:** la semana como lista por día de la pestaña elegida, con "Agendar" en los días libres.
- **Nueva cita** propone la **primera hora libre** del médico que se está mirando (dentro del horario y desde ahora si es hoy).
- "Por confirmar" en celular se abre como hoja desde abajo; en Semana lista las de la semana (de hoy en adelante) con su día.
- El detalle de una cita ofrece "Llegó" solo si la cita es de hoy, y el WhatsApp dice el día de la cita (no el que se mira).

### Agenda (19 nov)

- La grilla usa el **horario de atención** de Clínica: empieza a la apertura, sombrea lo cerrado
  (o el día entero si no se atiende) y atenúa lo que ya pasó. Una cita fuera de horario se puede
  agendar igual (la grilla se amplía); el sombreado es solo una guía.
- Al pasar el mouse se ve dónde caería la cita nueva; clic para agendar con ese profesional.
- El calendario del mes marca los días con citas (punto azul) y con citas por confirmar (ámbar).
- "Por confirmar" (botón ámbar del encabezado, solo si hay) lista las citas del día sin confirmar con WhatsApp y Confirmar; también al pasar el mouse por la cita. "Lo que sigue" va sobre la línea de la hora actual (solo hoy).

### Insumos: no se cobran aparte (19 nov)

- Cada producto dice si **se cobra al cliente**. Los insumos (jeringas, guantes, gasas) no: no salen
  al cobrar (Atención, Caja, Presupuestos) y el servidor lo rechaza.
- Se descuentan así: **con el servicio** ("Insumos que usa" en Servicios y precios) o como
  **"Insumos usados (sin cobrar)"** en la Atención (uso interno anotado a la mascota).
- Si la clínica vende un insumo (p. ej. jeringas para casa), enciende "Se cobra al cliente" en ese
  producto, idealmente con precio por unidad, no por caja.

### Agregar a la cola (19 nov)

- Buscar por nombre, DNI, celular o mascota: cada **dueño** con su DNI y celular y debajo **todas sus
  mascotas** (especie, sexo, edad y raza); lo buscado en negrita.
- **Agresivo** y **Alergias** se ven antes de elegir y en el resumen (con la nota de manejo). La
  búsqueda no muestra el detalle de las alergias: eso queda en la historia (caja no la ve).
- Enter elige si hay una sola mascota posible; sin resultados, "Registrar cliente nuevo" llega con
  lo escrito y desde ahí se puede registrar y poner en cola.
- El mismo buscador (`app-pet-picker`) se usa en Nueva cita, ingreso a Grooming, Presupuestos y uso
  de controlados: un cambio ahí se ve en todos.

### Avisos de servicio (21 nov)

- Orden: facturación detenida → rojos (cupo agotado, algo vence en ≤ 7 días o ya venció) → ámbar (cupo al 80 %, vence en ≤ 30 días, token de Mifact con 5 meses o más).
- Los datos los pone soporte en Facturación → "Plan y vencimientos". Vacío = no se vigila.
- Solo soporte técnico (el dueño no los ve). Al actualizar el token se reinicia la cuenta de los 5 meses.

### Facturación vigilada (19 nov)

- El servidor revisa la conexión con el PSE 4 veces al día (y cada envío): token malo o servicio
  cortado → **banner rojo** a administrador, caja y recepción (veterinario y groomer no) y un solo
  aviso en la campana. Se sigue cobrando; los comprobantes esperan en cola.
- Al arreglarse (token nuevo, pago, vuelve la red) **se reenvían solos** los detenidos por esas
  causas; nunca los rechazados por SUNAT.
- "Sin conexión" (ámbar, se oculta hasta mañana) solo tras 3 revisiones seguidas sin respuesta.
- Comprobante sin aceptar pasado un día → aviso al administrador que no se borra a medianoche
  (filtro **Sin aceptar hace más de 1 día**).
- Los banners del sistema salen en un solo lugar, arriba del contenido: el más grave primero.

### Movilidad: recojo y entrega (24 nov)

- **Consulta o grooming**, con el mismo campo: Lo trae y lo recoge · Lo recogemos · Lo llevamos ·
  Recojo y entrega, la **dirección** (viene la del dueño) y el **precio que pone recepción según su
  criterio** (viene el último que pagó ese dueño; vacío = sin cobro; tope S/ 500 por error de tipeo).
  No hay tarifas ni zonas: decidido con el cliente.
- **Dónde se marca:** en **Nueva cita** (pasa a la cola al tocar "Llegó"), en **Agregar a la cola**
  (consulta) y en el **Nuevo ingreso** de grooming (desde la cola trae lo de la cita).
- **Cobro:** una línea "Movilidad · Recojo y entrega" con IGV, en el mismo comprobante. En consulta
  entra a la cuenta al ponerlo en la cola (la atención la abre el veterinario; no bloquea cancelar
  ni cerrar la atención). En grooming, dentro de su cuenta. "Movilidad" es un servicio interno: no
  sale en Servicios ni se agrega a mano.
- **Cambiar el precio:** en Caja (lápiz en la línea) mientras no se haya cobrado nada; queda en la
  bitácora. Cobrada, con nota de crédito como todo.
- **Cancelar después de ir a recogerlo:** casilla **"Cobrar la movilidad igual"** al sacar de la
  cola o cancelar el grooming (desmarcada). Marcada, solo esa línea queda en la cuenta del cliente.
- **Llevarlo a casa:** grooming usa "Entregar" del tablero. En consulta, al terminar la cola muestra
  **"N por llevar a casa"** y "Falta llevarlo a casa" con **"Entregado en casa"** (guarda quién y a
  qué hora). Si quedó **internado**, la hoja de internamiento lo recuerda y se marca al darle de alta.
- **Lo trajo y ya no puede volver ("llévenlo"):** la movilidad se agrega o cambia después. En
  grooming, en el detalle del tablero ("Agregar"/"Cambiar", recepción y administrador) mientras no
  se entregue. En consulta, desde la tarjeta de la cola (⋯ → Movilidad) mientras no se termine. En
  Terminados ya no se agrega (26 nov: el botón "Llevar a casa" en cada fila parecía un estado y
  confundía). La línea entra a la cuenta y se cobra en Caja.
- WhatsApp de "listo" ya dice "En breve salimos a dejarlo(a)" y el total incluye la movilidad.

### Grooming: tablero más ágil (26 nov)
- **"Pasar a" salta el paso que no se pidió:** solo baño → de Baño a **Listo**; solo corte/uñas/oídos →
  de En espera a **Corte**. Se decide por el nombre del servicio (con "baño" = Baño; lo demás = Corte;
  la movilidad no cuenta). Arrastrando se puede ir a cualquier paso hacia adelante, como antes.
- **Nuevo ingreso:** el cursor ya está en el buscador de la mascota.
- **Tablet acostada (1024–1279 px):** las columnas vacías quedan como franjas delgadas; al arrastrar una
  tarjeta vuelven a su ancho para soltarla. Desde 1280 px, 4 columnas iguales.
- Tarjeta: raza y **dueño en su propia línea**. Botones de 44 px en tablet y celular.
- Detalle: solo los pasos posibles; abajo **Cancelar servicio** (rojo, a la izquierda) y a la derecha
  Constancia, Ver atención y Entregar, sin partirse.
- Pendiente (Excel): si el groomer ve los montos del día.

### Cola de hoy: tarjetas más simples (26 nov)
- Cada tarjeta: botón principal (**Atender** / **Ingreso** / **Continuar atención**) + **Pasar a espera**
  (antes "Esperar") + menú **⋯** con Marcar/Quitar urgencia, Movilidad (consulta) y Sacar de la cola…
  (en rojo, pide confirmar y si se cobra la movilidad). La marca "Urgente" sigue a la vista.
- **Recepción** no abre consultas: en "En atención" ve **"Con Dra. …"** en vez de "Continuar atención".
- En atención **más de 2 horas**: etiqueta ámbar "Abierta hace N h" (cerrarla o pasarla a caja).
- Celular: la pestaña de terminados se llama **Terminados**; el botón ⋯ mide 44 px.
- Pendiente (Excel de secciones por usuario): si el groomer deja de ver "Cola de hoy".

### ¿Olvidaste tu contraseña? (25 nov)
- En la pantalla de ingreso, si el servidor tiene correo configurado (`SMTP_USER`/`SMTP_PASS`, Gmail de la clínica con contraseña de aplicación). Sin correo, sigue el texto "Pídele al administrador…".
- El usuario escribe su correo → recibe un enlace (`/recuperar?token=…`) que vale **30 minutos** y sirve **una sola vez**; máximo 3 pedidos por hora y cuenta. La pantalla responde lo mismo exista o no el correo.
- Al crear la clave nueva: se desbloquea la cuenta, deja de ser temporal y se cierran sus sesiones en otros equipos. Queda en Actividad ("Pidió recuperar…", "Creó una contraseña nueva…").
- Solo cuentas activas de clínicas activas. En la base se guarda solo el hash del enlace.
- Respaldo si el correo no llega: el otro administrador (o soporte) le restablece la clave desde Usuarios (⋯ → Restablecer contraseña).

### Usuarios y Refuerzos: acciones de cada fila (26 nov)
- **Usuarios:** en cada fila queda a la vista solo **Editar** (lápiz). **Restablecer contraseña** y **Desactivar usuario…** (en rojo, pide confirmación) van en el menú ⋯; cerca del borde de abajo el menú se abre hacia arriba; Escape lo cierra y el foco vuelve al ⋯. Un usuario inactivo muestra **Activar** a la vista. Uno mismo no tiene ⋯ (no puede desactivarse).
- Usuario inactivo: fila con fondo gris y etiqueta "Inactivo" (antes se atenuaba toda la fila y el texto no se leía bien).
- **Refuerzos:** tras avisar, el botón dice **"Avisar de nuevo"** (antes "Otra vez").
- Regla para todas las listas: un botón lleva verbo y se ve como botón; un estado es una etiqueta de color. En la fila solo la acción principal; lo de poco uso va en ⋯ o en el detalle.

### Actividad (25 nov)
- Solo el administrador. Arriba, **Para revisar · últimos 7 días** por grupo (cierres con diferencia, anulaciones, precios, stock, accesos fallidos, facturación, usuarios o datos); cada tarjeta filtra.
- Filtros: área (botones), persona y período (Todo, Hoy, 7 días, 30 días, Fechas). Quedan en la dirección (`?area=`, `?importantes=1`, `?grupo=`, `?periodo=`, `?desde=&hasta=`).
- 3 o más acciones iguales seguidas de la misma persona se juntan en una fila que se abre.
- **Lo que hace soporte (Uywa) no se muestra** a la clínica (Actividad ni Control), decidido el 25 nov; queda guardado en la base por si hay un reclamo. El token nunca se guarda en la bitácora. Nadie puede borrar ni editar la bitácora.
- En producción, `TRUST_PROXY=true` para que la "conexión" (IP) sea la real y no la del proxy.

### Reportes: más datos y gráficos (25 nov)
- **Cuatro pestañas** (solo administrador): Ventas, Margen, Inventario y **Control** (descuentos, anulaciones, cierres con diferencia, mermas, quién hizo qué y cambios de precio). El período va en la dirección (`?periodo=hoy|7-dias|30-dias|este-mes|mes-pasado|12-meses|este-ano|ano-pasado` o `?desde=&hasta=`) y se mantiene al cambiar de pestaña.
- **Período hasta 2 años.** Si las fechas pasan de 2 años o quedan al revés, sale un aviso en ámbar (no rojo) con el arreglo en un botón ("Usar los últimos 2 años", "Intercambiar fechas"); Aplicar se activa solo con fechas válidas.
- **Agrupación automática:** por hora (1 día), por día (hasta 31), por semana (hasta 92, desde el lunes) y por mes. Así un año no muestra 365 barras.
- **Comparación justa:** mes en curso contra los mismos días del mes anterior; año en curso contra los mismos días del año anterior; cualquier otro rango contra el mismo largo justo antes. Si el período incluye hoy, el anterior se corta a la misma hora.
- **Ventas:** total con 4 indicadores, frases que resumen el período, gráfico de ventas (o tabla), categorías, medios de pago y comprobantes, horas con más ventas, especies, equipo, lo más vendido, clientes nuevos y mejores clientes, "Te deben hoy" (por antigüedad), movilidad, últimos 12 meses y refuerzos vencidos.
- **Margen:** margen por período (con % de margen), servicios contra productos, mapa de rentabilidad, por categoría, **precios a revisar** (menos de 25 % o a pérdida), lo que no tiene costo, cuánto restaron los descuentos y el detalle con búsqueda y orden.
- **Inventario:** valor por categoría, qué vence por semana, compras contra salidas (6 meses), para cuántos días alcanza, por reponer, sin movimiento y lotes con qué hacer. Las tarjetas llevan a Inventario ya filtrado. **Cuenta los productos desactivados que aún tienen stock** (con aviso).
- **Gráficos** con ECharts (se carga solo al abrir Reportes); cada uno tiene nombre para lector de pantalla y respeta "reducir movimiento". Celular, tablet (parada y acostada), laptop 1280 y PC: tarjetas y tablas se reacomodan según el ancho del recuadro, no de la pantalla.
- **Listas largas:** cada tarjeta muestra un tope (5–8) y "Ver todos" abre un modal; nada estira la tarjeta. **Clientes nuevos** = atendidos por primera vez; **volvió** = vinieron 2 días o más. Si el período anterior no tiene datos se dice una vez junto a las fechas.
- Servidor: `GET /reports/control`; ventas, margen e inventario devuelven series, comparación y los datos nuevos. Ya no hay Excel de reportes (404).

### Inventario: revisión completa (23 nov)

- **Las 4 tarjetas filtran cada una lo suyo:** Lotes vencidos · Vencen en 30 días · Vencen en 31 a
  60 días · Stock bajo. Con un filtro de vencimiento la lista va **del que vence antes al último**.
- **Activos / Inactivos** (solo admin y veterinario): un producto desactivado se encuentra y se
  reactiva desde su ficha. Recepción y caja solo ven activos.
- **Total en la unidad mínima** debajo de las cajas ("2 cajas · 200 tabletas") en la lista y en la
  ficha ("= 200 tabletas"); "Hay …" en Registrar salida (según el lote elegido) y la diferencia en
  Conteo físico antes de guardar.
- **Kardex:** la venta dice comprobante y cliente ("Venta · B001-… · cliente"), no repite el producto.
- **Compra rápida** (desde la ficha) se queda, decidido: si se escribe un comprobante, avisa que la
  factura completa va en Compras para que salga en el Excel del contador.
- **"Con receta" se quitó** de la pantalla (no hacía nada). Los controlados siguen pidiendo receta
  retenida como antes.
- Unidad SUNAT al editar: lista (NIU, caja, blíster…) en vez de texto libre.
- Las pestañas Productos · Compras · Proveedores siguen marcadas con un filtro puesto.

### Carga inicial del inventario (18 nov)

- Inventario → **Importar Excel**: plantilla → subir → revisar → importar. Nunca sobrescribe; repetir
  el archivo no duplica. Un producto con una fila mala no entra.
- **Dos lotes:** se repite la fila de la presentación con el otro lote (misma equivalencia).
- **Lote** obligatorio solo en vacunas y controlados; lo demás que vence, solo el vencimiento.
- Columnas opcionales **IGV** (Gravado por defecto) y **Código de barras** (no repetido).
- Acepta "Medicamentos", "Vacunas", "Unid.", "Tabs", etc. El proveedor queda en la lista de Proveedores.
- **Avisos** que no bloquean: sin precio, sin costo, vence en 30 días o menos.
- Después de importar, corregir con "Ajuste por conteo" o editando el producto, no reimportando.

### Atención: recepción y contexto del paciente (22 nov)

- **Consulta:** recepción registra motivo y triaje (peso, temperatura); lo clínico (SOAP, notas,
  diagnóstico) y **cerrar** son del veterinario o el administrador (servidor: 403). Grooming: recepción
  sigue con sus notas; se cierra al entregar desde el tablero.
- Tarjeta "Paciente": peso anterior, **última consulta** (consulta u hospitalización; el groomer, su
  último grooming) y refuerzos vencidos. En celular y tablet de pie va arriba.
- Peso más del doble o menos de la mitad del anterior: aviso ámbar, sin bloquear.
- Receta con entrega en la clínica: cantidad = dosis × tomas al día × días, en la presentación más chica.

### Cobro con productos agregados y factura compacta (22 nov)

- En **Cobrar** se puede agregar lo que el cliente lleva además de la atención (cama, medicamento):
  se crean los cargos y se cobran en la misma transacción y el mismo comprobante. Lo agregado se paga
  primero y completo (el abono solo aplica a los cargos). Controlados: solo en la atención, con receta.
- **Anular** un cobro con productos vendidos en caja (sin atención): "¿Devolvió los productos?" → sí:
  cargo quitado y stock de vuelta; no: el cargo queda pendiente. Los cargos de atenciones siempre
  vuelven a pendientes (sin cambios).
- **Factura:** RUC → tarjeta con razón social y dirección (SUNAT/clínica); razón social de SUNAT no
  editable; sin resultado, se escribe; correo opcional detrás de un enlace.

### Caja tipo POS (22 nov)

- **Venta de mostrador y Cobrar** comparten el panel derecho: total → comprobante (pestañas) →
  RUC/DNI si hace falta → cómo paga y recibido → **Cobrar** fijo abajo (Ctrl+Enter). Laptop y tablet
  acostada: lista a la izquierda con su propio desplazamiento. Tablet de pie / celular: una columna y
  Cobrar fijo abajo.
- **Venta:** F2 al buscador, Enter agrega; aviso de stock por línea ("Quedan N", "Solo hay N", "Sin
  stock registrado"); sin ítems, Cobrar desactivado. **Cobrar:** "N de M cargos", "Marcar todo", abono.
- Los errores del pago se muestran bajo "Recibido"; los del comprador, en su campo.

### Caja: cobrar en menos pasos (22 nov)

- **Por cobrar:** "De hoy" arriba (el último en terminar primero: quien está en el mostrador) y
  "Saldos anteriores" debajo (del más antiguo al reciente). Se actualiza solo cada 30 s y al volver
  a la pestaña; nunca con un modal abierto.
- **Cobro** (laptop y tablet acostada, en dos columnas, sin bajar): qué paga y comprobante a la
  izquierda; cómo paga, "Recibido" con montos rápidos y vuelto a la derecha. Normal = 3 toques:
  Cobrar → Exacto → Cobrar S/ …
- **Abono:** el monto se edita solo con "Paga solo una parte (abono)"; "Paga todo" lo devuelve.
- **Venta de mostrador:** Enter agrega el primer resultado, ↑/↓ eligen, Esc limpia. Lector de
  código de barras: agrega la presentación con ese código apenas llega el resultado.
- **Ticket:** caja/recepción ven "Para anular este cobro, pídelo al administrador".

### Caja del día y cierre (18 nov)

- **Egresos:** nunca mayores al efectivo del cajón (lo valida el servidor). El modal muestra
  "Efectivo disponible" y motivos rápidos; si el dueño se lleva plata → **"Retiro del dueño"**.
- **Una caja por día:** si sigue abierta de otro día, aviso "Esta caja es del 12 nov. (hace N días):
  ciérrala y abre la de hoy" (también al cobrar). No bloquea.
- **Cerrar:** opcional "Contar por billetes y monedas"; el total pasa a "Efectivo contado".
- **Reporte de cierre** (`/caja/cierres/:id`, ticket 80 mm o PDF): inicial, cobrado en efectivo,
  egresos, devoluciones, debía haber, contado, diferencia y motivo; apps/POS a revisar; egresos;
  firmas Entregó/Recibió. Sale en "Último cierre" con la caja cerrada.
- **Abrir:** botón "Igual que la última vez" con el inicial anterior.
- Tarjeta **Cobrado neto** (cobros − devoluciones); medios con su devuelto; deudas desde 7 días resaltadas.

### Pantallas (17 nov)

- **Hospitalización:** las dosis atrasadas se avisan arriba de la hoja con la más antigua lista para
  registrar. Sin signos en 12 h → aviso "toca registrar". FC/FR fuera de rango por especie en ámbar/rojo.
- **Atención:** el resumen lista la cuenta; "+ Agregar" lleva al buscador de cargos.
- **Orden de nombres** en español (tildes y Ñ en su lugar) en todas las listas.

## Regla para cada cambio

1. Si toca el backend: reiniciar el api (`actualizar-local.bat`) antes de probar la web.
2. Probar el flujo completo de la tabla, no solo la pantalla cambiada.
3. Antes de subir al servidor: `npx playwright test` en `e2e` (los 5 recorridos, en la clínica de
   pruebas `e2e@uywa.pe`; ver README).
4. Si toca la facturación: probar con token malo (sale el banner rojo y el cobro sigue) y con token
   bueno (se apaga y los comprobantes salen solos). Nunca con el token de producción en la demo.
5. Si agrega un aviso: decidir quién lo ve (tabla "Quién ve qué aviso"), si va en la campana o
   como banner, y si es rojo (impide trabajar) o ámbar (conviene saberlo).
6. Si cambia la base de datos: migración nueva en `backend/prisma/migrations` (se aplica sola al
   arrancar el api).
