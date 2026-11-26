# Desplegar Uywa en un servidor

Guía para dejar Uywa funcionando en internet, con HTTPS, respaldo diario y monitoreo. Sirve para la demo y para la primera clínica. Toma una tarde la primera vez.

**Qué queda funcionando:**

```text
Internet ──HTTPS──▶ Caddy (web) ──/api──▶ API NestJS ──▶ PostgreSQL
                                                          │
       respaldo diario 03:15, incremental y cifrado ◀─────┘ ──▶ Google Drive / Cloudflare R2
```

Todo corre con Docker Compose en un solo servidor. Solo los puertos 80 y 443 quedan abiertos: la base de datos y la API no se ven desde internet.

## 1. Lo que necesitas

| Qué | Recomendado | Costo aproximado |
| --- | --- | --- |
| Servidor (VPS) con Ubuntu 24.04 y 2 GB de RAM o más | Contabo Cloud VPS 10 o Hostinger KVM 1 | US$ 5–7 al mes |
| Dominio o subdominio | `demo.tudominio.pe` | US$ 10–15 al año |
| Lugar para los respaldos, fuera del servidor | Google Drive de la clínica (15 GB gratis) o Cloudflare R2 (10 GB gratis) | Gratis |
| Monitoreo de disponibilidad | UptimeRobot (plan gratuito) | Gratis |

## 2. Preparar el servidor (una sola vez)

Entra por SSH con el usuario que te dio el proveedor y ejecuta:

```bash
# Actualizaciones de seguridad automáticas
sudo apt update && sudo apt upgrade -y
sudo apt install -y unattended-upgrades git ufw
# Firewall: solo SSH, HTTP y HTTPS
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw --force enable
# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # sal y vuelve a entrar para que tome efecto
```

En tu proveedor de dominio crea un **registro A**: `demo` → la IP del servidor. Espera a que responda (`ping demo.tudominio.pe`).

## 3. Respaldos: contraseña y destino (en TU computadora)

