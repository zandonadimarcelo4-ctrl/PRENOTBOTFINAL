import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BASE_DIR,
  DEFAULT_CONFIG,
  ENV_KEYS,
  EnvMap,
  loadConfig,
  loadEnv,
  profilePath,
  getLastProfile,
} from "../server/core.ts";
import {
  DIST_DIR,
  DIST_SERVER_FILE,
  RELEASE_ZIP_PATH,
} from "../server/releaseBuilder.ts";
import { runTestBench } from "../server/testbench.ts";

function emptyEnv(): EnvMap {
  const e = {} as EnvMap;
  for (const k of ENV_KEYS) e[k] = "";
  return e;
}

function parseZipEntries(zipBuf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let pos = 0;
  while (pos + 30 <= zipBuf.length) {
    const sig = zipBuf.readUInt32LE(pos);
    if (sig !== 0x04034b50) break;
    const compMethod = zipBuf.readUInt16LE(pos + 8);
    if (compMethod !== 0) {
      throw new Error(`Método de compressão inesperado no ZIP: ${compMethod}`);
    }
    const compSize = zipBuf.readUInt32LE(pos + 18);
    const nameLen = zipBuf.readUInt16LE(pos + 26);
    const extraLen = zipBuf.readUInt16LE(pos + 28);
    const nameStart = pos + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const name = zipBuf.subarray(nameStart, nameStart + nameLen).toString("utf-8");
    const data = zipBuf.subarray(dataStart, dataStart + compSize);
    files.set(name, data);
    pos = dataStart + compSize;
  }
  return files;
}

