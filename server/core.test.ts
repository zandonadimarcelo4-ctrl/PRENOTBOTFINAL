import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_CONFIG,
  PROFILES_DIR,
  SERVICE_PRESETS,
  buildReadinessReport,
  classifyLabel,
  codeFor,
  historySummary,
  inTimeWindow,
  loadConfig,
  normalize,
  notify,
  parseDate,
  profilePath,
  sanitizePrenotamiBookingUrl,
  saveConfig,
  secondsUntilScheduledStart,
} from "./core.ts";
import { runConsularAgent } from "./aiAgent.ts";
import { createZipBuffer } from "./zip.ts";
import {
  buildChromiumInitialBookmarks,
  buildChromiumLauncherScript,
  buildChromiumPolicyJson,
  isAllowedBridgeUrl,
  safeCdpPort,
  sanitizeCliArgText,
} from "./chromiumBridge.ts";
import {
  extractOtpFromEmailText,
  inferImapHost,
  reportCapturedOtp,
} from "./otpReader.ts";
import {
  DIST_DIR,
  DIST_SERVER_FILE,
  buildEmptyEnvMap,
  buildPortableStartScripts,
  buildSanitizedReleaseConfig,
  createPortableReleaseZip,
} from "./releaseBuilder.ts";

test("normalize strips accents, trims and collapses spaces", () => {
  assert.equal(normalize("  Endereço   COMPLETO "), "endereco completo");
  assert.equal(normalize(null), "");
});

test("classifyLabel recognizes Portuguese and Italian labels", () => {
  assert.equal(classifyLabel("Indirizzo di residenza"), "endereco");
  assert.equal(classifyLabel("Endereço completo"), "endereco");
  assert.equal(classifyLabel("Stato civile"), "estado_civil");
  assert.equal(classifyLabel("Cor dos olhos"), "cor_olhos");
});

test("codeFor resolves Prenot@mi select codes", () => {
  assert.equal(codeFor("estado_civil", "Solteiro/a"), "16");
  assert.equal(codeFor("estado_civil", "Casado"), "13");
  assert.equal(codeFor("cor_olhos", "Castanho"), "23");
  assert.equal(codeFor("filhos_menores", "Não"), "12");
  assert.equal(codeFor("cor_olhos", "roxo"), null);
});

test("parseDate parses dd/mm/yyyy and yyyy-mm-dd", () => {
  const d1 = parseDate("05/03/2027");
  assert.ok(d1);
  assert.equal(d1.toISOString().slice(0, 10), "2027-03-05");

  const d2 = parseDate("2027-03-05");
  assert.ok(d2);
  assert.equal(d2.toISOString().slice(0, 10), "2027-03-05");

  assert.equal(parseDate("ontem"), null);
});

test("SERVICE_PRESETS includes São Paulo 5402 and 5256", () => {
  assert.ok(5402 in SERVICE_PRESETS);
  const campos = SERVICE_PRESETS[5402].campos;
  assert.equal(campos["DatiAddizionaliPrenotante[0]._testo"], "endereco");
  assert.equal(campos["ddls_1"], "estado_civil");
  assert.equal(campos["ddls_3"], "cor_olhos");
});

test("inTimeWindow handles empty window, inside/outside hours and weekday", () => {
  assert.deepEqual(inTimeWindow({}), [true, 0]);
  const cfg = { janela_horario: "09:00-12:00" };
  assert.deepEqual(
    inTimeWindow(cfg, new Date(2026, 10, 23, 10, 0)),
    [true, 0]
  );
  const [ok, wait] = inTimeWindow(cfg, new Date(2026, 10, 23, 7, 0));
  assert.equal(ok, false);
  assert.ok(Math.abs(wait - 7200) < 1);

  const [okDay, waitDay] = inTimeWindow(
    { dias_semana: [3] },
    new Date(2026, 10, 23, 10, 0) // Monday = 1
  );
  assert.equal(okDay, false);
  assert.ok(waitDay > 0);
});

