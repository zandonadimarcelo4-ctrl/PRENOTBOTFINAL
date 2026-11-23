import express from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import {
  BotConfig,
  CATALOG_PATH,
  DEFAULT_CONFIG,
  ENV_KEYS,
  EnvMap,
  FILES_DIR,
  HISTORY_CSV,
  PROOF_DIR,
  SERVICES_CACHE,
  buildReadinessReport,
  ensureDirs,
  getLastProfile,
  historySummary,
  listProfiles,
  loadConfig,
  loadEnv,
  notify,
  preflight,
  profilePath,
  saveConfig,
  saveEnv,
  setLastProfile,
} from "./server/core.ts";
import { runner } from "./server/runner.ts";
import {
  buildExtensionBundleEntries,
  buildUserscript,
  ensureAndroidExtensionFiles,
} from "./server/extensionBuilder.ts";
import {
  buildChromiumInitialBookmarks,
  buildChromiumInitialPreferences,
  buildChromiumLauncherScript,
  buildChromiumPolicyJson,
  ensureChromiumDedicatedTabs,
  getChromiumBridgeStatus,
  openChromiumBridgeTab,
} from "./server/chromiumBridge.ts";
import { createZipBuffer } from "./server/zip.ts";
import {
  fetchLatestPrenotamiOtpViaImap,
  getCachedOtp,
  reportCapturedOtp,
} from "./server/otpReader.ts";
import { runConsularAgent } from "./server/aiAgent.ts";
import { createPortableReleaseZip } from "./server/releaseBuilder.ts";

ensureDirs();

const app = express();
app.use(express.json({ limit: "4mb" }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDirs();
      cb(null, FILES_DIR);
    },
    filename: (_req, file, cb) => {
      const safeName = path.basename(file.originalname).replace(/[^\w.\- ()]/g, "_");
      cb(null, safeName || `documento_${Date.now()}.pdf`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
});

function loadCatalog(): Array<{
  id: number;
  consulado: string;
  nome: string;
}> {
  const rows: Array<{ id: number; consulado: string; nome: string }> = [];
  if (fs.existsSync(SERVICES_CACHE)) {
    try {
      const list = JSON.parse(fs.readFileSync(SERVICES_CACHE, "utf-8")) as Array<{
        id: number;
        nome: string;
        descricao?: string;
      }>;
      for (const s of list) {
        rows.push({
          id: s.id,
          consulado: "MINHA CONTA",
          nome: `${s.nome} ${(s.descricao ?? "").slice(0, 80)}`.trim(),
        });
      }
    } catch {
      // ignore
    }
  }
  if (fs.existsSync(CATALOG_PATH)) {
    try {
      const list = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf-8")) as Array<{
        consulado: string;
        servicos: Array<{ id: number; nome: string }>;
      }>;
      for (const c of list) {
        for (const s of c.servicos) {
          rows.push({ id: s.id, consulado: c.consulado, nome: s.nome });
        }
      }
    } catch {
      // ignore
    }
  }
  return rows;
}

