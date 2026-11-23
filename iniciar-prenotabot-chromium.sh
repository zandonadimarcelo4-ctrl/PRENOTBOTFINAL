#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="${SCRIPT_DIR}/extensao_android"
PROFILE_DIR="${SCRIPT_DIR}/chromium_perfil"
SEED_DIR="${SCRIPT_DIR}/chromium_seed"
mkdir -p "${PROFILE_DIR}/Default"

if [ ! -f "${PROFILE_DIR}/Default/Preferences" ] && [ -f "${SEED_DIR}/Preferences" ]; then
  cp "${SEED_DIR}/Preferences" "${PROFILE_DIR}/Default/Preferences"
fi
if [ ! -f "${PROFILE_DIR}/Default/Bookmarks" ] && [ -f "${SEED_DIR}/Bookmarks" ]; then
  cp "${SEED_DIR}/Bookmarks" "${PROFILE_DIR}/Default/Bookmarks"
fi

BIN=""
for cand in chromium chromium-browser ungoogled-chromium brave-browser google-chrome microsoft-edge; do
  if command -v "${cand}" >/dev/null 2>&1; then
    BIN="$(command -v "${cand}")"
    break
  fi
done

if [ -z "${BIN}" ]; then
  echo "Nenhum binario Chromium encontrado (instale chromium ou ungoogled-chromium)."
  exit 1
fi

ARGS=(
  "--user-data-dir=${PROFILE_DIR}"
  "--remote-debugging-port=9222"
  "--lang=pt-BR"
  "--no-first-run"
  "--no-default-browser-check"
  "--homepage=https://prenotami.esteri.it/"
)

if [ -f "${EXT_DIR}/manifest.json" ]; then
  ARGS+=("--load-extension=${EXT_DIR}")
fi

echo "Iniciando Chromium Dedicado Prenot@mi (${BIN}) com CDP 127.0.0.1:9222..."
"${BIN}" "${ARGS[@]}" "https://prenotami.esteri.it/" "https://prenotami.esteri.it/Services/Booking/5402" "https://prenotami.esteri.it/Services/Booking/5402" "https://web.whatsapp.com/" "https://mail.google.com/" "http://localhost:3000" &
