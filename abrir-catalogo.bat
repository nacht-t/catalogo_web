@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set PORT=8765
set "URL=http://127.0.0.1:%PORT%/Catalogo.html"

where python >nul 2>&1
if %ERRORLEVEL% equ 0 (
  echo Iniciando servidor en el puerto %PORT%...
  start "Catálogo — servidor (cerrá esta ventana para apagar)" /D "%~dp0" cmd /k python -m http.server %PORT%
  timeout /t 2 /nobreak >nul
  start "" "%URL%"
  goto :eof
)

where node >nul 2>&1
if %ERRORLEVEL% equ 0 (
  echo Iniciando servidor con npx serve...
  start "Catálogo — servidor (cerrá esta ventana para apagar)" /D "%~dp0" cmd /k npx --yes serve . -l %PORT%
  timeout /t 4 /nobreak >nul
  start "" "%URL%"
  goto :eof
)

echo No se encontro Python ni Node.js en el PATH.
echo Instala Python desde https://www.python.org/downloads/ ^(marca "Add to PATH"^) o Node desde https://nodejs.org/
pause
