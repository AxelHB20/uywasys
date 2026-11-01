# Desplegar Uywa en un servidor

Guía para dejar Uywa funcionando en internet, con HTTPS, respaldo diario y monitoreo. Sirve para la demo y para la primera clínica. Toma una tarde la primera vez.

**Qué queda funcionando:**

```text
Internet ──HTTPS──▶ Caddy (web) ──/api──▶ API NestJS ──▶ PostgreSQL
                                                          │
                     respaldo diario 03:15, cifrado ◀─────┘ ──▶ Cloudflare R2 / Google Drive
```

Todo corre con Docker Compose en un solo servidor. Solo los puertos 80 y 443 quedan abiertos: la base de datos y la API no se ven desde internet.

## 1. Lo que necesitas

| Qué | Recomendado | Costo aproximado |
| --- | --- | --- |
| Servidor (VPS) con Ubuntu 24.04 y 2 GB de RAM o más | Contabo Cloud VPS 10 o Hostinger KVM 1 | US$ 5–7 al mes |
| Dominio o subdominio | `demo.tudominio.pe` | US$ 10–15 al año |
| Lugar para los respaldos, fuera del servidor | Cloudflare R2 (10 GB gratis) o Google Drive | Gratis al inicio |
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

## 3. Claves del respaldo (en TU computadora, no en el servidor)

