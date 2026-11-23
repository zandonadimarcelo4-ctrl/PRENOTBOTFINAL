@echo off
setlocal
cd /d "%~dp0"
title PrenotaBot Livre 2.0 - Iniciador Unico
echo ============================================================
echo   PrenotaBot Livre 2.0 - Modo Pre-Instalado (chromium)
echo ============================================================
if not exist "logs" mkdir "logs"
if not exist "files" mkdir "files"
if not exist "perfis" mkdir "perfis"
if not exist "comprovantes" mkdir "comprovantes"
if not exist ".env" (
  if exist ".env.example" copy /Y ".env.example" ".env" >nul
)
where node >nul 2>nul
if errorlevel 1 (
  echo [AVISO] Node.js nao encontrado no PATH. Tentando instalar Node.js LTS via winget...
  where winget >nul 2>nul
  if not errorlevel 1 (
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  )
)
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERRO] Node.js 22+ e necessario apenas para rodar o servidor local.
  echo Baixe rapidamente em: https://nodejs.org/ ^(versao LTS^) e depois clique aqui novamente.
  pause
  exit /b 1
)
if not exist "dist-server\server.mjs" (
  echo [ERRO] dist-server\server.mjs nao encontrado nesta pasta.
  echo Baixe o pacote completo nos Releases ou execute: npm install ^&^& npm run release:build
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo [ERRO] dist\index.html nao encontrado nesta pasta.
  echo Baixe o pacote completo nos Releases ou execute: npm install ^&^& npm run release:build
  pause
  exit /b 1
)
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/api/bot/status' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if errorlevel 1 (
  echo [1/2] Iniciando servidor local pre-compilado em http://localhost:3000 ...
  start "PrenotaBot-Servidor" /min cmd /c "cd /d ""%~dp0"" && set NODE_ENV=production && node dist-server\server.mjs > logs\servidor.log 2>&1"
  powershell -NoProfile -Command "for($i=0;$i -lt 15;$i++){try{Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/api/bot/status' -TimeoutSec 1|Out-Null;break}catch{Start-Sleep -Milliseconds 700}}"
) else (
  echo [1/2] Servidor PrenotaBot ja esta ativo em http://localhost:3000.
)
echo [2/2] Abrindo Chromium Edicao Dedicada Prenot@mi ^(Servico 5402^)...
call "%~dp0iniciar-prenotabot-chromium.bat"
echo.
echo Tudo pronto! Painel web: http://localhost:3000
echo Nao feche a janela minimizada do servidor enquanto estiver monitorando.
timeout /t 3 /nobreak >nul
