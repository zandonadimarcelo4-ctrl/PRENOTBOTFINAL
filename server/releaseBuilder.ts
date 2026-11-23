import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {
  BASE_DIR,
  BotConfig,
  CATALOG_PATH,
  ChromiumConfig,
  DEFAULT_CONFIG,
  ENV_KEYS,
  EnvMap,
} from "./core.ts";
import { buildExtensionBundleEntries } from "./extensionBuilder.ts";
import {
  buildChromiumInitialBookmarks,
  buildChromiumInitialPreferences,
  buildChromiumLauncherScript,
  buildChromiumPolicyJson,
} from "./chromiumBridge.ts";
import { ZipEntryInput, createZipBuffer } from "./zip.ts";

export const RELEASE_ROOT_FOLDER = "PrenotaBot-Livre";
export const RELEASE_DIR = path.join(BASE_DIR, "release");
export const RELEASE_ZIP_PATH = path.join(
  RELEASE_DIR,
  "PrenotaBot-Livre-Portatil.zip"
);
export const DIST_DIR = path.join(BASE_DIR, "dist");
export const DIST_SERVER_FILE = path.join(BASE_DIR, "dist-server", "server.mjs");

export function buildEmptyEnvMap(): EnvMap {
  const empty = {} as EnvMap;
  for (const k of ENV_KEYS) {
    empty[k] = "";
  }
  return empty;
}

