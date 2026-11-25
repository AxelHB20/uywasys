@echo off
chcp 65001 >nul
rem Sube los cambios al servidor de demostracion en Azure y lo actualiza, sin pegar comandos.
rem Doble clic. Tarda 10 a 20 minutos (compila en el servidor). La demo sigue funcionando mientras.
set KEY=H:\uywasys-keys\uywasys-vm_key.pem
set HOST=azureuser@uywasys-demo.westus2.cloudapp.azure.com
set ZIP=%TEMP%\uywasys.zip

for %%I in ("%~dp0..") do set ROOT=%%~fI
for %%I in ("%ROOT%") do set PARENT=%%~dpI
for %%I in ("%ROOT%") do set NAME=%%~nxI

echo.
echo === 1/3 Empaquetando %ROOT% ===
if exist "%ZIP%" del /q "%ZIP%"
tar -a -c -f "%ZIP%" -C "%PARENT%." --exclude=node_modules --exclude=dist --exclude=.angular --exclude=.git --exclude=.env --exclude=test-results --exclude=playwright-report "%NAME%" || goto error

echo.
echo === 2/3 Subiendo al servidor ===
scp -i "%KEY%" "%ZIP%" %HOST%:~/uywasys.zip || goto error

echo.
echo === 3/3 Actualizando el servidor (no cierres esta ventana) ===
ssh -i "%KEY%" %HOST% "tr -d '\r' | bash -s" < "%~dp0actualizar-demo.sh" || goto error

echo.
echo Listo: https://uywasys-demo.westus2.cloudapp.azure.com  (recarga con Ctrl+F5)
pause
exit /b 0
:error
echo.
echo Algo fallo. Copia lo de arriba y envialo.
pause
exit /b 1
