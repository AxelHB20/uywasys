# Cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Cada fase cerrada lleva su etiqueta de versión (`git tag v0.3.0`) para poder volver a ella.

## [Sin publicar] · Plantillas clínicas y hospitalización

### Caja: descuento al cobrar y textos que se entienden (28 nov)
- **Descuento en Caja (monto fijo en soles):** un solo «Descuento» abajo, junto a «Paga solo una parte (abono)», en el cobro y en Venta de mostrador: monto, motivo de un toque («Cliente frecuente», «Campaña», «Albergue o rescate», «Ajuste de precio») u otro escrito, y al lado «− S/ 20.00 · queda S/ 460.00». El total dice «Incluye descuento − S/ 20.00». El sistema lo reparte entre las líneas según su importe (lo que sobra de céntimos, a las más grandes), así la boleta lleva el descuento en cada línea.
- **Tope:** hasta el tope de la clínica (10 % por defecto) cualquiera lo da; si pasa, «Pasa del 10 % (máx. S/ 4.60): solo el administrador puede darlo» (también en Atención y Presupuestos). El administrador cambia el tope en **Configuración → Descuentos**.
- **Con abono:** el descuento sale de lo que falta (ej.: consulta S/ 85, ya pagó S/ 28, falta S/ 57 → descuento S/ 7, cobra S/ 50). Lo pagado y su comprobante no cambian; el tope se mide sobre el precio de la línea. Si una línea ya traía descuento de la atención, el de caja se suma.
- **Quién lo dio:** nueva columna `discount_by_id` en los cargos (en caja, quien cobró); el reporte de Control la usa. Migración `20261128120000_descuento_en_caja` (los descuentos anteriores quedan a nombre de quien registró el cargo). Registro `charge.discount` en la actividad.
- **Atención:** los mismos motivos de un toque bajo «Motivo».
- **Textos de Caja:** «Consulta general, Vacuna y 1 más» en lugar de «3 cargos»; «ya pagó S/ 23.00 · falta S/ 23.00» en la lista y en el cobro; etiqueta «Venta de mostrador» (antes «Mostrador»); «Cobrado en esta caja», «Promedio por cobro», «13 clientes deben»; «Salida de dinero» en lugar de «Egreso»; «Paga con dos medios (ej.: efectivo + Yape)» en lugar de «Dividir el pago».
- **Caja en celular:** nombre del cliente completo con el monto y «Cobrar» debajo; resumen en una línea que se abre («Ver resumen»), así la lista Por cobrar se ve primero; «Transferencia» ya no se monta sobre el monto; «hace 30 días» no se parte.
- **Costo con o sin IGV:** en Agregar producto, Cargar stock y Registrar compra se elige «El costo viene: Con IGV / Sin IGV» (como en Recibir compra); con IGV se muestra «Se guarda sin IGV: S/ 21.19» y se guarda sin IGV.
- **Unidad SUNAT:** solo la ve y cambia el administrador.
- **Corregir productos:** dice «Conteo físico», como el botón de la ficha.
- **Contraste (axe):** Atenciones, Clientes en celular y Servicios. Sin fallas en Caja, cobro, Configuración, Agregar producto, Cargar stock, Atenciones, Clientes y Servicios.
- **API:** `GET /api/clinic/discount-limit` (cualquier rol); `POST /api/cash/receipts` acepta `discounts[]` (`chargeId`, `discount`, `discountReason`); `GET /api/inventory/stock-load` devuelve `igv`; `GET /api/cash/pending` devuelve `names` y `paid`.
- Pruebas: e2e de descuento en caja (tope en soles, motivo, administrador, después de un abono, venta de mostrador, quién lo dio); frontend del descuento en el cobro (tope, motivo y reparto entre líneas), reglas del descuento y costo con IGV en Registrar compra.

### Inventario sin confusiones: corregir productos, «¿Se le cobra al cliente?» y un solo nombre (27 nov)
- **Por qué:** en la clínica quedaron productos con el stock escrito en «Trae» (Shampoo Alerdog «Unidad = 3 unidades», Giardia Pet «Tableta = 44») y medicamentos con precio marcados como insumo (Nutrical, Giardia Pet), así no salían al cobrar.
- **Corregir productos** (`/inventario/corregir-productos`, aviso ámbar en Inventario, admin y veterinario): todos los mal llenados en una lista. Por producto: «Poner Trae = 1», «Se cuenta por» (Unidad → Frasco, solo sin movimientos) y «Se vende al cliente» si es insumo con precio. Se guarda todo junto (si uno falla no se guarda nada). Lo que estaba en «Trae» (el 3, el 44) pasa a **Cargar stock** como cantidad, primero en la lista con «Es lo que estaba en «Trae»»; solo falta el vencimiento. Si ya tenía stock, avisa que se revise con «Conteo físico».
- **Se detecta sin falsos avisos:** presentación sin número en el nombre («Unidad», «Frasco», «Tableta x1») en un producto sin ninguna que traiga 1. «Caja x 30» y los productos en ml o g («Por kilo = 1000») no se tocan. Los de categoría Insumo con precio tampoco.
- **«¿Se le cobra al cliente?»** con dos respuestas a la vista («Sí, se vende» / «No, se gasta en la clínica») en Agregar producto y Editar, en lugar de la casilla «No se vende (insumo)».
- **Editar producto: cambiar Unidad por Frasco** (o tableta, caja) mientras no tenga compras, ventas ni stock inicial. La presentación «Unidad» pasa a llamarse «Frasco».
- **Un solo nombre: «psicotrópico»** en todas las pantallas (Libro de psicotrópicos, Recibir compra, Caja, Presupuestos, Atención, Hospitalización y mensajes del servidor); antes convivía con «controlado».
- **Plantilla de Excel con los nombres de la pantalla:** «Se cuenta por», «Trae (1 si es una sola)», «Psicotrópico DIGEMID (Sí/No)», «Stock que tienes», «Vencimiento (MM/AAAA)» (columna de texto para que Excel no lo cambie). Cada producto necesita una fila con Trae = 1; si falta, el error dice «¿Pusiste el stock en «Trae»?». Las plantillas anteriores se siguen leyendo.
- **Recibir compra:** vencimiento como en la caja (08/2027), igual que en las demás pantallas; Enter sigue pasando al campo siguiente.
- **Servicios:** la ayuda de insumos ya no habla de ml («1 jeringa, 2 tabletas»).
- **API:** `GET /api/inventory/product-fixes` y `POST /api/inventory/product-fixes` (hasta 300; errores por fila en `details.rows`; responde las cantidades sugeridas). Sin cambios en la base de datos.
- Pruebas: e2e de corregir productos (fila mala → nada; Unidad → Frasco renombra la presentación; con movimientos no cambia la unidad; recepción no entra), detección de la presentación mal cargada, MM/AAAA y encabezados nuevos y viejos del Excel; frontend de Corregir productos y vencimiento en Recibir compra.

### Psicotrópicos y presentaciones guiadas (27 nov)
- **Por qué:** en la clínica 12 de 13 medicamentos quedaron como "Controlado" (la palabra se entendía como "lo controlamos") y en Hemovitab se escribió el stock (192) en "Trae" de la tableta.
- **"Estupefaciente o psicotrópico (libro de DIGEMID)"** en lugar de "Medicamento controlado"; insignia "Psicotrópico (DIGEMID)". Se movió a "Más datos" (solo Medicamento) y **pide confirmación** con lo que exige (lote, receta, paciente, veterinario) y lo que no se marca (antibióticos, vitaminas, antiparasitarios…). También al editar.
- **Revisar psicotrópicos** (`/inventario/revisar-psicotropicos`): aviso rojo en Inventario con los no revisados; lista con todos para quitar los que no son en una pasada. Al quitarlo también se quita "requiere receta" (backend: editar y Cargar stock). En Cargar stock la casilla solo sale para quitarlo. API: filtro `controlled=true` en la lista de productos.
- **Presentaciones guiadas:** primera fila = unidad suelta, "Trae" fijo en 1 (no se puede poner el stock ahí); botones "+ Blíster / + Caja / + Otra" según la unidad; nombre automático ("Caja x 30"); resumen "1 Caja x 30 = 30 tabletas · S/ 2.67 cada tableta" y aviso si sale más caro que suelto; ejemplo bajo el título; filas vacías se quitan al guardar; errores concretos ("Falta cuántas tabletas trae «Caja»").
- **Aviso de insumo con precio** al agregar ("no aparecerá al cobrar").
- **Ficha: "Revisa este producto"** con botón "Corregir": presentación base mal cargada (ninguna trae 1) e insumo con precio. Al editar una presentación: "Cantidad de tabletas que trae. Si es una sola, pon 1".
- Pruebas: confirmación del psicotrópico (frontend), quitar psicotrópico deja de pedir receta y filtro de la lista (e2e).

### Inventario: textos claros en todas las pantallas (27 nov)
- **Lote con su motivo:** "Obligatorio: el lote va en el carné de vacunación", "Obligatorio: DIGEMID pide el lote de los controlados" u "Opcional: anótalo si la caja lo trae", bajo el campo en Agregar producto, Cargar stock y Registrar compra. Los errores dicen lo mismo (también los del servidor).
- **Controlado explicado** donde se marca (agregar y editar): solo estupefacientes y psicotrópicos, qué exige y "si no es uno de estos, no lo marques".
- **"No se vende: se gasta en la clínica (insumo)"** (antes "Es de uso interno"), con la explicación de qué es (jeringas, guantes, gasas, alcohol), que no aparece al cobrar y cómo baja su stock (Insumos usados en la atención, un servicio que lo usa o Registrar salida). Insignia "No se vende (insumo)" (antes "No se cobra"). La salida "Uso interno" pasa a **"Usado en la clínica"**, también en el kardex: eran dos cosas distintas con el mismo nombre.
- **"Trae (tabletas)"** en lugar de "Equivalencia", **"¿Cómo se cuenta el stock?"** en lugar de "Unidad mínima"; costo "lo que pagaste, sin IGV".
- **Registrar compra:** vencimiento como en la caja (08/2027) en vez del calendario.
- **Cargar stock:** recuadro que explica cada columna (cantidad, vence, lote, costo, controlado).
- **Aviso de stock bajo explicado:** "Avísame cuando queden pocas (opcional)" con "Ej.: 20" y debajo qué pasa ("Cuando queden 20 tabletas o menos, sale en «Con stock bajo» (Inventario e Inicio)…"; vacío: no avisa). En la ficha, "Aviso de stock bajo: Al quedar 6 unidades" y "Quedan pocas: toca comprar" (antes "Stock mínimo" y "Por debajo del mínimo"). Contraste de los títulos de la ficha a 4.5:1.

### Cargar stock de varios productos en una tabla (27 nov)
- **Pedido de la clínica:** tenían 24 productos creados sin stock y entrar a cada uno era tedioso.
- **Inventario → Cargar stock** y aviso "N productos sin stock · Cargar stock" en Inventario (admin y veterinario).
- **Una tabla con todos los productos activos sin stock:** cantidad y presentación (la más grande por defecto, con "= 30 tabletas"), vence como en la caja (08/2027), lote (obligatorio solo en vacunas y controlados), costo opcional. Buscador y filtro por categoría. En celular, una tarjeta por producto.
- **Corregir "Controlado"** en la misma fila (solo Medicamento): varios productos se habían marcado como controlados por error, y eso pide receta, paciente y veterinario en cada uso.
- **Todo o nada:** el servidor revisa todas las filas antes de guardar; si una está mal la marca y no entra ninguna. Las filas vacías no se tocan. Al guardar salen de la tabla.
- **API:** `GET /api/inventory/stock-load` y `POST /api/inventory/stock-load` (hasta 200 por vez; errores por fila en `details.rows`). Sin cambios en la base de datos.
- **Agregar producto:** el enlace al Excel solo se muestra al administrador (es quien puede importar).
- Pruebas: e2e de carga por tabla (fila mal → no entra nada; corregir controlado → entra todo; recepción no entra).

### Agregar producto: stock y vencimiento en la misma pantalla (27 nov)
- **Pedido de la clínica** (cargando su inventario): el alta tenía varios pasos y preguntas de más.
- **Stock inicial en la misma pantalla** (opcional): cantidad y presentación, vencimiento, lote y costo. Se guarda junto con el producto en una sola operación (si el stock está mal, no se crea el producto a medias).
- **Vencimiento como en la caja:** se escribe 08/2027 (o 08/27) y se guarda el último día del mes; también acepta la fecha completa. Avisa si ya venció o si no se entiende.
- **Se queda en la pantalla al agregar:** mensaje con el stock, formulario limpio (se mantienen categoría y unidad), foco en el nombre y lista "Agregados ahora" con enlace a cada producto. "Cancelar" pasa a "Terminar".
- **Unidad mínima: unidad, tableta, caja y frasco** (nuevos valores `BOX` y `BOTTLE`). ml y g ya no se ofrecen al agregar; los productos que los usan siguen igual. El Excel acepta "caja", "frasco" y "fco", y la plantilla ofrece Unidad, Tableta, Caja y Frasco.
- **La categoría decide si vence** (sin la pregunta "Vence / No vence"): nota bajo la categoría con "Cambiar" para casos raros. "Medicamento controlado" solo en Medicamento.
- **"Es de uso interno (no se vende)"**, siempre desmarcado salvo Insumo, en lugar de "Se cobra al cliente" (que venía marcado y confundía). También en Editar producto.
- **Lote obligatorio solo en vacunas y controlados** en el alta, "Registrar compra", "Recibir compra" (igual que ya hacía el Excel); lo demás que vence pide solo el vencimiento.
- **Aviso de producto repetido** al escribir el nombre (sin importar tildes ni mayúsculas), con enlace para abrirlo.
- Botón, título y botón del inventario: **"Agregar producto"**; enlace al Excel en la pantalla.
- **Base de datos:** migración `20261127120000_unidad_caja_frasco` (solo agrega dos valores al enum; no cambia datos).
- Pruebas: e2e de alta con stock inicial (frasco, sin lote) y vacuna sin lote que no crea nada; lote opcional en compra y Recibir compra; `parseExpiry`. Probado con 17 productos reales seguidos (todas las categorías) en PC y celular, como administrador y veterinario.

### Inventario: errores al agregar medicamentos (27 nov)
- **Causa:** la pantalla aceptaba más decimales de los que guarda el sistema. Un precio como 0.833 (S/ 25 ÷ 30 tabletas), una equivalencia de 4 decimales o un costo de 5 decimales se rechazaba recién al guardar, con un texto confuso: "presentations.0.El precio debe tener hasta 2 decimales" o "El costo debe ser un número" (aunque era un número).
- **Ahora se avisa en el campo al escribir:** precio de venta hasta 2 decimales (ej.: 0.83), equivalencia, cantidades y stock mínimo hasta 3, costo hasta 4 (ej.: 21.6667). En Nuevo producto, la ficha (registrar compra, salida, conteo, presentación, editar) y Recibir compra (cantidad, precio y precio de venta).
- **Mensajes del servidor legibles:** los errores de listas dicen la fila ("Presentación 1: el precio…", "Línea 3: la cantidad…", "Fila 2: …") en todo el sistema; los de decimales dicen cuántos se permiten.
- **Controlado = pide receta** también en el servidor al crear o editar.
- "Ahora ingresa su primera compra" → "Ahora registra su primera compra" (el botón se llama "Registrar compra").
- Pruebas: `maxDecimals` (frontend), `readablePath` (backend), e2e de error por presentación y controlado con receta.