export function buildPortableStartScripts(
  serviceId: number,
  chromiumCfg: Partial<ChromiumConfig> = {},
  panelOrigin = "http://localhost:3000"
): { bat: string; sh: string; readme: string } {
  const sid = Number.isInteger(serviceId) && serviceId > 0 ? serviceId : 5402;
  const navLabel = String(chromiumCfg.navegador ?? "chromium");

  const bat = `@echo off\r
setlocal\r
cd /d "%~dp0"\r
title PrenotaBot Livre 2.0 - Iniciador Unico\r
echo ============================================================\r
echo   PrenotaBot Livre 2.0 - Modo Pre-Instalado (${navLabel})\r
echo ============================================================\r
if not exist "logs" mkdir "logs"\r
if not exist "files" mkdir "files"\r
if not exist "perfis" mkdir "perfis"\r
if not exist "comprovantes" mkdir "comprovantes"\r
if not exist ".env" (\r
  if exist ".env.example" copy /Y ".env.example" ".env" >nul\r
)\r
where node >nul 2>nul\r
if errorlevel 1 (\r
  echo [AVISO] Node.js nao encontrado no PATH. Tentando instalar Node.js LTS via winget...\r
  where winget >nul 2>nul\r
  if not errorlevel 1 (\r
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements\r
  )\r
)\r
where node >nul 2>nul\r
if errorlevel 1 (\r
  echo.\r
  echo [ERRO] Node.js 22+ e necessario apenas para rodar o servidor local.\r
  echo Baixe rapidamente em: https://nodejs.org/ ^(versao LTS^) e depois clique aqui novamente.\r
  pause\r
  exit /b 1\r
)\r
if not exist "dist-server\\server.mjs" (\r
  echo [ERRO] dist-server\\server.mjs nao encontrado nesta pasta.\r
  echo Baixe o pacote completo nos Releases ou execute: npm install ^&^& npm run release:build\r
  pause\r
  exit /b 1\r
)\r
if not exist "dist\\index.html" (\r
  echo [ERRO] dist\\index.html nao encontrado nesta pasta.\r
  echo Baixe o pacote completo nos Releases ou execute: npm install ^&^& npm run release:build\r
  pause\r
  exit /b 1\r
)\r
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/api/bot/status' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul\r
if errorlevel 1 (\r
  echo [1/2] Iniciando servidor local pre-compilado em ${panelOrigin} ...\r
  start "PrenotaBot-Servidor" /min cmd /c "cd /d ""%~dp0"" && set NODE_ENV=production && node dist-server\\server.mjs > logs\\servidor.log 2>&1"\r
  powershell -NoProfile -Command "for($i=0;$i -lt 15;$i++){try{Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/api/bot/status' -TimeoutSec 1|Out-Null;break}catch{Start-Sleep -Milliseconds 700}}"\r
) else (\r
  echo [1/2] Servidor PrenotaBot ja esta ativo em ${panelOrigin}.\r
)\r
echo [2/2] Abrindo Chromium Edicao Dedicada Prenot@mi ^(Servico ${sid}^)...\r
call "%~dp0iniciar-prenotabot-chromium.bat"\r
echo.\r
echo Tudo pronto! Painel web: ${panelOrigin}\r
echo Nao feche a janela minimizada do servidor enquanto estiver monitorando.\r
timeout /t 3 /nobreak >nul\r
`;

  const sh = `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cd "\${SCRIPT_DIR}"

echo "============================================================"
echo "  PrenotaBot Livre 2.0 - Modo Pre-Instalado (${navLabel})"
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

if [ "\${SERVER_UP}" -eq 0 ]; then
  echo "[1/2] Iniciando servidor local pre-compilado em ${panelOrigin} ..."
  NODE_ENV=production nohup node "\${SCRIPT_DIR}/dist-server/server.mjs" > "\${SCRIPT_DIR}/logs/servidor.log" 2>&1 &
  for _ in $(seq 1 15); do
    if command -v curl >/dev/null 2>&1 && curl -sf "http://127.0.0.1:3000/api/bot/status" >/dev/null 2>&1; then
      break
    fi
    sleep 0.7
  done
else
  echo "[1/2] Servidor PrenotaBot ja esta ativo em ${panelOrigin}."
fi

echo "[2/2] Abrindo Chromium Edicao Dedicada Prenot@mi (Servico ${sid})..."
chmod +x "\${SCRIPT_DIR}/iniciar-prenotabot-chromium.sh"
"\${SCRIPT_DIR}/iniciar-prenotabot-chromium.sh"

echo "Tudo pronto! Painel: ${panelOrigin}"
`;

  const readme = [
    "PrenotaBot Livre 2.0 — Pacote Portatil Pre-Instalado",
    "===================================================",
    "",
    "Voce NAO precisa rodar npm install nem compilar nada!",
    "Este pacote ja contem o painel compilado (dist/), servidor empacotado (dist-server/server.mjs),",
    "extensao Chromium Dedicado (extensao_android/), semente de perfil, politicas e leitor de OTP.",
    "",
    "COMO INICIAR EM 2 CLIQUES:",
    "  1. Extraia TODO o conteudo deste ZIP em uma pasta no seu PC (ex.: C:\\PrenotaBot-Livre).",
    "  2. No Windows: clique duas vezes em INICIAR-AQUI.bat",
    "     No Linux/macOS: execute no terminal: chmod +x iniciar-aqui.sh && ./iniciar-aqui.sh",
    "",
    "REQUISITOS NO PC:",
    "  - Node.js 22+ LTS (apenas o runtime, disponivel em https://nodejs.org/).",
    "  - Um navegador Chromium aberto/instalado (Chromium, Ungoogled Chromium, Brave, Chrome ou Edge).",
    "",
    "O QUE ABRE AUTOMATICAMENTE:",
    `  - Painel web de controle: ${panelOrigin}`,
    "  - Portal oficial Prenot@mi: https://prenotami.esteri.it/ (login manual com autofill)",
    `  - Abas de agendamento configuradas para o servico ${sid}`,
    "  - WhatsApp Web (Radar +55 47 92004-1774) + Webmail com captura automatica de OTP (<noreply-prenotami@esteri.it>)",
    "",
    "SEGURANCA:",
    "  - Este ZIP nao contem senhas, chaves de API nem dados pessoais.",
    "  - Suas credenciais ficam somente no arquivo local .env do seu computador.",
  ].join("\r\n");

  return { bat, sh, readme };
}

export function collectDirFiles(
  dirPath: string,
  zipPrefix: string
): ZipEntryInput[] {
  if (!fs.existsSync(dirPath)) return [];
  const out: ZipEntryInput[] = [];

  const walk = (current: string, relBase: string) => {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.isFile()) {
        out.push({
          name: `${zipPrefix}/${rel}`,
          data: fs.readFileSync(full),
        });
      }
    }
  };

  walk(dirPath, "");
  return out;
}

export function buildSanitizedReleaseConfig(
  cfg: BotConfig,
  sanitizeForPublicRelease = true
): BotConfig {
  const clean = structuredClone(DEFAULT_CONFIG);
  if (sanitizeForPublicRelease) {
    return clean;
  }
  return {
    ...clean,
    servicos: cfg.servicos?.length ? [...cfg.servicos] : [5402],
    intervalo_min_segundos: cfg.intervalo_min_segundos,
    intervalo_max_segundos: cfg.intervalo_max_segundos,
    fuso_horario: cfg.fuso_horario,
    horario_alvo: cfg.horario_alvo,
    antecedencia_minutos: cfg.antecedencia_minutos,
    manter_primeira_aba: cfg.manter_primeira_aba,
    abas_agendamento: cfg.abas_agendamento,
    dias_semana: [...(cfg.dias_semana ?? [1])],
    chromium: {
      ...clean.chromium,
      ...cfg.chromium,
    },
    radar_whatsapp: {
      ...clean.radar_whatsapp,
      ...cfg.radar_whatsapp,
    },
  };
}