function listDirFiles(dir: string): Array<{ name: string; size: number }> {
  ensureDirs();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith("."))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size };
    })
    .filter((f) => f.size >= 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function safePanelOrigin(req: express.Request): string {
  const candidate = String(req.query.origin ?? "").trim();
  if (/^https?:\/\/[A-Za-z0-9.\-]+(?::\d{1,5})?$/.test(candidate)) {
    return candidate;
  }
  const host = String(req.get("host") ?? "").trim();
  if (/^[A-Za-z0-9.\-]+(?::\d{1,5})?$/.test(host)) {
    const proto = req.protocol === "https" ? "https" : "http";
    return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}

// ---------------- API Routes ----------------

app.get("/api/bootstrap", (_req, res) => {
  const profiles = listProfiles();
  const activeProfile = getLastProfile();
  const cfg = loadConfig(profilePath(activeProfile));
  const env = loadEnv();
  ensureAndroidExtensionFiles(cfg, env);

  res.json({
    profiles,
    activeProfile,
    cfg,
    env,
    catalog: loadCatalog(),
    files: listDirFiles(FILES_DIR),
    proofs: listDirFiles(PROOF_DIR),
    history: historySummary(),
    runner: runner.getState(),
    readiness: buildReadinessReport(cfg, env),
    otp: getCachedOtp(),
  });
});

app.post("/api/profiles/switch", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const profiles = listProfiles();
  if (!name || !profiles.includes(name)) {
    return res.status(404).json({ error: "Perfil não encontrado." });
  }
  setLastProfile(name);
  const cfg = loadConfig(profilePath(name));
  const env = loadEnv();
  res.json({
    activeProfile: name,
    cfg,
    profiles,
    readiness: buildReadinessReport(cfg, env),
  });
});

app.post("/api/profiles/new", (req, res) => {
  const rawName = String(req.body?.name ?? "").trim();
  if (!rawName) {
    return res.status(400).json({ error: "Informe o nome do perfil." });
  }
  const dest = profilePath(rawName);
  const stem = path.basename(dest, ".yaml");
  const cfg: BotConfig = req.body?.cfg
    ? { ...structuredClone(DEFAULT_CONFIG), ...req.body.cfg }
    : structuredClone(DEFAULT_CONFIG);
  saveConfig(cfg, dest);
  setLastProfile(stem);
  const loaded = loadConfig(dest);
  res.json({
    activeProfile: stem,
    cfg: loaded,
    profiles: listProfiles(),
    readiness: buildReadinessReport(loaded, loadEnv()),
  });
});

app.delete("/api/profiles/:name", (req, res) => {
  const profiles = listProfiles();
  if (profiles.length <= 1) {
    return res
      .status(400)
      .json({ error: "Precisa existir pelo menos um perfil." });
  }
  const target = profilePath(req.params.name);
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
  }
  const nextProfiles = listProfiles();
  const activeProfile = nextProfiles[0];
  setLastProfile(activeProfile);
  const cfg = loadConfig(profilePath(activeProfile));
  res.json({
    activeProfile,
    cfg,
    profiles: nextProfiles,
    readiness: buildReadinessReport(cfg, loadEnv()),
  });
});

app.post("/api/save", (req, res) => {
  const profile = String(req.body?.profile ?? getLastProfile()).trim();
  const cfg = req.body?.cfg as BotConfig | undefined;
  const envPatch = req.body?.env as Partial<EnvMap> | undefined;

  if (cfg) {
    saveConfig(cfg, profilePath(profile));
  }
  setLastProfile(profile);
  if (envPatch) {
    const clean: Partial<EnvMap> = {};
    for (const k of ENV_KEYS) {
      if (k in envPatch) {
        clean[k] = String(envPatch[k] ?? "").trim();
      }
    }
    saveEnv(clean);
  }

  const savedCfg = loadConfig(profilePath(profile));
  const savedEnv = loadEnv();
  ensureAndroidExtensionFiles(savedCfg, savedEnv);

  res.json({
    ok: true,
    activeProfile: profile,
    cfg: savedCfg,
    env: savedEnv,
    readiness: buildReadinessReport(savedCfg, savedEnv),
    savedAt: new Date().toLocaleTimeString("pt-BR", { hour12: false }),
  });
});

app.post("/api/check-config", (req, res) => {
  const profile = String(req.body?.profile ?? getLastProfile()).trim();
  const cfg = (req.body?.cfg as BotConfig) ?? loadConfig(profilePath(profile));
  const env = (req.body?.env as EnvMap) ?? loadEnv();

  saveConfig(cfg, profilePath(profile));
  saveEnv(env);
  const reloadedCfg = loadConfig(profilePath(profile));
  const reloadedEnv = loadEnv();

  const problems = preflight(reloadedCfg, reloadedEnv);
  const channels: string[] = [];
  if (reloadedEnv.NTFY_TOPICO) channels.push("celular (ntfy)");
  if (reloadedEnv.WHATSAPP_APIKEY) channels.push("WhatsApp");
  if (reloadedEnv.TELEGRAM_TOKEN) channels.push("Telegram");
  if (reloadedEnv.IMAP_SENHA_APP) channels.push("e-mail OTP (IMAP)");

  res.json({
    problems,
    channels,
    services: reloadedCfg.servicos,
    readiness: buildReadinessReport(reloadedCfg, reloadedEnv),
  });
});

