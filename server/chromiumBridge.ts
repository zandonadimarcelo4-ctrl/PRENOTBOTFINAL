import { ChromiumConfig, SITE } from "./core.ts";

export interface ChromiumTabInfo {
  id: string;
  title: string;
  url: string;
  type: string;
}

export interface ChromiumBridgeStatus {
  connected: boolean;
  browser: string | null;
  port: number;
  tabs: ChromiumTabInfo[];
  hasPrenotamiTab: boolean;
  hasWhatsappTab: boolean;
  hasWebmailTab: boolean;
  error?: string;
}

const CDP_HOST = "127.0.0.1";

export function safeCdpPort(raw?: number): number {
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1024 && n <= 65535) return n;
  return 9222;
}

export function sanitizeCliArgText(raw: unknown, fallback = ""): string {
  const clean = String(raw ?? "")
    .replace(/[\r\n\t\0`$&|;<>^*?!]/g, "")
    .trim()
    .slice(0, 220);
  return clean || fallback;
}

export function sanitizeWebmailUrl(raw: unknown): string {
  const fallback = "https://mail.google.com/";
  try {
    const u = new URL(String(raw ?? "").trim());
    const host = u.hostname.toLowerCase();
    if (
      u.protocol === "https:" &&
      host !== "localhost" &&
      !host.startsWith("127.") &&
      !host.startsWith("10.") &&
      !host.startsWith("192.168.") &&
      !host.startsWith("169.254.")
    ) {
      return u.toString();
    }
  } catch {
    // ignore
  }
  return fallback;
}

export function isAllowedBridgeUrl(raw: unknown): string | null {
  try {
    const u = new URL(String(raw ?? "").trim());
    const host = u.hostname.toLowerCase();
    if (
      u.protocol === "https:" &&
      (host === "prenotami.esteri.it" ||
        host === "iam.esteri.it" ||
        host === "web.whatsapp.com" ||
        host === "mail.google.com" ||
        host === "outlook.live.com" ||
        host === "outlook.office.com" ||
        host === "mail.yahoo.com")
    ) {
      return u.toString();
    }
  } catch {
    // ignore invalid URLs
  }
  return null;
}

export async function getChromiumBridgeStatus(
  portInput?: number
): Promise<ChromiumBridgeStatus> {
  const port = safeCdpPort(portInput);
  try {
    const verResp = await fetch(`http://${CDP_HOST}:${port}/json/version`, {
      signal: AbortSignal.timeout(1200),
    });
    if (!verResp.ok) {
      return {
        connected: false,
        browser: null,
        port,
        tabs: [],
        hasPrenotamiTab: false,
        hasWhatsappTab: false,
        hasWebmailTab: false,
        error: `HTTP ${verResp.status}`,
      };
    }
    const ver = (await verResp.json()) as { Browser?: string };
    const listResp = await fetch(`http://${CDP_HOST}:${port}/json/list`, {
      signal: AbortSignal.timeout(1200),
    });
    const rawTabs = listResp.ok
      ? ((await listResp.json()) as Array<{
          id?: string;
          title?: string;
          url?: string;
          type?: string;
        }>)
      : [];

    const tabs: ChromiumTabInfo[] = rawTabs
      .filter((t) => t.type === "page")
      .map((t) => ({
        id: String(t.id ?? ""),
        title: String(t.title ?? "").slice(0, 120),
        url: String(t.url ?? "").slice(0, 240),
        type: String(t.type ?? "page"),
      }));

    return {
      connected: true,
      browser: ver.Browser ?? "Chromium",
      port,
      tabs,
      hasPrenotamiTab: tabs.some((t) => t.url.includes("prenotami.esteri.it")),
      hasWhatsappTab: tabs.some((t) => t.url.includes("web.whatsapp.com")),
      hasWebmailTab: tabs.some(
        (t) =>
          t.url.includes("mail.google.com") ||
          t.url.includes("outlook.live.com") ||
          t.url.includes("outlook.office.com") ||
          t.url.includes("mail.yahoo.com")
      ),
    };
  } catch {
    return {
      connected: false,
      browser: null,
      port,
      tabs: [],
      hasPrenotamiTab: false,
      hasWhatsappTab: false,
      hasWebmailTab: false,
      error: `Chromium CDP não detectado em 127.0.0.1:${port} (use o inicializador local no PC).`,
    };
  }
}

