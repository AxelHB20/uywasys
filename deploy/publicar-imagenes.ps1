# Arma las imagenes de Uywa en TU PC y las sube al registro privado de GitHub (GHCR).
# El servidor de la clinica solo las descarga: el codigo fuente nunca sale de tu PC.
#
# Se corre UNA vez por version, desde la carpeta del proyecto (H:\uywasys), con Docker Desktop abierto:
#   .\deploy\publicar-imagenes.ps1 -Owner axelhb20 -Tag v0.4.0
#
# La primera vez pide un token de GitHub (Personal Access Token) con permiso "write:packages".
# Se crea en github.com -> Settings -> Developer settings -> Personal access tokens (classic).
# Guardalo en tu bloc de notas; sirve para todas las versiones.

param(
  [Parameter(Mandatory = $true)][string]$Owner,   # tu usuario de GitHub en minusculas, p. ej. axelhb20
  [Parameter(Mandatory = $true)][string]$Tag,     # la version, p. ej. v0.4.0
  [string]$Token = $env:GHCR_TOKEN                 # opcional: el token por variable de entorno
)

$ErrorActionPreference = 'Stop'
$owner = $Owner.ToLower()
$root = Split-Path $PSScriptRoot -Parent   # la carpeta del proyecto (la de arriba de deploy\)

if (-not $Token) {
  $secure = Read-Host "Pega tu token de GitHub (write:packages)" -AsSecureString
  $Token = [System.Net.NetworkCredential]::new('', $secure).Password
}

Write-Host "Entrando al registro de GitHub (ghcr.io) como $owner..." -ForegroundColor Cyan
$Token | docker login ghcr.io -u $owner --password-stdin
if ($LASTEXITCODE -ne 0) { throw "No se pudo entrar a ghcr.io. Revisa el token y el usuario." }

$images = @(
  @{ name = 'uywasys-api';    context = "$root\backend";       dockerfile = "$root\backend\Dockerfile" },
  @{ name = 'uywasys-web';    context = $root;                 dockerfile = "$root\deploy\web.Dockerfile" },
  @{ name = 'uywasys-backup'; context = "$root\deploy\backup"; dockerfile = "$root\deploy\backup\Dockerfile" }
)

foreach ($img in $images) {
  $ref = "ghcr.io/$owner/$($img.name)"
  Write-Host "`nArmando $ref ($Tag)..." -ForegroundColor Cyan
  docker build -t "${ref}:$Tag" -t "${ref}:latest" -f $img.dockerfile $img.context
  if ($LASTEXITCODE -ne 0) { throw "Fallo al armar $($img.name)." }
  Write-Host "Subiendo $ref..." -ForegroundColor Cyan
  # Cada subida se revisa por separado (GHCR a veces rechaza la primera; se reintenta una vez)
  foreach ($t in @($Tag, 'latest')) {
    docker push "${ref}:$t"
    if ($LASTEXITCODE -ne 0) {
      Write-Host "Reintentando subir ${ref}:$t..." -ForegroundColor Yellow
      Start-Sleep -Seconds 5
      docker push "${ref}:$t"
      if ($LASTEXITCODE -ne 0) { throw "Fallo al subir ${ref}:$t." }
    }
  }
}

Write-Host "`nListo. Subidas las 3 imagenes con la version $Tag." -ForegroundColor Green
Write-Host "La primera vez, en github.com -> tu foto -> Packages, abre cada paquete (uywasys-api, -web, -backup)," -ForegroundColor Yellow
Write-Host "entra a Package settings y deja su visibilidad en Private." -ForegroundColor Yellow
Write-Host "En el servidor:  docker compose -f docker-compose.server.yml --env-file .env pull && ... up -d" -ForegroundColor Yellow