app.post("/api/test-notifications", async (req, res) => {
  const env = (req.body?.env as Partial<EnvMap>) ?? loadEnv();
  saveEnv(env);
  const loaded = loadEnv();
  const results = await notify(
    loaded,
    "PrenotaBot: teste de aviso. Se você recebeu, está tudo certo!",
    true,
    (msg) => runner.addLog("WARNING", msg)
  );
  res.json({ results });
});

app.post("/api/bot/start", async (req, res) => {
  const profile = String(req.body?.profile ?? getLastProfile()).trim();
  const discover = Boolean(req.body?.discover);
  const forceImmediate = Boolean(req.body?.forceImmediate);
  if (req.body?.cfg) {
    saveConfig(req.body.cfg as BotConfig, profilePath(profile));
  }
  if (req.body?.env) {
    saveEnv(req.body.env as Partial<EnvMap>);
  }
  const savedCfg = loadConfig(profilePath(profile));
  const started = runner.start(profile, discover, forceImmediate);
  if (!started) {
    return res.status(409).json({ error: "O monitor já está em execução." });
  }
  const chromiumSync = await ensureChromiumDedicatedTabs(
    savedCfg.servicos[0] ?? 5402,
    savedCfg.chromium
  );
  if (chromiumSync.connected && chromiumSync.opened.length > 0) {
    runner.addLog(
      "OK",
      `Chromium Dedicado sincronizado: ${chromiumSync.opened.length} aba(s) aberta(s) automaticamente.`
    );
  }
  res.json({ ok: true, runner: runner.getState(), chromiumSync });
});

app.post("/api/automation/start-all", async (req, res) => {
  const profile = String(req.body?.profile ?? getLastProfile()).trim();
  const forceImmediate = Boolean(req.body?.forceImmediate);
  if (req.body?.cfg) {
    saveConfig(req.body.cfg as BotConfig, profilePath(profile));
  }
  if (req.body?.env) {
    saveEnv(req.body.env as Partial<EnvMap>);
  }

  const cfg = loadConfig(profilePath(profile));
  const env = loadEnv();
  ensureAndroidExtensionFiles(cfg, env);

  const chromiumSync = await ensureChromiumDedicatedTabs(
    cfg.servicos[0] ?? 5402,
    cfg.chromium
  );

  let startedNow = false;
  if (!runner.getState().running) {
    startedNow = runner.start(profile, false, forceImmediate);
  }

  const imapConfigured = Boolean(
    (env.IMAP_EMAIL || env.PRENOTAMI_EMAIL) && env.IMAP_SENHA_APP
  );
  if (cfg.chromium?.auto_otp_email !== false && imapConfigured) {
    void fetchLatestPrenotamiOtpViaImap(env, false);
  }

  res.json({
    ok: true,
    startedNow,
    chromiumSync,
    imapConfigured,
    runner: runner.getState(),
    readiness: buildReadinessReport(cfg, env),
    otp: getCachedOtp(),
  });
});

app.post("/api/bot/stop", (_req, res) => {
  runner.stop();
  res.json({ ok: true, runner: runner.getState() });
});

let lastBackgroundImapAt = 0;

app.get("/api/bot/status", (_req, res) => {
  const activeProfile = getLastProfile();
  const cfg = loadConfig(profilePath(activeProfile));
  const env = loadEnv();
  const state = runner.getState();

  const now = Date.now();
  if (
    state.running &&
    cfg.chromium?.auto_otp_email !== false &&
    (env.IMAP_EMAIL || env.PRENOTAMI_EMAIL) &&
    env.IMAP_SENHA_APP &&
    now - lastBackgroundImapAt >= 25_000
  ) {
    lastBackgroundImapAt = now;
    void fetchLatestPrenotamiOtpViaImap(env, false);
  }

  res.json({
    runner: state,
    catalog: loadCatalog(),
    history: historySummary(),
    readiness: buildReadinessReport(cfg, env),
    otp: getCachedOtp(),
  });
});