### Plantillas clínicas: revisión completa y uso rápido (27 nov)
- **Página Plantillas:** tarjetas con toda la información, ordenada como en la Atención (letras S·O·A·P), con los ___ resaltados y "N datos por llenar"; recetas con dosis completa (dosis · vía · frecuencia · duración) y "Del inventario"/"Externa"; quién la hizo y cuándo se actualizó. Toda la tarjeta abre la plantilla.
- **Eliminar y Duplicar dentro de la plantilla** (ya no hay papelera en cada tarjeta). Duplicar abre una copia sin guardar: "Nombre (copia)".
- **Muchas plantillas:** se muestran las 12 más usadas y "Ver 12 más"; buscar muestra todas. Buscador más ancho.
- **"Cómo funciona":** el paso 3 ya no dice "nada se guarda solo" (la Atención sí se guarda sola); ahora explica los ___.
- **Usar plantilla en la Atención (rediseño):** ventana ancha con lista y vista previa lado a lado (PC y tablet acostada); en celular y tablet parada, lista → vista previa con "Todas las plantillas". En PC la más usada ya viene elegida; flechas ↑↓ recorren la lista; doble clic aplica. Contador "36 plantillas · las más usadas primero" / "2 de 36"; en celular el buscador queda fijo arriba.
- **Busca en todo el texto** de la plantilla (antes solo nombre y resumen) y la vista previa sigue a los resultados: ya no se puede aplicar una que no está en la lista.
- **Solo pregunta si pisa algo escrito**, y dice en qué campos: "Dejar lo mío" (por defecto) o "Usar la plantilla" (avisa que se borra lo escrito). Con la consulta vacía no pregunta.
- **Datos por llenar:** al aplicar, el cursor queda en el primer ___ seleccionado; aviso bajo la consulta con "Siguiente ___" (salta al próximo); al cerrar la atención se recuerda con "Completar". No bloquea.
- **Recetas frecuentes:** ya no duplican medicamentos que ya están en la receta (un toque de más los repetía y se podían cobrar doble); se avisa.
- **Mensajes:** "Plantilla aplicada. Completa los 4 datos marcados con ___" (antes "revisa y guarda", pero se guarda solo); botón "Usar plantilla" / "Agregar a la receta" en vez de "Aplicar"; mensaje vacío propio para recetas.
- **Componentes compartidos:** `app-template-text` (resalta ___) y ayudas `SOAP_LETTER`, `templateBlankCount`, `rxDosage`, `fieldName` en `clinical-templates.service.ts`, usados por la página y la ventana.
- **Accesibilidad:** pestañas como grupo de botones (`aria-pressed`); listas de medicamentos sin "opciones" con botones dentro (Plantillas y Receta); `aria-controls` solo con la lista abierta; vista previa desplazable con teclado; textos grises a 4.5:1 (también el encabezado de la Atención). axe: 0 fallas en laptop 1280, tablet 1180/1024/834/820 y celular.
- Pruebas: ventana de plantillas (sin pregunta con la consulta vacía, pregunta con campos escritos y "Usar la plantilla", búsqueda que cambia la vista previa); página ajustada a las tarjetas nuevas.

### Hospitalización: revisión completa (27 nov)
- **Cobro flexible al dar de alta:** "Cobrar aparte" opcional en cada indicación (servicio o producto del inventario); el alta propone cobrar las dosis dadas menos lo ya cargado, con cantidad editable, y muestra el total. La **estancia es obligatoria de elegir** (incluye "No cobrar"), así no se cobra doble en una cirugía corta. Los cargos se crean en la misma operación del alta.
- **Alta voluntaria** como tercera salida (queda marcada en la hoja y en "Altas recientes").
- **"Se dio a las"** al registrar una dosis (hora real si se registra tarde).
- **Suspender pide confirmación.**
- **Aviso de receta** en el alta si la atención aún no tiene una.
- **Tablero:** franja de resumen en vez de 3 tarjetas, botón **Registrar** que abre la dosis que toca, dueño sin cortar, etiquetas del sistema.
- **Hoja:** pendientes solo con la hora, leyenda plegable, ícono por tipo, textos de 12 px o más, evolución con "Notas y signos" primero; en celular los signos antes de la evolución; gráfico de temperatura normal en tablet de pie.
- **Sin jaula** en pantallas (el dato queda guardado).
- **Ajustes de diseño:** las horas de la hoja se acomodan en filas (antes se cortaban a los costados; con muchas horas, "+N antes"); la estancia del alta con opciones a la vista en vez de la lista desplegable cortada; en el celular, los botones de las ventanas ya no quedan fuera de la pantalla.
- **Accesibilidad:** contraste del encabezado y "Actualizado", "Editar" fuera de la lista de datos, separadores de día y filtros bien marcados (axe: 0 fallas en tablero y hoja, PC y celular).
- **Imagen del servidor:** `backend/.dockerignore` ya no copia `src/generated` de la PC (un cliente de Prisma viejo rompía la compilación con columnas nuevas).
- **Cliente de Prisma en Docker:** `importFileExtension = "js"` explícito en `schema.prisma` (dentro de la imagen se genera sin tsconfig y ponía imports `.ts`: la API no arrancaba con "Cannot find module …/internal/class.ts").
- **Base de datos:** migración `20261127010000_hospitalizacion_cobro` (columnas nuevas opcionales; no cambia datos existentes).
- Pruebas: alta con estancia obligatoria y cobro aparte, registrar desde el tablero, confirmación al suspender, hora real (`givenAtIso`); e2e de cobro aparte, hora real y alta voluntaria.

### Usuarios y Refuerzos: acciones más claras (26 nov)
- **Usuarios:** "Desactivar" ya no está a la vista en cada fila. Restablecer contraseña y Desactivar usuario… (rojo, con confirmación) van en el menú ⋯; queda a la vista Editar (y Activar en los inactivos). El menú de la última fila ya no se corta.
- **Usuarios inactivos:** fondo gris en lugar de atenuar la fila (el texto no pasaba contraste). "N activos" con contraste 4.5:1 (axe: 0 fallas).
- **Refuerzos:** "Otra vez" → "Avisar de nuevo".
- Pruebas: menú ⋯ (opciones y Escape), desactivar desde el menú.

### Sistema de prueba: probar una versión antes que la clínica (26 nov)
- **`PRUEBA_IMAGE_TAG`** en `.env`: la prueba puede ir una versión adelante (vacío = la misma que la clínica). Nuevo servicio **`prueba-web`** (su propia web), así la prueba usa su propia pantalla y su propia API.
- **Red aparte para la prueba** (`prueba-db`, `prueba-api`, `prueba-web`): no alcanza la base ni la API de la clínica. El web principal está en las dos redes y sirve la prueba por su dominio.
- **Caddy:** `API_UPSTREAM` (a qué API va /api, por defecto `api:3000`) y `TRUSTED_PROXIES` (por defecto nadie; `prueba-web` confía en la red interna para ver la IP real). `deploy/sites/prueba.caddy` ahora reenvía a `prueba-web`.
- Docs: `DEPLOY.md` 10.1, `COMANDOS-PRUEBA.txt` sección G.

### Grooming: revisión del tablero (26 nov)
- **Menos toques:** "Pasar a" salta el paso que no se pidió (solo baño va de Baño a Listo; solo uñas, de En espera a Corte).
- **Nuevo ingreso** con el cursor ya en el buscador.
- **Tablet acostada:** columnas vacías delgadas (se ensanchan al arrastrar); ya no se cortan nombres, groomers ni servicios.
- **Tarjeta:** dueño en su línea; botones de 44 px en tablet y celular (manos mojadas).
- **Detalle:** solo los pasos posibles (antes salían apagados); Cancelar servicio a la izquierda y en rojo; Constancia y Ver atención sin partirse.
- **Accesibilidad:** tiempo en el estado y columnas vacías con contraste 4.5:1 (axe: 0 fallas en 390, 820, 1024, 1180 y 1366 px).
- Pruebas: `nextStatusFor` (solo baño, solo uñas, baño y corte, anulados).

### Cola de hoy: revisión (26 nov)
- **La × ya no se sale de la tarjeta:** la fila queda en botón principal + "Pasar a espera" + menú ⋯ (urgente, movilidad, sacar de la cola).
- **"Continuar atención"** sin el hueco entre palabras.
- **Recepción** ya no ve "Continuar atención" (le daba error: las consultas las abre el médico); ve "Con Dra. …".
- **"Abierta hace N h"** en ámbar cuando una atención pasa de 2 horas.
- **Terminados sin "Llevar a casa":** el botón en cada fila parecía que ya tenía movilidad. La movilidad se pone al agregar a la cola o en la tarjeta (⋯ → Movilidad) mientras está en la cola.
- **"Esperar" → "Pasar a espera"**, que dice lo que hace. En "En espera", recepción ya no ve el texto "Lo llama el veterinario" (no aportaba): solo el menú ⋯.
- **Celular:** la página ya no se desliza de costado (6 px de más); pestaña "Listos" → "Terminados"; ⋯ de 44 px.
- **Accesibilidad:** fecha, ayudas de columna y contadores de pestaña con contraste 4.5:1 (axe: 0 fallas en PC, tablet y celular).
- Pruebas: recepción ve quién atiende, ámbar desde 2 h, menú ⋯ con sus 3 acciones.

### Demo completa: un año de historia (25 nov)
- **`scripts/demo-data.mjs`:** 364 días por defecto (antes 70; máximo 430). "12 meses" en Reportes tiene movimiento de punta a punta y sin un período anterior a medias.
- La clínica **crece** (empieza con ~60 % del movimiento de hoy) y tiene **temporadas**: diciembre y verano con más grooming, invierno con más consultas.
- Nuevo en la historia: anulaciones de cobros con nota de crédito, subidas de precio (consulta y corte de uñas), una practicante cuyo acceso se desactiva, portal del dueño enviado a ~45 clientes, avisos de refuerzo marcados como enviados por WhatsApp, una adenda y la foto de la factura de la última compra. Actividad → Revisar muestra anulaciones, precios y accesos.
- **Compras de reposición según lo que se usó** (antes se compraba siempre lo mismo y el stock crecía sin fin): stock e inventario realistas, con stock bajo.
- Números de factura de compra que no se repiten con historias largas.

### Sistema de prueba en el mismo servidor (25 nov)
- **Prueba sin tocar los datos reales:** servicios opcionales `prueba-db` y `prueba-api` en `docker-compose.server.yml` (perfil `prueba`, se encienden con `COMPOSE_PROFILES=prueba` en `.env`). Base de datos aparte, comprobantes simulados, sin correo ni respaldos, misma versión que la clínica.
- **Caddy:** la configuración del sitio pasa a un bloque reutilizable (`import app <api>`) y carga sitios extra desde `~/uywa/sites/*.caddy` (vacía = solo la clínica). Nuevo `deploy/sites/prueba.caddy`.
- Docs: `docs/DEPLOY.md` sección 10 y `docs/COMANDOS-SERVIDOR.txt` (comandos del servidor para el día a día). Procedimiento para archivar y liberar el Drive cuando se llene.

