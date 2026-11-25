@echo off
chcp 65001 >nul
rem Prepara los datos de la demo en Azure antes de mostrarla. Doble clic; no hay que pegar comandos.
rem 1 = traer al dia (segundos, no borra nada)   2 = rehacer desde cero (1 a 3 minutos)
set KEY=H:\uywasys-keys\uywasys-vm_key.pem
set HOST=azureuser@uywasys-demo.westus2.cloudapp.azure.com
set "DC=cd ~/uywasys && docker compose -f deploy/docker-compose.azure-demo.yml --env-file deploy/.env exec -T"
echo.
echo === Datos de la demo ===
echo.
echo   1. Traer al dia de hoy (recomendado, media hora antes de mostrarla)
echo      Cola, consultorio, grooming, citas e internados quedan con la hora de ahora.
echo.
echo   2. Rehacer todo desde cero
echo      Clinica nueva con 70 dias de historia. La anterior se archiva.
echo      Usuario admin@huellitas.pe / clave Demo2026clave
echo.
set /p OPT=Elige 1 o 2 y pulsa Enter:
if "%OPT%"=="1" (
  ssh -i "%KEY%" %HOST% "%DC% -e DEMO_REFRESH=1 api node scripts/demo-data.mjs" || goto error
) else if "%OPT%"=="2" (
  ssh -i "%KEY%" %HOST% "%DC% -e DEMO_RESET=1 -e DEMO_PASSWORD=Demo2026clave api node scripts/demo-data.mjs" || goto error
) else (
  echo Opcion no valida.
  goto error
)
echo.
echo Listo: https://uywasys-demo.westus2.cloudapp.azure.com  (recarga con Ctrl+F5)
pause
exit /b 0
:error
echo.
echo Algo fallo. Copia lo de arriba y envialo.
pause
exit /b 1