export async function openChromiumBridgeTab(
  rawUrl: string,
  portInput?: number
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const safeUrl = isAllowedBridgeUrl(rawUrl);
  if (!safeUrl) {
    return {
      ok: false,
      error:
        "URL bloqueada pela política de segurança (apenas prenotami.esteri.it, iam.esteri.it, web.whatsapp.com ou webmail OTP).",
    };
  }
  const port = safeCdpPort(portInput);
  try {
    const resp = await fetch(
      `http://${CDP_HOST}:${port}/json/new?${encodeURIComponent(safeUrl)}`,
      {
        method: "PUT",
        signal: AbortSignal.timeout(2000),
      }
    );
    if (!resp.ok) {
      return { ok: false, error: `Chromium CDP retornou HTTP ${resp.status}` };
    }
    return { ok: true, url: safeUrl };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function ensureChromiumDedicatedTabs(
  serviceId: number,
  chromiumCfg: Partial<ChromiumConfig> = {}
): Promise<{
  connected: boolean;
  opened: string[];
  alreadyOpen: string[];
}> {
  const status = await getChromiumBridgeStatus(chromiumCfg.porta_cdp);
  if (!status.connected) {
    return { connected: false, opened: [], alreadyOpen: [] };
  }

  const sid = Number.isInteger(serviceId) && serviceId > 0 ? serviceId : 5402;
  const opened: string[] = [];
  const alreadyOpen: string[] = [];

  const desired: Array<{ check: boolean; url: string }> = [
    {
      check: status.hasPrenotamiTab,
      url: `${SITE}/Services/Booking/${sid}`,
    },
  ];
  if (chromiumCfg.abrir_whatsapp_ao_iniciar !== false) {
    desired.push({
      check: status.hasWhatsappTab,
      url: "https://web.whatsapp.com/",
    });
  }
  if (chromiumCfg.abrir_webmail_ao_iniciar !== false) {
    desired.push({
      check: status.hasWebmailTab,
      url: sanitizeWebmailUrl(chromiumCfg.url_webmail),
    });
  }

  for (const item of desired) {
    if (item.check) {
      alreadyOpen.push(item.url);
    } else {
      const res = await openChromiumBridgeTab(item.url, chromiumCfg.porta_cdp);
      if (res.ok && res.url) opened.push(res.url);
    }
  }

  return { connected: true, opened, alreadyOpen };
}

function buildStartupUrls(
  serviceId: number,
  chromiumCfg: Partial<ChromiumConfig>,
  panelOrigin: string
): string[] {
  const sid = Number.isInteger(serviceId) && serviceId > 0 ? serviceId : 5402;
  const bookingUrl = `${SITE}/Services/Booking/${sid}`;
  const extraTabs = Math.min(
    3,
    Math.max(0, Number(chromiumCfg.abrir_abas_extras ?? 2))
  );
  const openWa = chromiumCfg.abrir_whatsapp_ao_iniciar !== false;
  const openMail = chromiumCfg.abrir_webmail_ao_iniciar !== false;
  const openPanel = chromiumCfg.abrir_painel_ao_iniciar !== false;
  const webmailUrl = sanitizeWebmailUrl(chromiumCfg.url_webmail);
  const safeOrigin = panelOrigin.startsWith("http")
    ? sanitizeCliArgText(panelOrigin, "http://localhost:3000")
    : "http://localhost:3000";

  const urls: string[] = [`${SITE}/`];
  for (let i = 0; i < extraTabs; i++) {
    urls.push(bookingUrl);
  }
  if (openWa) urls.push("https://web.whatsapp.com/");
  if (openMail) urls.push(webmailUrl);
  if (openPanel) urls.push(safeOrigin);
  return urls;
}

export function buildChromiumPolicyJson(
  serviceId: number,
  chromiumCfg: Partial<ChromiumConfig> = {},
  panelOrigin = "http://localhost:3000"
): string {
  const sid = Number.isInteger(serviceId) && serviceId > 0 ? serviceId : 5402;
  const urls = buildStartupUrls(sid, chromiumCfg, panelOrigin);
  const webmailUrl = sanitizeWebmailUrl(chromiumCfg.url_webmail);

  const policy: Record<string, unknown> = {
    HomepageLocation: `${SITE}/`,
    HomepageIsNewTabPage: false,
    ShowHomeButton: true,
    BookmarkBarEnabled: true,
    DefaultBrowserSettingEnabled: false,
    PasswordManagerEnabled: false,
    RestoreOnStartup: 4,
    RestoreOnStartupURLs: urls,
    ManagedBookmarks: [
      { toplevel_name: "Prenot@mi — Navegador Dedicado" },
      { name: "1. Portal Prenot@mi (Login)", url: `${SITE}/` },
      { name: `2. Agendar Serviço ${sid}`, url: `${SITE}/Services/Booking/${sid}` },
      { name: "3. Meus Agendamentos", url: `${SITE}/Services` },
      { name: "4. WhatsApp Web (Radar)", url: "https://web.whatsapp.com/" },
      { name: "5. Webmail OTP", url: webmailUrl },
      { name: "6. Painel PrenotaBot", url: panelOrigin },
    ],
  };

  if (chromiumCfg.bloquear_sites_externos) {
    let webmailHost = "mail.google.com";
    try {
      webmailHost = new URL(webmailUrl).hostname;
    } catch {
      // ignore
    }
    policy.URLBlocklist = ["*"];
    policy.URLAllowlist = [
      "prenotami.esteri.it",
      "iam.esteri.it",
      "web.whatsapp.com",
      webmailHost,
      "accounts.google.com",
      "mail.google.com",
      "outlook.live.com",
      "outlook.office.com",
      "login.live.com",
      "login.microsoftonline.com",
      "mail.yahoo.com",
      "localhost:3000",
      "127.0.0.1:3000",
      "ntfy.sh",
      "*.gstatic.com",
      "*.googleapis.com",
      "challenges.cloudflare.com",
      "*.hcaptcha.com",
      "hcaptcha.com",
      "www.google.com/recaptcha",
      "chrome-extension://*",
      "chrome://*",
    ];
  }

  return JSON.stringify(policy, null, 2);
}

export function buildChromiumInitialPreferences(
  serviceId: number,
  chromiumCfg: Partial<ChromiumConfig> = {},
  panelOrigin = "http://localhost:3000"
): string {
  const urls = buildStartupUrls(serviceId, chromiumCfg, panelOrigin);
  return JSON.stringify(
    {
      homepage: `${SITE}/`,
      homepage_is_newtabpage: false,
      browser: {
        show_home_button: true,
        check_default_browser: false,
      },
      bookmark_bar: {
        show_on_all_tabs: true,
      },
      session: {
        restore_on_startup: 4,
        startup_urls: urls,
      },
      credentials_enable_service: false,
      profile: {
        name: "Prenot@mi Dedicado",
        password_manager_enabled: false,
      },
    },
    null,
    2
  );
}

export function buildChromiumInitialBookmarks(
  serviceId: number,
  chromiumCfg: Partial<ChromiumConfig> = {},
  panelOrigin = "http://localhost:3000"
): string {
  const sid = Number.isInteger(serviceId) && serviceId > 0 ? serviceId : 5402;
  const webmailUrl = sanitizeWebmailUrl(chromiumCfg.url_webmail);
  const safeOrigin = panelOrigin.startsWith("http")
    ? sanitizeCliArgText(panelOrigin, "http://localhost:3000")
    : "http://localhost:3000";

  const links = [
    { id: "1", name: "1. Portal Prenot@mi (Login)", url: `${SITE}/` },
    { id: "2", name: `2. Agendar (${sid})`, url: `${SITE}/Services/Booking/${sid}` },
    { id: "3", name: "3. Serviços da Conta", url: `${SITE}/Services` },
    { id: "4", name: "4. WhatsApp Radar", url: "https://web.whatsapp.com/" },
    { id: "5", name: "5. Email OTP (noreply-prenotami)", url: webmailUrl },
    { id: "6", name: "6. Painel PrenotaBot", url: safeOrigin },
  ].map((item) => ({
    date_added: "13350000000000000",
    guid: `00000000-0000-4000-8000-00000000000${item.id}`,
    id: item.id,
    name: item.name,
    type: "url",
    url: item.url,
  }));

  return JSON.stringify(
    {
      checksum: "",
      roots: {
        bookmark_bar: {
          children: links,
          date_added: "13350000000000000",
          date_modified: "13350000000000000",
          guid: "00000000-0000-4000-8000-000000000100",
          id: "100",
          name: "Barra de favoritos",
          type: "folder",
        },
        other: {
          children: [],
          date_added: "13350000000000000",
          date_modified: "13350000000000000",
          guid: "00000000-0000-4000-8000-000000000101",
          id: "101",
          name: "Outros favoritos",
          type: "folder",
        },
        synced: {
          children: [],
          date_added: "13350000000000000",
          date_modified: "13350000000000000",
          guid: "00000000-0000-4000-8000-000000000102",
          id: "102",
          name: "Favoritos em dispositivos moveis",
          type: "folder",
        },
      },
      version: 1,
    },
    null,
    2
  );
}

export function buildChromiumLauncherScript(
  osKind: "win" | "linux",
  serviceId: number,
  chromiumCfg: Partial<ChromiumConfig> = {},
  panelOrigin = "http://localhost:3000"
): string {
  const sid = Number.isInteger(serviceId) && serviceId > 0 ? serviceId : 5402;
  const port = safeCdpPort(chromiumCfg.porta_cdp);
  const profileDirName = sanitizeCliArgText(
    chromiumCfg.diretorio_perfil,
    "chromium_perfil"
  ).replace(/[^\w.\-\\/ ]/g, "_");
  const customBin = sanitizeCliArgText(chromiumCfg.caminho_executavel, "");
  const lang = /^[a-z]{2}(?:-[A-Z]{2})?$/.test(String(chromiumCfg.idioma ?? ""))
    ? String(chromiumCfg.idioma)
    : "pt-BR";
  const dedicated = chromiumCfg.modo_dedicado !== false;
  const urls = buildStartupUrls(sid, chromiumCfg, panelOrigin);

  const winCandidates: Record<string, string[]> = {
    chromium: [
      `"%LocalAppData%\\Chromium\\Application\\chrome.exe"`,
      `"%ProgramFiles%\\Chromium\\Application\\chrome.exe"`,
    ],
    "ungoogled-chromium": [
      `"%LocalAppData%\\Chromium\\Application\\chrome.exe"`,
      `"%ProgramFiles%\\Ungoogled Chromium\\chrome.exe"`,
      `"%LocalAppData%\\Thorium\\Application\\thorium.exe"`,
    ],
    brave: [
      `"%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"`,
      `"%LocalAppData%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"`,
    ],
    edge: [
      `"%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"`,
      `"%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"`,
    ],
    chrome: [
      `"%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"`,
      `"%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe"`,
    ],
  };

  const nav = chromiumCfg.navegador ?? "chromium";
  const allWinBins = [
    ...(winCandidates[nav] ?? []),
    ...winCandidates.chromium,
    ...winCandidates["ungoogled-chromium"],
    ...winCandidates.brave,
    ...winCandidates.chrome,
    ...winCandidates.edge,
  ];
  const uniqueWinBins = Array.from(new Set(allWinBins));

  const linuxCandidates: Record<string, string[]> = {
    chromium: ["chromium", "chromium-browser"],
    "ungoogled-chromium": ["ungoogled-chromium", "chromium", "chromium-browser"],
    brave: ["brave-browser", "brave"],
    edge: ["microsoft-edge", "microsoft-edge-stable"],
    chrome: ["google-chrome", "google-chrome-stable"],
  };
  const uniqueLinuxBins = Array.from(
    new Set([
      ...(linuxCandidates[nav] ?? []),
      "chromium",
      "chromium-browser",
      "ungoogled-chromium",
      "brave-browser",
      "google-chrome",
      "microsoft-edge",
    ])
  );

  const dedicatedFlags = dedicated
    ? `--no-first-run --no-default-browser-check --homepage="${SITE}/"`
    : `--no-first-run`;

  if (osKind === "win") {
    const quotedUrls = urls.map((u) => `"${u}"`).join(" ");
    const binSection = customBin
      ? `set "BIN=${customBin}"\r\nif not exist "%BIN%" set "BIN="`
      : `set "BIN="\r\nfor %%P in (\r\n  ${uniqueWinBins.join("\r\n  ")}\r\n) do (\r\n  if exist %%P (\r\n    set "BIN=%%~P"\r\n    goto :found\r\n  )\r\n)\r\n:found`;

    return `@echo off\r
setlocal\r
echo ============================================================\r
echo   PrenotaBot Livre - Chromium Edicao Dedicada Prenot@mi\r
echo ============================================================\r
set "EXT_DIR=%~dp0extensao_android"\r
set "PROFILE_DIR=%~dp0${profileDirName}"\r
set "SEED_DIR=%~dp0chromium_seed"\r
if not exist "%PROFILE_DIR%\\Default" mkdir "%PROFILE_DIR%\\Default"\r
if not exist "%PROFILE_DIR%\\Default\\Preferences" if exist "%SEED_DIR%\\Preferences" copy /Y "%SEED_DIR%\\Preferences" "%PROFILE_DIR%\\Default\\Preferences" >nul\r
if not exist "%PROFILE_DIR%\\Default\\Bookmarks" if exist "%SEED_DIR%\\Bookmarks" copy /Y "%SEED_DIR%\\Bookmarks" "%PROFILE_DIR%\\Default\\Bookmarks" >nul\r
${binSection}\r
if "%BIN%"=="" (\r
  echo [ERRO] Navegador Chromium nao encontrado.\r
  echo Baixe o Chromium de codigo aberto: https://www.chromium.org/getting-involved/download-chromium/\r
  pause\r
  exit /b 1\r
)\r
echo Navegador: "%BIN%"\r
echo Perfil dedicado: "%PROFILE_DIR%"\r
echo Porta CDP: 127.0.0.1:${port} | Idioma: ${lang}\r
if exist "%EXT_DIR%\\manifest.json" (\r
  start "" "%BIN%" --user-data-dir="%PROFILE_DIR%" --remote-debugging-port=${port} --lang=${lang} ${dedicatedFlags} --load-extension="%EXT_DIR%" ${quotedUrls}\r
) else (\r
  start "" "%BIN%" --user-data-dir="%PROFILE_DIR%" --remote-debugging-port=${port} --lang=${lang} ${dedicatedFlags} ${quotedUrls}\r
)\r
`;
  }

  const quotedLinuxUrls = urls.map((u) => `"${u}"`).join(" ");
  const linuxDetect = customBin
    ? `BIN="${customBin}"\nif [ ! -x "\${BIN}" ]; then BIN=""; fi`
    : `BIN=""\nfor cand in ${uniqueLinuxBins.join(" ")}; do\n  if command -v "\${cand}" >/dev/null 2>&1; then\n    BIN="$(command -v "\${cand}")"\n    break\n  fi\ndone`;

  return `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="\${SCRIPT_DIR}/extensao_android"
PROFILE_DIR="\${SCRIPT_DIR}/${profileDirName}"
SEED_DIR="\${SCRIPT_DIR}/chromium_seed"
mkdir -p "\${PROFILE_DIR}/Default"

if [ ! -f "\${PROFILE_DIR}/Default/Preferences" ] && [ -f "\${SEED_DIR}/Preferences" ]; then
  cp "\${SEED_DIR}/Preferences" "\${PROFILE_DIR}/Default/Preferences"
fi
if [ ! -f "\${PROFILE_DIR}/Default/Bookmarks" ] && [ -f "\${SEED_DIR}/Bookmarks" ]; then
  cp "\${SEED_DIR}/Bookmarks" "\${PROFILE_DIR}/Default/Bookmarks"
fi

${linuxDetect}

if [ -z "\${BIN}" ]; then
  echo "Nenhum binario Chromium encontrado (instale chromium ou ungoogled-chromium)."
  exit 1
fi

ARGS=(
  "--user-data-dir=\${PROFILE_DIR}"
  "--remote-debugging-port=${port}"
  "--lang=${lang}"
  "--no-first-run"
  ${dedicated ? '"--no-default-browser-check"\n  "--homepage=' + SITE + '/"' : ""}
)

if [ -f "\${EXT_DIR}/manifest.json" ]; then
  ARGS+=("--load-extension=\${EXT_DIR}")
fi

echo "Iniciando Chromium Dedicado Prenot@mi (\${BIN}) com CDP 127.0.0.1:${port}..."
"\${BIN}" "\${ARGS[@]}" ${quotedLinuxUrls} &
`;
}
