@echo off
setlocal
echo ============================================================
echo   PrenotaBot Livre - Chromium Edicao Dedicada Prenot@mi
echo ============================================================
set "EXT_DIR=%~dp0extensao_android"
set "PROFILE_DIR=%~dp0chromium_perfil"
set "SEED_DIR=%~dp0chromium_seed"
if not exist "%PROFILE_DIR%\Default" mkdir "%PROFILE_DIR%\Default"
if not exist "%PROFILE_DIR%\Default\Preferences" if exist "%SEED_DIR%\Preferences" copy /Y "%SEED_DIR%\Preferences" "%PROFILE_DIR%\Default\Preferences" >nul
if not exist "%PROFILE_DIR%\Default\Bookmarks" if exist "%SEED_DIR%\Bookmarks" copy /Y "%SEED_DIR%\Bookmarks" "%PROFILE_DIR%\Default\Bookmarks" >nul
set "BIN="
for %%P in (
  "%LocalAppData%\Chromium\Application\chrome.exe"
  "%ProgramFiles%\Chromium\Application\chrome.exe"
  "%ProgramFiles%\Ungoogled Chromium\chrome.exe"
  "%LocalAppData%\Thorium\Application\thorium.exe"
  "%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe"
  "%LocalAppData%\BraveSoftware\Brave-Browser\Application\brave.exe"
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%LocalAppData%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
) do (
  if exist %%P (
    set "BIN=%%~P"
    goto :found
  )
)
:found
if "%BIN%"=="" (
  echo [ERRO] Navegador Chromium nao encontrado.
  echo Baixe o Chromium de codigo aberto: https://www.chromium.org/getting-involved/download-chromium/
  pause
  exit /b 1
)
echo Navegador: "%BIN%"
echo Perfil dedicado: "%PROFILE_DIR%"
echo Porta CDP: 127.0.0.1:9222 | Idioma: pt-BR
if exist "%EXT_DIR%\manifest.json" (
  start "" "%BIN%" --user-data-dir="%PROFILE_DIR%" --remote-debugging-port=9222 --lang=pt-BR --no-first-run --no-default-browser-check --homepage="https://prenotami.esteri.it/" --load-extension="%EXT_DIR%" "https://prenotami.esteri.it/" "https://prenotami.esteri.it/Services/Booking/5402" "https://prenotami.esteri.it/Services/Booking/5402" "https://web.whatsapp.com/" "https://mail.google.com/" "http://localhost:3000"
) else (
  start "" "%BIN%" --user-data-dir="%PROFILE_DIR%" --remote-debugging-port=9222 --lang=pt-BR --no-first-run --no-default-browser-check --homepage="https://prenotami.esteri.it/" "https://prenotami.esteri.it/" "https://prenotami.esteri.it/Services/Booking/5402" "https://prenotami.esteri.it/Services/Booking/5402" "https://web.whatsapp.com/" "https://mail.google.com/" "http://localhost:3000"
)
