import fs from "node:fs";
import path from "node:path";
import {
  BASE_DIR,
  BotConfig,
  EnvMap,
  FILES_DIR,
  MAX_PRENOTAMI_FILE_BYTES,
  SITE,
  preflight,
  sanitizePrenotamiBookingUrl,
  secondsUntilScheduledStart,
} from "./core.ts";
import { getChromiumBridgeStatus } from "./chromiumBridge.ts";
import { ensureAndroidExtensionFiles } from "./extensionBuilder.ts";
import {
  extractOtpFromEmailText,
  fetchLatestPrenotamiOtpViaImap,
  getCachedOtp,
  inferImapHost,
} from "./otpReader.ts";
import {
  DIST_DIR,
  DIST_SERVER_FILE,
  RELEASE_ZIP_PATH,
} from "./releaseBuilder.ts";

export interface TestBenchCheck {
  id: string;
  category: string;
  title: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  durationMs: number;
  actionTab?: "inicio" | "dados" | "horario" | "chromium" | "historico";
  fixHint?: string;
}

export interface TestBenchReport {
  overallStatus: "APROVADO" | "ATENCAO" | "FALHA";
  passedCount: number;
  warnCount: number;
  failCount: number;
  totalChecks: number;
  durationMs: number;
  executedAt: string;
  checks: TestBenchCheck[];
}

export interface TestBenchOptions {
  checkPortal?: boolean;
  checkImap?: boolean;
}

