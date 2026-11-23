#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

echo "============================================================"
echo "  PrenotaBot Livre 2.0 - Modo Pre-Instalado (chromium)"
echo "============================================================"

mkdir -p logs files perfis comprovantes

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  cp ".env.example" ".env"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[ERRO] Node.js 22+ nao encontrado."
  echo "Instale o Node.js LTS em https://nodejs.org/ e execute novamente."
  exit 1
fi

if [ ! -f "dist-server/server.mjs" ] || [ ! -f "dist/index.html" ]; then
  echo "[ERRO] Arquivos pre-compilados ausentes (dist-server/server.mjs ou dist/index.html)."
  echo "Baixe o ZIP completo do GitHub Releases ou rode: npm install && npm run release:build"
  exit 1
fi

SERVER_UP=0
if command -v curl >/dev/null 2>&1 && curl -sf "http://127.0.0.1:3000/api/bot/status" >/dev/null 2>&1; then
  SERVER_UP=1
fi

if [ "${SERVER_UP}" -eq 0 ]; then
  echo "[1/2] Iniciando servidor local pre-compilado em http://localhost:3000 ..."
  NODE_ENV=production nohup node "${SCRIPT_DIR}/dist-server/server.mjs" > "${SCRIPT_DIR}/logs/servidor.log" 2>&1 &
  for _ in $(seq 1 15); do
    if command -v curl >/dev/null 2>&1 && curl -sf "http://127.0.0.1:3000/api/bot/status" >/dev/null 2>&1; then
      break
    fi
    sleep 0.7
  done
else
  echo "[1/2] Servidor PrenotaBot ja esta ativo em http://localhost:3000."
fi

echo "[2/2] Abrindo Chromium Edicao Dedicada Prenot@mi (Servico 5402)..."
chmod +x "${SCRIPT_DIR}/iniciar-prenotabot-chromium.sh"
"${SCRIPT_DIR}/iniciar-prenotabot-chromium.sh"

echo "Tudo pronto! Painel: http://localhost:3000"