app.get("/api/history", (_req, res) => {
  const summary = historySummary();
  let recent: Array<{
    data_hora: string;
    dia_semana: string;
    servico: string;
    resultado: string;
  }> = [];
  if (fs.existsSync(HISTORY_CSV)) {
    const lines = fs
      .readFileSync(HISTORY_CSV, "utf-8")
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .slice(1);
    recent = lines
      .slice(-50)
      .reverse()
      .map((line) => {
        const [data_hora = "", dia_semana = "", servico = "", resultado = ""] =
          line.split(";");
        return { data_hora, dia_semana, servico, resultado };
      });
  }
  res.json({ summary, recent });
});

app.get("/api/history/csv", (_req, res) => {
  if (!fs.existsSync(HISTORY_CSV)) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="historico_verificacoes.csv"'
    );
    return res.send("data_hora;dia_semana;servico;resultado\n");
  }
  res.download(HISTORY_CSV, "historico_verificacoes.csv");
});

app.get("/api/files", (_req, res) => {
  res.json({ files: listDirFiles(FILES_DIR) });
});

app.post("/api/files", upload.array("files", 10), (req, res) => {
  const uploaded = (req.files as Express.Multer.File[]) ?? [];
  res.json({
    uploaded: uploaded.map((f) => ({ name: f.filename, size: f.size })),
    files: listDirFiles(FILES_DIR),
  });
});

app.get("/api/files/:name", (req, res) => {
  const safe = path.basename(req.params.name);
  const full = path.join(FILES_DIR, safe);
  if (!fs.existsSync(full)) {
    return res.status(404).json({ error: "Arquivo não encontrado." });
  }
  res.download(full, safe);
});

app.delete("/api/files/:name", (req, res) => {
  const safe = path.basename(req.params.name);
  const full = path.join(FILES_DIR, safe);
  if (fs.existsSync(full)) {
    fs.unlinkSync(full);
  }
  res.json({ files: listDirFiles(FILES_DIR) });
});

app.get("/api/proofs", (_req, res) => {
  res.json({ proofs: listDirFiles(PROOF_DIR) });
});

app.get("/api/proofs/:name", (req, res) => {
  const safe = path.basename(req.params.name);
  const full = path.join(PROOF_DIR, safe);
  if (!fs.existsSync(full)) {
    return res.status(404).json({ error: "Comprovante não encontrado." });
  }
  res.download(full, safe);
});

app.get("/api/extension/userscript", (req, res) => {
  const profile = String(req.query.profile ?? getLastProfile());
  const cfg = loadConfig(profilePath(profile));
  const env = loadEnv();
  const script = buildUserscript(cfg, env);
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="prenotabot-livre.user.js"'
  );
  res.send(script);
});

app.get("/api/extension/files", (req, res) => {
  const profile = String(req.query.profile ?? getLastProfile());
  const cfg = loadConfig(profilePath(profile));
  const env = loadEnv();
  ensureAndroidExtensionFiles(cfg, env);
  const files = buildExtensionBundleEntries(cfg, env);
  res.json({ dir: "extensao_android/", files });
});

app.get("/api/extension/download-zip", (req, res) => {
  const profile = String(req.query.profile ?? getLastProfile());
  const cfg = loadConfig(profilePath(profile));
  const env = loadEnv();
  const entries = buildExtensionBundleEntries(cfg, env).map((e) => ({
    name: `extensao_android/${e.name}`,
    data: e.content,
  }));
  const zipBuf = createZipBuffer(entries);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="prenotabot-chromium-extensao.zip"'
  );
  res.send(zipBuf);
});