export async function runTestBench(
  cfg: BotConfig,
  env: EnvMap,
  opts: TestBenchOptions = {}
): Promise<TestBenchReport> {
  const benchStart = Date.now();
  const checks: TestBenchCheck[] = [];
  const primarySid = cfg.servicos[0] ?? 5402;

  // 1. Horario & Fuso (16:00 Brasilia = 15:00 Cuiaba-AM toda segunda)
  {
    const t0 = Date.now();
    const sched = secondsUntilScheduledStart(cfg);
    const intervalOk =
      cfg.intervalo_min_segundos >= 20 &&
      cfg.intervalo_max_segundos >= cfg.intervalo_min_segundos;
    const diasOk = Array.isArray(cfg.dias_semana) && cfg.dias_semana.length > 0;
    const ok = intervalOk && diasOk;
    checks.push({
      id: "schedule",
      category: "Agendamento",
      title: "Fuso horário e pré-início de segunda-feira",
      status: ok ? "ok" : "fail",
      detail: `${sched.timeZone} | Alvo ${cfg.horario_alvo} | Pré-início: ${sched.brasiliaLabel} BRT / ${sched.cuiabaLabel} Cuiabá-AM | Intervalo ${cfg.intervalo_min_segundos}-${cfg.intervalo_max_segundos}s`,
      durationMs: Date.now() - t0,
      actionTab: "horario",
      fixHint: ok
        ? undefined
        : "Ajuste o fuso (Brasília 16:00 ou Cuiabá-AM 15:00) e dias da semana na aba Horário, Radar & OTP.",
    });
  }

  // 2. Credenciais & Dados de Preenchimento (Autofill)
  {
    const t0 = Date.now();
    const problems = preflight(cfg, env);
    const hasLogin = Boolean(env.PRENOTAMI_EMAIL && env.PRENOTAMI_SENHA);
    const missingDados: string[] = [];
    if (!cfg.dados.endereco) missingDados.push("Endereço");
    if (!cfg.dados.altura_cm) missingDados.push("Altura");
    if (!cfg.dados.estado_civil) missingDados.push("Estado civil");
    if (!cfg.dados.cor_olhos) missingDados.push("Cor dos olhos");

    let status: TestBenchCheck["status"] = "ok";
    if (!cfg.servicos.length || !hasLogin) {
      status = "fail";
    } else if (missingDados.length > 0 || problems.length > 0) {
      status = "warn";
    }

    checks.push({
      id: "credentials_form",
      category: "Dados",
      title: "Conta Prenot@mi, serviço e autofill",
      status,
      detail:
        status === "ok"
          ? `Serviço ${primarySid}, login de autofill definido e 4 campos obrigatórios prontos.`
          : [
              !hasLogin ? "Falta e-mail ou senha do Prenot@mi" : null,
              !cfg.servicos.length ? "Nenhum serviço selecionado" : null,
              missingDados.length
                ? `Campos pendentes: ${missingDados.join(", ")}`
                : null,
            ]
              .filter(Boolean)
              .join(" • "),
      durationMs: Date.now() - t0,
      actionTab: "dados",
      fixHint:
        status === "ok"
          ? undefined
          : "Preencha login e dados pessoais na aba Meus Dados (o navegador preenche tudo automaticamente para você confirmar).",
    });
  }

  // 3. Documentos PDF (<= 2 MB)
  {
    const t0 = Date.now();
    const docs = Array.isArray(cfg.documentos) ? cfg.documentos : [];
    const missingFiles: string[] = [];
    const oversized: string[] = [];
    for (const d of docs) {
      const full = path.join(FILES_DIR, path.basename(d));
      if (!fs.existsSync(full)) {
        missingFiles.push(d);
      } else {
        const size = fs.statSync(full).size;
        if (size > MAX_PRENOTAMI_FILE_BYTES) {
          oversized.push(`${d} (${(size / 1048576).toFixed(2)} MB)`);
        }
      }
    }
    let status: TestBenchCheck["status"] = "ok";
    let detail = `${docs.length} documento(s) anexado(s) dentro do limite de 2 MB.`;
    if (oversized.length > 0 || missingFiles.length > 0) {
      status = "fail";
      detail = [
        missingFiles.length ? `Ausente(s): ${missingFiles.join(", ")}` : null,
        oversized.length ? `Acima de 2 MB: ${oversized.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" | ");
    } else if (docs.length === 0) {
      status = "warn";
      detail = "Nenhum documento PDF anexado ainda em files/ (opcional, mas recomendado antes de segunda).";
    }
    checks.push({
      id: "documents",
      category: "Documentos",
      title: "Arquivos em PDF dentro do limite de 2 MB",
      status,
      detail,
      durationMs: Date.now() - t0,
      actionTab: "dados",
      fixHint:
        status === "ok"
          ? undefined
          : "Verifique seus PDFs (máximo 2 MB cada) na aba Meus Dados -> Gerenciar PDFs.",
    });
  }

  // 4. Alcance do Portal Oficial prenotami.esteri.it
  if (opts.checkPortal !== false) {
    const t0 = Date.now();
    try {
      const resp = await fetch(`${SITE}/`, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
          "Accept-Language": "pt-BR,pt;q=0.9,it;q=0.8",
        },
        signal: AbortSignal.timeout(8000),
      });
      const elapsed = Date.now() - t0;
      const status: TestBenchCheck["status"] =
        resp.status >= 500 ? "fail" : elapsed > 5000 ? "warn" : "ok";
      checks.push({
        id: "portal_reachability",
        category: "Rede / Portal",
        title: "Conexão ao vivo com prenotami.esteri.it",
        status,
        detail: `HTTP ${resp.status} em ${elapsed} ms${
          elapsed > 5000 ? " (portal lento — timeout 60s protege contra quedas)" : " (portal respondendo normalmente)"
        }`,
        durationMs: elapsed,
        actionTab: "horario",
      });
    } catch (e) {
      checks.push({
        id: "portal_reachability",
        category: "Rede / Portal",
        title: "Conexão ao vivo com prenotami.esteri.it",
        status: "warn",
        detail: `Não foi possível alcançar ${SITE} agora (${
          e instanceof Error ? e.message : String(e)
        }). Pode ser bloqueio de saída ou instabilidade momentânea do portal.`,
        durationMs: Date.now() - t0,
        actionTab: "inicio",
      });
    }
  }

  // 5. Extensão Chromium Dedicado & Arquivos Gerados
  {
    const t0 = Date.now();
    const extDir = ensureAndroidExtensionFiles(cfg, env);
    const reqFiles = [
      path.join(extDir, "manifest.json"),
      path.join(extDir, "background.js"),
      path.join(extDir, "content.js"),
      path.join(extDir, "newtab.html"),
      path.join(extDir, "popup.html"),
    ];
    const missing = reqFiles.filter((f) => !fs.existsSync(f));
    let syncWired = false;
    try {
      const bg = fs.readFileSync(path.join(extDir, "background.js"), "utf-8");
      syncWired = bg.includes("SYNC_LIVE_CONFIG");
    } catch {
      // ignore
    }
    const ok = missing.length === 0 && syncWired;
    checks.push({
      id: "chromium_extension",
      category: "Chromium",
      title: "Extensão Dedicada MV3 + Nova Aba + Sincronia Live",
      status: ok ? "ok" : "fail",
      detail: ok
        ? "manifest.json, content.js (Autofill/Radar/OTP), newtab.html e sincronia ao vivo verificados."
        : `Arquivos pendentes na extensão: ${missing.map((m) => path.basename(m)).join(", ")}`,
      durationMs: Date.now() - t0,
      actionTab: "chromium",
    });
  }

  // 6. Ponte Local Chromium CDP (127.0.0.1:9222)
  {
    const t0 = Date.now();
    const cdp = await getChromiumBridgeStatus(cfg.chromium?.porta_cdp);
    checks.push({
      id: "chromium_cdp",
      category: "Chromium",
      title: `Ponte Chromium local (127.0.0.1:${cdp.port})`,
      status: cdp.connected ? "ok" : "warn",
      detail: cdp.connected
        ? `Conectado (${cdp.browser}) • ${cdp.tabs.length} aba(s) • Prenot@mi: ${
            cdp.hasPrenotamiTab ? "OK" : "abrir"
          }, WA: ${cdp.hasWhatsappTab ? "OK" : "abrir"}, Webmail: ${
            cdp.hasWebmailTab ? "OK" : "abrir"
          }`
        : "Chromium Dedicado ainda não está aberto neste host/porta. No PC do usuário, será conectado automaticamente ao rodar INICIAR-AQUI.",
      durationMs: Date.now() - t0,
      actionTab: "chromium",
      fixHint: cdp.connected
        ? undefined
        : "Abra seu computador usando INICIAR-AQUI.bat / iniciar-aqui.sh para conectar o Chromium Dedicado.",
    });
  }

  // 7. Leitor Automático de OTP (<noreply-prenotami@esteri.it>)
  {
    const t0 = Date.now();
    const sampleOtp = extractOtpFromEmailText(
      "Prenot@Mi - Codice di verifica OTP",
      "Il tuo codice OTP e: 739104. Valido per 5 minuti.",
      "noreply-prenotami@esteri.it"
    );
    const parserOk = sampleOtp === "739104";
    const imapEmail = (env.IMAP_EMAIL || env.PRENOTAMI_EMAIL || "").trim();
    const imapConfigured = Boolean(imapEmail && env.IMAP_SENHA_APP);
    const inferredHost = imapEmail
      ? inferImapHost(imapEmail, env.IMAP_SERVIDOR)
      : null;

    let imapLiveNote = "";
    let imapError = "";
    if (opts.checkImap && imapConfigured) {
      const res = await fetchLatestPrenotamiOtpViaImap(env, true);
      if (res.ok) {
        imapLiveNote = res.otp
          ? ` | IMAP OK (último OTP ${res.otp.code})`
          : ` | IMAP conectado em ${res.host}`;
      } else if (res.error) {
        imapError = res.error;
      }
    }

    const cached = getCachedOtp();
    let status: TestBenchCheck["status"] = "ok";
    if (!parserOk || imapError) {
      status = imapError ? "warn" : "fail";
    } else if (!imapConfigured && !cfg.chromium?.abrir_webmail_ao_iniciar) {
      status = "warn";
    }

    checks.push({
      id: "otp_reader",
      category: "OTP Email",
      title: "Leitor de OTP (<noreply-prenotami@esteri.it>)",
      status,
      detail: [
        parserOk ? "Parser OK (teste 739104)" : "Falha no parser OTP",
        imapConfigured
          ? `IMAP pronto (${inferredHost ?? "servidor custom"})${imapLiveNote}`
          : "Webmail DOM ativo no Chromium (IMAP opcional não preenchido)",
        imapError ? `Erro IMAP: ${imapError}` : null,
        cached ? `Último OTP em cache: ${cached.code}` : null,
      ]
        .filter(Boolean)
        .join(" • "),
      durationMs: Date.now() - t0,
      actionTab: "horario",
      fixHint: imapError
        ? "Confira a Senha de App IMAP e o e-mail na aba Horário, Radar & OTP."
        : undefined,
    });
  }

  // 8. Radar WhatsApp (+55 47 92004-1774) & Proteção de URL
  {
    const t0 = Date.now();
    const num = cfg.radar_whatsapp?.numero_radar || "+55 47 92004-1774";
    const digits = num.replace(/\D+/g, "");
    const safeUrl = sanitizePrenotamiBookingUrl(
      `https://prenotami.esteri.it/Services/Booking/${primarySid}`,
      primarySid
    );
    const blockedEvil = sanitizePrenotamiBookingUrl(
      "https://evil.example.com/Services/Booking/5402",
      primarySid
    );
    const urlGuardOk =
      safeUrl.startsWith("https://prenotami.esteri.it/") &&
      blockedEvil === `https://prenotami.esteri.it/Services/Booking/${primarySid}`;
    const ok = digits.length >= 10 && urlGuardOk && cfg.radar_whatsapp?.ativo !== false;
    checks.push({
      id: "whatsapp_radar",
      category: "Radar WA",
      title: `Radar WhatsApp Web (${num})`,
      status: ok ? "ok" : "warn",
      detail: ok
        ? `Ativo para ${num} | Abrir automático: ${
            cfg.radar_whatsapp.abrir_automatico !== false ? "SIM" : "NÃO"
          } | Trava estrita https://prenotami.esteri.it verificada.`
        : "Radar WhatsApp desativado ou número incompleto.",
      durationMs: Date.now() - t0,
      actionTab: "horario",
    });
  }

  // 9. Pacote Pré-Instalado Portátil & Inicializadores
  {
    const t0 = Date.now();
    const hasDist = fs.existsSync(path.join(DIST_DIR, "index.html"));
    const hasServerBundle = fs.existsSync(DIST_SERVER_FILE);
    const hasWinStart = fs.existsSync(path.join(BASE_DIR, "INICIAR-AQUI.bat"));
    const hasShStart = fs.existsSync(path.join(BASE_DIR, "iniciar-aqui.sh"));
    const hasZip = fs.existsSync(RELEASE_ZIP_PATH);
    let zipClean = false;
    let zipSizeMb = "0";
    if (hasZip) {
      const buf = fs.readFileSync(RELEASE_ZIP_PATH);
      zipSizeMb = (buf.length / 1048576).toFixed(2);
      zipClean =
        buf.readUInt32LE(0) === 0x04034b50 &&
        buf.includes("PrenotaBot-Livre/INICIAR-AQUI.bat") &&
        buf.includes("PrenotaBot-Livre/dist-server/server.mjs") &&
        !buf.includes("PrenotaBot-Livre/.env\0");
    }

    const allOk = hasDist && hasServerBundle && hasWinStart && hasShStart && zipClean;
    checks.push({
      id: "portable_release",
      category: "Pacote ZIP",
      title: "Bundle pré-instalado e ZIP portátil sem segredos",
      status: allOk ? "ok" : hasDist ? "warn" : "fail",
      detail: allOk
        ? `Pronto (${zipSizeMb} MB): dist/, server.mjs, INICIAR-AQUI.bat, iniciar-aqui.sh e .env excluído.`
        : `Componentes ausentes: ${[
            !hasDist ? "dist/" : null,
            !hasServerBundle ? "dist-server/server.mjs" : null,
            !hasWinStart ? "INICIAR-AQUI.bat" : null,
            !hasZip ? "release/PrenotaBot-Livre-Portatil.zip" : null,
          ]
            .filter(Boolean)
            .join(", ")}`,
      durationMs: Date.now() - t0,
      actionTab: "chromium",
      fixHint: allOk
        ? undefined
        : "Execute 'npm run release:build' para atualizar o pacote pré-instalado completo.",
    });
  }

  const passedCount = checks.filter((c) => c.status === "ok").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;
  const failCount = checks.filter((c) => c.status === "fail").length;

  const overallStatus: TestBenchReport["overallStatus"] =
    failCount > 0 ? "FALHA" : warnCount > 0 ? "ATENCAO" : "APROVADO";

  return {
    overallStatus,
    passedCount,
    warnCount,
    failCount,
    totalChecks: checks.length,
    durationMs: Date.now() - benchStart,
    executedAt: new Date().toLocaleTimeString("pt-BR", { hour12: false }),
    checks,
  };
}