test("secondsUntilScheduledStart handles 16:00 BRT = 15:00 Cuiabá-AM every Monday", () => {
  const monBefore = new Date("2026-11-23T18:55:00Z");

  const brtCfg = {
    fuso_horario: "America/Sao_Paulo",
    horario_alvo: "16:00",
    antecedencia_minutos: 2,
    dias_semana: [1],
  };
  const brt = secondsUntilScheduledStart(brtCfg, monBefore);
  assert.equal(brt.startLabel, "15:58");
  assert.equal(brt.brasiliaLabel, "15:58");
  assert.equal(brt.cuiabaLabel, "14:58");
  assert.equal(Math.round(brt.waitSeconds), 180);

  const amtCfg = {
    fuso_horario: "America/Cuiaba",
    horario_alvo: "15:00",
    antecedencia_minutos: 2,
    dias_semana: [1],
  };
  const amt = secondsUntilScheduledStart(amtCfg, monBefore);
  assert.equal(amt.startLabel, "14:58");
  assert.equal(amt.brasiliaLabel, "15:58");
  assert.equal(amt.cuiabaLabel, "14:58");
  assert.equal(Math.round(amt.waitSeconds), 180);

  const ready = secondsUntilScheduledStart(brtCfg, new Date("2026-11-23T18:58:30Z"));
  assert.equal(ready.waitSeconds, 0);

  const tue = secondsUntilScheduledStart(brtCfg, new Date("2026-11-24T12:00:00Z"));
  assert.equal(tue.targetUtcIso, "2026-11-30T18:58:00.000Z");
  assert.ok(tue.waitSeconds > 5 * 86400);
});