Los respaldos se hacen con [restic](https://restic.net/): el primero es completo y desde ahí cada noche se sube **solo lo que cambió**, pero cualquier día guardado se restaura completo. Así 30 días y 12 meses de historial ocupan poco más que una sola copia, y caben en el Drive gratis por años. Van cifrados (AES-256) con una contraseña.

1. **Contraseña:** genérala con `openssl rand -base64 24` y anótala en dos lugares, fuera del servidor: la hoja de entrega a la clínica y tu gestor de contraseñas. **Sin ella no se puede restaurar nada.**
2. **Destino fuera del servidor:** instala [rclone](https://rclone.org/) en tu PC (`winget install Rclone.Rclone`) y ejecuta `rclone config`:
   - `n` (nuevo), nombre `gdrive`, tipo **drive** (Google Drive).
   - `client_id` y `client_secret` vacíos.
   - Permiso (scope): **`drive.file`**, así rclone solo ve los archivos que él sube.
   - Lo demás por defecto; "auto config": sí. Se abre el navegador: entra con el **Gmail de la clínica** (no el de un empleado) y acepta.
   - Prueba: `rclone mkdir gdrive:uywa-respaldos` y `rclone lsd gdrive:`.

   Con Cloudflare R2 es igual, con un remoto `r2` de tipo S3.

## 4. Instalar Uywa (sin código fuente en el servidor)

El código **no se copia al servidor**. En tu PC armas las imágenes y las subes a tu registro privado de GitHub (GHCR); el servidor solo las descarga. Así, aunque alguien copie el servidor de la clínica, no obtiene el código fuente, solo el programa compilado.

**4.1 En tu PC (una vez por versión).** Con Docker Desktop abierto y el proyecto en `H:\uywasys`:

1. Crea un token de GitHub con permiso para subir paquetes: github.com → Settings → Developer settings → **Personal access tokens (classic)** → Generate → marca **`write:packages`**. Cópialo a tu bloc de notas.
2. Arma y sube las tres imágenes (API, web y respaldo):

   ```powershell
   cd H:\uywasys
   powershell -ExecutionPolicy Bypass -File .\deploy\publicar-imagenes.ps1 -Owner axelhb20 -Tag v0.4.0
   ```

   (`-ExecutionPolicy Bypass` evita el aviso de Windows "la ejecución de scripts está deshabilitada" solo para este comando.)

   Pide el token la primera vez. El JavaScript del backend se compacta y se le quitan los mapas de código dentro de la imagen, así que no queda código legible.
3. La primera vez, en github.com → tu foto → **Packages**, abre `uywasys-api`, `uywasys-web` y `uywasys-backup`, entra a **Package settings** y deja la visibilidad en **Private**.

**4.2 Darle al servidor permiso de solo lectura al registro.** En GitHub crea otro token classic, ahora solo con **`read:packages`** (este va en el servidor, por eso mínimo permiso). Luego, en el servidor:

```bash
mkdir -p ~/uywa/backup/rclone && cd ~/uywa
echo "EL_TOKEN_READ_PACKAGES" | docker login ghcr.io -u TU_USUARIO_GITHUB --password-stdin
```

**4.3 Lo que necesita el servidor.** No hace falta el repositorio, solo copia desde tu PC a `~/uywa` en el servidor (con el bloc de notas y `nano`, o con `scp`): `deploy/docker-compose.server.yml` y `deploy/.env.example` (renómbralo a `.env`). El `rclone.conf` de los respaldos va en `~/uywa/backup/rclone/rclone.conf` (se crea en el paso 3).

```bash
cd ~/uywa
cp .env.example .env
nano .env
```

En `.env` completa:

- `IMAGE_OWNER`: tu usuario de GitHub en minúsculas (donde subiste las imágenes).
- `IMAGE_TAG`: la versión, p. ej. `v0.4.0`.
- `DOMAIN`: el dominio del paso 2.
- `POSTGRES_PASSWORD` y `JWT_SECRET`: genera cada uno con `openssl rand -base64 36`.
- `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD`: el primer administrador.
- `DEMO_PASSWORD`: solo si vas a cargar los datos de demostración.
- `BILLING_ALLOW_SIMULATED=false` (ya viene así): en producción no se emiten comprobantes simulados. Hasta configurar Mifact, Caja solo emite notas de venta.
- `BILLING_SECRET`: genera uno con `openssl rand -hex 32`. Es **obligatorio** en el servidor de la clínica (sin él la API no arranca) y cifra el token del PSE. ⚠ **Nunca lo cambies**: si cambia, el token guardado ya no se puede leer y se corta la facturación (habría que volver a pegarlo). Guárdalo junto con `BACKUP_PASSWORD`.
- `BACKUP_PASSWORD`: la contraseña del paso 3.
- `RCLONE_REMOTE`: `gdrive:uywa-respaldos`.
- `BACKUP_PING_URL`: el aviso de healthchecks.io (paso 6).

Copia la configuración de rclone de tu PC al servidor, en `~/uywa/backup/rclone/rclone.conf`. En tu PC está en `~/.config/rclone/rclone.conf`, o en Windows en `%APPDATA%\rclone\rclone.conf`.

Crea un atajo para no escribir el comando completo cada vez:

```bash
echo "alias uywa='docker compose -f ~/uywa/docker-compose.server.yml --env-file ~/uywa/.env'" >> ~/.bashrc && source ~/.bashrc
```

Descarga las imágenes y levanta todo:

```bash
uywa pull                                 # baja las imágenes privadas (la primera vez tarda unos minutos)
uywa up -d
uywa logs -f api                          # espera "UywaSys API escuchando…" y sal con Ctrl+C
uywa exec api npx prisma db seed          # crea la clínica y el administrador
uywa exec api node scripts/demo-data.mjs  # opcional: un día de demostración completo
```

**Cuenta de soporte técnico (la tuya).** Es la única que cambia la configuración de facturación (proveedor, ruta, producción, series, razón social) y el RUC cuando el PSE está activo; ve todo como administrador. También es la única que ve la configuración y pega el token nuevo de Mifact (**Actualizar token**, se prueba antes de guardarse); el dueño no la ve. Créala desde **Usuarios → Nuevo usuario** como Administrador, cámbiale la clave al entrar y márcala en el servidor:

```bash
uywa exec db psql -U uywasys -d uywasys -c "UPDATE users SET is_support = true WHERE email = 'tu-correo@ejemplo.com';"
```

Desde ese momento nadie de la clínica la puede editar, desactivar ni cambiarle la clave. Para quitársela: `is_support = false`. Avísale al dueño que esa cuenta existe y para qué es (va en la hoja de entrega).

Abre `https://demo.tudominio.pe`. El certificado HTTPS se emite solo en el primer acceso.

**Buscadores y vista previa:** la app es privada de cada clínica, así que va fuera de Google (`noindex` en `index.html` y en la cabecera `X-Robots-Tag` de Caddy); la página de venta irá en otro dominio. Con el dominio definitivo, para que el enlace se vea con imagen al compartirlo por WhatsApp, agrega en `frontend/src/index.html` una imagen de 1200×630 en `public/` y `<meta property="og:image" content="https://TU-DOMINIO/og.png">` (siempre con la dirección completa).

**Datos de demostración:** con `DEMO_PASSWORD` definido, el script arma una clínica con **un año completo de historia** que crece mes a mes y tiene temporadas (verano y diciembre con más grooming, invierno con más consultas): equipo (dos veterinarios, recepción, caja, dos groomers y una practicante que ya se fue), unos 300 clientes con sus mascotas, más de 2 000 atenciones con SOAP, vacunas, recetas y exámenes, cobros con boletas y facturas, cierres de caja (algunos con diferencia), anulaciones con nota de crédito, subidas de precio, compras de reposición según lo que se usa (con la foto de la última factura), lotes vencidos y por vencer, avisos de refuerzo enviados por WhatsApp, portal del dueño, una adenda, controlados, merma y conteo físico; hoy deja la cola con gente esperando, atenciones en curso, el tablero de grooming, dos internados, una cirugía con presupuesto y consentimiento firmado, y citas para la semana. Así Inicio, Reportes (12 meses de punta a punta), Actividad y cada sección tienen qué mostrar. Tarda unos 5 minutos. Si la clínica del seed está vacía la usa; si no, crea una clínica aparte, "Veterinaria Huellitas" (`admin@huellitas.pe`), que no se mezcla con datos reales. Para rehacerla: `DEMO_RESET=1` (archiva la anterior). Días de historia: `DEMO_DAYS` (7 a 430; por defecto 364, así "12 meses" empieza el día en que la clínica empezó a usar Uywa; para una prueba rápida, 25).

**Antes de mostrarla (importante):** la demo se arma con las fechas del día en que se corrió. Si la muestras otro día, tráela al día con `DEMO_REFRESH=1` (tarda segundos, no crea nada): el último día de la demo pasa a ser hoy, lo de hoy queda repartido hasta ese momento (cola, consultorio y tablero de grooming "en vivo") y las citas pendientes quedan para más tarde; la hoja de los internados también se trae a la hora actual. Córrelo media hora antes de la reunión:

```bash
docker compose exec -e DEMO_REFRESH=1 api node scripts/demo-data.mjs
```

Qué trae la demo para mostrar: inicio con cola, citas de hoy (una llegó, una no vino, las demás más tarde), refuerzos que tocan esta semana y vencidos con WhatsApp, avisos (urgencia, un lote vencido, uno por vencer y stock bajo) y lo cobrado en el mes; reportes de ventas, margen (los servicios con sus insumos) e inventario (con un lote vencido y correas sin movimiento); grooming en todos los estados con comisiones; una cirugía con presupuesto aceptado, consentimiento firmado y radiografía; caja abierta con cobros, venta de mostrador y egreso.

### 4.4 "¿Olvidaste tu contraseña?" por correo (recomendado)

Así el dueño y el personal recuperan su clave solos, sin llamarte. Se envía desde el **Gmail de la clínica**, gratis.

1. Entra a esa cuenta de Google → **Seguridad** → activa la **Verificación en dos pasos** (es requisito de Google).
2. Abre [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), escribe `Uywa` y toca **Crear**. Copia las 16 letras (solo se muestran una vez).
3. En el servidor, agrega a `~/uywa/.env`:

   ```text
   SMTP_USER=correo-de-la-clinica@gmail.com
   SMTP_PASS=las16letrasdelacontrasenadeaplicacion
   SMTP_FROM=Gomez Medic <correo-de-la-clinica@gmail.com>
   ```

4. `uywa up -d` (reinicia la API). En la pantalla de ingreso aparece **¿Olvidaste tu contraseña?**.

Cómo funciona: el usuario escribe su correo y recibe un enlace que vale **30 minutos** y sirve **una sola vez** (como máximo 3 pedidos por hora). Al crear la clave nueva se desbloquea la cuenta y se cierran sus sesiones en otros equipos. La pantalla responde lo mismo exista o no el correo.

⚠ Si alguien cambia la contraseña del Gmail de la clínica, Google anula la contraseña de aplicación y los correos dejan de salir: crea otra (paso 2), cámbiala en `.env` y `uywa up -d`. Si falla un envío, queda en `uywa logs api` ("No se pudo enviar el correo").

## 5. Respaldo

- **Automático:** todos los días a las 03:15 (hora de Lima), directo al remoto. Se guardan 30 días (uno por día) y 12 meses (uno por mes); lo más antiguo se borra solo. Se cambia con `BACKUP_KEEP_DAILY` y `BACKUP_KEEP_MONTHLY`. Para ver si corrió y cuánto ocupa: `uywa logs backup`.
- **Manual:** antes de actualizar, siempre: `uywa exec backup backup.sh`.
- **Ver los respaldos guardados:** `uywa run --rm backup restore.sh lista`.
- **Prueba de restauración** (al instalar y una vez al año; un respaldo que nunca se probó no es un respaldo): `uywa run --rm backup verify.sh`. Revisa el repositorio, restaura el último respaldo en una base temporal, compara la cantidad de registros con la base en uso y borra la base temporal.
- **Ante un desastre** (servidor nuevo o datos dañados):
  1. Instala Uywa como en el paso 4, sin el seed, con la misma `BACKUP_PASSWORD`, el mismo `RCLONE_REMOTE` y el `rclone.conf`.
  2. `uywa stop api`.
  3. `uywa run --rm backup restore.sh latest SI-RESTAURAR` (o el código de un respaldo anterior, de la lista).
  4. `uywa start api`.
- **Copia completa extra (opcional, el primer mes):** con `BACKUP_AGE_RECIPIENT` (clave pública de `age-keygen`) se guarda además una copia completa diaria en el servidor, 7 días. Se restaura con `uywa run --rm -v /ruta/clave.agekey:/key:ro backup restore.sh uywasys_FECHA.dump.age SI-RESTAURAR`.

- **Si el Drive gratis se llena (archivar y liberar):** primero baja el historial (`BACKUP_KEEP_MONTHLY=3` en `.env`, `uywa up -d`). Si aun así no alcanza, archiva:
  1. En una PC con rclone: `rclone copy gdrive:uywa-respaldos D:\uywa-archivo-AÑO` y guarda una segunda copia en un disco externo.
  2. Comprueba la copia: `restic -r D:\uywa-archivo-AÑO check` (pide la `BACKUP_PASSWORD`).
  3. Recién entonces: `rclone purge gdrive:uywa-respaldos`.
  4. Esa noche el respaldo crea un almacén nuevo solo y sube una copia completa de la base actual.
  El archivo se restaura con la misma `BACKUP_PASSWORD` (por eso nunca cambia). Queda escrito en la hoja de entrega: Drive gratuito de 15 GB; si se llena se reduce el historial o se archiva sin costo; más almacenamiento lo paga la clínica si lo quiere.

## 6. Monitoreo

- **Respaldo:** en healthchecks.io (gratis) crea un check con período de 1 día y gracia de 1 hora, y pon su URL en `BACKUP_PING_URL`. Si un respaldo falla o deja de correr, llega un correo. Sin esto, un respaldo roto pasa desapercibido hasta el día que se necesita.
- **Rendimiento:** en healthchecks.io crea un segundo check con período de 7 días y gracia de 1 día, y pon su URL en `PERF_PING_URL`. Cada lunes a las 07:10 se revisa la base: consultas lentas, tablas grandes sin índice, limpieza atrasada, memoria y disco. Si algo está mal, el correo trae el informe con lo que hay que mirar; si todo está bien, no llega nada. Manual: `uywa exec backup perf-check.sh`. Las consultas de más de 1 segundo quedan en `uywa logs db` con su plan.
- **Disponibilidad:** en UptimeRobot crea un monitor HTTPS a `https://demo.tudominio.pe/api/health` cada 5 minutos, con aviso a tu correo o Telegram. Ese endpoint también revisa la base de datos.
- **Errores:** cuando alguien ve "avisa a soporte con el código 7F3A09C2", búscalo con `uywa logs api | grep 7F3A09C2`. Ahí están la ruta, el usuario y el detalle técnico. Los logs rotan solos (5 archivos de 10 MB por servicio).
- **Disco:** `df -h` una vez al mes. Con 75 GB alcanza para años.

## 7. Actualizar a una versión nueva

Primero, en **tu PC**, armas y subes la versión nueva (igual que en el paso 4.1):

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\publicar-imagenes.ps1 -Owner axelhb20 -Tag v0.5.0
```

Luego, en el **servidor**:

```bash
uywa exec backup backup.sh                     # 1. respaldo antes de tocar nada
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=v0.5.0/' ~/uywa/.env   # 2. apunta a la versión nueva
uywa pull                                      # 3. baja las imágenes nuevas
uywa up -d                                     # 4. las migraciones se aplican solas
uywa logs -f api                               # 5. revisa que arranque
```

**Volver atrás:** pon la versión anterior en `IMAGE_TAG` (`v0.4.0`), `uywa pull && uywa up -d`. Las migraciones solo agregan columnas y tablas, así que la versión anterior sigue funcionando con la base nueva.

**Prueba antes de tocar el real:** si tienes el sistema de prueba (abajo), sube la versión y actualízala **primero** ahí. Si todo va bien, recién cambias el `IMAGE_TAG` del real.

## 8. Probar la producción en tu PC antes de subirla

Con Docker Desktop, en `H:\uywasys`:

1. Copia `deploy\.env.example` como `deploy\.env`.
2. Pon `DOMAIN=localhost` y unas claves de prueba, también en `BACKUP_PASSWORD`.
3. Ejecuta `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build` y abre `https://localhost`. El navegador avisará que el certificado es local: acéptalo.

Lo mismo se prueba solo en GitHub Actions en cada push (job `produccion`).

## 9. Lista antes de mostrarlo a una clínica

- [ ] `https://` abre sin avisos y `/api/health` responde `ok`.
- [ ] Facturación: Mifact configurado en producción y "Probar conexión" correcto; ningún comprobante sale con el sello "Simulación".
- [ ] Catálogo de servicios revisado con el veterinario: insumos solo de lo que se controla (vacunas, medicamentos, controlados, jeringas) en su unidad mínima. Guantes, algodón y alcohol no se controlan, salvo que la clínica lo pida.
- [ ] Hay al menos un respaldo en el remoto (`restore.sh lista`) y pasó la prueba de restauración (`verify.sh`).
- [ ] La contraseña de los respaldos está en la hoja de entrega y en un segundo lugar fuera del servidor.
- [ ] healthchecks.io recibe el primer respaldo (`uywa exec backup backup.sh`) y figura en verde.
- [ ] UptimeRobot avisa: apaga la API un minuto (`uywa stop api`) y comprueba que llega el aviso.
- [ ] El ticket sale bien en una **ticketera térmica real de 80 mm**: en la vista de impresión elige la impresora, márgenes "Ninguno" y escala 100 %. Revisa el logo, el corte al final del ticket y que se lea el saldo pendiente.
- [ ] Datos de la clínica, logo y horario completos en Configuración.
- [ ] Clave del administrador cambiada a una propia.
- [ ] Los textos de `docs/legal/` pasaron por un abogado antes de cargar datos reales.

## 10. Sistema de prueba en el mismo servidor (opcional)

Para enseñar al personal y mostrar el sistema sin tocar los datos reales, por ejemplo en `prueba-veterinario.duckdns.org`. Corre junto a la clínica con **su propia base de datos** (`prueba-db`), comprobantes **simulados** (sello "Simulación · sin valor tributario"), sin correo y sin respaldos. Usa la misma versión que la clínica: al actualizar, se actualizan las dos.

⚠ Nunca pongas el token de Mifact de producción en el sistema de prueba.

1. El subdominio debe apuntar a la IP del servidor (en DuckDNS, la misma IP).
2. En el servidor, **antes de reiniciar**, crea la carpeta de sitios extra (si Docker la crea, queda sin permiso para copiar):
   ```bash
   mkdir -p ~/uywa/sites
   ```
3. Desde tu PC copia el sitio y el compose:
   ```bash
   scp deploy\sites\prueba.caddy uywa@IP:~/uywa/sites/
   scp deploy\docker-compose.server.yml uywa@IP:~/uywa/
   ```
4. En el servidor, agrega al `.env` (los secretos se generan solos; cambia el dominio y la clave de demostración):
   ```bash
   cat >> ~/uywa/.env <<EOF
   COMPOSE_PROFILES=prueba
   PRUEBA_DOMAIN=prueba-veterinario.duckdns.org
   PRUEBA_POSTGRES_PASSWORD=$(openssl rand -hex 24)
   PRUEBA_JWT_SECRET=$(openssl rand -hex 48)
   PRUEBA_DEMO_PASSWORD=UnaClaveDemo2026
   EOF
   uywa pull && uywa up -d
   ```
   `COMPOSE_PROFILES=prueba` hace que `uywa up -d` levante también la prueba. Para apagarla: bórrala del `.env` y `uywa stop prueba-api prueba-db`.
5. Carga los datos de demostración (unos 5 minutos): `uywa exec prueba-api node scripts/demo-data.mjs`. Crea "Veterinaria Huellitas" con un año completo de historia; se entra con `admin@huellitas.pe` y `PRUEBA_DEMO_PASSWORD`.
6. Antes de mostrarla otro día, tráela a la fecha de hoy: `uywa exec -e DEMO_REFRESH=1 prueba-api node scripts/demo-data.mjs`. Para rehacerla desde cero: `-e DEMO_RESET=1`.

El nombre de la clínica en el menú ("Veterinaria Huellitas") y el sello de simulación en los comprobantes distinguen la prueba del sistema real. Las sesiones no se mezclan: cada sistema tiene su dominio y su propia clave de sesión.

