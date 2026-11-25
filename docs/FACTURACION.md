# Facturación electrónica: cómo pasar de la simulación al PSE

Uywa ya emite boletas, facturas y notas de crédito. Con el proveedor **Simulación** se numeran e imprimen como las reales, pero no van a SUNAT. Este documento es la lista para el día en que la clínica contrate el PSE.

**PSE elegido (13 nov 2026): Lucode (APISUNAT)**, por precio: de S/ 8 (100 comprobantes) a S/ 35 (700) al mes con IGV, sin certificado digital y con varias clínicas en una cuenta. **Nubefact** (S/ 70 al mes) queda integrado como alternativa. Los pasos de Nubefact (secciones 1, 2 y 5) aplican igual cambiando lo que dice la sección "Lucode".

## Cómo funciona

```text
Caja: cobro con "Boleta" ──▶ el comprobante se numera en la misma transacción (B001-00000123)
                           └▶ cola de envío ──▶ PSE ──▶ SUNAT
                                 ▲   reintenta sola: 1, 5, 15, 30 min… hasta 12 h
                                 └── "Reintentar" a mano en Comprobantes
```

- **La caja nunca espera al PSE.** El cobro y su número se guardan al instante. El envío corre aparte y, si el PSE está caído, se reintenta solo. Después de 3 intentos fallidos aparece un aviso en la campana.
- **Boletas:** SUNAT las recibe en un resumen diario, así que pueden quedar "Esperando a SUNAT" unas horas. El sistema las consulta cada 15 minutos hasta que quedan aceptadas.
- **Anular un cobro** con boleta o factura emite su **nota de crédito** (motivo 01, anulación de la operación) con la serie BC01 o FC01. La nota nunca sale antes que su comprobante.
- **Factura:** solo para clientes con RUC. **Boleta de más de S/ 700** (SUNAT: "supere S/ 700", RCP art. 8): exige el DNI u otro documento del cliente. Hasta S/ 700.00 inclusive, si no hay documento, sale como "clientes varios".
- **Pago a cuenta:** el comprobante sale por lo que se pagó en ese cobro. La línea dice "(pago a cuenta)" y la base y el IGV son proporcionales. *Confírmalo con el contador de la clínica* (ver la sección 4).
- **El token del PSE** se guarda cifrado (AES-256-GCM) y nunca vuelve al navegador. La clave sale de `BILLING_SECRET` o, si no se define, de `JWT_SECRET`. Si cambias esa variable, vuelve a pegar el token.

## Quién cambia qué (para que nadie la rompa sin querer)

| Quién | Qué puede hacer |
| --- | --- |
| Recepción, caja, veterinario | Nada en la configuración. El veterinario crea productos, pero el IGV queda en Gravado |
| Administrador / dueño | **Reintentar todos**, Excel para el contador, cambiar el IGV de un producto. No ve la configuración ni el token (21 nov): si la facturación se detiene, avisa a soporte |
| Soporte técnico | Todo: proveedor, ruta, producción, series, razón social, ubigeo y el RUC de la clínica |

- Guardar ruta, token o ambiente nuevos **prueba la conexión antes**: si falla, no se guarda nada.
- No deja cambiar de proveedor ni de ambiente con comprobantes sin respuesta de SUNAT.
- Cambiar series, proveedor o "Producción" pide confirmar.
- Cada cambio queda en Actividad y avisa en la campana de los administradores.
- La cuenta de soporte se marca en el servidor (`docs/DEPLOY.md`, paso 4).

## Mifact — el PSE elegido (nov. 2026)

Mifact (Osys Company S.A.C., autorización SUNAT RS 034-005-0007241) firma con **su** certificado: la clínica no necesita certificado digital ni usuario SOL secundario. Precio cotizado para 0–500 comprobantes al mes, validación PSE: **S/ 216 semestral o S/ 408 anual** (confirmar si incluye IGV y que es por RUC). La validación OSE (S/ 324 / S/ 612) no hace falta para una clínica pequeña.

0. **Trámite en SUNAT (una sola vez, lo hace la clínica con su Clave SOL):** dar de alta a Mifact como su PSE. En SUNAT Operaciones en Línea → Empresas → Comprobantes de pago → Factura electrónica → Comunicación de tercerización con PSE → **Altas/Bajas de PSE**, elegir **Osys Company S.A.C.** (pedir a Mifact su RUC y la fecha de inicio). Antes, confirmar que la clínica ya es **emisor electrónico** (lo suele saber el contador). Sin esta alta, SUNAT rechaza lo que firme Mifact.
1. Mifact envía el **token** de la clínica (va dentro del JSON, no como cabecera). **Lo rota cada ~6 meses**: cuando llegue uno nuevo, se pega en Configurar.
2. En Uywa, **Comprobantes → Configurar**: proveedor **Mifact**, token, **razón social**, **dirección fiscal** y **ubigeo** (los tres como en la ficha RUC). Ruta **vacía** = ambiente demo (`demo.mifact.net.pe`). Guarda y **Probar conexión**.
3. Corre los casos de la sección 3 y revísalos en el portal de Mifact.
4. **Si la clínica ya emitió comprobantes electrónicos con esas series** (otro sistema u otro PSE): usar series nuevas (ej. F002/B002) o continuar la numeración. Para continuar, antes del primer cobro, con el último número emitido (ej. F001-00000120):
   `INSERT INTO clinic_sequences (clinic_id, key, last_value) VALUES (<id>, 'cpe:F001', 120) ON CONFLICT (clinic_id, key) DO UPDATE SET last_value = 120;` (igual para `cpe:B001` y las notas de crédito). Si no, Mifact responde que el comprobante ya existe.
