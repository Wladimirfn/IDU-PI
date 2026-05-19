@echo off
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"
node scripts\setup-env.mjs
set "EXITCODE=%ERRORLEVEL%"
echo.
if "%EXITCODE%"=="0" (
  echo Configuracion terminada. Ahora podes ejecutar start-pi-telegram-bridge.bat
) else (
  echo Configuracion finalizo con error %EXITCODE%.
)
pause
exit /b %EXITCODE%