app.get("/api/chromium/bundle-zip", (req, res) => {
  const profile = String(req.query.profile ?? getLastProfile());
  const cfg = loadConfig(profilePath(profile));
  const env = loadEnv();
  const sid = cfg.servicos[0] ?? 5402;
  const origin = safePanelOrigin(req);

  const extEntries = buildExtensionBundleEntries(cfg, env).map((e) => ({
    name: `extensao_android/${e.name}`,
    data: e.content,
  }));

  const winBat = buildChromiumLauncherScript("win", sid, cfg.chromium, origin);
  const linuxSh = buildChromiumLauncherScript("linux", sid, cfg.chromium, origin);
  const prefs = buildChromiumInitialPreferences(sid, cfg.chromium, origin);
  const bookmarks = buildChromiumInitialBookmarks(sid, cfg.chromium, origin);
  const policyJson = buildChromiumPolicyJson(sid, cfg.chromium, origin);

  const readme = [
    "PrenotaBot Livre — Chromium Edicao Dedicada Prenot@mi",
    "======================================================",
    "",
    "1. Extraia este ZIP em uma pasta no seu PC (ex.: C:\\PrenotaBot-Chromium).",
    "2. No Windows, clique duas vezes em: iniciar-prenotabot-chromium.bat",
    "   No Linux, execute: chmod +x iniciar-prenotabot-chromium.sh && ./iniciar-prenotabot-chromium.sh",
    "",
    "O navegador Chromium vai abrir diretamente configurado SO para o Prenot@mi:",
    `- Aba inicial: https://prenotami.esteri.it/ (login manual com autofill)`,
    `- Abas de agendamento: Servico ${sid}`,
    "- Aba WhatsApp Web (Radar +55 47 92004-1774)",
    "- Aba Webmail + Leitor automatico de OTP (<noreply-prenotami@esteri.it>)",
    "- Nova aba personalizada + Barra de favoritos Prenot@mi",
    "",
    "Opcional (modo bloqueio total de sites externos):",
    "- Arquivo chromium_politica/policies.json pronto caso queira aplicar politica gerenciada.",
  ].join("\r\n");

  const zipBuf = createZipBuffer([
    ...extEntries,
    { name: "chromium_seed/Preferences", data: prefs },
    { name: "chromium_seed/Bookmarks", data: bookmarks },
    { name: "chromium_politica/policies.json", data: policyJson },
    { name: "iniciar-prenotabot-chromium.bat", data: winBat },
    { name: "iniciar-prenotabot-chromium.sh", data: linuxSh },
    { name: "LEIA-CHROMIUM.txt", data: readme },
  ]);

  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="chromium-dedicado-prenotami.zip"'
  );
  res.send(zipBuf);
});