4. Para producción, Mifact entrega la **ruta** y el token definitivos: pégalos y marca **Producción** (sin ruta no deja activar producción).

> **Formato de la API:** JSON de Mifact (github.com/mifact/apijson): `SendInvoice` para emitir y `GetEstatusInvoice` para consultar. Estados: 101 en proceso, 102 aceptado, 103 aceptado con observación, 104 rechazado. Mifact devuelve el hash y el texto del QR. Boleta sin documento: tipo `0`, número `00000000`, "CLIENTE SIN NOMBRE". La nota de crédito lleva la fecha del comprobante que anula. Mapeo en `backend/src/billing/providers/mifact.provider.ts`, con sus pruebas.
>
> **Probado el 14/11/2026** contra el demo (RUC 20100100100, token de pruebas `gN8zNRBV+/FVxTLwdaZx0w==`): boleta B004 aceptada, `estado_documento` 102. Para probar UywaSys completo contra el demo, la clínica de pruebas debe tener ese RUC.

## Lucode (APISUNAT) — alternativa (no respondió)

1. La clínica se registra en Lucode con **su** RUC y entra a su cuenta de **pruebas** (`sandbox.apisunat.pe`).
2. En **Clave SOL de SUNAT** → Comprobantes → Información del PSE, autoriza a Lucode como su PSE (una sola vez). No necesita certificado digital: Lucode firma por ella.
3. Antes de contratar, revisa que Lucode figure en el **Padrón de PSE** de SUNAT (cpe.sunat.gob.pe → Listados).
4. En el panel de Lucode, módulo **Organizaciones**, copia el **token** de la empresa.
5. En Uywa, **Comprobantes → Configurar**: proveedor **Lucode**, pega el token, deja **Producción sin marcar**, guarda y **Probar conexión**. No hay ruta que pegar: sin "Producción" va al sandbox y con "Producción" a `app.apisunat.pe` (si Lucode da otra ruta, se puede escribir en la base, campo `api_url`).
6. Corre los casos de la sección 3. Cuando todo quede aceptado, pega el **token de producción** y marca **Producción**.

> **Formato de la API:** JSON v3 de Lucode (`POST /api/v3/documents` para emitir y `POST /api/v3/status` para consultar), con `Authorization: Bearer <token>`. Lucode no devuelve el texto del QR: Uywa lo arma con el hash que sí devuelve, en el formato de SUNAT. Boleta sin documento: Lucode pide tipo `1` y número `99999999` ("clientes varios"). El mapeo está en `backend/src/billing/providers/lucode.provider.ts`, con sus pruebas; si en el sandbox algún campo responde con error, ese es el único archivo que hay que ajustar. Puntos a confirmar en el sandbox: que acepte el valor unitario con más de 6 decimales y la nota de crédito de una boleta.

## Búsqueda de RUC y DNI (APISPERU, opcional)

Para que al escribir un RUC o DNI en el cobro se llene solo el nombre: cuenta gratis en **apisperu.com** → **Consultas DNI y RUC** (1000 consultas al mes, se renuevan solas, sin soporte) → copiar el token → **Comprobantes → Configurar → Búsqueda de RUC y DNI**. Los RUC/DNI que ya usó la clínica se llenan sin consultar. Sin token, la cajera escribe la razón social; el RUC igual se valida. Endpoint: `GET https://dniruc.apisperu.com/api/v1/ruc/{ruc}?token=…` (y `/dni/{dni}`), en `backend/src/billing/lookup.ts`.

## 1. Contratar Nubefact

1. La clínica contrata el plan en Nubefact con **su** RUC.
2. Nubefact da acceso a una **cuenta de pruebas**. En su panel están la **RUTA** (URL) y el **TOKEN**.
3. En el panel de Nubefact se registran las series: B001, F001, BC01 y FC01, o las que la clínica prefiera. Deben ser las mismas que en Uywa.

## 2. Conectar Uywa (pruebas)

En **Comprobantes → Configurar**:

