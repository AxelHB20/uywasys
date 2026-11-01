# Facturación electrónica: cómo pasar de la simulación al PSE

Uywa ya emite boletas, facturas y notas de crédito. Con el proveedor **Simulación** se numeran e imprimen como las reales, pero no van a SUNAT. Este documento es la lista para el día en que la clínica contrate el PSE (Nubefact).

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
- **Factura:** solo para clientes con RUC. **Boleta desde S/ 700:** exige el DNI u otro documento del cliente. Por debajo de ese monto, si no hay documento, sale como "clientes varios".
- **Pago a cuenta:** el comprobante sale por lo que se pagó en ese cobro. La línea dice "(pago a cuenta)" y la base y el IGV son proporcionales. *Confírmalo con el contador de la clínica* (ver la sección 4).
- **El token del PSE** se guarda cifrado (AES-256-GCM) y nunca vuelve al navegador. La clave sale de `BILLING_SECRET` o, si no se define, de `JWT_SECRET`. Si cambias esa variable, vuelve a pegar el token.

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
- [ ] Boleta a "clientes varios" (venta de mostrador menor a S/ 700).
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

| Lo que ves | Qué significa | Qué hacer |
| --- | --- | --- |
| "Error de envío · El PSE no respondió" | El PSE o internet estuvieron caídos | Nada: se reintenta solo. Si sigue, usa **Reintentar** |
| "El PSE rechazó la ruta o el token" | Cambiaron o se copiaron mal | Corrígelos en Configurar y usa **Reintentar** |
| "Rechazado por SUNAT" + motivo | Un dato no cumple las reglas de SUNAT (por ejemplo, un RUC que no existe) | No se puede reenviar con ese número. Corrige el dato del cliente y emite de nuevo. Consulta al contador |
| "Esperando a SUNAT" por más de un día | El resumen diario de boletas no se procesó | Revisa el documento en el panel del PSE |