test("saveConfig and loadConfig enforce minimum 20s interval and numeric services", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-test-"));
  try {
    const p = path.join(tmp, "perfil.yaml");
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.servicos = [5402, "abc" as unknown as number];
    cfg.intervalo_min_segundos = 5;
    cfg.chromium.modo_dedicado = true;
    saveConfig(cfg, p);
    const back = loadConfig(p);
    assert.deepEqual(back.servicos, [5402]);
    assert.ok(back.intervalo_min_segundos >= 20);
    assert.equal(back.chromium.modo_dedicado, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("profilePath sanitizes traversal characters", () => {
  const p = profilePath("../meu perfil!");
  assert.equal(path.basename(p), "meu_perfil.yaml");
  assert.equal(path.dirname(p), PROFILES_DIR);
});

test("notify returns off when no channels configured", async () => {
  const r = await notify({}, "teste");
  assert.ok(Object.values(r).every((v) => v === "off"));
});

test("historySummary aggregates csv rows", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-hist-"));
  try {
    const csv = path.join(tmp, "h.csv");
    fs.writeFileSync(
      csv,
      "data_hora;dia_semana;servico;resultado\n" +
        "2026-11-23 09:15:00;1;5402;indisponivel\n" +
        "2026-11-23 10:02:00;1;5402;disponivel\n",
      "utf-8"
    );
    const s = historySummary(csv);
    assert.equal(s.total, 2);
    assert.equal(s.vagas, 1);
    assert.deepEqual(s.horas_com_vaga, { "10": 1 });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("runConsularAgent blocks CAPTCHA evasion requests", async () => {
  const blocked = await runConsularAgent({
    mode: "chat",
    prompt: "deixe o captcha sem detectar",
    fieldLabel: "",
    profile: "meu_perfil",
    env: {
      PRENOTAMI_EMAIL: "",
      PRENOTAMI_SENHA: "",
      TELEGRAM_TOKEN: "",
      TELEGRAM_CHAT_ID: "",
      IMAP_EMAIL: "",
      IMAP_SENHA_APP: "",
      IMAP_SERVIDOR: "",
      EMAIL_AVISO_DESTINO: "",
      SMTP_SERVIDOR: "",
      WHATSAPP_TELEFONE: "",
      WHATSAPP_APIKEY: "",
      NTFY_TOPICO: "",
    },
  });
  assert.equal(blocked.actions[0]?.tool, "safety_policy");
  assert.equal(blocked.actions[0]?.ok, false);
  assert.match(blocked.reply, /Não posso/);
});

test("sanitizePrenotamiBookingUrl restricts URLs strictly to https://prenotami.esteri.it", () => {
  assert.equal(
    sanitizePrenotamiBookingUrl("https://prenotami.esteri.it/Services/Booking/5402", 5402),
    "https://prenotami.esteri.it/Services/Booking/5402"
  );
  assert.equal(
    sanitizePrenotamiBookingUrl("https://evil.example.com/Services/Booking/5402", 5402),
    "https://prenotami.esteri.it/Services/Booking/5402"
  );
  assert.equal(
    sanitizePrenotamiBookingUrl("javascript:alert(1)", 5256),
    "https://prenotami.esteri.it/Services/Booking/5256"
  );
});

test("createZipBuffer produces valid STORE zip archive with PK signature", () => {
  const buf = createZipBuffer([
    { name: "extensao_android/manifest.json", data: '{"manifest_version":3}' },
    { name: "README.txt", data: "PrenotaBot" },
  ]);
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  assert.ok(buf.includes("extensao_android/manifest.json"));
  assert.ok(buf.includes("README.txt"));
});

test("buildReadinessReport scores complete vs incomplete profiles", () => {
  const emptyRep = buildReadinessReport(structuredClone(DEFAULT_CONFIG), {});
  assert.ok(emptyRep.score < 100);

  const readyCfg = structuredClone(DEFAULT_CONFIG);
  readyCfg.dados.endereco = "Rua A, 10";
  readyCfg.dados.altura_cm = "175";
  readyCfg.dados.estado_civil = "Solteiro/Solteira";
  readyCfg.dados.cor_olhos = "Marrom";
  const fullRep = buildReadinessReport(readyCfg, {
    PRENOTAMI_EMAIL: "a@b.com",
    PRENOTAMI_SENHA: "secret",
  });
  assert.equal(fullRep.score, 100);
});

test("chromiumBridge validates CDP port, URLs, launchers and dedicated policy", () => {
  assert.equal(safeCdpPort(9222), 9222);
  assert.equal(safeCdpPort(80), 9222);
  assert.equal(safeCdpPort(99999), 9222);
  assert.equal(sanitizeCliArgText("abc;rm -rf /", "ok"), "abcrm -rf /");
  assert.ok(isAllowedBridgeUrl("https://prenotami.esteri.it/Services/Booking/5402"));
  assert.ok(isAllowedBridgeUrl("https://mail.google.com/"));
  assert.equal(isAllowedBridgeUrl("https://evil.example.com/"), null);

  const bat = buildChromiumLauncherScript("win", 5402, DEFAULT_CONFIG.chromium);
  assert.match(bat, /--remote-debugging-port=9222/);
  assert.match(bat, /https:\/\/prenotami\.esteri\.it\//);

  const pol = JSON.parse(
    buildChromiumPolicyJson(5402, { ...DEFAULT_CONFIG.chromium, bloquear_sites_externos: true })
  );
  assert.deepEqual(pol.URLBlocklist, ["*"]);
  assert.ok(pol.URLAllowlist.includes("prenotami.esteri.it"));

  const bm = JSON.parse(buildChromiumInitialBookmarks(5402, DEFAULT_CONFIG.chromium));
  assert.equal(bm.roots.bookmark_bar.children.length, 6);
});

test("otpReader extracts OTP from noreply-prenotami@esteri.it and blocks private IMAP hosts", () => {
  const code = extractOtpFromEmailText(
    "Prenot@Mi - Codice OTP",
    "Il tuo codice di verifica OTP e: 482910",
    "noreply-prenotami@esteri.it"
  );
  assert.equal(code, "482910");

  const unrelated = extractOtpFromEmailText(
    "Promo",
    "Cupom 123456 hoje",
    "promo@loja.com"
  );
  assert.equal(unrelated, null);

  const saved = reportCapturedOtp({
    code: "654321",
    from: "noreply-prenotami@esteri.it",
    source: "imap",
  });
  assert.equal(saved?.code, "654321");

  assert.equal(inferImapHost("user@gmail.com"), "imap.gmail.com");
  assert.equal(inferImapHost("user@gmail.com", "127.0.0.1"), null);
  assert.equal(inferImapHost("user@gmail.com", "169.254.169.254"), null);
});

test("releaseBuilder generates 1-click launchers and strips secrets from release configs", () => {
  const scripts = buildPortableStartScripts(5402, DEFAULT_CONFIG.chromium);
  assert.match(scripts.bat, /dist-server\\server\.mjs/);
  assert.match(scripts.bat, /iniciar-prenotabot-chromium\.bat/);
  assert.match(scripts.sh, /dist-server\/server\.mjs/);
  assert.match(scripts.sh, /iniciar-prenotabot-chromium\.sh/);

  const emptyEnv = buildEmptyEnvMap();
  assert.equal(emptyEnv.PRENOTAMI_SENHA, "");
  assert.equal(emptyEnv.IMAP_SENHA_APP, "");

  const dirty = structuredClone(DEFAULT_CONFIG);
  dirty.dados.endereco = "Rua Privada 999";
  const sanitized = buildSanitizedReleaseConfig(dirty, true);
  assert.equal(sanitized.dados.endereco, "");

  if (
    fs.existsSync(path.join(DIST_DIR, "index.html")) &&
    fs.existsSync(DIST_SERVER_FILE)
  ) {
    const zipBuf = createPortableReleaseZip(dirty, {
      sanitizeForPublicRelease: true,
    });
    assert.equal(zipBuf.readUInt32LE(0), 0x04034b50);
    assert.ok(zipBuf.includes("PrenotaBot-Livre/INICIAR-AQUI.bat"));
    assert.ok(zipBuf.includes("PrenotaBot-Livre/iniciar-aqui.sh"));
    assert.ok(zipBuf.includes("PrenotaBot-Livre/dist-server/server.mjs"));
    assert.ok(zipBuf.includes("PrenotaBot-Livre/dist/index.html"));
    assert.ok(zipBuf.includes("PrenotaBot-Livre/extensao_android/manifest.json"));
    assert.ok(!zipBuf.includes("Rua Privada 999"));
  }
});