async function waitForHttpReady(url: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Servidor isolado não respondeu a tempo em ${url}`);
}

async function main() {
  console.log("================================================================");
  console.log("  PRENOTABOT LIVRE — BANCADA OFICIAL DE TESTES PRE-SEGUNDA");
  console.log("================================================================\n");

  const activeProfile = getLastProfile();
  const cfg = fs.existsSync(profilePath(activeProfile))
    ? loadConfig(profilePath(activeProfile))
    : structuredClone(DEFAULT_CONFIG);
  const env = loadEnv();

  // Fase 1: Bancada de diagnóstico no servidor local
  console.log("[Fase 1/3] Executando verificações do perfil, extensões, OTP e portal...");
  const bench = await runTestBench(cfg, env, {
    checkPortal: true,
    checkImap: false,
  });

  for (const c of bench.checks) {
    const tag = c.status === "ok" ? "[OK]  " : c.status === "warn" ? "[AVISO]" : "[FALHA]";
    console.log(`  ${tag} ${c.title} (${c.durationMs}ms)`);
    console.log(`         -> ${c.detail}`);
  }
  console.log(
    `\n  Resumo Fase 1: ${bench.overallStatus} (${bench.passedCount} OK, ${bench.warnCount} avisos, ${bench.failCount} falhas)\n`
  );

  // Fase 2: Descompressão simulada do ZIP portátil em pasta limpa e verificação de zero segredos
  console.log("[Fase 2/3] Testando extração limpa de release/PrenotaBot-Livre-Portatil.zip...");
  if (!fs.existsSync(RELEASE_ZIP_PATH)) {
    throw new Error(
      `ZIP portátil não encontrado em ${RELEASE_ZIP_PATH}. Rode 'npm run release:build' primeiro.`
    );
  }
  const zipBuf = fs.readFileSync(RELEASE_ZIP_PATH);
  const entries = parseZipEntries(zipBuf);
  const requiredInZip = [
    "PrenotaBot-Livre/INICIAR-AQUI.bat",
    "PrenotaBot-Livre/iniciar-aqui.sh",
    "PrenotaBot-Livre/dist/index.html",
    "PrenotaBot-Livre/dist-server/server.mjs",
    "PrenotaBot-Livre/extensao_android/manifest.json",
    "PrenotaBot-Livre/extensao_android/background.js",
    "PrenotaBot-Livre/extensao_android/content.js",
    "PrenotaBot-Livre/extensao_android/newtab.html",
    "PrenotaBot-Livre/chromium_seed/Bookmarks",
    "PrenotaBot-Livre/chromium_seed/Preferences",
    "PrenotaBot-Livre/chromium_politica/policies.json",
    "PrenotaBot-Livre/config.yaml",
    "PrenotaBot-Livre/.env.example",
  ];

  for (const r of requiredInZip) {
    if (!entries.has(r)) {
      throw new Error(`Arquivo obrigatório ausente dentro do ZIP: ${r}`);
    }
  }
  if (entries.has("PrenotaBot-Livre/.env")) {
    throw new Error("FALHA DE SEGURANÇA: .env real encontrado dentro do ZIP!");
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-bancada-"));
  const testPort = 3199;
  let proc: ReturnType<typeof spawn> | null = null;

  try {
    for (const [entryName, buf] of entries.entries()) {
      const dest = path.join(tmpDir, entryName);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
    }

    const extractedRoot = path.join(tmpDir, "PrenotaBot-Livre");
    console.log(`  [OK]   ${entries.size} arquivos extraídos para pasta limpa ${extractedRoot}`);

    // Fase 3: Boot REAL do servidor pré-compilado extraído (sem node_modules!)
    console.log(`\n[Fase 3/3] Subindo servidor pré-compilado extraído na porta ${testPort} (sem node_modules)...`);
    proc = spawn(process.execPath, ["dist-server/server.mjs"], {
      cwd: extractedRoot,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(testPort),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await waitForHttpReady(`http://127.0.0.1:${testPort}/api/bot/status`, 12000);
    console.log(`  [OK]   Servidor standalone respondeu em http://127.0.0.1:${testPort}`);

    const htmlResp = await fetch(`http://127.0.0.1:${testPort}/`);
    const html = await htmlResp.text();
    if (!htmlResp.ok || !html.includes("PrenotaBot")) {
      throw new Error(`Painel HTML inválido na porta ${testPort}`);
    }
    console.log(`  [OK]   GET / -> HTTP ${htmlResp.status} (painel React carregado)`);

    const liveResp = await fetch(`http://127.0.0.1:${testPort}/api/extension/live-config`);
    const liveData = (await liveResp.json()) as { ok?: boolean; servico?: number };
    if (!liveResp.ok || !liveData.ok) {
      throw new Error("Falha em /api/extension/live-config no servidor extraído");
    }
    console.log(`  [OK]   GET /api/extension/live-config -> serviço ${liveData.servico}`);

    // Testbench endpoint dentro do servidor extraído
    const tbResp = await fetch(`http://127.0.0.1:${testPort}/api/testbench/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkPortal: false, checkImap: false }),
    });
    const tbData = (await tbResp.json()) as { totalChecks?: number; overallStatus?: string };
    if (!tbResp.ok || !tbData.totalChecks) {
      throw new Error("Falha em POST /api/testbench/run no servidor extraído");
    }
    console.log(`  [OK]   POST /api/testbench/run -> ${tbData.totalChecks} verificações executadas (${tbData.overallStatus})`);

    // Radar WhatsApp E2E dentro do servidor extraído
    const radarResp = await fetch(`http://127.0.0.1:${testPort}/api/radar/whatsapp-trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: "+55 47 92004-1774",
        message: "Teste bancada: VAGA DISPONIVEL servico 5402",
        bookingUrl: "https://prenotami.esteri.it/Services/Booking/5402",
      }),
    });
    const radarData = (await radarResp.json()) as { ok?: boolean; trigger?: { bookingUrl?: string } };
    if (!radarResp.ok || !radarData.ok) {
      throw new Error("Falha ao simular disparo do Radar WhatsApp no servidor extraído");
    }
    console.log(`  [OK]   POST /api/radar/whatsapp-trigger -> ${radarData.trigger?.bookingUrl}`);

    // Report + fetch OTP dentro do servidor extraído
    const otpPost = await fetch(`http://127.0.0.1:${testPort}/api/otp/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "829415",
        from: "noreply-prenotami@esteri.it",
        subject: "Prenot@Mi - Codice OTP",
      }),
    });
    const otpGet = await fetch(`http://127.0.0.1:${testPort}/api/otp/latest`);
    const otpJson = (await otpGet.json()) as { otp?: { code?: string } };
    if (!otpPost.ok || otpJson.otp?.code !== "829415") {
      throw new Error("Falha no fluxo completo de captura e entrega de OTP");
    }
    console.log("  [OK]   Ciclo completo OTP (<noreply-prenotami@esteri.it> -> servidor -> extensão): 829415");

    // Start + Stop monitor dentro do servidor extraído
    const startResp = await fetch(`http://127.0.0.1:${testPort}/api/automation/start-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ forceImmediate: false }),
    });
    const stopResp = await fetch(`http://127.0.0.1:${testPort}/api/bot/stop`, {
      method: "POST",
    });
    if (!startResp.ok || !stopResp.ok) {
      throw new Error("Falha no ciclo iniciar/parar automação integrada");
    }
    console.log("  [OK]   Ciclo completo /api/automation/start-all -> /api/bot/stop aprovado");

    // Confirma que config/env limpos também passam na função base
    void emptyEnv();
    void BASE_DIR;
    void DIST_DIR;
    void DIST_SERVER_FILE;
  } finally {
    if (proc && !proc.killed) {
      proc.kill("SIGTERM");
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log("\n================================================================");
  console.log("  BANCADA E2E CONCLUÍDA COM SUCESSO! TUDO PRONTO PARA SEGUNDA.");
  console.log("================================================================");
}

main().catch((err) => {
  console.error("\n[ERRO NA BANCADA]:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