export function createPortableReleaseZip(
  cfg: BotConfig,
  opts?: { sanitizeForPublicRelease?: boolean; panelOrigin?: string }
): Buffer {
  if (!fs.existsSync(path.join(DIST_DIR, "index.html"))) {
    throw new Error(
      "Build do painel (dist/index.html) não encontrado. Execute 'npm run release:build' primeiro."
    );
  }
  if (!fs.existsSync(DIST_SERVER_FILE)) {
    throw new Error(
      "Servidor pré-compilado (dist-server/server.mjs) não encontrado. Execute 'npm run release:build' primeiro."
    );
  }

  const sanitizePublic = opts?.sanitizeForPublicRelease ?? false;
  const panelOrigin = opts?.panelOrigin ?? "http://localhost:3000";
  const releaseCfg = buildSanitizedReleaseConfig(cfg, sanitizePublic);
  const emptyEnv = buildEmptyEnvMap();
  const sid = releaseCfg.servicos[0] ?? 5402;

  const entries: ZipEntryInput[] = [];
  const root = RELEASE_ROOT_FOLDER;

  const startScripts = buildPortableStartScripts(
    sid,
    releaseCfg.chromium,
    panelOrigin
  );
  entries.push(
    { name: `${root}/INICIAR-AQUI.bat`, data: startScripts.bat },
    { name: `${root}/iniciar-aqui.sh`, data: startScripts.sh },
    { name: `${root}/LEIA-PRIMEIRO.txt`, data: startScripts.readme }
  );

  // Scripts individuais do Chromium
  entries.push(
    {
      name: `${root}/iniciar-prenotabot-chromium.bat`,
      data: buildChromiumLauncherScript(
        "win",
        sid,
        releaseCfg.chromium,
        panelOrigin
      ),
    },
    {
      name: `${root}/iniciar-prenotabot-chromium.sh`,
      data: buildChromiumLauncherScript(
        "linux",
        sid,
        releaseCfg.chromium,
        panelOrigin
      ),
    },
    {
      name: `${root}/chromium_seed/Preferences`,
      data: buildChromiumInitialPreferences(
        sid,
        releaseCfg.chromium,
        panelOrigin
      ),
    },
    {
      name: `${root}/chromium_seed/Bookmarks`,
      data: buildChromiumInitialBookmarks(
        sid,
        releaseCfg.chromium,
        panelOrigin
      ),
    },
    {
      name: `${root}/chromium_politica/policies.json`,
      data: buildChromiumPolicyJson(sid, releaseCfg.chromium, panelOrigin),
    }
  );

  // Extensão Chromium (SEMPRE sem senhas/segredos)
  const extEntries = buildExtensionBundleEntries(releaseCfg, emptyEnv);
  for (const f of extEntries) {
    entries.push({
      name: `${root}/extensao_android/${f.name}`,
      data: f.content,
    });
  }

  // Frontend + Backend pré-compilados
  entries.push(...collectDirFiles(DIST_DIR, `${root}/dist`));
  entries.push({
    name: `${root}/dist-server/server.mjs`,
    data: fs.readFileSync(DIST_SERVER_FILE),
  });

  // Configuração e metadados limpos (NUNCA incluir .env real)
  entries.push({
    name: `${root}/config.yaml`,
    data: yaml.dump(releaseCfg, { noRefs: true, sortKeys: false }),
  });

  const envExamplePath = path.join(BASE_DIR, ".env.example");
  if (fs.existsSync(envExamplePath)) {
    entries.push({
      name: `${root}/.env.example`,
      data: fs.readFileSync(envExamplePath),
    });
  }

  const readmePath = path.join(BASE_DIR, "LEIAME.md");
  if (fs.existsSync(readmePath)) {
    entries.push({
      name: `${root}/LEIAME.md`,
      data: fs.readFileSync(readmePath),
    });
  }

  if (fs.existsSync(CATALOG_PATH)) {
    entries.push({
      name: `${root}/catalogo_servicos.json`,
      data: fs.readFileSync(CATALOG_PATH),
    });
  }

  const pkgPath = path.join(BASE_DIR, "package.json");
  if (fs.existsSync(pkgPath)) {
    entries.push({
      name: `${root}/package.json`,
      data: fs.readFileSync(pkgPath),
    });
  }

  return createZipBuffer(entries);
}
