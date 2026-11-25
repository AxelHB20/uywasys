@echo off
chcp 65001 >nul
rem Actualiza UywaSys en esta PC con Docker: base, backend y web.
rem Doble clic despues de recibir cambios. Instala lo nuevo y aplica migraciones solo.
cd /d "%~dp0"
echo.
echo === Actualizando UywaSys en tu PC ===
echo.
netstat -ano | findstr /r /c:":3000 .*LISTENING" >nul
if not errorlevel 1 (
  docker ps --format "{{.Names}}" | findstr /c:"uywasys-api" >nul
  if errorlevel 1 (
    echo [!] Otro programa usa el puerto 3000: cierra la ventana donde corre "npm run start:dev" y vuelve a abrir este archivo.
    pause
    exit /b 1
  )
)
docker compose up -d || goto error
docker compose restart api || goto error
echo.
echo Esperando al backend (la primera vez tarda 1 a 3 minutos)...
for /l %%i in (1,1,72) do (
  curl -s http://localhost:3000/api/health 2>nul | findstr /c:"\"up\"" >nul && goto ok
  timeout /t 5 >nul
)
echo.
echo [!] El backend no respondio. Ultimas lineas del registro:
docker compose logs --tail 40 api
goto error
:ok
echo.
echo Listo: abre http://localhost:4200 y recarga con Ctrl+F5
echo.
pause
exit /b 0
:error
echo.
echo Algo fallo. Copia lo de arriba y envialo.
pause
exit /b 1