Los respaldos se cifran con [age](https://github.com/FiloSottile/age). La clave **pública** va al servidor y la **privada** se queda contigo. Así, aunque alguien robe el servidor o el lugar de los respaldos, no puede leerlos.

```bash
age-keygen -o uywa-respaldo.agekey   # muestra "Public key: age1..."
```

Guarda `uywa-respaldo.agekey` en dos lugares seguros, por ejemplo tu gestor de contraseñas y una USB. **Sin ella no se puede restaurar nada.**

Para la copia fuera del servidor, configura [rclone](https://rclone.org/) en tu PC (`rclone config`): crea un remoto llamado `r2` (Cloudflare R2, tipo S3) o `gdrive` (Google Drive) y prueba con `rclone lsd r2:`.

## 4. Instalar Uywa

```bash
git clone https://github.com/TU_USUARIO/uywasys.git && cd uywasys
git checkout v0.3.6                       # siempre una versión etiquetada
cp deploy/.env.example deploy/.env
nano deploy/.env
```

En `deploy/.env` completa:

- `DOMAIN`: el dominio del paso 2.
- `POSTGRES_PASSWORD` y `JWT_SECRET`: genera cada uno con `openssl rand -base64 36`.
- `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD`: el primer administrador.
- `DEMO_PASSWORD`: solo si vas a cargar los datos de demostración.
- `BACKUP_AGE_RECIPIENT`: la clave pública `age1...` del paso 3.
- `RCLONE_REMOTE`: por ejemplo `r2:uywasys-respaldos`.

Copia la configuración de rclone de tu PC al servidor, en `deploy/backup/rclone/rclone.conf`. En tu PC está en `~/.config/rclone/rclone.conf`, o en Windows en `%APPDATA%\rclone\rclone.conf`.

Crea un atajo para no escribir el comando completo cada vez:

```bash
echo "alias uywa='docker compose -f deploy/docker-compose.yml --env-file deploy/.env'" >> ~/.bashrc && source ~/.bashrc
```

Levanta todo:

```bash
uywa up -d --build                        # la primera vez tarda unos minutos
uywa logs -f api                          # espera "UywaSys API escuchando…" y sal con Ctrl+C
uywa exec api npx prisma db seed          # crea la clínica y el administrador
uywa exec api node scripts/demo-data.mjs  # opcional: un día de demostración completo
```

Abre `https://demo.tudominio.pe`. El certificado HTTPS se emite solo en el primer acceso.

**Datos de demostración:** con `DEMO_PASSWORD` definido, el script arma una clínica con historia: equipo (dos veterinarios, recepción, caja y dos groomers), unos 55 clientes con sus mascotas, catálogo con stock y compras, y 35 días de atenciones con SOAP, vacunas, recetas, cobros con boletas, cierres de caja, citas y grooming; hoy deja la cola con gente esperando, atenciones en curso, el tablero de grooming, una cirugía con presupuesto y consentimiento firmado, y citas para la semana. Tarda unos 5 minutos (la API limita las peticiones por minuto). Si la clínica del seed está vacía la usa; si no, crea una clínica aparte, "Veterinaria Huellitas" (`admin@huellitas.pe`), que no se mezcla con datos reales. Para rehacerla: `DEMO_RESET=1` (archiva la anterior). Días de historia: `DEMO_DAYS` (7 a 90).

## 5. Respaldo

- **Automático:** todos los días a las 03:15 (hora de Lima). Se guardan 30 días en el servidor y 30 días en el remoto. Para ver si corrió: `uywa logs backup`.
- **Manual:** antes de actualizar, siempre: `uywa exec backup backup.sh`.
- **Prueba mensual de restauración** (obligatoria: un respaldo que nunca se probó no es un respaldo). Sube la clave privada al servidor solo durante la prueba:

  ```bash
  scp uywa-respaldo.agekey servidor:/tmp/k     # desde tu PC
  uywa run --rm -v /tmp/k:/key:ro backup verify.sh /key && rm /tmp/k
  ```

  Restaura el último respaldo en una base temporal, compara la cantidad de registros con la base en uso y borra la base temporal.

- **Ante un desastre** (servidor nuevo o datos dañados):
  1. Instala Uywa como en el paso 4, sin el seed.
  2. Descarga el respaldo del remoto al volumen de respaldos: `uywa run --rm backup rclone copy r2:uywasys-respaldos/ARCHIVO /backups/`.
  3. Restaura: `uywa stop api` y luego `uywa run --rm -v /tmp/k:/key:ro backup restore.sh /key ARCHIVO SI-RESTAURAR`.
  4. Vuelve a levantar la API: `uywa start api`.

## 6. Monitoreo

- **Disponibilidad:** en UptimeRobot crea un monitor HTTPS a `https://demo.tudominio.pe/api/health` cada 5 minutos, con aviso a tu correo o Telegram. Ese endpoint también revisa la base de datos.
- **Errores:** cuando alguien ve "avisa a soporte con el código 7F3A09C2", búscalo con `uywa logs api | grep 7F3A09C2`. Ahí están la ruta, el usuario y el detalle técnico. Los logs rotan solos (5 archivos de 10 MB por servicio).
- **Disco:** `df -h` una vez al mes. Con 75 GB alcanza para años.

## 7. Actualizar a una versión nueva

```bash
uywa exec backup backup.sh                # 1. respaldo antes de tocar nada
git fetch --tags && git checkout v0.4.0   # 2. la versión nueva
uywa up -d --build                        # 3. reconstruye; las migraciones se aplican solas
uywa logs -f api                          # 4. revisa que arranque
```

**Volver atrás:** `git checkout v0.3.6 && uywa up -d --build`. Las migraciones solo agregan columnas y tablas, así que la versión anterior sigue funcionando con la base nueva.

## 8. Probar la producción en tu PC antes de subirla

Con Docker Desktop, en `H:\uywasys`:

1. Copia `deploy\.env.example` como `deploy\.env`.
2. Pon `DOMAIN=localhost` y unas claves de prueba. Para `BACKUP_AGE_RECIPIENT` sirve cualquier clave de `age-keygen`.
3. Ejecuta `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build` y abre `https://localhost`. El navegador avisará que el certificado es local: acéptalo.

Lo mismo se prueba solo en GitHub Actions en cada push (job `produccion`).

## 9. Lista antes de mostrarlo a una clínica

- [ ] `https://` abre sin avisos y `/api/health` responde `ok`.
- [ ] Hay al menos un respaldo en el remoto y pasó la prueba de restauración.
- [ ] UptimeRobot avisa: apaga la API un minuto (`uywa stop api`) y comprueba que llega el aviso.
- [ ] El ticket sale bien en una **ticketera térmica real de 80 mm**: en la vista de impresión elige la impresora, márgenes "Ninguno" y escala 100 %. Revisa el logo, el corte al final del ticket y que se lea el saldo pendiente.
- [ ] Datos de la clínica, logo y horario completos en Configuración.
- [ ] Clave del administrador cambiada a una propia.
- [ ] Los textos de `docs/legal/` pasaron por un abogado antes de cargar datos reales.
