import fs from "node:fs";
import path from "node:path";
import {
  BOOKING_URL,
  BotConfig,
  CATALOG_PATH,
  ENV_KEYS,
  EnvMap,
  LOGS_DIR,
  LOG_FILE,
  SERVICES_CACHE,
  SITE,
  UNAVAILABLE_HINTS,
  ensureDirs,
  inTimeWindow,
  loadConfig,
  loadEnv,
  normalize,
  notify,
  profilePath,
  recordHistory,
  sanitizePrenotamiBookingUrl,
  secondsUntilScheduledStart,
} from "./core.ts";

export interface LogEntry {
  id: number;
  time: string;
  level: "INFO" | "WARNING" | "ERROR" | "OK";
  message: string;
}

export interface RadarTriggerEvent {
  at: string;
  sender: string;
  message: string;
  bookingUrl: string;
}

export interface RunnerState {
  running: boolean;
  discovering: boolean;
  bigStatus: string;
  statusLine: string;
  attempts: number;
  lastAttemptAt: string | null;
  beepSeq: number;
  profile: string;
  lastRadarTrigger: RadarTriggerEvent | null;
  logs: LogEntry[];
}

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export class PrenotaBotRunner {
  private state: RunnerState = {
    running: false,
    discovering: false,
    bigStatus: "Parado",
    statusLine: "Pronto.",
    attempts: 0,
    lastAttemptAt: null,
    beepSeq: 0,
    profile: "",
    lastRadarTrigger: null,
    logs: [],
  };
  private logSeq = 0;
  private abortCtrl: AbortController | null = null;
  private stopped = false;

  getState(): RunnerState {
    return {
      ...this.state,
      logs: [...this.state.logs],
    };
  }

  addLog(level: LogEntry["level"], message: string): void {
    const time = nowStamp();
    const entry: LogEntry = {
      id: ++this.logSeq,
      time,
      level,
      message,
    };
    this.state.logs.push(entry);
    if (this.state.logs.length > 1000) {
      this.state.logs.splice(0, this.state.logs.length - 1000);
    }
    try {
      ensureDirs();
      fs.appendFileSync(
        LOG_FILE,
        `${time} [${level}] ${message}\n`,
        "utf-8"
      );
    } catch {
      // ignore disk write errors in ephemeral env
    }
  }

  private async sleep(seconds: number): Promise<boolean> {
    if (this.stopped) return false;
    const ms = Math.max(0, Math.round(seconds * 1000));
    if (ms === 0) return !this.stopped;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.abortCtrl?.signal.removeEventListener("abort", onAbort);
        resolve(!this.stopped);
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve(false);
      };
      this.abortCtrl?.signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private triggerAlert(
    cfg: BotConfig,
    env: EnvMap,
    msg: string,
    sendExternal = true,
    important = true
  ): void {
    this.addLog("OK", "==================================================");
    this.addLog("OK", msg);
    this.addLog("OK", "==================================================");
    this.state.statusLine = msg;
    if (msg.includes("VAGA") || msg.includes("CONCLUIDO")) {
      this.state.bigStatus = msg;
    }
    if (cfg.alerta_sonoro) {
      this.state.beepSeq += 1;
    }
    if (sendExternal) {
      void notify(env, `PrenotaBot: ${msg}`, important, (w) =>
        this.addLog("WARNING", w)
      );
    }
  }

  triggerRadarWhatsapp(
    profileName: string,
    sender: string,
    message: string,
    rawBookingUrl?: string
  ): RadarTriggerEvent {
    const cfg = loadConfig(profilePath(profileName));
    const env = loadEnv();
    const primarySid = cfg.servicos[0] ?? 5402;
    const bookingUrl = sanitizePrenotamiBookingUrl(rawBookingUrl, primarySid);
    const cleanSender = String(sender || cfg.radar_whatsapp.numero_radar || "+55 47 92004-1774")
      .trim()
      .slice(0, 80);
    const cleanMsg = String(message || "Vaga detectada no Radar WhatsApp")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);

    const evt: RadarTriggerEvent = {
      at: nowStamp(),
      sender: cleanSender,
      message: cleanMsg,
      bookingUrl,
    };
    this.state.lastRadarTrigger = evt;

    const alertText = `VAGA NO RADAR WHATSAPP (${cleanSender}): "${cleanMsg}" -> Abrir ${bookingUrl} (autofill ativo, confirmação e data manuais).`;
    this.triggerAlert(
      cfg,
      env,
      alertText,
      cfg.radar_whatsapp.notificar_push !== false,
      true
    );
    recordHistory(primarySid, "radar_whatsapp");
    return evt;
  }

  private async probeService(
    sid: number,
    timeoutSec = 60
  ): Promise<{ state: string; detail?: string }> {
    const url = BOOKING_URL.replace("{id}", String(sid));
    try {
      const resp = await fetch(url, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          "Accept-Language": "pt-BR,pt;q=0.9,it;q=0.8,en;q=0.7",
        },
        signal: AbortSignal.any([
          AbortSignal.timeout(Math.max(15, timeoutSec) * 1000),
          ...(this.abortCtrl ? [this.abortCtrl.signal] : []),
        ]),
      });

      const location = (resp.headers.get("location") ?? "").toLowerCase();
      if (
        location.includes("perfdrive") ||
        location.includes("validate.") ||
        location.includes("captcha")
      ) {
        return { state: "captcha", detail: location };
      }
      if (location.includes("/error")) {
        return { state: "bloqueado", detail: location };
      }
      if (
        location.includes("iam.esteri.it") ||
        location.includes("signin") ||
        location.includes("login") ||
        resp.status === 401 ||
        resp.status === 403
      ) {
        return { state: "deslogado", detail: location || `HTTP ${resp.status}` };
      }
      if (location.includes("/bookingcalendar")) {
        return { state: "calendario", detail: location };
      }
      if (resp.status >= 500) {
        return { state: "lentidao", detail: `HTTP ${resp.status}` };
      }

      const html = await resp.text();
      const lower = html.toLowerCase();
      const norm = normalize(html.replace(/<[^>]+>/g, " "));

      if (lower.includes("perfdrive") || lower.includes("radware")) {
        return { state: "captcha" };
      }
      if (lower.includes('id="login-email"') || lower.includes('id="pingid-button"')) {
        return { state: "deslogado" };
      }
      if (
        lower.includes('id="btnavanti"') ||
        lower.includes('id="privacycheck"') ||
        lower.includes('id="typeofbookingddl"')
      ) {
        return { state: "disponivel" };
      }
      if (UNAVAILABLE_HINTS.some((h) => norm.includes(h))) {
        return { state: "indisponivel" };
      }
      if (resp.status >= 400) {
        return { state: "bloqueado", detail: `HTTP ${resp.status}` };
      }
      return { state: "desconhecido", detail: `HTTP ${resp.status}` };
    } catch (e) {
      if (this.stopped) return { state: "parado" };
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("aborted")) {
        return { state: "lentidao", detail: "tempo limite excedido" };
      }
      return {
        state: "desconhecido",
        detail: msg,
      };
    }
  }

  private async runDiscover(cfg: BotConfig): Promise<void> {
    this.addLog("INFO", "Consultando serviços em prenotami.esteri.it/Services...");
    try {
      const resp = await fetch(`${SITE}/Services`, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(20000),
      });
      const loc = (resp.headers.get("location") ?? "").toLowerCase();
      if (loc.includes("signin") || loc.includes("iam.esteri.it") || resp.status === 302) {
        this.addLog(
          "WARNING",
          "O Prenot@mi exige sessão autenticada (login manual no navegador) para listar serviços privados."
        );
        this.addLog(
          "INFO",
          "Exibindo o catálogo conhecido (catalogo_servicos.json). Use o navegador com a extensão/userscript após fazer seu login manual."
        );
      } else {
        const html = await resp.text();
        const regex = /href=["'][^"']*\/Services\/Booking\/(\d+)["'][^>]*>([^<]*)/gi;
        const found: Array<{ id: number; nome: string; descricao: string }> = [];
        let m: RegExpExecArray | null;
        while ((m = regex.exec(html)) !== null) {
          const id = Number(m[1]);
          if (id && !found.some((x) => x.id === id)) {
            found.push({ id, nome: `Serviço ${id}`, descricao: m[2].trim() });
          }
        }
        if (found.length > 0) {
          fs.writeFileSync(
            SERVICES_CACHE,
            JSON.stringify(found, null, 2),
            "utf-8"
          );
          this.addLog(
            "OK",
            `${found.length} serviços encontrados e salvos em ${path.basename(SERVICES_CACHE)}.`
          );
          return;
        }
      }
    } catch (e) {
      this.addLog(
        "WARNING",
        `Não foi possível consultar /Services diretamente: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    if (fs.existsSync(CATALOG_PATH)) {
      const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf-8")) as Array<{
        consulado: string;
        servicos: Array<{ id: number; nome: string }>;
      }>;
      let count = 0;
      for (const c of catalog) {
        for (const s of c.servicos) {
          this.addLog("INFO", `  ${String(s.id).padStart(5)} | ${c.consulado} - ${s.nome}`);
          count++;
        }
      }
      this.addLog("INFO", `Catálogo local carregado com ${count} serviços de referência.`);
    }
    if (!cfg.servicos.length) {
      this.addLog(
        "WARNING",
        "Nenhum serviço configurado neste perfil. Adicione um ID na aba Serviço (ex.: 5402 para SP Primeiro Passaporte)."
      );
    }
  }

  start(
    profileName: string,
    onlyDiscover = false,
    forceImmediate = false
  ): boolean {
    if (this.state.running) return false;
    this.stopped = false;
    this.abortCtrl = new AbortController();
    this.state.running = true;
    this.state.discovering = onlyDiscover;
    this.state.attempts = 0;
    this.state.profile = profileName;
    this.state.bigStatus = onlyDiscover
      ? "Listando serviços..."
      : forceImmediate
        ? "Monitorando (teste imediato)..."
        : "Aguardando horário / Monitorando...";
    this.state.statusLine = onlyDiscover
      ? "Consultando catálogo e serviços..."
      : forceImmediate
        ? "Iniciado imediatamente (modo teste)."
        : "Verificando horário agendado...";

    void this.loop(profileName, onlyDiscover, forceImmediate);
    return true;
  }

  stop(): void {
    if (!this.state.running) return;
    this.stopped = true;
    this.state.bigStatus = "Parando...";
    this.state.statusLine = "Parando monitoramento...";
    this.addLog("INFO", "Solicitação de parada recebida.");
    this.abortCtrl?.abort();
  }

  private async loop(
    profileName: string,
    onlyDiscover: boolean,
    forceImmediate: boolean
  ): Promise<void> {
    const cfg = loadConfig(profilePath(profileName));
    const env = loadEnv();

    try {
      this.addLog("INFO", `Perfil ativo: ${profileName}`);
      if (onlyDiscover || cfg.servicos.length === 0) {
        await this.runDiscover(cfg);
        return;
      }

      if (!forceImmediate) {
        const sched = secondsUntilScheduledStart(cfg);
        if (sched.waitSeconds > 0) {
          const totalMin = Math.ceil(sched.waitSeconds / 60);
          const hrs = Math.floor(totalMin / 60);
          const mins = totalMin % 60;
          const timeText = hrs > 0 ? `${hrs}h ${mins}min` : `${mins} min`;
          this.addLog(
            "INFO",
            `Modo agendado (${sched.timeZone}): iniciará automaticamente às ${sched.brasiliaLabel} BRT / ${sched.cuiabaLabel} Cuiabá-AM (${cfg.antecedencia_minutos} min antes de ${cfg.horario_alvo}). Faltam ~${timeText}. Use 'Iniciar agora (teste)' para testar imediatamente.`
          );
          while (!this.stopped) {
            const cur = secondsUntilScheduledStart(cfg);
            if (cur.waitSeconds <= 0) break;
            const totalS = Math.floor(cur.waitSeconds);
            const h = Math.floor(totalS / 3600);
            const m = Math.floor((totalS % 3600) / 60);
            const s = totalS % 60;
            const remStr = h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
            this.state.bigStatus = `Aguardando ${cur.brasiliaLabel} BRT / ${cur.cuiabaLabel} AMT (${remStr})`;
            this.state.statusLine = `Início programado: ${cur.brasiliaLabel} Brasília / ${cur.cuiabaLabel} Cuiabá-AM`;
            if (!(await this.sleep(Math.min(cur.waitSeconds, 15)))) break;
          }
          if (this.stopped) return;
          this.state.bigStatus = "Monitorando...";
        }
      } else {
        this.addLog("INFO", "Modo de teste imediato ativado (ignorando espera de horário).");
      }

      const maxT = Number(cfg.max_tentativas) || 0;
      let unknownStreak = 0;

      while (!this.stopped && (maxT === 0 || this.state.attempts < maxT)) {
        const [ok, waitSec] = inTimeWindow(cfg);
        if (!ok) {
          const mins = Math.ceil(waitSec / 60);
          this.addLog(
            "INFO",
            `Fora da janela de horário. Próxima verificação em ${mins} min.`
          );
          this.state.statusLine = `Aguardando janela de horário (${mins} min)`;
          if (!(await this.sleep(Math.min(waitSec, 900)))) break;
          continue;
        }

        for (const sid of cfg.servicos) {
          if (this.stopped) break;
          this.state.attempts += 1;
          this.state.lastAttemptAt = new Date().toLocaleTimeString("pt-BR", {
            hour12: false,
          });

          const res = await this.probeService(sid, cfg.timeout_pagina_segundos);
          const st = res.state;
          if (st === "parado") break;

          this.addLog(
            st === "disponivel" || st === "calendario"
              ? "OK"
              : st === "bloqueado" || st === "captcha" || st === "lentidao"
                ? "WARNING"
                : "INFO",
            `Tentativa ${this.state.attempts} | serviço ${sid}: ${st}${res.detail ? ` (${res.detail})` : ""}`
          );
          recordHistory(sid, st);
          this.state.statusLine = `Tentativa ${this.state.attempts} | serviço ${sid}: ${st}`;

          if (st === "disponivel" || st === "calendario") {
            this.triggerAlert(
              cfg,
              env,
              `VAGA ENCONTRADA no serviço ${sid}! Complete a confirmação e escolha a data manualmente no navegador.`
            );
            return;
          }

          if (st === "captcha") {
            this.addLog(
              "WARNING",
              "Captcha / verificação anti-robô detectado. O bot pausa e aguarda você resolver manualmente no navegador (sem burlar captcha)."
            );
            this.triggerAlert(
              cfg,
              env,
              "Captcha detectado no Prenot@mi. Resolva manualmente no navegador.",
              false,
              false
            );
            if (!(await this.sleep(60))) break;
          } else if (st === "lentidao") {
            this.addLog(
              "WARNING",
              `Lentidão ou erro temporário do servidor Prenot@mi (${res.detail}). Aguardando 20s para nova tentativa com segurança.`
            );
            if (!(await this.sleep(20))) break;
          } else if (st === "bloqueado") {
            const mins = Number(cfg.espera_bloqueio_minutos) || 10;
            this.addLog(
              "WARNING",
              `O site retornou página de bloqueio/erro (/Error). Aguardando ${mins} min antes de retomar...`
            );
            this.state.statusLine = `Bloqueio temporário - aguardando ${mins} min`;
            if (!(await this.sleep(mins * 60))) break;
          } else if (st === "deslogado") {
            this.addLog(
              "INFO",
              "Sessão não autenticada no servidor: faça o login manual no seu navegador com a extensão/userscript para manter os cookies ativos lá."
            );
          }

          unknownStreak = st === "desconhecido" ? unknownStreak + 1 : 0;
        }

        if (maxT > 0 && this.state.attempts >= maxT) break;
        const lo = cfg.intervalo_min_segundos;
        const hi = cfg.intervalo_max_segundos;
        let wait = lo + Math.random() * (hi - lo);
        if (unknownStreak >= 3) wait *= 2;
        this.addLog("INFO", `Próxima verificação em ${Math.round(wait)}s.`);
        if (!(await this.sleep(wait))) break;
      }

      this.addLog("INFO", "Monitoramento encerrado.");
    } catch (e) {
      this.addLog(
        "ERROR",
        `Erro inesperado: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      this.state.running = false;
      this.state.discovering = false;
      if (
        !this.state.bigStatus.startsWith("VAGA") &&
        !this.state.bigStatus.startsWith("AGENDAMENTO")
      ) {
        this.state.bigStatus = "Parado";
      }
      this.state.statusLine = "Pronto.";
      this.abortCtrl = null;
    }
  }
}

export const runner = new PrenotaBotRunner();
