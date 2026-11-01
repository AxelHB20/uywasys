# Lo legal de Uywa: qué revisar antes de vender

> **Borradores.** Nada de esta carpeta reemplaza la revisión de un abogado. Están escritos para que el abogado parta de algo concreto y para que la clínica sepa qué le toca.
> Revisión técnica del 28 de octubre de 2026. Normas: Ley N.° 29733 de Protección de Datos Personales y su reglamento, D. S. N.° 016-2024-JUS (vigente desde el 30 de marzo de 2025).

## 1. Textos que debe revisar el abogado

| Texto | Dónde está | Qué decir al revisarlo |
| --- | --- | --- |
| Consentimiento del cliente (versión `2026-10-v2`) | `backend/src/clients/consent.ts` | Si cambia, se sube la versión: cada cliente guarda la que aceptó |
| Consentimiento de promociones (aparte y opcional) | `backend/src/clients/consent.ts` | |
| Términos del servicio | `frontend/src/app/features/legal/legal-content.ts` · se ve en `/legal/terminos` | Faltan la razón social, el RUC y el correo del titular (`UYWA_COMPANY`) |
| Política de privacidad | El mismo archivo · se ve en `/legal/privacidad` | Idem |
| Modelos de consentimiento informado (cirugía, anestesia, eutanasia, hospitalización, otro) | `backend/src/medical/consent-templates.ts` | Son modelos generales; el veterinario puede ajustar cada uno antes de la firma y queda guardado lo que se firmó |
| Contrato de encargo de tratamiento entre la clínica y Uywa | [contrato-encargo-tratamiento.md](contrato-encargo-tratamiento.md) | Se firma con cada clínica antes de cargar datos reales |

## 2. Qué ya hace el sistema

- **Consentimiento al registrar.** No se puede registrar un cliente sin marcarlo. Se guardan la fecha, la versión del texto, el medio (formulario o importación) y quién lo registró. El consentimiento de promociones va aparte y es opcional.
- **Envío de datos al extranjero.** La versión 2 del consentimiento lo informa y lo acepta de forma expresa, porque los servidores de nube y del proveedor de facturación pueden estar fuera del Perú.
- **Derecho de acceso.** En la ficha del cliente, el administrador usa **Descargar sus datos**, que genera un archivo con todo lo que la clínica guarda de él.
- **Derecho de rectificación.** Es la edición normal de la ficha.
- **Derecho de oposición** a promociones: se quita la marca "Acepta promociones".
- **Derecho de cancelación.** El administrador usa **Borrar sus datos**, que pide el motivo y una confirmación. Se borran el nombre, el documento, el celular, el correo, la dirección, las notas, las personas autorizadas y el microchip de sus mascotas. Las atenciones y los cobros se conservan sin esos datos (historia clínica y obligación tributaria). No se puede hacer si tiene una atención abierta o deuda pendiente.
- **Bitácora.** Cada exportación y cada borrado quedan en **Actividad** con autor, fecha y motivo, nunca con los datos borrados.
- **Consentimientos informados firmados en pantalla.** Se guardan el texto exacto, la firma dibujada, el nombre, documento y relación de quien firma, el veterinario, la fecha y hora, y una huella SHA-256 de todo eso: si el registro se alterara, la huella dejaría de coincidir. No se editan; se anulan con motivo y queda en **Actividad**. Es una firma electrónica simple (Ley 27269), no una firma digital con certificado.
- **Archivos de la historia.** Solo fotos y PDF (se revisa el contenido, no solo el nombre), hasta 10 MB, visibles únicamente para la clínica. No se borran: se anulan con motivo.
- **Seguridad.**
  - Contraseñas cifradas con bcrypt.
  - Sesión en una cookie que JavaScript no puede leer, con vencimiento.
  - Bloqueo de la cuenta tras varios intentos fallidos, más un límite de intentos por conexión.
  - Al cambiar la contraseña se cierran las sesiones de otros equipos.
  - Permisos por rol y aislamiento entre clínicas, probados con pruebas automáticas.
  - Respaldo diario fuera del servidor, desde el hito de demo.

## 3. Lo que le toca a cada clínica (ponerlo en el contrato y en la capacitación)

1. **Inscribir su banco de datos de clientes** en el Registro Nacional de Protección de Datos Personales. Desde marzo de 2025 es gratuito y se aprueba en automático.
2. **Atender los pedidos ARCO** en plazo. La referencia usual es de 20 días hábiles para el acceso y 10 para la rectificación, la cancelación y la oposición. *Verificar los plazos con el abogado.*
3. **Avisar a la autoridad** de un incidente de seguridad grave en 48 horas, y a los afectados si hay riesgo. Uywa se compromete a avisarle de inmediato (ver el contrato).
4. **Designar un oficial de datos personales** si le corresponde. Según el reglamento, depende del tamaño y del tipo de datos, con plazos escalonados hasta 2028 para las microempresas. *Confirmar si aplica a una veterinaria pequeña.*
5. **Tener un libro de reclamaciones** (Indecopi), físico o virtual.
6. **Pedir el consentimiento de verdad:** leer o mostrar el texto al cliente antes de marcarlo.

## 4. Lo que le toca a Uywa como empresa

1. Constituir la empresa o emitir como persona natural con RUC, y completar `UYWA_COMPANY` en los términos.
2. Inscribir su propio banco de datos (usuarios del sistema).
3. Tener contratos con sus proveedores (nube y facturación electrónica) que garanticen un nivel de protección equivalente. Para el envío a países sin nivel adecuado, el reglamento pide cláusulas contractuales.
4. Tener un libro de reclamaciones virtual en la web de venta.
5. Tener un procedimiento escrito de incidentes: quién avisa a la clínica, en cuánto tiempo y con qué datos.

## 5. Preguntas abiertas para el abogado y el contador

- ¿Cuánto tiempo debe conservarse la información tributaria y de cobros? Hoy se conserva sin límite. *Contador.*
- ¿Hay una norma que fije cuánto tiempo guardar la historia clínica veterinaria? *Colegio Médico Veterinario del Perú.*
- ¿Basta el consentimiento marcado por recepción, o conviene una firma en pantalla? Los consentimientos informados ya se firman en pantalla; el de datos personales sigue marcado.
- ¿La firma en pantalla con huella SHA-256 es prueba suficiente de un consentimiento informado, o la clínica debe además imprimirlo y guardarlo firmado a mano? *Abogado.*
- ¿Las clínicas que importen clientes desde Excel deben volver a pedirles el consentimiento? Hoy la clínica declara tenerlo al importar.

Fuentes: [IAPP, nuevo reglamento](https://iapp.org/news/a/se-publica-el-nuevo-reglamento-de-protecci-n-de-datos-personales-en-per-), [LaLey.pe, marco legal 2025](https://laley.pe/todo-sobre-el-nuevo-marco-legal-de-proteccion-de-datos-personales-en-peru/), [procedimiento ARCO de referencia](https://isegcorp.com/peru/wp-content/uploads/2026/05/PE-SGI-P-08-Procedimiento-Derechos-ARCO.pdf).