### ¿Olvidaste tu contraseña? por correo (25 nov)
- **Pantalla de ingreso:** enlace "¿Olvidaste tu contraseña?" (solo si el servidor tiene correo). El usuario recibe un correo con un enlace que vale 30 minutos y sirve una vez; crea su clave nueva en `/recuperar`.
- Siempre responde lo mismo exista o no el correo; máximo 3 pedidos por hora y cuenta, 5 por minuto por conexión. En la base solo se guarda el hash (`password_resets`).
- Al restablecer: desbloquea la cuenta, quita la clave temporal y cierra las sesiones de otros equipos. Queda en Actividad.
- Servidor: `GET /auth/options`, `POST /auth/forgot`, `POST /auth/reset`; `MailService` con nodemailer (Gmail + contraseña de aplicación). Variables nuevas: `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (y `SMTP_HOST`, `SMTP_PORT`, `APP_URL`). Migración `20261125020000_recuperar_clave`.
- Dependencia nueva del backend: `nodemailer` 10.6.1.

### Despliegue por imágenes privadas (protege el código) (25 nov)
- El servidor de la clínica ya **no recibe el código fuente**. En la PC se arman las imágenes y se suben al registro privado de GitHub (GHCR); el servidor solo las descarga.
- El JavaScript del backend se **compacta y se le quitan los mapas de código** dentro de la imagen (`backend/scripts/minify-dist.mjs`, llamado desde `backend/Dockerfile`): en el servidor no queda código legible. Verificado: la API compactada arranca y responde igual.
- Nuevos: `deploy/docker-compose.server.yml` (el servidor solo necesita este archivo y `.env`, sin `git clone`) y `deploy/publicar-imagenes.ps1` (arma y sube API, web y respaldo a GHCR).
- `docs/DEPLOY.md` actualizado: instalar y actualizar con `docker compose ... pull` en vez de `git`.
- No cambia el método viejo para pruebas locales ni el CI (`deploy/docker-compose.yml` sigue armando desde el código).
- Imagen del backend: el seed (`npx prisma db seed`) funciona sin `src/` (enlace al cliente de Prisma compilado).
- `deploy/web.Dockerfile.dockerignore`: al armar la web desde Windows ya no se copia el `node_modules` de Windows (rompía `ng build` con "node.exe: not found").

### Actividad: para revisar, filtros simples y soporte claro (25 nov)
- **Para revisar · últimos 7 días** arriba: cierres con diferencia, anulaciones, cambios de precio, ajustes de stock, accesos fallidos, cambios en facturación y de usuarios o datos. Cada tarjeta filtra la lista; "Ver los N" muestra todo lo marcado.
- **Áreas como botones** (antes lista) con 3 nuevas: Facturación, Hospitalización y Exámenes. "Revisar" lleva su número.
- **Período como en Reportes:** Todo, Hoy, 7 días, 30 días y Fechas. Fechas al revés: aviso en ámbar con "Intercambiar fechas" (se muestran ordenadas).
- **Repetidos juntos:** 3 o más acciones iguales seguidas de la misma persona van en una fila ("Inició sesión · 16 veces, de 00:03 a 01:37") que se abre.
- **Ícono por área** en cada fila. En celular, las áreas se deslizan y "Persona y fechas" se abre en una hoja.
- **19 acciones salían en código** ("hospitalization.discharge"): ahora todas tienen nombre (facturación, hospitalización, exámenes, movilidad, horario) y su detalle se lee ("Salida: Alta", "Exámenes: …").
- **"Ver" abre más cosas:** citas, grooming, cola, cierre de caja, presupuesto, hospitalización, exámenes, comprobantes, receta, consentimiento, mascota y datos de la clínica.
- **Soporte (Uywa) no se muestra** en Actividad ni en Reportes → Control (ingresos, ajustes ni cambios de precio). Queda guardado en la base por si hay un reclamo. Nadie puede borrar ni editar la bitácora.
- **Conexión limpia:** sin el "::ffff:" y sin mostrarla si es una dirección interna (red del servidor o de la clínica).
- Se suman a "Revisar": configuración y conexión de facturación, corregir rechazado, cambiar a factura, precio de movilidad y examen cancelado.
- Servidor: `GET /activity/review`; `GET /activity` acepta `kind` y las áreas `billing`, `hospitalization`, `lab`; oculta lo de la cuenta de soporte.

### Reportes: más datos, gráficos y pestaña Control (25 nov)
- **Rediseño de Ventas, Margen e Inventario** con más datos: frases que resumen el período, gráficos ECharts (ventas en el tiempo, medios de pago, horas con más ventas, mapa de rentabilidad, valor por categoría, vencimientos por semana, compras contra salidas, cobertura en días) y listas con "Ver todo".
- **Nueva pestaña Control:** descuentos (quién, por qué, a quién, tope), anulaciones, cierres con diferencia (enlace al cierre), mermas, quién hizo qué y cambios de precio.
- **Período hasta 2 años** (antes 1) con 8 atajos (Hoy, 7 días, 30 días, Este mes, Mes pasado, 12 meses, Este año, Año pasado) y fechas propias. Fechas inválidas: aviso en ámbar con arreglo de un toque, sin error rojo.
- **Agrupación automática** por hora, día, semana o mes, y **comparación con el período anterior equivalente** (mismos días del mes/año anterior).
- **Inventario cuenta los productos desactivados con stock** (antes el valor salía menor) y avisa cuántos son.
- El período queda en la dirección y se mantiene al cambiar de pestaña; la vista anterior se queda mientras carga.
- Se ve bien en celular, tablet, laptop 1280 y PC; tablas en celular pasan a lista; nombres largos se cortan en 2 líneas; montos no se parten.
- Se quitaron el Excel de reportes y los gráficos antiguos (`sales-chart`, `bar-list`).
- Servidor: `GET /reports/control` (`control-report.service.ts`); `report-period.ts` con `previousOf`, `grainOf`, `bucketsOf`, `bucketSql`; demostración con descuentos.
- **Revisión con datos reales (25 nov):**
  - **Margen por día:** la línea de % ahora es oscura (antes verde igual que las barras) y hay leyenda visible "Margen en S/" y "% de margen"; en el detalle cada serie tiene su marca.
  - **Indicadores** con su línea chica (cobrado, atenciones, ticket, clientes nuevos) y montos desde S/ 1,000 sin céntimos (S/ 37,859).
  - **Sin datos del período anterior:** se avisa una vez junto a las fechas, no "Sin datos antes" en cada tarjeta.
  - **Clientes nuevos = vinieron por primera vez** (antes contaba registrados y podía salir "90 de 82 atendidos"). En Clientes: "% volvió" = vinieron 2 días o más; el gráfico separa primera vez y los que vuelven.
  - **Listas que crecen no estiran la tarjeta:** tope fijo y "Ver todos" en un modal en Te deben hoy, Mejores clientes, Margen por categoría, Sin costo, Para cuántos días alcanza, Clientes con más descuento y Mermas; Por reponer lleva a Inventario filtrado.
  - **Movilidad** en una tarjeta delgada a todo lo ancho (ya no queda estirada y vacía); se oculta si no hubo movilidad. Por especie muestra mascotas y promedio en la misma lista (sin tarjetas sueltas). "Últimos 12 meses" no se repite cuando el período ya va por mes.
  - Accesibilidad: textos grises con contraste 4.5:1, iniciales en blanco sobre tonos oscuros, barras de margen en verde oscuro (sin auditoría axe con errores en las 4 pestañas, el selector de fechas ni los modales).
- Dependencia nueva: `echarts` 6.1.0 (carga diferida, ~194 KB gzip). **Correr `npm install` en frontend y reconstruir la imagen `web`.**

### Movilidad: recojo y entrega con precio (24 nov)
- **Recojo, entrega o ambos en consultas y grooming**, con la dirección del dueño y **el precio que pone recepción según la distancia** (viene el último que pagó). Se marca en Nueva cita, Agregar a la cola y el ingreso de grooming.
- **Se cobra** como una línea más ("Movilidad · Recojo y entrega"), con IGV y en el mismo comprobante. **En Caja se corrige el precio** con el lápiz mientras no se cobre.
- **Cancelar después de ir a recogerlo:** "Cobrar la movilidad igual" al sacar de la cola o cancelar el grooming.
- **Lo trajo y ya no puede volver:** la movilidad se agrega después. En grooming, "Agregar"/"Cambiar" en el detalle del tablero; en consulta, el ícono de movilidad en la tarjeta de la cola o "Llevar a casa" en Terminados (también ya atendido). Servidor: `PATCH /grooming/:id/transport`; la cola acepta cambiar solo la movilidad de una consulta atendida.
- **Cola:** la tarjeta muestra la movilidad; las consultas atendidas con entrega salen como **"Falta llevarlo a casa"** con "Entregado en casa" (y "N por llevar a casa" arriba). Si queda internado, se recuerda en la hoja de internamiento.
- La agenda muestra la movilidad de la cita. La demostración ya no usa el servicio "Movilidad (recojo y entrega)" de precio fijo.
- Servidor: migración `20261124010000_movilidad` (cola, citas, grooming y servicio interno `system_key`); `PATCH /charges/:id/transport-price`, `GET /clients/:id/transport-price`, `POST /queue/:id/delivered-home`; `chargeTransport` al cancelar.

### Inventario: tarjetas que filtran bien e inactivos (23 nov)
- **Cada tarjeta filtra lo suyo:** antes "Vencidos", "30 días" y "60 días" mostraban la misma lista. Ahora vencidos, 0–30 y 31–60 días, ordenados del que vence antes.
- **Inactivos:** lista Activos/Inactivos (admin y veterinario) para encontrar y reactivar un producto desactivado; antes no había forma de llegar a él.
- **Total en la unidad mínima** ("2 cajas · 200 tabletas") en la lista y la ficha; fecha y lote ya no se parten.
- **Registrar salida** dice cuánto hay (del lote elegido); **Conteo físico** muestra la diferencia antes de guardar.
- **Kardex:** las ventas dicen comprobante y cliente en vez de repetir el nombre del producto.
- **Compra rápida con comprobante:** aviso de registrarla en Compras para el Excel del contador.
- **Se quitó "Con receta"** (etiqueta y casilla; no hacía nada). Los controlados no cambian.
- Unidad SUNAT como lista; tabla del detalle de compra sin cortes en tablet; "1 movimiento" en singular; pestañas siguen marcadas con filtros.
- Servidor: filtros `expired`, `exp30`, `exp60` en `GET /inventory/products` (ordenados por vencimiento); kardex con `sale` (comprobante y cliente). Las pruebas e2e desactivan sus productos y proveedores al terminar.

### Filtros sin saltos (23 nov)
- Al tocar un filtro (tipo, periodo, estado, pestaña, búsqueda) **la lista anterior se queda hasta que llega la nueva**: ya no se vacía ni muestra el "cargando", la página no se achica y no vuelve arriba. En Comprobantes, Atenciones, Historias clínicas, Exámenes, Presupuestos, Compras, Proveedores, Citas, Clientes e Inventario.
- `loaded()` guarda lo último mientras carga (prueba en `resource.spec`); el "cargando" sale solo la primera vez.

### Comprobantes: filas más cortas y corregir rechazados (23 nov)
- **El diseño de siempre, con arreglos:** "A4" y "Ticket" a la vista; **"Cambiar a factura"**, "PDF del PSE" y **"Anular cobro…"** (administrador, lleva al ticket) en **⋯**. La fila ya no baja a dos líneas. El ⋯ se abre hacia arriba cerca del borde y se cierra con Esc.
- **Corregir un rechazado:** si SUNAT rechaza una boleta o factura (DNI, RUC o nombre mal), **"Corregir"** emite otra del mismo tipo para el mismo cobro con los datos corregidos, sin nota de crédito y sin tocar el pago ni la caja. Antes había que anular el cobro y cobrar de nuevo. El rechazado queda como "Rechazado · corregido" y deja de contar en el aviso, la campana e Inicio (también si se anula el cobro o se cambia a factura).
- **"Cambiar a factura" solo dentro del mes de la boleta** (el mes anterior ya se declaró): fuera de él sale el motivo. Una boleta rechazada se puede cambiar siempre.
- **"Simulado" en gris:** el verde queda solo para "Aceptado por SUNAT".
- **Caja y recepción:** el aviso de problemas dice "Corrige los rechazados; si es un error de envío, avisa al administrador".
- **Celular:** el número no se parte; el tipo va junto a la fecha; el periodo es una lista.
- Accesibilidad: filtro de tipo con `aria-pressed` (no eran pestañas); botones de 40 px (44 en celular).
- Servidor: `POST /billing/documents/:id/reissue`; columna `replaced_at` (migración `20261123020000_comprobante_corregido`, marca los rechazados ya resueltos).

### Exámenes: lista compacta por mascota y atención (23 nov)
- **Agrupados por mascota y atención** (enlace "Atención del 19 nov ›" y a la historia). Una fila por pedido con barra de 4 pasos ("Muestra tomada · 4 días · llama al lab") y **un solo botón: el siguiente paso** (Registrar muestra, Subir resultado, Revisar e interpretar, Avisar al dueño). Tocar la fila abre indicación, fechas, resultado e interpretación.
- **Botones con número** (Esperando · Por revisar · Revisados), **buscador** (mascota, dueño, DNI, celular o código EX) y **Lugar** (clínica o laboratorio externo). Un solo aviso de demorados; **Ver más** en vez del tope de 200.
- **Revisados:** se ve lo que escribió el médico; primero los que falta avisar al dueño.
- **⋯ según el rol:** Cancelar solo médico o administrador y antes del resultado; "Subir resultado ahora" (pruebas rápidas sin muestra) y "Cambiar resultado". Recepción con la muestra tomada no tiene ⋯.
- **Cancelar un examen ya pagado:** antes daba error ("primero anula el cobro en caja") y el examen quedaba demorado para siempre. Ahora se cancela y el cobro se queda; el aviso dice que la devolución es con nota de crédito en Comprobantes. Sin pagar, se quita de la cuenta como antes.
- **Revisar e interpretar** muestra especie, raza, sexo, edad y peso (los valores normales dependen de eso).
- **Subir resultado:** en PC, arrastrar o "Elegir archivo"; en celular y tablet, **Tomar foto** (cámara trasera) y "Elegir archivo o PDF". Vista previa con el peso y "Subir en calidad original".
- Pantalla a todo el ancho; dentro de la atención las mismas filas sin agrupar. Celular y tablet: la barra baja debajo del nombre (las filas se acomodan al ancho de su tarjeta, no de la pantalla).
- Accesibilidad: filtros con `aria-pressed`, filas con `aria-expanded`, ⋯ se cierra con Esc y devuelve el foco, especie con texto, resultados de búsqueda anunciados.
- Servidor: `GET /lab-orders` con `q`, `destination`, `skip`/`take` (máx. 100) y `counts` (pending, ready, reviewed, overdue, toNotify); mascota con raza, sexo, nacimiento y peso; `paid` en cada pedido.

### Atenciones: lista más clara y pruebas en su propia clínica (23 nov)
- **Cobro:** "Lleva S/ …" mientras sigue abierta, "Por cobrar" solo si está cerrada con saldo.
- **Internamiento** con su etiqueta también cuando ya está cerrado.
- **"Abiertas 7"** con su número (para ver solo las de un médico, el selector de veterinarios).
- **Celular:** el estado y el cobro bajan a su línea; se ve quién atendió y la hora. Tablet: buscador a todo el ancho.
- Accesibilidad: filtros de estado con `aria-pressed` y 44 px en celular; la cursiva ya no se corta.
- Servidor: `open` (abiertas en total) en la lista de atenciones.
- **Pruebas en el navegador en una clínica aparte:** `scripts/e2e-clinic.mjs` crea "Clínica de pruebas (E2E)" (`e2e@uywa.pe`); las pruebas la usan por defecto. La demostración ya no se ensucia.

### Historias clínicas: encabezado y arreglos (23 nov)
- **Encabezado** con el dueño (enlace a su ficha), la próxima cita y una acción principal: **Atender** (médico) o **A la cola** (recepción). Agendar e Historia completa a la vista; Presupuesto, Ingreso a grooming e Imprimir carnet en **⋯**.
- **Tablet:** el nombre ya no se corta letra por letra; los botones bajan a una fila.
- **Atenciones:** solo las médicas, con etiqueta Consulta o Internamiento; los baños quedan en Grooming.
- **Vacunas:** resumen "Vencido" o "Próximo refuerzo" (de la última dosis de cada vacuna).
- "Archivos y consentimientos" antes que Grooming; "esterilizada" para hembras.
- Corregido: un internamiento salía como "Consulta".
- Servidor: `nextAppointment` en el carnet de la mascota.
- Pruebas en el navegador: `global-teardown` desactiva al final lo que crearon (clientes, mascotas, servicios y usuarios de prueba).

### Clientes: ficha más rápida y registro con DNI (23 nov)
- **Barra fija con el nombre** al bajar por la ficha (documento, deuda, Llamar, WhatsApp, + Mascota).
- **Mascotas:** próxima cita en la tarjeta; "Agendar" (Nueva cita con la mascota puesta) y menú ⋯ con Ingreso a grooming y Editar mascota. Desde 4 mascotas, buscador y filtros (especie, Con alerta) con las mismas tarjetas.
- **Atenciones:** las 5 últimas, filtro por mascota y "Ver las N".
- **Celular:** cuenta, mascotas y atenciones primero; los datos del dueño al final.
- **Nuevo cliente:** el DNI o el RUC llena el nombre (clínica o APISPERU); aviso si el celular ya es de otro cliente (no bloquea).
- **Editar cliente:** factura con "+ Agregar RUC para facturas" y tarjeta compacta con la razón social de SUNAT.
- Corregido: "Última visita" salía vacía si la atención no pasó por la cola; "Portal del dueño" y "Protección de datos" iban pegadas; la cuenta no decía que una atención seguía abierta.
- Servidor: `GET /api/clients/lookup-phone`, `nextAppointment` en las mascotas de la ficha, `inProgress` en la cuenta; el veterinario puede usar la consulta de DNI/RUC.

### Citas: vista semana y arreglos (22 nov)
- **Vista Semana** (botón Día | Semana): pestañas por médico y "Todo el equipo". Un médico: 7 columnas por hora; clic en un hueco agenda. Todo el equipo: una fila por médico, hasta 3 citas por día y "+N más"; "+ Agendar" en los días libres. El médico entra a su semana; recepción, al equipo. En celular, lista por día. Se recuerda la última vista.
- **Nueva cita** viene con la primera hora libre del médico (no las 09:00 fijas).
- **"Por confirmar" en celular** se abre como hoja desde abajo (el menú se cortaba).
- Corregido: el WhatsApp de una cita decía el día que se estaba mirando en vez del de la cita; "Llegó" depende del día de la cita.
- La prueba automática "consulta completa" desactiva su veterinaria de prueba al terminar (ya no se acumulan "Dra. Prueba" en la agenda de la demo).

### Atención: arreglos sin cambiar el diseño (22 nov)
- **Recepción en una consulta** registra solo el motivo, el peso y la temperatura (triaje); la anamnesis, el examen, el diagnóstico y el plan quedan bloqueados con un aviso, y no ve "Cerrar atención" ni las plantillas. El servidor también lo exige (403). En grooming sigue escribiendo sus notas; el administrador sí puede cerrar una consulta.
- **Celular y tablet de pie:** la tarjeta "Paciente" (peso anterior, última consulta, refuerzos) va arriba, debajo de las alertas. En celular los botones del encabezado van en una fila y "Guardar como plantilla" pasa al menú "⋯".
- La tarjeta "Paciente" ya no repite la alergia ni el "agresivo" (están arriba); muestra "Ninguna registrada" si no tiene alergias.
- **"Última consulta"** en vez de "Última atención": solo consultas y hospitalizaciones (un baño no la tapa). El groomer sigue viendo su último grooming.
- **Peso:** si es más del doble o menos de la mitad del anterior, el campo se pinta ámbar con "¿Seguro? Antes pesaba X kg" (no bloquea).
- **Receta "Se entrega en la clínica":** la presentación más chica sale primero y la cantidad se calcula sola (dosis × tomas al día × días; ej. 1 tableta c/12 h × 5 días = 10). Si se cambia a mano, ofrece "Usar N". La cantidad guardada en una plantilla se respeta.
- El menú "⋯" se cierra con Esc o tocando fuera; "Agregar adenda" se activa al escribir.

### Cobro: agregar productos y factura compacta (22 nov)
- **Agregar productos o servicios al cobro** de una consulta, grooming u hospitalización: buscador "Agregar producto o servicio" (F2) debajo de los cargos. Lo agregado sale en la lista como **Nuevo**, va en **el mismo comprobante y un solo pago**, y descuenta stock al cobrar (todo o nada).
- **Abonos:** lo agregado en caja se paga completo y primero; el abono solo aplica a los cargos. El servidor rechaza un abono que no cubra lo agregado.
- Un **controlado** no se agrega en caja: se registra en la atención con su receta (igual que en la venta de mostrador).
- **Anular un cobro con productos vendidos en caja** (mostrador o agregados) pregunta "¿Devolvió los productos?": sí → se quitan de la cuenta del cliente y vuelven al stock; no → quedan por cobrar.
- **Factura compacta:** solo el campo RUC; lo encontrado (SUNAT o la clínica) se muestra en una tarjeta con la dirección. La razón social de SUNAT no se edita (el lápiz edita la dirección). Si no aparece, se pide la razón social. El correo va en "Enviar el PDF por correo". Igual para el DNI de la boleta de más de S/ 700.
- Corregido: el monto de "Cómo paga" no se actualizaba al agregar algo en el cobro.

### Caja tipo POS: Venta de mostrador y Cobrar (22 nov)
- **Panel de cobro fijo a la derecha** (laptop y tablet acostada): total en grande, comprobante en pestañas (Boleta | Factura | Nota de venta), datos del comprador solo cuando hacen falta, cómo paga con lo recibido y el vuelto, y el botón **Cobrar** siempre visible abajo, aunque el pago sea dividido o la venta tenga 20 ítems.
- **Izquierda:** en la venta, cliente, buscador (F2) y la lista con ícono de servicio o producto, que baja sola; en Cobrar, los cargos con "N de M cargos", "Marcar todo" y el abono.
- **Avisos de stock en la línea** antes de cobrar: "Quedan 3", "Solo hay 2" o "Sin stock registrado".
- **Venta vacía:** "Agrega lo que lleva el cliente" y Cobrar desactivado con el motivo.
- **Errores junto al campo:** lo recibido que falta o un pago que no cuadra sale debajo de "Recibido" (ya no como aviso flotante); los datos de factura o DNI que faltan se marcan en su campo.
- **Atajos:** F2 busca producto, Enter agrega, Ctrl+Enter cobra (se ocultan en pantallas táctiles).
- **Tablet de pie y celular:** todo baja en una columna y Cobrar queda fijo abajo; las líneas de la venta ponen el nombre arriba y la cantidad e importe debajo.
- Botones de montos rápidos y pestañas de 44 px en pantallas táctiles.

### Boleta y DNI: límite exacto de SUNAT (22 nov)
- **Corregido:** el DNI del comprador se pedía desde S/ 700.00 y SUNAT lo exige cuando la boleta **supera** S/ 700. Ahora una boleta de S/ 700.00 justos de "Cliente varios" sale sin DNI; desde S/ 700.01 lo pide (servidor y web). Textos: "Más de S/ 700…".
- Si el cliente registrado ya tiene su DNI en la ficha, no se pide nada (sin cambios).
- Caja: el buscador de la venta de mostrador dice "Busca por nombre: pipeta, collar, consulta…" (sin mención al lector de códigos).

### Caja: cobrar en menos pasos (22 nov)
- **Por cobrar:** lo de hoy va arriba ("De hoy", el último en terminar primero) y los saldos de días anteriores debajo. Antes el cliente que estaba en el mostrador quedaba al final de la lista.
- **Se actualiza solo** cada 30 segundos y al volver a la pestaña: lo que cierra el veterinario aparece sin F5.
- **Cobro en dos columnas** en laptop y tablet acostada: "Recibido" y el vuelto se ven sin bajar en el modal. Un cobro normal: Cobrar → Exacto → Cobrar.
- **Abono:** el monto a cobrar aparece solo con "Paga solo una parte (abono)".
- **Venta de mostrador:** Enter agrega el producto, flechas para elegir, y funciona con lector de código de barras (agrega la presentación exacta).
- **Ticket:** caja y recepción ven "Para anular este cobro, pídelo al administrador".
- La lista de "Por cobrar" trae la fecha del último cargo (`last`).

### Tablet (21 nov)
- **Tablet acostada y laptops chicas (1024–1279 px):** el menú lateral arranca solo con íconos (se puede abrir con el botón de abajo; en escritorio se sigue recordando la preferencia). Las pantallas ganan ~190 px y entran sin apretarse.
- **Pantallas táctiles:** botones de al menos 44 px de alto.
- **Atención:** el examen físico va en 2 columnas en tablet acostada (los nombres de los campos ya no se encimen).
- **Cola:** el celular del dueño en su propia línea (ya no se corta), "Atiende…" debajo del tiempo y "Continuar" corto en pantallas medianas.
- **Inventario y Compras:** los botones de arriba quedan en una fila.
- **Grooming:** arrastrar con el dedo pide mantenerlo un momento (no se confunde con bajar la pantalla).
- **Recepción ya no abre consultas** ("Atender" en la cola y en la ficha del cliente): la atención quedaba a su nombre. Pone al paciente en la cola o "En espera" y lo llama el veterinario. El servidor también lo impide. El ingreso de grooming no cambia.
- Recorrido de pantallas (`e2e/qa-recorrido.cjs`) con `MODES=tablet,tablet-h`: 0 problemas en 468 pantallas (tablet de pie y acostada, escritorio y celular).

### Revisión completa por flujos (21 nov)
- Recorrido de las 390 pantallas (5 roles, escritorio y celular): sin errores de consola, sin respuestas 4xx/5xx inesperadas, sin textos "undefined"/"NaN" ni desbordes. Los 5 recorridos de punta a punta en el navegador (día completo, consulta con cita, grooming, compra, números que cuadran) pasan.
- 40 revisiones de cuadre de datos sobre una clínica de prueba grande (8,000 clientes, 45,000 atenciones, 43,000 comprobantes): caja, cobros, comprobantes (sin huecos ni repetidos), inventario y kardex, compras, presupuestos, recetas, vacunas, hospitalización, exámenes, citas, grooming y separación entre clínicas. Todas en 0.
- **Corregido — Inicio "Cobrado hoy":** con la entrega anterior un cobro anulado el mismo día seguía sumando en el número grande y Inicio no coincidía con Caja y Reportes. Ahora lo anulado hoy sale de "cobrado" y "devuelto" es solo por cobros de días anteriores.
- **Corregido — Agenda:** en citas angostas (dos a la misma hora con el mismo profesional) los botones rápidos tapaban el centro y un clic para abrir la cita podía confirmarla. Ahora son dos íconos chicos en la esquina y solo en citas que ocupan todo el ancho.
- Pruebas del navegador: el "Vuelto" se compara sin depender de espacios.

### Facturación solo para soporte técnico (21 nov)
- El dueño (administrador) ya no ve **Comprobantes → Configurar** ni el token: la pantalla, el botón "Configurar"/"Activar" y los enlaces desde Caja son solo de soporte técnico (`GET /billing/settings`, `PUT /billing/settings/token` y `POST /billing/settings/test` responden 403 a los demás).
- Si la facturación se detiene, el dueño ve "La conexión con Mifact no funciona… Puedes seguir cobrando… Avisa a soporte técnico" con "Ver comprobantes" (sin hablar de tokens). Soporte ve el detalle y "Actualizar token".
- Los avisos de token viejo, cupo y vencimientos, y el aviso de "se cambió la configuración", los ve solo soporte técnico.

### Avisos antes de que algo se detenga (21 nov)
- **Token de Mifact viejo:** se guarda cuándo se actualizó el token; a los 5 meses el administrador ve "El token de Mifact tiene 5 meses" con el botón "Actualizar token" (Mifact lo cambia cada ~6). En Facturación: "Token guardado hace N días".
- **Cupo del mes:** en Facturación → "Plan y vencimientos", soporte pone los comprobantes por mes del plan (ej. 300). Al 80 % aviso ámbar ("Usaste 240 de 300…"); al llegar al límite, rojo. Cuenta solo lo enviado al PSE (no la simulación).
- **Vencimientos** del plan del PSE, del dominio y del servidor: aviso ámbar desde 30 días antes (se oculta hasta el día siguiente) y rojo desde 7 días y después de vencer.
- Solo los ve soporte técnico; van debajo del aviso de facturación detenida. Migración `20261121010000_vencimientos_cupo` (se aplica sola al arrancar la API).

### Inicio: "Cobrado hoy" sin negativos (21 nov)
- Un día con solo devoluciones mostraba "S/ -45.00 · 0 cobros". Ahora el número grande es lo cobrado y lo devuelto sale aparte en rojo ("S/ 45.00 devuelto", lleva a Caja). El resumen del día (`/api/dashboard`, `sales`) trae `collected` y `refunded` además del neto `total`.

### Demo: se puede rehacer otra vez (20 nov)
- `demo-data.mjs` con `DEMO_RESET=1` fallaba con 403 en "Clínica, horario y comprobantes": la configuración de facturación ahora solo la cambia soporte técnico. El script le da ese permiso al dueño de la demo solo durante esa llamada y se lo quita al terminar.

### Mifact: se muestra el error real (20 nov)
- Cuando Mifact rechazaba un envío con un texto como "…ya que el documento de referencia no existe", el sistema lo tomaba por "ya enviado", consultaba y mostraba "El documento consultado no existe". Ahora "ya que" / "no existe" no cuentan como duplicado y, si la consulta tampoco encuentra el documento, se muestra el mensaje original del envío.
- Si Mifact dice que el número "ya existe" pero no lo encuentra con esa fecha y datos (el número ya se usó desde otro sistema o en el RUC compartido de pruebas), el aviso lo dice y sugiere usar una serie nueva.

### Agenda de citas más profesional (19 nov)
- **Horario de atención** (Clínica → Horario) en la agenda: la grilla empieza a la hora de apertura; lo cerrado sale sombreado ("Antes de abrir", "Cerrado", "Cerrado este día") y lo que ya pasó, atenuado. Nuevo `GET /api/clinic/hours` para cualquier rol.
- **Al pasar el mouse** por una columna se ve "+ 10:30 · Nueva cita" donde caería la cita (nunca en horas pasadas).
- **Calendario del mes** propio (reemplaza al selector de fecha del navegador) con los días con citas y por confirmar marcados.
- La cabecera con los nombres queda fija y sólida; se quitó el aviso "Sin citas" que se superponía (queda uno solo arriba); el rol del profesional sale al pasar el mouse; sin barra horizontal si caben las columnas.
- **Lo que sigue** va como etiqueta sobre la línea de la hora actual ("Sigue: 17:30 Gatubela · en 1 h 13 min"; clic abre la cita; si hay varias a la misma hora con distintos profesionales, salen todas: "Copo (Dra. Lucía R.) y Kiara (Dr. Carlos M.)"). **Por confirmar** es un botón ámbar con el número junto a "Nueva cita": abre la lista con WhatsApp y Confirmar. Al pasar el mouse por una cita por confirmar aparecen WhatsApp y Confirmar sin abrirla. Sin panel lateral: la agenda usa todo el ancho.
- En pantallas anchas la semana, la navegación y los filtros van en una sola fila; los días muestran puntitos por cita (ámbar si hay por confirmar).
- La cabecera de columnas muestra el nombre corto ("Dra. Lucía R.", el completo al pasar el mouse); el rótulo "Antes de abrir" va a la izquierda.

### Los insumos no se cobran aparte (19 nov)
- Producto con casilla **"Se cobra al cliente"**: apagada por defecto en **Insumos** (jeringas, guantes…), encendida en lo demás. Migración `20261119020000_producto_se_cobra` (los insumos existentes quedan sin cobrar).
- Los buscadores de cobro (Atención, venta de mostrador en Caja, Presupuestos) ya no muestran insumos, y el servidor rechaza cobrarlos: "es un insumo de uso interno". Un presupuesto ya aceptado se respeta. Antes se podía cobrar, por ejemplo, una caja de 100 guantes por un par.
- **"Insumos usados (sin cobrar)"** en la Atención (veterinario o administrador): material extra que sale del inventario anotado a la mascota, sin cobrarse. Los controlados siguen con su propio registro.
- Etiqueta "No se cobra" en el producto; importar Excel aplica la misma regla por categoría.

### Buscar paciente igual en todo el sistema (19 nov)
- El buscador de paciente de **Nueva cita**, **ingreso a Grooming**, **Presupuestos** y **uso de controlados** ahora es igual que "Agregar a la cola": cada dueño con su DNI y celular, sus mascotas con especie, sexo, edad y raza, etiquetas Agresivo/Alergias, lo buscado en negrita y Enter si hay una sola mascota.
- La mascota elegida muestra su N.º de historia, sus datos, el celular del dueño y los avisos (con la nota de manejo).

### Agregar a la cola más claro (19 nov)
- **Agrupado por dueño, como antes**, ahora con su **DNI y celular** debajo del nombre; lo buscado va en negrita (se ve por qué salió).
- **Cada mascota** muestra "Perro · Hembra · 2 años · Shih tzu" y las etiquetas **Agresivo**/**Alergias** si aplica; "Ya en la cola · En espera" si ya está.
- **Al elegirla:** el resumen repite los datos y los avisos (con la nota de manejo, p. ej. "usar bozal"); motivos rápidos Consulta · Vacuna · Control · Desparasitación · Curación.
- El buscador se enfoca solo; **Enter** elige si hay una sola mascota posible; "Hay N clientes más" si no caben; "Registrar cliente nuevo" llega con lo escrito (DNI, celular o nombre).

### Avisos con movimiento suave (19 nov)
- El panel de la campana se abre desde la campana y se cierra más rápido; los banners entran y salen con un deslizamiento corto; la campana se balancea una vez cuando llega algo urgente (no al entrar a la app). Solo transform y opacidad, sin librerías; con "reducir movimiento" queda en un fundido.
- **Menos consumo:** se quitó el desenfoque (vidrio esmerilado) de la barra de arriba y de las barras fijas de Nuevo cliente, Nuevo producto y Agenda; se recalculaba en cada desplazamiento. Se ven igual (fondo casi opaco).

### Facturación vigilada, fase 1 (19 nov)
- **Revisión automática de la conexión con el PSE** a las 00, 06, 12 y 18 h (y al arrancar), sin emitir nada; cada envío también actualiza el estado. Migración `20261119010000_salud_facturacion`.
- **Banner "La facturación está detenida"** si el token no sirve o el servicio está cortado: el administrador con "Actualizar token"; caja y recepción con "Puedes seguir cobrando… avisa al administrador". En la campana, un solo aviso en vez de uno por comprobante.
- **Reenvío automático** al arreglarse (token nuevo, pago, vuelve la red) de los comprobantes detenidos por esas causas; antes había que usar "Reintentar todos".
- **"Sin conexión con Mifact"** (ámbar) solo tras 3 revisiones seguidas sin respuesta.
- **Comprobantes sin aceptar hace más de un día:** aviso al administrador y filtro nuevo en Comprobantes.
- **Arreglos:** "Probar conexión" daba por buena la conexión con el servicio suspendido; los comprobantes detenidos por el token no salían en el contador de la campana.
- "Conexión con Mifact: funciona · revisada…" en Comprobantes → Configurar.

### Importar inventario más fácil (18 nov)
- **Varios lotes de un producto:** se repite la fila de la presentación con el otro lote (antes daba "presentación repetida").
- **Lote obligatorio solo en vacunas y controlados;** en alimento, higiene o insumos basta el vencimiento.
- Columnas nuevas opcionales **IGV** (Gravado/Exonerado/Inafecto) y **Código de barras** (no puede repetirse ni estar en otro producto).
- Acepta plurales y abreviaturas ("Medicamentos", "Unid.", "Tabs", "cc").
- **Avisos en ámbar** que no bloquean: sin precio, sin costo, vence pronto. Filtro "Para revisar".
- El proveedor del stock inicial queda en la lista de **Proveedores** (uno solo aunque se escriba distinto).
- **Arreglo:** la tabla de revisión decía "Cliente/Mascota"; ahora Producto, Presentación, Stock inicial.

### Caja: control del efectivo y reporte de cierre (18 nov)
- **Egresos con tope:** no puede salir más efectivo del que hay en el cajón (servidor y pantalla). El modal muestra el efectivo disponible y motivos rápidos (Agua, Movilidad, Limpieza, Compras menores, **Retiro del dueño**, Depósito al banco).
- **Reporte de cierre imprimible** (80 mm o PDF) con arqueo, apps/POS a revisar, egresos y firmas. Botón en "Último cierre", que ahora se carga al entrar con la caja cerrada.
- **Contar por billetes y monedas** al cerrar (opcional).
- **Caja de otro día:** aviso más claro arriba y al cobrar ("Esta caja es del 12 nov. (hace 6 días)").
- "Igual que la última vez" al abrir; tarjeta **Cobrado neto** con cobros − devoluciones; cada medio muestra lo devuelto; deudas resaltadas desde 7 días.

### Servicios y precios más claros (18 nov)
- **Arreglo:** un presupuesto pendiente o aceptado se puede pasar a la atención y cobrar **aunque después se haya desactivado** un servicio o producto cotizado (antes daba "no existe o está inactivo"). Desactivar solo impide usarlo en cobros nuevos; al desactivar, avisa en cuántos presupuestos pendientes está.
- **La categoría dice dónde aparece:** Grooming solo en el tablero de Grooming; Laboratorio en Exámenes; Hospitalización al dar de alta; el resto en Atención, Caja y Presupuestos. También al lado de cada grupo de la lista.
- **Avisos** si falta un servicio de Hospitalización, Laboratorio o Grooming, con botón para crearlo.
- Formulario en 3 secciones (Qué es · Precio · Insumos); precio con "Sin IGV · IGV" en vivo; ayuda del IGV; duración como referencia (no cambia la agenda); "Activo" explicado.

### Plantillas clínicas más claras (18 nov)
- **"Cómo funciona"** en 3 pasos (se puede ocultar) y una línea por pestaña que dice dónde se usa cada tipo. Buscador cuando hay más de 6.
- **Recetas frecuentes ligadas al inventario:** el medicamento se busca en el inventario; elegido, queda "Del inventario: se entrega y cobra" con su cantidad. Escrito a mano queda como **receta externa** (no se cobra). Antes, las creadas en esta pantalla nunca se cobraban al usarlas.
- Al editar, avisa si un medicamento ya no está en el inventario (queda como externa).
- Etiquetas visibles y mensajes de qué falta en cada campo; ayuda y ejemplo en cada campo del SOAP; uso de ___ para los datos del paciente; aviso "la dosis es de referencia: ajústala al peso".
- Cancelar con cambios pregunta "¿Descartar los cambios?". Las tarjetas marcan cada medicamento como "Del inventario" o "Externa".

### Facturación a prueba de errores (18 nov)
- **Cuenta de soporte técnico:** la única que cambia la configuración de facturación (proveedor, ruta, producción, series, razón social, ubigeo) y el RUC de la clínica con el PSE activo. Se marca en el servidor; nadie de la clínica la edita, desactiva ni le cambia la clave, y no cuenta como "último administrador". Migración `20261118010000_soporte_tecnico`.
- **El dueño ve la configuración bloqueada y puede "Actualizar token":** el token nuevo se prueba con el PSE antes de guardarse; si falla, sigue el anterior.
- **Guardar ruta, token o ambiente prueba la conexión antes;** no deja cambiar de proveedor o de ambiente con comprobantes sin respuesta; cambiar series, proveedor o producción pide confirmar.
- **Mensajes claros de Mifact:** "El token venció: actualízalo…" y "Mifact restringió el servicio: revisa el pago". **Reintentar todos** en Comprobantes.
- **IGV de productos:** solo el administrador lo cambia (el veterinario los crea en Gravado).
- **Campana:** los administradores ven cuando alguien cambia la facturación o el token.
- **`BILLING_SECRET` obligatorio** en el servidor de la clínica (sin simulación), para que cambiar `JWT_SECRET` nunca deje la facturación sin token.

### Reportes sin Excel (17 nov)
- Se quitó **Descargar Excel** de Ventas, Margen e Inventario. Las listas de "más vendidos" y "productos con más valor" muestran los primeros y un botón **Ver los N restantes** para ver todo en pantalla. El Excel de **Comprobantes** y de **Compras** para el contador se mantiene.

### Cobro en caja (17 nov)
- **Código de operación opcional** en Yape, Plin y transferencia: si el dueño no lo tiene, se cobra igual. Si se escribe, mínimo 4 caracteres. El voucher de tarjeta sigue opcional y sin mínimo.
- **Cómo paga** con botones con ícono (Efectivo, Yape, Plin, Tarjeta, Transferencia): se elige uno.
- **Efectivo: "Recibido" es obligatorio** (también en el pago dividido), con montos rápidos: Exacto y los billetes por encima (S/ 297 → 300, 400). El vuelto se ve al lado. Si falta, avisa y lleva el cursor al campo.
- **Dividir el pago:** dos o tres medios (ej. efectivo + Yape). Al escribir un monto, el otro se ajusta solo; abajo dice "Cubierto", "Falta" o "Sobra" y el vuelto. "Un solo medio" vuelve atrás. Desmarcar un cargo o cambiar el monto a cobrar ya no borra la división.
- **Movimientos:** cada cobro dice cómo se pagó ("Efectivo S/ 50.00 + Yape S/ 30.00") y marca "sin código".
- **Cerrar caja → "Revisa en tus apps":** total por Yape, Plin, tarjeta y transferencia, cuántos pagos y cuántos sin código, para compararlo con el celular, el POS o el banco.
- La boleta/factura electrónica no cambia (SUNAT no lleva el medio de pago). El ticket ya imprime cada medio, lo recibido y el vuelto.

### Mejoras de pantallas (17 nov)
- **Orden alfabético en español** en clientes, mascotas, productos, servicios, usuarios, proveedores y plantillas: Álvaro va junto a la A y Ñ después de N (antes los nombres con tilde iban al final). Migración `20261117010000_orden_espanol`.
- **Hospitalización:** aviso rojo con las dosis atrasadas y botón para registrar la más antigua; atrasadas en rosa suave (no rojo fuerte); indicaciones como lista con su tipo en etiqueta; título del día antes de cada grupo de horas; aviso si pasaron más de 12 h sin signos vitales; FC y FR se marcan en ámbar/rojo fuera de rango según la especie; la evolución separa los días; signos vitales fijos al bajar.
- **Atención:** el resumen muestra los primeros cargos de la cuenta (y "N más") con **+ Agregar**, que lleva al buscador; queda fijo al bajar. Los signos fuera de rango marcan el borde del campo. Vacunas, exámenes y archivos sin cuadros vacíos.
- **Caja:** "Movimientos" queda fijo al bajar en pantallas grandes.
- Rangos de temperatura de hospitalización y del gráfico salen de la misma tabla de signos por especie.

### Reportes más pulidos
- "Por categoría" muestra las 6 primeras y **Ver las N categorías** abre la lista completa en una ventana; "Por categoría" y "Medios de pago" ya no dejan espacio vacío. El % de cada fila sigue siendo sobre el total.
- Sin datos del período anterior, la comparación dice "Sin datos anteriores" en gris y sin flecha (antes "Antes no hubo" con flecha de subida).
- "Por profesional": barras más visibles, medidas contra quien más vendió; Mostrador en gris.
- Margen: el % siempre con un decimal (41.0 %).

### Insumos de los servicios, más claros
- En el formulario del servicio, "Insumos del inventario que gasta": se descuentan solos del stock y **no se cobran aparte** (ya están en el precio). Una nota aclara que basta con lo que conviene controlar (vacunas, medicamentos, jeringas); lo barato de uso general (guantes, algodón, alcohol) no hace falta ponerlo.
- Cada insumo muestra su costo (último costo de compra, sin IGV) y abajo un resumen: **Insumos · Precio sin IGV · Te queda (%)**. Si los insumos cuestan más que el precio, se marca en rojo. Lo que nunca se compró por el sistema dice "Sin costo registrado".
- Un producto que se usa como insumo en servicios activos **no se puede desactivar**: el aviso nombra esos servicios. Antes se desactivaba y los servicios seguían descontando de un producto oculto.
- El listado de productos y la ficha traen el último costo de compra (`unitCost`).
- En el Kardex, lo que descuenta un servicio dice **"Servicio"** (antes "Uso interno", que queda solo para las salidas registradas a mano).

### Producción sin comprobantes simulados
- Nueva variable `BILLING_ALLOW_SIMULATED` (en producción `false`, ya puesta en `deploy/docker-compose.yml`). Así no se puede activar la simulación ni emitir un comprobante con el sello "Simulación · sin valor tributario". Si el PSE no está configurado, Caja emite nota de venta y avisa qué falta. En tu PC y en la demo sigue permitida.
- En Configuración de facturación, la opción "Simulación" no aparece en un servidor de producción.

### Inicio del administrador
- "Necesita atención" muestra los 5 avisos más urgentes; **Ver los N pendientes** abre la lista completa en una ventana, así el inicio no cambia de forma. El título dice cuántos hay y la tarjeta del mes ya no se estira con espacio en blanco.

### Presupuestos más claros
- El texto de la lista ya no los limita a cirugías: sirven para todo lo que el dueño debe aprobar antes (tratamientos, exámenes, hospitalización, paquetes).
- Botón **PDF** en el presupuesto (`PR-00004.pdf`), igual que en los comprobantes.
- Si el dueño no tiene celular, el botón dice "Sin celular" en vez de abrir un enlace roto.
- "Ya no lo hará" pasa a "El dueño desistió".

### Revisión automática de rendimiento
- Cada lunes 07:10 se revisa la base: consultas lentas (más de 300 ms en promedio), tablas grandes leídas enteras (índice que falta), limpieza atrasada, memoria y disco. Si hay algo, llega un correo con el informe (`PERF_PING_URL`, healthchecks.io); si todo está bien, nada. No cambia nada por su cuenta.
- La base de producción guarda estadísticas de consultas (`pg_stat_statements`) y registra con su plan las que tardan más de 1 s, sin los valores de los parámetros. Memoria ajustada a un VPS de 8 GB (`shared_buffers` 512 MB).

### Respaldos incrementales
- El respaldo diario usa **restic**: el primero es completo y desde ahí solo sube lo que cambió, pero cualquier día se restaura completo. Se guardan **30 días y 12 meses**; con uso normal ocupa ~1–2 GB al año en vez de ~30 GB, así que cabe años en el Google Drive gratis de la clínica.
- Cifrado AES-256 con `BACKUP_PASSWORD` (reemplaza a la clave de age, que queda opcional para una copia completa extra el primer mes).
- Si `pg_dump` falla no se guarda un respaldo a medias; contraseña equivocada o destino caído avisan con su causa.
- **Aviso por correo** si el respaldo falla o deja de correr (`BACKUP_PING_URL`, healthchecks.io gratis).
- `restore.sh lista` muestra los respaldos; `restore.sh latest SI-RESTAURAR` restaura; `verify.sh` ya no pide la clave privada.
- La descripción de un producto vendido por unidad ya no repite "· Unidad" (está en la columna Unidad del comprobante). La franja superior de la hoja A4 pasa a gris oscuro: el comprobante es de la clínica.

### Comprobante en A4, PDF y WhatsApp
- **Hoja A4** de cada comprobante (boleta, factura y **nota de crédito**, que antes no tenía hoja propia) con el formato peruano: recuadro con RUC, tipo y número; "Señor(es)"; detalle con cantidad, unidad, valor y precio unitario; totales con IGV; monto en letras; QR y resumen. Se arma con las mismas líneas enviadas al PSE (cuadra al céntimo). Sellos de simulación, rechazado, anulado y aviso de pendiente.
- Botones separados: **Imprimir** (directo a la impresora) y **Descargar PDF** (baja el archivo `F001-00000015.pdf` con el mismo diseño, QR y sellos; se arma en el navegador, no se guarda nada en el servidor). La librería del PDF solo se carga al usarla.
- **Abrir chat de WhatsApp:** con el campo **Celular** (el de la ficha, editable) abre el chat de ese número aunque no esté en los contactos; ahí se adjunta el PDF guardado. El cliente recibe solo el PDF, sin enlaces. Acepta celulares peruanos y extranjeros con `+`.
- Acceso: botón **A4** en cada fila de Comprobantes y **"A4 / PDF · WhatsApp"** en el ticket.

### Fotos clínicas comprimidas y espacio en disco
- Las fotos de la historia clínica y de los resultados de laboratorio se **comprimen en el navegador antes de subir** (WebP de 2048 px al 85 %, ~0,35 MB en vez de 3–8 MB): se ven igual en pantalla e impresas. Un PDF sube tal cual.
- Casilla **"Subir en calidad original"** para radiografías o microscopio (máximo 10 MB). Una foto puede pesar hasta 40 MB antes de comprimir.
- Fotos del iPhone (HEIC): si el navegador no puede convertirlas, avisa claro en vez de fallar; en Compras ya no da error (sube la original).
- **Configuración → Clínica** muestra al administrador cuánto ocupan las fotos y archivos (historia clínica y fichas de compra).
- Pruebas: el `<dialog>` simulado ya no depende del orden en que corren los archivos de prueba.

### Rendimiento de la base de datos (medido con la base de volumen: 8 mil clientes, 90 mil cargos, 315 mil registros de bitácora)
- Búsqueda de RUC/DNI en el cobro: índices en `clients (clinic_id, invoice_ruc)` y `electronic_documents (clinic_id, customer_doc_type, customer_doc_number)`: de 4,7 ms (recorría todos los comprobantes) a 0,03 ms.
- Caja → "Por cobrar": índice parcial de cargos pendientes (`charges_pending_idx`): de 30 a 21 ms; en frío ya no lee los 106 mil cargos.
- Bitácora: cuenta hasta 10 000 registros (~2 ms en vez de 22 ms y creciendo) y dice "más de 10 000: filtra por fecha".
- Cobrado por día/método (Inicio, Reportes): el filtro también por `receipts.clinic_id` usa el índice por fecha: Inicio de 53 a 41 ms, Reporte de ventas de 42 a 33 ms.
- "A factura": tres clics simultáneos emiten una sola factura (prueba).

### Datos del comprador y cambio de boleta a factura
- **La factura ya no se bloquea** cuando el cliente no tiene RUC: el cobro (mostrador y cuenta) pide ahí mismo **RUC, razón social**, dirección y correo (opcionales). La **boleta desde S/ 700** pide el DNI y nombre del comprador, también para "Cliente varios".
- **Datos de facturación del cliente** (RUC al que factura, p. ej. su empresa; su DNI no se toca): se guardan solos al facturar y la próxima vez aparecen como "Factura a … · Cambiar". Editables en la ficha; se borran al anonimizar.
- **Búsqueda de RUC/DNI:** primero lo que ya tiene la clínica (sin gastar consultas) y luego **APISPERU** (gratis 1000/mes) con su token en Configuración → Facturación. Sin token o sin respuesta, se escribe a mano. Aviso si SUNAT da el RUC como no activo o no habido.
- **Cambiar boleta por factura** en Comprobantes ("A factura"): nota de crédito de la boleta y factura por el mismo detalle, sin tocar pago ni caja; bloqueado contra doble clic. El ticket muestra el comprobante vigente y anular el cobro anula la factura.
- **Correo del comprador:** Mifact y Nubefact le envían el PDF.
- El RUC se valida con su dígito verificador en pantalla y en el servidor.
- Pruebas: comprador en el cobro (cliente varios, cliente con DNI que factura a su empresa, boleta ≥ S/ 700), búsqueda local y APISPERU, cambio a factura + anulación, ficha; pantallas de caja y comprobantes.

### Facturación electrónica: Mifact
- Nuevo proveedor **Mifact** en Comprobantes → Configurar (PSE que firma con su certificado; la clínica no necesita certificado ni usuario SOL). Pide **token, razón social, dirección fiscal y ubigeo**; sin ruta usa el demo de Mifact y para **Producción** exige la ruta que entrega Mifact.
- Emite boletas, facturas y notas de crédito (con la fecha del comprobante anulado), con exonerado e inafecto; boleta sin documento como "CLIENTE SIN NOMBRE"; si la respuesta se cortó y el documento ya existía, lo consulta; guarda el hash y el QR que devuelve Mifact.
- Probado contra el demo real de Mifact (boleta aceptada). Pruebas del proveedor (11), de la configuración (API y pantalla).

### Facturación electrónica: Lucode (APISUNAT)
- Nuevo proveedor **Lucode** en Comprobantes → Configurar, elegido por precio (de S/ 8 a S/ 35 al mes, sin certificado digital). Solo pide el **token**: sin "Producción" va al sandbox de Lucode y con "Producción" a SUNAT. Nubefact sigue disponible.
- Emite boletas, facturas y notas de crédito (anulación), con exonerado e inafecto; boleta sin documento como "clientes varios"; si la respuesta se cortó y el documento ya existía, lo consulta en vez de fallar; arma el QR de SUNAT con el hash.
- Pasos para la clínica en `docs/FACTURACION.md`. Pruebas del proveedor (11) y de la configuración.

### Compras y proveedores (Inventario)
- **Inventario** tiene pestañas **Productos · Compras · Proveedores** (solo administrador y veterinario; recepción y caja siguen consultando productos).
- **Recibir compra:** la ficha del proveedor se pasa tal como viene (Cant. · Unidad · Descripción · Lote · Vence · P. unitario · Importe). Producto por nombre, código o lector de código de barras; Enter pasa al campo siguiente. Al guardar entra todo el stock junto (o nada) y cada línea queda con su lote.
- Precios **con o sin IGV** (la factura sugiere sin IGV; la boleta, con IGV): el costo del lote se guarda siempre **sin IGV**, para que el margen salga real. Lo exonerado o inafecto no lleva IGV.
- En cada línea: lo que entra en unidades, **última compra** (avisa si sube o baja más de 10 %) y **margen** con el precio de venta actual (aviso si baja de 15 % o está por debajo del costo), con **Cambiar precio** ahí mismo.
- **Total que dice la ficha:** avisa si no cuadra. **Borrador automático** (se recupera si se cierra la pestaña). **Foto de la ficha** opcional (se achica a ~300 KB; también PDF).
- **No deja registrar dos veces la misma ficha** del mismo proveedor ("F001-00123" y "f001-123" son la misma).
- Si hubo **insumos usados sin stock**, ofrece descontarlos de esta compra (quedan ligados a su cargo).
- **Historial de compras:** búsqueda por número, proveedor, RUC, producto o CO-00012; filtros de período, proveedor y estado. **Corregir comprobante** (llegó la factura después de la guía) sin tocar el stock. **Anular** solo si no se usó nada (quien la registró o el administrador); sale todo con un movimiento propio en el kardex.
- **Proveedores:** razón social, RUC validado y sin repetir, contacto, teléfono (WhatsApp si es celular), notas, activo/inactivo; compras y última compra. El administrador ve lo comprado en el año y puede **unir proveedores repetidos**. Los proveedores escritos a mano en lotes antiguos pasaron a la lista.
- **Excel para el contador** (solo administrador): compras del período (fecha, tipo, serie y número, RUC, proveedor, valor, IGV, total), por proveedor y el detalle con lote y vencimiento. Sin anuladas.
- Arreglos del inventario: **recepción y caja ya no ven costos, proveedores ni "Valor al costo"** (también desde la API); la compra rápida de la ficha del producto pide el **costo sin IGV** y elige el proveedor de la lista; en **controlados** el lote es obligatorio y el libro muestra de qué proveedor y factura vino cada entrada; cada lote enlaza a su compra.
- Demo: 4 proveedores con RUC, compras como fichas, un controlado (ketamina) con su uso, una merma y un ajuste por conteo.
- Pruebas: `purchases.e2e` (14), montos de compra, pantallas (Recibir compra, Compras, Detalle, Proveedores), y Playwright `compra-completa` (ficha → stock → venta → margen).

### Pantallas que no se quedan en blanco
- Si el servidor falla, cada pantalla muestra su aviso con **Reintentar** en vez de quedar en blanco: Ingreso de grooming (servicios), Comprobantes, Actividad, Refuerzos, Presupuestos, Servicios y precios, Exámenes, Agenda, Pedir examen (dentro de la atención) y el Portal del dueño (ficha del cliente).
- Regla para el código: el valor de un recurso se lee con `loaded()` (`shared/utils/resource.ts`), nunca con `value()` directo (lanza un error cuando el servidor falló).
- Prueba fija `server-errors.spec.ts`: abre esas 10 pantallas con el servidor respondiendo 500 y exige el aviso y el botón Reintentar.

### Historias clínicas
- Nueva sección **Clínica → Historias clínicas**: la lista de pacientes para el veterinario, que piensa en el paciente y no en el dueño. Al abrir uno se ve la ficha de siempre (historia, curva de peso, carnet, historia completa imprimible).
- **Buscador** por mascota, dueño, DNI, celular o número de historia ("HC-00041", "hc41" o "41").
- Pestañas **Activos / Inactivos** (en Inactivos van los fallecidos y los retirados, con el motivo en gris; la historia se conserva), especie (Todos, Perros, Gatos, Otros; en el celular, una lista) y orden (más recientes, nombre o número de historia).
- Cada fila: especie, sexo, edad y raza; número de historia; dueño y celular; última consulta o internamiento (sin grooming ni anuladas); avisos con texto: En atención, Internado, Agresivo, Alergia y Refuerzo vencido (se ven 2 y el resto como "+1", completos para lectores de pantalla).
- Solo veterinario, recepción y administrador (`GET /api/pets`, caja y groomer 403). Filtros en la dirección: al volver de una ficha se queda donde estaba.
- Arreglo: si el servidor fallaba, la lista de Atenciones se quedaba en blanco en vez de mostrar "Reintentar" (también corregido en Historias clínicas).
- Pruebas: `patients.e2e` (permisos, búsqueda, filtros, orden, otra clínica) y de la pantalla.

### Demo con exámenes
- La demo (`scripts/demo-data.mjs`) ahora pide exámenes en los casos que los necesitan: hemograma en la clínica y, a veces, bioquímico a un laboratorio externo. Los de días pasados quedan revisados; los de ayer y anteayer, en proceso o con resultado por revisar; hoy hay pedidos esperando. Con `DEMO_DAYS=25` se arma en poco más de un minuto.

### Menú ordenado por quién trabaja
- El menú sigue el día de la clínica: **Inicio**, **Recepción** (Cola de hoy, Citas, Clientes), **Clínica** (Atenciones, Hospitalización, Exámenes, Refuerzos, Presupuestos), **Grooming** (Tablero), **Caja** (Caja, Comprobantes) y **Gestión** (Inventario, Servicios y precios, Plantillas, Reportes, Clínica, Usuarios, Actividad). Cada rol ve solo lo suyo: el veterinario no ve caja ni grooming; el groomer ve recepción y su tablero; caja ve recepción, caja e inventario.
- **Atenciones** queda solo para consultas e internamientos; el grooming se trabaja completo en su tablero (por dentro sigue teniendo su atención para los cargos y la caja).
- **Vacunas** pasa a llamarse **Refuerzos** (es la lista de refuerzos por avisar; las vacunas se aplican en la atención).
- Avisos separados: las consultas abiertas de días anteriores llevan a Atenciones (veterinario, recepción, administrador) y el grooming sin entregar al tablero (recepción, groomer, administrador).
- Solo cambia el menú: las rutas y los permisos del backend siguen iguales.

### Atenciones: tercera tanda
- **Diagnósticos frecuentes:** al escribir el diagnóstico se sugieren los 40 que la clínica más usó en el año (se agrupan sin importar mayúsculas). Se puede escribir otro.
- **Curva de peso** en la historia de la mascota, con el último peso y cuánto cambió (ámbar si pasa del 10 %).
- **Historia completa imprimible** (A4) desde la ficha → "Historia completa": todas las consultas con SOAP, recetas, vacunas y adendas, y la curva de peso; para derivar a otro veterinario. Lleva la nota de datos personales (Ley 29733).
- **Signos vitales del conejo y del cuy** con su propio rango (aves y reptiles no avisan: varían mucho por especie).
- **"Por cobrar" una sola vez**, junto al total de Servicios y productos; en cada cargo solo se marca lo pagado o abonado.
- **Exámenes con menos peso visual** dentro de la atención: barras de avance finas y botones secundarios (la acción principal ahí es cerrar la atención). En la pantalla Exámenes siguen igual.
- **Archivos compactos:** fotos en miniaturas pequeñas y PDFs como tarjetas en fila.
- Backend: `GET /api/visits/diagnoses`, `GET /api/visits/pet/:id/history` y `GET /api/visits/pet/:id/weights` (caja 403; el groomer solo el peso). Pruebas en `visits-list.e2e` y de la web (historia, curva, sugerencias, rangos).

### Atenciones: segunda tanda
- **Guardado automático** de la consulta: se guarda solo 1,5 s después de dejar de escribir y muestra "Guardando…", "Guardado hace 20 s" o "Corrige lo marcado para guardar". Lo que se sigue escribiendo mientras guarda no se pierde; una recarga (cargos, recetas) ya no borra lo escrito; al salir de la pantalla se manda lo pendiente y al cerrar la pestaña el navegador avisa. "Guardar ahora" queda para no esperar.
- ~~Menú de secciones fijo~~: se quitó; una barra flotante tapaba campos mientras se escribía.
- **Cerrar con revisión:** guarda primero y muestra lo que falta (diagnóstico, peso, exámenes esperando resultado, refuerzos vencidos) con "Completar" que lleva al campo; no bloquea. Lo que queda por cobrar se indica junto con que se cobra en Caja.
- **Indicaciones para el dueño:** diagnóstico, tratamiento, medicamentos de la receta y vacunas de hoy, con lo escrito en ese momento. **WhatsApp** en un clic (el mensaje se puede corregir en WhatsApp antes de enviarlo) o **Imprimir** en A5 con el logo y el nombre del veterinario.
- **Accesibilidad:** textos y pasos en gris más oscuro (contraste 4.5:1), papeleras y botones de quitar de 44 px, fechas de los pasos de exámenes en 12 px.
- Solo web (el backend no cambia). Pruebas de autoguardado, cierre con revisión, indicaciones y menú de secciones.

### Atenciones más claras (primera tanda)
- **Lista:** pestañas **Consultas / Grooming** (consultas incluye internados) y **Abiertas / De otros días / Todas**, con las mismas pestañas que Exámenes; buscador por mascota, dueño, DNI o celular; filtro por quién atendió y por día; agrupada por **Hoy / Ayer / fecha**.
- Cada fila muestra primero **la mascota y su diagnóstico** (o el motivo); el estado va con texto y color (**En atención**, **Abierta hace 3 días**, **Internado**, **Cerrada**, **Cancelada**) y el cobro como **Por cobrar S/ X** o **Pagada**.
- **Abiertas de días anteriores:** aviso en la lista ("Ver cuáles"), número en la pestaña del otro tipo y aviso en Inicio y en la campana (es plata sin cobrar). Los internados no cuentan: siguen abiertos hasta el alta.
- **Dentro de la atención:** panel **Paciente** con alergias, agresivo, peso anterior y cuánto cambió, última atención (con enlace) y refuerzos vencidos. Debajo del peso se ve el anterior.
- **Signos vitales** con aviso en ámbar o rojo cuando salen del rango del perro o del gato (temperatura, FC, FR) y el llenado capilar de más de 2 s, con el rango escrito.
- **Cancelar** pasó al menú **⋯** (en rojo y con motivo), lejos de "Cerrar atención".
- Backend: `GET /api/visits` con `type`, `q`, `vetId`, `day` y `stale`, y devuelve `pending` por atención y `stale`/`staleByType`; `GET /api/visits/:id/context` (caja 403; el groomer solo ve grooming y sin vacunas); aviso `staleVisits`. Pruebas `visits-list.e2e`, de la lista, de la atención y de los rangos. La web funciona aunque el backend no se haya reiniciado.

### Exámenes de laboratorio
- **En la atención:** "Pedir examen" con uno o varios exámenes del catálogo (categoría Laboratorio) en un solo pedido (EX-00001), en la clínica o en laboratorio externo (nombre y costo del laboratorio, opcional). Se cargan a la cuenta del cliente, o sin cobro si van incluidos.
- **Recorrido:** Pedido → Muestra tomada → Resultado (PDF o foto que queda como "Análisis" en la historia, y/o valores) → **Revisado por el veterinario** con su interpretación → recién entonces "Avisar al dueño" por WhatsApp. Cancelar un pedido sin resultado quita sus cargos pendientes.
- **Pantalla Exámenes** (Atención): Esperando, Por revisar y Revisados; recepción sube ahí lo que llega. Los que llevan 3 días o más sin resultado salen en rojo.
- **Avisos:** "Resultado listo" en la campana del veterinario; en Inicio → Necesita atención: resultados por revisar y exámenes demorados.
- Solo veterinario, recepción y administrador (pedir y revisar: veterinario y administrador). Migración `20261110020000_examenes`; pruebas `lab-orders.e2e` y del componente. Demo con más exámenes en el catálogo.
- **Corregido:** guardar una plantilla clínica, "Guardar como plantilla" y la nota de evolución de hospitalización no hacían nada al tocar Guardar (formularios con `ngSubmit` sin `formGroup`).

### Historia clínica solo para quien la necesita
- **Caja** ya no abre atenciones, recetas, consentimientos ni adjuntos (cobra desde la cuenta del cliente). **Groomer** solo ve las atenciones de grooming, sin adjuntos ni consentimientos.
- Backend: `CLINICAL_ROLES` en recetas, consentimientos y adjuntos; atenciones con 403 para caja y solo grooming para el groomer. Web: rutas, menú (Atenciones y Vacunas) y enlaces a la historia ocultos para esos roles.
- Prueba nueva `clinical-access.e2e`; las de documentos y atenciones se ajustaron a la regla.

### Revisión completa y actualizaciones sin errores
- Revisión de todos los flujos (`docs/FLUJOS.md`): pruebas completas, recorrido de 47 pantallas por rol en escritorio y celular, y controles de datos. Sin errores encontrados.
- **`actualizar-local.bat`**: actualiza Docker en la PC, reinicia el backend y espera a que responda; avisa si otro programa ocupa el puerto 3000.
- **`deploy\subir-demo.bat`** + `deploy/actualizar-demo.sh`: sube y actualiza la demo de Azure con un clic (respaldo automático, quedan los 7 últimos).

### Recordatorios gratis (sin pagar la API de WhatsApp)
- **Vacunas:** progreso del día ("Faltan 5 por avisar"), botón **Avisar al siguiente** que abre el WhatsApp ya escrito, y cada aviso queda marcado (quién y a qué hora) para no repetirlo. Se ve a qué dueños "les llega solo".
- **Citas (agenda):** el botón de WhatsApp de cada cita marca el aviso ("Avisado") y el detalle muestra cuándo y quién avisó, o si al dueño le llega solo al celular.
- **Avisos al celular del dueño:** desde su portal toca **Activar avisos** y recibe una notificación 3 días antes del refuerzo y la tarde antes de su cita (de 9:00 a 20:00, una sola vez). Notificaciones web con claves VAPID que el sistema genera y guarda solo; sin costo por mensaje. En iPhone funciona agregando el portal a la pantalla de inicio (el portal tiene su propio manifiesto).
- **Calendario del dueño:** botones **Google Calendar** e **iPhone u Outlook** que suscriben un calendario (`/api/portal/:token/calendario.ics`) con los refuerzos (alarma la víspera a las 9:00) y las citas (alarma 2 h antes); se actualiza solo.
- **Portal sin carnet por defecto** (pedido del cliente: el carnet digital se podía copiar). Muestra solo próximas vacunas y citas, sin lote, quién aplicó ni recetas. Se vuelve a mostrar en **Configuración → Portal del dueño**.
- Migración `20261110010000_recordatorios` (`push_subscriptions`, `reminder_logs`, `system_settings`, `clinics.portal_show_records`). Nueva dependencia `web-push`. Política de privacidad actualizada.

### Grooming más profesional y sin firma en el ingreso
- **Tablero:** indicadores del día (en el tablero, listos y avisados, atrasados, entregados con lo que falta cobrar), columnas con ícono y color, y tarjetas más claras: especie, tamaño, servicios en chips (sin repetir el tamaño), alertas, groomer con iniciales, tiempo en el estado y la hora de recojo con color (a tiempo, en menos de 30 min, atrasado, esperando recojo).
- **Nuevo ingreso:** pasos numerados que se marcan al completarse y un **resumen fijo a la derecha** (mascota, servicios con precio, recojo, groomer, alertas y total) con el botón "Registrar ingreso". En el celular el resumen va al final.
- **Dirección de recojo automática:** al elegir "Lo recogemos", "Lo llevamos" o "Recojo y entrega", se llena con la dirección registrada del dueño (dirección y distrito) y se puede cambiar si es otra. Si se cambia de mascota, se actualiza salvo que la hayas escrito a mano. El carnet (`/api/pets/:id/immunization-card`) ahora trae la dirección y el distrito del dueño.
- **Se quitó la firma del dueño** del ingreso (pedido del cliente): se envía sin firma; la constancia sigue mostrando el checklist de cómo llegó.
- Playwright del día de grooming ajustado a las nuevas tarjetas.

### Cargar un presupuesto sin salir de la atención
- En la atención, "Cargar a esta atención" ya no lleva a la página del presupuesto: abre un modal con las líneas y el total, pide el N.º de receta si incluye un controlado y, al confirmar, los cargos aparecen en la misma atención. Con varios presupuestos aceptados, cada uno tiene su botón; "Ver detalle" sigue llevando al presupuesto.
- Spec: sin receta no se envía; con receta carga y se queda en la atención.

### Presupuestos: se cargan solo por la atención del veterinario
- Antes, si la mascota no tenía atención abierta, "Cargar a la atención" **abría una por su cuenta** a nombre de quien pulsaba (podía ser recepción) y la mascota se saltaba la cola. Ahora el botón es **"Mandar a la cola de hoy"**, con el código y título del presupuesto como motivo. Cuando el veterinario pulsa Atender, la atención muestra "tiene un presupuesto aceptado · Cargar a esta atención".
- Flujo completo: emitir → el dueño acepta → el día del procedimiento llega por la cola → el veterinario lo atiende y carga el presupuesto (precio pactado, descuenta insumos) → agrega lo extra si hubo → cierra → **Caja cobra y ahí se emite el comprobante** (boleta, factura o nota de venta). El presupuesto nunca es comprobante.
- Spec del flujo: sin atención no abre una (manda a la cola); con atención abierta, carga en ella.

### Grooming sin comisiones
- **Retirado a pedido del cliente:** los groomers no ganan comisión. Se quitó el campo "Comisión de grooming (%)" de Usuarios, el porcentaje que se congelaba al entregar cada servicio, la página **Comisiones** (menú y botón del tablero), su Excel y la ruta `GET /api/grooming/commissions`.
- Migración `20261107010000_sin_comisiones_grooming`: borra `users.commission_percent` y `grooming_sessions.commission_percent`.
- A los servicios de grooming solo se asignan usuarios activos con rol **Groomer** (antes también quien tuviera comisión configurada).
- El tablero, la entrega, la constancia y el cobro siguen igual. Pruebas e2e y Playwright del día de grooming actualizadas.

### Caja más profesional
- **Encabezado con estado** (Abierta/Cerrada), caja, hora y tiempo abierta; acciones con icono y, en celular, "Venta de mostrador" primero.
- **Quién abrió y quién cobra:** "abierta … por Jorge" (o "por ti") y la etiqueta "Cobras como Andrea": la caja es del cajón, no de quien la abrió; cada cobro, venta o egreso queda a nombre de quien lo registra (también se indica en Cobrar y Venta de mostrador).
- **Aviso si la caja sigue abierta de otro día**, con "Cerrar y cuadrar": el arqueo debe hacerse por jornada.
- **Indicadores:** efectivo en caja con su desglose (inicial + cobros en efectivo − egresos), cobrado con ticket promedio y devoluciones, **por cobrar** (saldo total y clientes) y medios de pago con barra de participación.
- **Por cobrar:** iniciales del cliente, búsqueda por cliente o mascota sin tildes, deudas de 30 días o más resaltadas, botón Cobrar menos pesado y saldo total al pie. Si no hay deudas: "Todo cobrado" con acceso a la venta de mostrador.
- **Movimientos de esta caja** en pestañas (Cobros / Egresos) con tipo de comprobante (B, F, NV), estado SUNAT, neto al pie y estados vacíos con su acción.
- **Caja cerrada:** apertura con prefijo S/ y "Último cierre" con esperado, contado, diferencia (Cuadró / Con diferencia) y la nota.
- **Venta de mostrador:** buscadores con icono y resultados que no empujan el formulario, servicio/producto diferenciados, precio c/u, cantidad con − / +, total destacado e indicador de carga al cobrar.

### Presupuestos más profesionales
- **Bandeja con indicadores:** por responder (monto y cuántos vencen en 3 días), aceptados por cargar, cargados en el mes y tasa de aceptación de los últimos 90 días (`GET /api/estimates/summary`, solo de la clínica). Tocar un indicador filtra la lista.
- Lista en columnas (presupuesto, paciente, concepto, estado, total) con **cuánto le queda** a cada uno ("Vence hoy", "Vence mañana", "Quedan 7 días"), búsqueda por código, mascota o dueño sin tildes (queda en la dirección) y total de lo listado. En celular, tarjetas.
- **Detalle tipo documento:** encabezado con estado y acciones (la principal según el paso), hoja A4 con franja de marca, paciente y propietario (con documento), ítems numerados, subtotal, descuentos, op. gravada/exonerada, IGV y total destacado, indicaciones y **condiciones** ("no es un comprobante de pago"). Si venció o no se aceptó, la hoja lleva una marca de agua para que no se use por error (también al imprimir).
- Panel de **seguimiento**: emitido → respuesta del dueño (con su nota) → cargado a la atención, más importe, ahorro y teléfono del dueño. "Emitir uno nuevo" también para los no aceptados.
- **Nuevo presupuesto en 3 pasos** (paciente, detalle, servicios y productos) con check al completarse; buscador con teclado (↑ ↓ Enter Esc); cantidad con botones − / +; agregar el mismo ítem suma cantidad; descuento en soles con aviso si supera el importe; resumen fijo con lo que falta para emitir.
- Pruebas: e2e del resumen (otra clínica no suma) y spec de la bandeja y de la vigencia.

### Plantillas clínicas
- **Plantillas de consulta:** en la atención, "Usar plantilla" llena motivo, anamnesis, examen físico, diagnóstico y plan; se elige si completa solo lo vacío o reemplaza, con vista previa. "Guardar como plantilla" guarda lo escrito (sin datos del paciente).
- **Recetas frecuentes:** al recetar, las más usadas aparecen como botones y agregan sus medicamentos con dosis, vía, frecuencia y duración. Los del inventario se leen otra vez (precio y stock de hoy); si el producto ya no está, queda para comprar en farmacia y se avisa.
- Pantalla **Plantillas clínicas** (Configuración, veterinario y administrador): consultas y recetas frecuentes, con su uso, edición y borrado. Las más usadas salen primero.

### Hospitalización
- **Internar** desde la consulta: la consulta se cierra (lo pendiente queda por cobrar) y el internamiento abre su propia atención (HZ-00001) con jaula, motivo, diagnóstico y veterinario responsable. Esa atención no se cierra ni se cancela a mano: se cierra con el alta.
- **Hoja de tratamiento:** indicaciones (medicamento, fluidoterapia, alimentación, procedimiento o control) con dosis, vía y frecuencia en horas. Cada hora se ve como **dada, omitida, atrasada, toca ahora o pendiente** (con color, icono y texto). Tocar una hora registra la dosis con quién y cuándo; omitirla pide el motivo. Una misma dosis no se registra dos veces.
- **Signos vitales** (temperatura, FC, FR, peso, mucosas) con curva de temperatura sobre su rango normal por especie y tabla; **notas de evolución**; registro completo filtrable.
- **Tablero de internados** que se actualiza solo cada minuto: jaula, día de estancia, dosis atrasadas, la próxima que toca y últimos signos; altas de los últimos días.
- **Avisos:** dosis atrasadas en la campana (veterinario y administrador) y tarjeta de internados en el inicio.
- **Alta o fallecimiento:** cobra los días de estancia (servicio de la nueva categoría "Hospitalización"; cada 24 h o fracción, editable), suspende las indicaciones y cierra la atención. Si falleció, la mascota queda registrada como fallecida.
- Consentimiento de hospitalización a un clic desde la hoja (abre el formulario con el tipo elegido).
- Recepción ve y registra dosis, signos y notas; internar, indicar y dar de alta: veterinario o administrador.
- Migración `20261102020000_plantillas_hospitalizacion`. Pruebas e2e de plantillas y hospitalización (roles, otra clínica, dosis repetida, atrasos, alta con cobro y fallecimiento) y prueba unitaria de las horas de la hoja.

### Recetas
- **Anular una receta ya no pide quitar antes los cargos:** lo entregado en la clínica se quita de la cuenta y vuelve a su lote en la misma operación (si ya se cobró, pide anular primero el cobro en caja). El aviso de anulación muestra qué se devuelve.
- Las recetas de una atención se ven separadas (antes las tarjetas quedaban pegadas).
- El administrador puede registrar su colegiatura (CMVP) en Usuarios para recetar si también atiende.

### Caja
- **"Por cobrar" muestra la mascota y de dónde viene la deuda** (Consulta, Grooming, Hospitalización o Mostrador): recepción reconoce al cliente por la mascota o el servicio, no solo por el nombre del dueño.
- En el tablero de grooming, los entregados con saldo tienen su botón **Cobrar**, que abre el cobro de ese cliente en caja.

### Comprobantes
- **La caja muestra el comprobante real de cada cobro** (Boleta B001-00000123 o Factura F001-…), con aviso si quedó con error o se está enviando a SUNAT; la nota de venta interna (NV-) solo aparece cuando no se emitió comprobante.
- **Rediseño de Comprobantes:** resumen del periodo (boletas, facturas, notas de crédito y ventas netas), periodos rápidos (hoy, 7 días, este mes, mes pasado, todo o fechas), búsqueda por número, cliente o DNI/RUC, filtro por tipo y por estado (vigentes, anulados, con problemas…), tabla en escritorio y tarjetas en el celular. El Excel para el contador se pide desde el encabezado.
- **Las boletas y facturas anuladas se ven como anuladas:** estado "Anulado", importe tachado y la nota de crédito que las anuló; tocarla la busca. La nota de crédito muestra qué comprobante anula.
- En Caja, la devolución nombra la boleta devuelta ("Devolución de B001-00000519 · Cobro duplicado") en lugar de la nota de venta interna.
- La opción "Solo nota de venta" avisa que no es comprobante para SUNAT.
- Datos de demostración: todo cobro lleva boleta o factura (antes casi la mitad salía solo con nota de venta y Comprobantes no cuadraba con Caja).

### Inicio y Reportes (para la demo)
- **Inicio más compacto y directo:** el saludo ocupa una línea y trae lo que recepción hace todo el día: **Agregar a la cola** (abre el formulario), **Nueva cita** y **Nuevo cliente**.
- **"Necesita atención":** un solo bloque reúne urgencias, internados y dosis atrasadas, lotes por vencer, stock bajo, refuerzos vencidos y grooming listo para entregar, de lo más urgente a lo informativo (antes eran tres franjas y las dosis salían dos veces). En el celular aparece antes que los gráficos.
- **Cobrado por día de las últimas 2 semanas** (la última semana en el celular), con el mismo día de la semana anterior de fondo, el promedio y hoy marcado "en curso". Reemplaza la curva del mes, que a inicio de mes no decía nada.
- La tarjeta **"Cobrado hoy"** (antes "Ventas de hoy") muestra lo cobrado el mismo día de la semana pasada.
- **Orden de la cola:** las urgencias pasan antes que los que esperan, aunque hayan llegado después (antes una urgencia recién llegada quedaba debajo de quien ya estaba "en espera").
- **Reportes → "En resumen":** cuatro frases con lo importante del período (cuánto más o menos vendiste, tu mejor día, lo que más vendes y qué porcentaje cobraste).
- Indicadores más legibles; el período de comparación va en el encabezado en vez de una nota al pie.
- El gráfico de ventas marca la línea de **promedio** y el día de hoy como **en curso**; hoy no compite por "mejor día".

### Grooming separado de la consulta
- **Baño y corte ya no se cargan en una consulta, un internamiento ni en mostrador:** los servicios de la categoría "Baño y grooming" solo se cobran en la atención de un grooming (el backend lo rechaza con un mensaje claro). Así cada baño pasa por el tablero, lo atiende un groomer, se entrega la mascota y se calcula su comisión.
- En la consulta, si se busca un servicio de grooming aparece **"Enviar a grooming"**, que abre el ingreso con la mascota ya elegida. La consulta sigue abierta: una mascota puede estar en consulta y en grooming a la vez (dos consultas a la vez, no).
- Un baño terapéutico que hace el veterinario se crea en otra categoría (por ejemplo "Otros") y sí se carga en la consulta.
- Caja y presupuestos tampoco ofrecen servicios de grooming.

### Recordatorios automáticos
- Quedan para después: requieren la API oficial de WhatsApp Business (cobro por mensaje, plantillas aprobadas por Meta y un número verificado de la clínica). Hoy los recordatorios se envían a un clic con `wa.me`, sin costo.

### Centro de notificaciones
- **Campana con dos pestañas:** "Para ti" (lo que pasó hoy y te toca) y "Pendientes" (urgencias, dosis atrasadas, comprobantes con problemas, caja, vencimientos y stock). El número rojo cuenta **solo lo nuevo**; al abrir la campana se marca como leído en todos tus equipos, y lo nuevo queda resaltado en la lista ("Nuevas" / "Antes, hoy") con la hora ("hace 5 min").
- **Qué le llega a cada rol:** veterinarios, las llegadas a la cola (urgencias en rojo) y las citas que les agendan; groomers, los ingresos a grooming suyos o sin asignar; recepción y caja, las atenciones **listas para cobrar** (con el monto) y los baños **listos para entregar**; el administrador, además, los comprobantes rechazados por SUNAT. Nunca avisa de lo que hizo uno mismo.
- **Avisos emergentes** cuando llega algo nuevo: arriba a la derecha, con botón para ir ("Ver cola", "Cobrar", "Revisar"), se van solos (8 s; 14 s las urgencias), se pausan con el mouse encima, como mucho 3 y sin tapar la campana abierta. La primera carga del día no dispara avisos de lo que ya había.
- **Opcional por usuario:** sonido corto solo en urgencias y avisos del navegador con la pestaña minimizada.
- Se revisa cada 30 s con la pestaña a la vista (90 s minimizada) y al volver a la pestaña. Animaciones solo con transform y opacidad, un único pulso en el número y sin movimiento si el equipo tiene "reducir movimiento".
- Backend: `GET /api/notifications` y `POST /api/notifications/seen`; migración `20261106010000_notificaciones_leidas`. Pruebas e2e y de pantalla.

### Navegación: "Volver" regresa a donde estabas
- **"‹ Volver" regresa a la pantalla de donde vino el usuario**, no a una fija, y dice a dónde: un ticket abierto desde Comprobantes dice "‹ Comprobantes" y vuelve ahí (antes mandaba a Caja). Si se entró directo por un enlace, va a la sección de siempre. Aplicado en las 21 pantallas de detalle y formularios (ticket, cliente, mascota, atención, receta, consentimiento, carnet, producto, presupuesto, hospitalización, grooming, importaciones…).
- **Los filtros se conservan al volver**: Comprobantes (búsqueda, tipo, estado, periodo y página), Atenciones, Presupuestos, Vacunas y Actividad guardan sus filtros en la dirección, como ya hacían Clientes e Inventario. El botón Atrás del navegador hace lo mismo.
- **La lista vuelve al mismo lugar** donde se había bajado, y cada pantalla nueva abre arriba.
- **El menú marca la sección de donde vino**: un ticket abierto desde Comprobantes resalta Comprobantes (igual mascotas, recetas, consentimientos y atenciones).
- Al guardar un cliente, producto, presupuesto, ingreso de grooming o consentimiento, el formulario ya no queda en el camino de "Volver".

### Revisión de calidad (QA) antes del piloto
- Informe completo en `docs/QA-2026-11.md`: aislamiento entre clínicas (86 rutas, sin fugas), permisos por rol, recorrido de 39 pantallas por rol en escritorio y celular (0 errores), rendimiento con una clínica de 3 años de datos, migraciones en base vacía y prueba de respaldo y restauración.
- **Vacunas:** solo veterinario o administrador registran una vacuna aplicada en la clínica (sale en el carnet con su CMVP); recepción registra antecedentes de otra clínica. El botón "Aplicar" de la atención ya no aparece para recepción.
- **Rendimiento:** "vacunas por vencer" ya no recorre todo el historial (58,8 → 2,0 ms con 30 000 vacunas; el inicio carga en 70 ms). Migración `20261105010000_indice_vacunas_por_vencer`.
- El estado y la desactivación del portal de un cliente de otra clínica responden 404.
- La prueba mensual de restauración (`deploy/backup/verify.sh`) compara 19 tablas (antes 9).
- Scripts para repetir la revisión: `backend/scripts/qa/` (clínica de volumen, tiempos, aislamiento, permisos) y `e2e/qa-recorrido.cjs`.

### Portal del dueño
- Desde la ficha del cliente, **"Crear y enviar enlace"** genera un enlace personal y lo manda por WhatsApp (o se copia). Sin contraseña ni app: el dueño abre el enlace en su celular.
- El dueño ve, por cada mascota: datos (historia, edad, peso, microchip), **"Le toca pronto"** con los refuerzos vencidos o de los próximos 30 días, **próximas citas**, **carnet de vacunas y desparasitaciones** (con quién aplicó y su CMVP, o la otra clínica) para imprimir o guardar en PDF, y **recetas** de los últimos 4 meses con dosis e indicaciones. Botones para escribir por WhatsApp o llamar a la clínica.
- Seguridad y Ley 29733: solo el primer nombre del dueño (ni documento, ni celular, ni cuentas); mascotas fallecidas no aparecen; el enlace vence a los 6 meses, se desactiva cuando se quiera y uno nuevo anula el anterior; se guarda solo la huella (hash) del token; no se indexa en buscadores; límite de consultas por minuto. Anonimizar al cliente desactiva su enlace. La ficha muestra si está activo, cuántas veces se abrió y cuándo. Crear y desactivar quedan en Actividad.
- Política de privacidad y contrato de encargo actualizados con el portal.
- Migración `20261104020000_portal_del_dueno`. Pruebas e2e (roles, datos mínimos, regenerar, desactivar, vencido, otra clínica) y de pantalla.

### Citas: agenda renovada
- **Tira de la semana** (lunes a domingo) con cuántas citas tiene cada día y un punto ámbar si alguna falta confirmar; las flechas pasan de semana. La agenda se trae por semana, así que cambiar de día es instantáneo.
- **Columnas solo para quien atiende:** veterinarios y quien tenga citas ese día, con avatar, rol y cuántas citas tiene. Groomers o administrador sin citas se muestran con "Ver a todo el equipo".
- **Bloques más legibles:** franja de color por estado (y borde punteado si falta confirmar), ícono de la especie, hora, motivo y, en citas largas, el dueño. La línea de "ahora" muestra la hora y la grilla se abre una hora antes de ahora, no en las 8:00.
- **Panel del día (escritorio):** "Lo que sigue" con la próxima cita y cuánto falta, y **"Por confirmar"** con WhatsApp y Confirmar a un clic para cada una.
- **Celular:** filas con franja de estado, duración, especie y estado en etiqueta; una línea marca la hora actual entre las citas. Vacío con botón para agendar.
- Resumen del día con cantidades en singular o plural ("1 confirmada", "1 llegó").

### Inventario: productos que no vencen
- Cada producto dice si **vence** (medicamentos, vacunas, alimentos, shampoos: lote y fecha obligatorios y semáforo de vencimientos) o **no vence** (camas, juguetes, correas, collares: solo cantidad, costo y proveedor). Al crear se elige con dos tarjetas; por defecto sigue la categoría (accesorios no vencen) y se puede cambiar en Editar.
- La compra de algo que no vence ya no muestra lote ni vencimiento y, aunque llegue una fecha, no se guarda: antes una cama podía quedar "vencida". Las compras que sí vencen marcan el lote y la fecha que faltan junto al campo.
- Pasar un producto a "no vence" borra las fechas de sus lotes (se avisa antes) y deja de salir en las alertas.
- Lista: **"No vence"** en vez de "—", ícono y color por categoría, precio alineado y tarjeta de celular con precio. Ficha: etiqueta "No vence", "Ingresos con stock" (por fecha de llegada) en vez de lotes, y lote y vencimiento juntos en una columna para que no se corten.
- Migración `20261104010000_productos_sin_vencimiento` (los accesorios existentes quedan como "no vence" y se limpian sus fechas). Pruebas e2e y de pantalla.

### Datos de demostración
- Seis plantillas de consulta y cinco recetas frecuentes con su uso, el servicio "Hospitalización (día)", dos internados con su hoja al día (una dosis atrasada para mostrar el aviso), signos, notas y cuenta, y un alta de ayer. `DEMO_REFRESH=1` también trae la hoja de tratamiento a la hora actual.

## [Sin publicar] · Revisión profesional

### Rendimiento de la base de datos
Medido con `EXPLAIN (ANALYZE, BUFFERS)` sobre una copia de la demo inflada a unos 200 mil cargos, 115 mil cobros y 124 mil movimientos de stock (20 clínicas):
- Índice `stock_movements (clinic_id, ref_type, ref_id)`: devolver el stock al anular un cargo pasó de 1.40 ms a 0.03 ms y ya no crece con el kardex de la clínica; el margen del período también lo usa.
- Índice `visits (clinic_id, opened_at)`: atenciones del período de 1.19 ms a 0.09 ms.
- Índice `cash_movements (clinic_id, created_at)`: devoluciones del período (lo cobrado en caja, inicio y reportes) de 0.32 ms a 0.05 ms, sin recorrer la tabla.
- Migración `20261102010000_indices_reportes` (índices normales: las tablas aún son chicas y se crean en milisegundos).

### Metadatos y buscadores
- La app queda **fuera de los buscadores** (`noindex` en `index.html` y cabecera `X-Robots-Tag` en Caddy): es privada de cada clínica; la página de venta irá aparte.
- Descripción, idioma `es-PE`, vista previa básica al compartir el enlace (Open Graph) y nombre de la app.
- Íconos: favicon SVG con el logo, `apple-touch-icon` sin transparencia, íconos 192/512 (y maskable) y `manifest.webmanifest` para instalarla en el celular; Caddy lo sirve con su tipo correcto.
- La pestaña del inicio se llama "Inicio · Uywa", igual que el menú.

### Pantallas (auditoría en celular y escritorio de las Fases 4 a 7)
Se recorrieron 15 pantallas en celular (390 px) y escritorio, midiendo además el desborde horizontal de las 25 rutas principales:
- **Celular sin desbordes:** el ingreso a grooming se salía 101 px de la pantalla (un `fieldset` mide por defecto su contenido más ancho; se corrigió para toda la app) y el tablero de grooming 12 px.
- **Comprobantes en el celular:** el número ya no se parte en dos líneas, el monto y "Ticket" van debajo, y los filtros ocupan la mitad de alto (dos por fila).
- **Presupuesto en el celular:** los montos no se parten ("S/" arriba y el número abajo); precio unitario y descuento se ocultan en pantalla chica y vuelven al imprimir.
- **Comisiones y reportes en el celular:** las tablas muestran solo las columnas que caben, sin barra horizontal.
- **Agenda:** se abre en la hora actual o en la primera cita del día (antes mostraba las 8:00 vacías aunque las citas fueran en la tarde), con la cabecera de veterinarios fija al desplazarse. Los bloques de cita ya no usan una franja de color a la izquierda: borde completo, punto de color y "por confirmar" punteado, para no depender solo del color.
- **Contraste:** los textos de ayuda (placeholders) y textos secundarios que usaban gris claro (2.6:1) pasan a un gris que cumple 4.5:1 (WCAG AA).
- Las miniaturas de archivos ya no se agrandan al pasar el mouse (no aportaba nada).

### Corregido (importante)
- **Fechas corridas 5 horas en Docker.** La base de datos de Docker corre en hora de Lima (`TZ`) y el adaptador de Prisma manda las fechas sin zona horaria: PostgreSQL las guardaba como hora de Lima y cada fecha quedaba 5 horas adelantada. Se veía como ventas de la noche contadas al día siguiente, esperas raras, cifras distintas según el período y, en la demo, reportes vacíos (al llevar cada día a su fecha, el desfase la mandaba años adelante). Ahora la sesión de la base de datos va siempre en UTC (API, seed y demo) y la hora de Lima la pone la zona de la clínica, como debe ser. Afectaba también al servidor de producción (`deploy/docker-compose.yml` tiene la misma `TZ`).
- Nueva prueba `test/timezone.e2e-spec.ts`: falla si la sesión no está en UTC o si una fecha guardada no es la hora real. Toda la suite (141 e2e del backend y las de Playwright) se corrió con la base de datos en hora de Lima, igual que en Docker.
- Las pestañas de Reportes ya no muestran una barra de desplazamiento vertical en Windows, y las barras de desplazamiento son finas en toda la app.

### Datos de demostración
- **70 días de historia** (antes 35): los reportes de 30 días se comparan con 30 días anteriores que también tienen movimiento, en vez de mostrar "sube 480 %". Unas 490 atenciones y 530 cobros; tarda menos de un minuto.
- **Reportes abren en "Últimos 30 días"** (nuevo período rápido) en vez de "Este mes": a inicio de mes ya no se ven vacíos.
- **`DEMO_REFRESH=1`**: trae una demo ya creada al día en segundos, sin crear nada. Corre todas sus fechas hasta hoy, reparte lo de hoy hasta ese momento y deja las citas y recojos pendientes para más tarde. Así la demo no se ve "vieja" si se armó días antes.
- **Hoy se ve como una clínica a esa hora:** lo terminado entre la apertura y hace un rato, y lo que está en curso (cola, consultorio, tablero de grooming) en la última hora. Antes un perro podía figurar "9 h en espera".
- Citas de hoy variadas (una llegó, una no vino, una confirmada y las demás pendientes), dos clientes nuevos, y refuerzos que tocan **esta semana** además de los vencidos.
- Servicios con sus insumos (guantes, jeringas, tubos, champú, suero) para que el **margen** sea realista; un lote vencido, uno por vencer y correas **sin movimiento** para el reporte de inventario.
- Abre también los domingos en la mañana (con menos movimiento), y ninguna mascota repite nombre.

## [0.7.0] — 2026-11-01 · Fase 7: dashboard y reportes

El dueño ve cómo va el negocio sin salir del sistema: inicio con lo del día y del mes, reportes de ventas, margen e inventario, y cada número coincide con su módulo de origen.

### Agregado (paso 1: reporte de ventas)
- **Reportes → Ventas** (solo el administrador): período rápido (hoy, últimos 7 días, este mes, el pasado, este año) o fechas libres hasta un año, comparado siempre con el período anterior de la misma duración.
- **Indicadores** con su variación (sube/baja con icono y texto, no solo color): vendido (con lo que falta cobrar), cobrado, atenciones, ticket promedio y clientes nuevos.
- **Gráfico de ventas** por día, semana o mes según el largo del período, con servicios y productos apilados, tooltip al pasar el mouse o con las flechas del teclado, y la **misma información en tabla**.
- **De dónde salen las ventas:** por categoría, por medio de pago (menos devoluciones), por profesional (el veterinario de la atención o el groomer; lo vendido sin atención va a "Mostrador") y los servicios y productos más vendidos con su cantidad.
- **Excel** con una hoja por vista: resumen con la comparación, por día, por categoría, servicios y productos, por profesional y medios de pago.
- Reglas para que los números cuadren: **cobrado** = pagos menos devoluciones (igual que Caja e Inicio); **vendido** = cargos no anulados con IGV. Un cobro anulado sale de lo cobrado y lo vendido pasa a "por cobrar"; un cargo quitado sale de todo. Lo prueba `test/reports.e2e-spec.ts`.

### Agregado (paso 2: margen e inventario)
- **Reportes → Margen:** margen bruto por producto y por servicio en el período: venta sin IGV menos el costo del lote que salió por FEFO (en servicios, sus insumos; no incluye honorarios). Tabla ordenable por venta, costo, margen o % margen, con las pérdidas marcadas.
- Lo vendido **sin costo de compra** registrado no entra al margen: se muestra aparte, con enlace al producto para registrarlo en la próxima compra.
- **Reportes → Inventario:** valor del almacén hoy a costo de compra (sin IGV), por categoría y por producto; lotes vencidos o que vencen en 60 días con su valor en riesgo; productos con stock **sin salidas en 60 días** (capital parado); aviso de lotes sin costo.
- Excel de margen (resumen, productos, servicios) y de inventario (valorizado, por vencer, sin movimiento).
- Reportes ahora tiene pestañas (Ventas · Margen · Inventario), cada una con su dirección, y un mismo filtro de período.

### Agregado (paso 3: inicio renovado)
- **Citas de hoy** en el inicio, las mismas de la agenda: hora, mascota, tipo, veterinario y estado; la próxima que aún no llega se resalta, con el resumen "por llegar · llegaron · no vinieron".
- **Refuerzos que tocan:** vacunas y desparasitaciones de esta semana y las vencidas (los mismos de Vacunas), con botón de **WhatsApp** que lleva el recordatorio escrito. Lo ven recepción, veterinarios y el administrador.
- **Avisos** juntos en una franja (urgencias, vencimientos, stock bajo, insumos sin stock, caja de otro día, comprobantes con problemas), los mismos de la campana y según el rol; solo aparece si hay algo que atender.
- Para el administrador, **lo cobrado en el mes** contra el mes anterior hasta el mismo día (el 31 de marzo se compara con el 1 al 28 de febrero), con vendido, atenciones, ticket promedio y la **tendencia acumulada** día a día en un gráfico con tooltip y teclado.
- Un solo pedido al servidor arma el inicio; los números salen de la misma lógica que la agenda, Vacunas, la caja y Reportes (lo prueba `test/reports.e2e-spec.ts`).

### Agregado (paso 4: cierre de fase)
- Prueba de punta a punta con Playwright de que **los números cuadran**: un cobro aparece igual en la caja, el inicio y Reportes; al anularlo sale de lo cobrado en todos lados y lo vendido queda por cobrar. Corre junto a las otras tres.

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
