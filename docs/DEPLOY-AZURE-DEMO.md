# Demo en Azure for Students

Para que una clínica pruebe el sistema con datos de demostración. **No es la producción**: para una
clínica que paga, usa `docs/DEPLOY.md` (VPS con respaldo cifrado propio).

Todo corre en **una sola máquina virtual** (base de datos, API y web con HTTPS):

| Pieza | Servicio | Costo |
|---|---|---|
| Máquina virtual | **B2ats v2** (2 vCPU, 1 GB), Ubuntu 24.04, disco SSD prémium 30 GB | 750 h/mes gratis |
| IP pública y tráfico | — | Pocos dólares del crédito |

> **Regiones de Azure for Students:** la cuenta solo permite algunas regiones (Directiva →
> Tareas → *Allowed resource deployment regions*). En la cuenta de la UTP: North Central US,
> Chile Central, Brazil South, West US 2 y Canada Central. La B2ats v2 se pudo crear en **West US 2**,
> pero ahí no se permite PostgreSQL administrado: por eso la base va dentro de la misma máquina.

## 1. Máquina virtual (ya creada)

- `uywasys-vm` en West US 2, usuario `azureuser`, clave `uywasys-vm_key.pem`.
- Puertos abiertos: 22, 80 y 443.
- Nombre DNS: `uywasys-demo.westus2.cloudapp.azure.com`.

## 2. Preparar la máquina (una sola vez)

Desde la PC (PowerShell o CMD), en la carpeta donde está la clave:

```bash
ssh -i uywasys-vm_key.pem azureuser@uywasys-demo.westus2.cloudapp.azure.com
```

Dentro de la máquina:

```bash
# Memoria extra: con 1 GB de RAM la compilación de Angular no alcanza
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker azureuser
exit
```

## 3. Subir el proyecto

**Con GitHub (repositorio privado):** dentro de la máquina, `git clone https://github.com/USUARIO/uywasys.git`.

**Sin GitHub:** desde la PC, comprime y copia (sin `node_modules`):

```bash
cd H:\
tar -a -c -f uywasys.zip --exclude=node_modules --exclude=dist --exclude=.angular --exclude=.env uywasys
scp -i uywasys-vm_key.pem uywasys.zip azureuser@uywasys-demo.westus2.cloudapp.azure.com:~
```

Y en la máquina: `sudo apt-get install -y unzip && unzip uywasys.zip`.

## 4. Configurar y levantar la base

```bash
cd ~/uywasys
cp deploy/.env.azure-demo.example deploy/.env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" deploy/.env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" deploy/.env
alias dc='docker compose -f deploy/docker-compose.azure-demo.yml --env-file deploy/.env'
dc up -d db
```

## 5. Copiar los datos demo desde la base de Canadá (una sola vez)

La base `uywasys-demo` (Canada Central) ya tiene los datos cargados. Se copian directo a la máquina:

```bash
dc exec db sh -c "pg_dump --no-owner --no-acl 'postgresql://admin_uywasys:Angular%40123@uywasys-demo.postgres.database.azure.com:5432/uywasys_db?sslmode=require' | psql -q -U uywasys -d uywasys"
dc exec db psql -U uywasys -d uywasys -c "select count(*) as clientes from clients;"
```

Si el conteo muestra clientes, la copia funcionó. Después puedes **eliminar** el servidor de Canadá.

## 6. Levantar el sistema

```bash
dc up -d --build
```

La primera compilación tarda 15–25 minutos con 1 GB de RAM. Abre
`https://uywasys-demo.westus2.cloudapp.azure.com` (el certificado HTTPS se emite solo en el primer acceso)
y entra con `admin@huellitas.pe` / `Demo2026clave`.

## Actualizar con un clic

Desde la PC, doble clic en **`deploy\subir-demo.bat`**: empaqueta el proyecto, lo sube, saca un
respaldo de la base (quedan los 7 últimos en `~/respaldos`), compila y espera a que el sistema
responda. No hay que pegar comandos. La clave debe estar en `H:\uywasys-keys\uywasys-vm_key.pem`
(si cambia, se edita la línea `set KEY=` del archivo).

## Antes de mostrarla

Doble clic en **`deploy\demo-al-dia.bat`** y elige:

- **1. Traer al día** (segundos, no borra nada): cola, consultorio, grooming, citas e internados con la
  hora de ahora. Córrelo media hora antes de la reunión.
- **2. Rehacer desde cero** (1 a 3 minutos): clínica nueva con 70 días de historia; la anterior se
  archiva. Entra con `admin@huellitas.pe` / `Demo2026clave`.

## Mantenimiento

```bash
cd ~/uywasys && alias dc='docker compose -f deploy/docker-compose.azure-demo.yml --env-file deploy/.env'
dc logs -f api                                   # ver errores
dc exec -e DEMO_REFRESH=1 api node scripts/demo-data.mjs   # traer la demo al día de hoy
dc exec -e DEMO_RESET=1 -e DEMO_DAYS=25 api node scripts/demo-data.mjs   # demo nueva con 25 días de historia (archiva la anterior)
git pull && dc up -d --build                     # actualizar (con GitHub)
dc exec db pg_dump -U uywasys uywasys | gzip > demo-$(date +%F).sql.gz   # respaldo manual
```

## Reglas de la prueba

- Solo datos ficticios: si la clínica registra clientes reales, aplica la Ley 29733.
- Facturación en **Simulación** (no va a SUNAT).
- Si no se usará varios días, **Detén** la máquina desde el portal.