app.get("/api/release/portable-zip", (req, res) => {
  const profile = String(req.query.profile ?? getLastProfile());
  const cfg = loadConfig(profilePath(profile));
  const origin = safePanelOrigin(req);
  try {
    const zipBuf = createPortableReleaseZip(cfg, {
      sanitizeForPublicRelease: false,
      panelOrigin: origin,
    });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="PrenotaBot-Livre-Portatil.zip"'
    );
    res.send(zipBuf);
  } catch (e) {
    res.status(503).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.get("/api/chromium/launcher", (req, res) => {
  const osKind = req.query.os === "linux" ? "linux" : "win";
  const profile = String(req.query.profile ?? getLastProfile());
  const cfg = loadConfig(profilePath(profile));
  const sid = cfg.servicos[0] ?? 5402;
  const origin = safePanelOrigin(req);
  const script = buildChromiumLauncherScript(osKind, sid, cfg.chromium, origin);
  const filename =
    osKind === "linux"
      ? "iniciar-prenotabot-chromium.sh"
      : "iniciar-prenotabot-chromium.bat";

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(script);
});

app.get("/api/chromium/status", async (req, res) => {
  const profile = String(req.query.profile ?? getLastProfile());
  const cfg = loadConfig(profilePath(profile));
  const status = await getChromiumBridgeStatus(cfg.chromium?.porta_cdp);
  res.json(status);
});

app.post("/api/chromium/open-tab", async (req, res) => {
  const profile = String(req.body?.profile ?? getLastProfile()).trim();
  const cfg = loadConfig(profilePath(profile));
  const rawUrl = String(req.body?.url ?? "").trim();
  const result = await openChromiumBridgeTab(rawUrl, cfg.chromium?.porta_cdp);
  if (!result.ok) {
    const code = result.error?.includes("política de segurança") ? 400 : 502;
    return res.status(code).json(result);
  }
  res.json(result);
});

// ---------------- OTP Email (<noreply-prenotami@esteri.it>) ----------------

app.get("/api/otp/latest", async (req, res) => {
  const env = loadEnv();
  const refresh = req.query.refresh === "1" || req.query.refresh === "true";
  const force = req.query.force === "1" || req.query.force === "true";
  if (refresh) {
    const result = await fetchLatestPrenotamiOtpViaImap(env, force);
    return res.json(result);
  }
  const cached = getCachedOtp();
  res.json({
    ok: true,
    otp: cached,
    checkedImap: false,
    imapConfigured: Boolean(
      (env.IMAP_EMAIL || env.PRENOTAMI_EMAIL) && env.IMAP_SENHA_APP
    ),
  });
});

app.post("/api/otp/report", (req, res) => {
  const rec = reportCapturedOtp({
    code: req.body?.code,
    from: req.body?.from,
    subject: req.body?.subject,
    receivedAt: req.body?.receivedAt,
    source: "webmail",
  });
  if (!rec) {
    return res.status(400).json({ error: "Código OTP inválido (esperado 4 a 8 dígitos)." });
  }
  runner.addLog(
    "OK",
    `OTP capturado (${rec.source}) de ${rec.from}: ${rec.code}`
  );
  res.json({ ok: true, otp: rec });
});

app.post("/api/otp/test-imap", async (req, res) => {
  if (req.body?.env && typeof req.body.env === "object") {
    const patch: Partial<EnvMap> = {};
    for (const k of ["IMAP_EMAIL", "IMAP_SENHA_APP", "IMAP_SERVIDOR"] as const) {
      if (k in req.body.env) {
        patch[k] = String(req.body.env[k] ?? "").trim();
      }
    }
    saveEnv(patch);
  }
  const env = loadEnv();
  const result = await fetchLatestPrenotamiOtpViaImap(env, true);
  if (result.otp) {
    runner.addLog(
      "OK",
      `Teste IMAP: OTP ${result.otp.code} encontrado de ${result.otp.from}.`
    );
  }
  res.json(result);
});

app.post("/api/radar/whatsapp-trigger", (req, res) => {
  const profile = String(req.body?.profile ?? getLastProfile()).trim();
  const sender = String(req.body?.sender ?? "+55 47 92004-1774").trim();
  const message = String(
    req.body?.message ?? "Alerta de vaga recebido do Radar WhatsApp"
  ).trim();
  const bookingUrl = String(req.body?.bookingUrl ?? "").trim();

  const trigger = runner.triggerRadarWhatsapp(
    profile,
    sender,
    message,
    bookingUrl
  );
  res.json({
    ok: true,
    trigger,
    runner: runner.getState(),
  });
});

app.post("/api/ai/assist", async (req, res) => {
  const rawMode = String(req.body?.mode ?? "chat");
  const mode: "readiness" | "map_field" | "chat" | "autonomous" =
    rawMode === "readiness" ||
    rawMode === "map_field" ||
    rawMode === "autonomous"
      ? rawMode
      : "chat";
  const prompt = String(req.body?.prompt ?? "").trim().slice(0, 4000);
  const fieldLabel = String(req.body?.fieldLabel ?? "").trim().slice(0, 2000);
  const profile = String(req.body?.profile ?? getLastProfile()).trim();
  const env = loadEnv();

  try {
    const result = await runConsularAgent({
      mode,
      prompt,
      fieldLabel,
      profile,
      env,
    });
    return res.json(result);
  } catch (e) {
    return res.status(502).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

// ---------------- Vite / Static Serving ----------------
const isProd = process.env.NODE_ENV === "production";
const PORT = 3000;
const HOST = "0.0.0.0";

async function startServer() {
  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true, host: HOST, port: PORT },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  const srv = app.listen(PORT, HOST, () => {
    console.log(`PrenotaBot Livre running at http://${HOST}:${PORT}`);
  });
  srv.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Porta ${PORT} já está em uso. O PrenotaBot já pode estar rodando em http://localhost:${PORT}.`
      );
      process.exit(1);
    }
    throw err;
  });
}

startServer();