1. Proveedor **Nubefact**, pega la ruta y el token, deja **Producción sin marcar**.
2. Completa la **razón social** tal como figura en la ficha RUC y revisa que el **RUC** esté en Configuración → Clínica.
3. **Guardar** y luego **Probar conexión**: debe decir "Conexión con el PSE correcta".
4. Marca **Emitir boletas y facturas** y guarda.

## 3. Casos que hay que probar en la cuenta de pruebas

Prueba uno por uno y revisa en **Comprobantes** que cada uno quede **Aceptado por SUNAT**:

- [ ] Boleta a un cliente con DNI (consulta + producto).
- [ ] Boleta a "clientes varios" (venta de mostrador de hasta S/ 700).
- [ ] Factura a un cliente con RUC.
- [ ] Pago a cuenta: cobra una parte de una deuda y luego el resto. Salen dos boletas.
- [ ] Anular un cobro con boleta: sale la nota de crédito BC01.
- [ ] Anular un cobro con factura: sale la nota de crédito FC01.
- [ ] Un producto exonerado, si la clínica tiene alguno.
- [ ] Apaga el internet del servidor un momento: el cobro se hace igual y el comprobante sale solo al volver.
- [ ] El ticket impreso muestra la razón social, el RUC, el QR, el resumen (hash) y el importe en letras.

> **Formato de la API:** Uywa usa la API JSON de Nubefact, con las operaciones `generar_comprobante` y `consultar_comprobante` y la cabecera `Authorization: Token token="…"`. El mapeo está en `backend/src/billing/providers/nubefact.provider.ts`, con sus pruebas. Si en la cuenta de pruebas algún campo responde con error, ese es el único archivo que hay que ajustar, y conviene compararlo con el manual vigente que Nubefact entrega al contratar.

## 4. Preguntas para el contador de la clínica

- ¿Está de acuerdo con emitir el comprobante **por cada pago** en los pagos a cuenta? La otra opción son los anticipos con regularización, que es más compleja.
- ¿Qué servicios o productos son **exonerados o inafectos**? Se marcan en cada producto o servicio.
- ¿Desde qué fecha la clínica está obligada a emitir electrónicamente, y con qué series?
- El **Excel del registro de ventas** (Comprobantes → Excel para el contador): ¿le sirve tal cual o necesita otras columnas?

## 5. Pasar a producción

1. Nubefact habilita la cuenta de producción y da una **ruta y un token nuevos**.
2. En Uywa: pega los nuevos datos, marca **Producción**, guarda y prueba la conexión.
3. Emite una boleta real pequeña y revisa que quede aceptada.
4. Desde ese momento, revisa la campana: un comprobante con problemas aparece ahí.

## 6. Si algo falla

**Revisión automática:** el servidor prueba la conexión con el PSE a las 00:00, 06:00, 12:00 y
18:00 (hora de Lima) y al arrancar, sin emitir nada ni gastar comprobantes. Cada envío también
actualiza el estado. Si el token no sirve o el servicio está cortado, sale un **banner rojo**
(soporte técnico con botón "Actualizar token"; dueño con "Ver comprobantes" y "avisa a soporte"; caja y recepción sin botón) y **un solo aviso** en la
campana. "Sin conexión" (ámbar) recién tras 3 revisiones seguidas sin respuesta. Al arreglarse
(token nuevo, pago o vuelve la red) los comprobantes detenidos **se reenvían solos**; los
rechazados por SUNAT o con datos mal no. El estado se ve en **Comprobantes → Configurar →
Conexión con Mifact**. En simulación no corre.

| Lo que ves | Qué significa | Qué hacer |
| --- | --- | --- |
| "Error de envío · El PSE no respondió" | El PSE o internet estuvieron caídos | Nada: se reintenta solo. Si sigue, usa **Reintentar** |
| "El token de Mifact venció o no es válido" | Mifact cambió el token (~cada 6 meses) | Soporte técnico pega el nuevo en **Comprobantes → Configurar → Actualizar token** (se prueba antes de guardar). Lo detenido sale solo |
| "Mifact restringió el servicio: revisa el pago" | Venció el pago de la suscripción | Pagar en BCP, BBVA, Interbank o Kashio con el RUC (no transferencias). En la próxima revisión (o con "Probar conexión") sale solo |
| "El PSE rechazó la ruta o el token" (Nubefact, Lucode) | Cambiaron o se copiaron mal | Soporte técnico los corrige en Configurar y usa **Reintentar todos** |
| "Rechazado por SUNAT" + motivo | Un dato no cumple las reglas de SUNAT (por ejemplo, un RUC que no existe) | No se puede reenviar con ese número. Corrige el dato del cliente y emite de nuevo. Consulta al contador |
| "Esperando a SUNAT" por más de un día | El resumen diario de boletas no se procesó | La campana avisa al administrador ("sin aceptar hace más de un día", filtro **Sin aceptar** en Comprobantes). Revisa el documento en el panel del PSE |
