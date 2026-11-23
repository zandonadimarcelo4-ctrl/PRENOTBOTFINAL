import fs from "node:fs";
import {
  BotConfig,
  CATALOG_PATH,
  DadosConfig,
  EnvMap,
  FILES_DIR,
  SERVICES_CACHE,
  SERVICE_PRESETS,
  SITE,
  buildReadinessReport,
  classifyLabel,
  historySummary,
  loadConfig,
  normalize,
  preflight,
  profilePath,
  resolveTimeZone,
  sanitizePrenotamiBookingUrl,
  saveConfig,
  secondsUntilScheduledStart,
} from "./core.ts";
import { ensureAndroidExtensionFiles } from "./extensionBuilder.ts";
import {
  ensureChromiumDedicatedTabs,
  getChromiumBridgeStatus,
  openChromiumBridgeTab,
  safeCdpPort,
  sanitizeCliArgText,
  sanitizeWebmailUrl,
} from "./chromiumBridge.ts";
import { fetchLatestPrenotamiOtpViaImap, getCachedOtp } from "./otpReader.ts";
import { RunnerState, runner } from "./runner.ts";

export interface AgentActionLog {
  step: number;
  tool: string;
  summary: string;
  ok: boolean;
}

export interface AgentResult {
  source: "openai" | "local";
  aiConfigured: boolean;
  mappedKey: keyof DadosConfig | null;
  suggestedValue: string;
  reply: string;
  actions: AgentActionLog[];
  updatedCfg?: BotConfig;
  updatedRunner?: RunnerState;
}

function targetForTz(tz: string): string {
  const utcMinus4 = new Set([
    "America/Cuiaba",
    "America/Manaus",
    "America/Campo_Grande",
    "America/Porto_Velho",
    "America/Boa_Vista",
  ]);
  return utcMinus4.has(tz) ? "15:00" : "16:00";
}

function isCaptchaEvasionRequest(text: string): boolean {
  const n = normalize(text);
  const evasionWords = [
    "burlar captcha",
    "sem detectar captcha",
    "captcha sem detectar",
    "evadir captcha",
    "pular captcha",
    "resolver captcha automatico",
    "radware",
    "anti-bot",
    "antibot",
    "bypass",
    "camuflar navegador",
    "fingerprint",
    "esconder robo",
    "ocultar robo",
  ];
  if (evasionWords.some((w) => n.includes(w))) return true;
  if (
    n.includes("captcha") &&
    (n.includes("sem detect") ||
      n.includes("tirar") ||
      n.includes("desativar") ||
      n.includes("burl") ||
      n.includes("menos robo"))
  ) {
    return true;
  }
  return false;
}

function redactConfigForAgent(cfg: BotConfig, env: Partial<EnvMap>, profile: string) {
  const schedule = secondsUntilScheduledStart(cfg);
  const preflightProblems = preflight(cfg, env);
  const uploadedFiles = fs.existsSync(FILES_DIR)
    ? fs.readdirSync(FILES_DIR).filter((f) => !f.startsWith("."))
    : [];
  const runnerSnap = runner.getState();

  return {
    perfil: profile,
    monitor_atual: {
      rodando: runnerSnap.running,
      status: runnerSnap.bigStatus,
      linha: runnerSnap.statusLine,
      tentativas: runnerSnap.attempts,
      ultimo_radar_wa: runnerSnap.lastRadarTrigger,
    },
    servicos: cfg.servicos,
    servicos_nomes: cfg.servicos.map(
      (id) => `${id}: ${SERVICE_PRESETS[id]?.nome ?? "Serviço personalizado"}`
    ),
    agendamento: {
      fuso_horario: cfg.fuso_horario,
      horario_alvo: cfg.horario_alvo,
      antecedencia_minutos: cfg.antecedencia_minutos,
      dias_semana: cfg.dias_semana,
      pre_inicio_brasilia: schedule.brasiliaLabel,
      pre_inicio_cuiaba_am: schedule.cuiabaLabel,
      segundos_ate_inicio: Math.round(schedule.waitSeconds),
      abas_agendamento: cfg.abas_agendamento,
      manter_primeira_aba: cfg.manter_primeira_aba,
      timeout_pagina_segundos: cfg.timeout_pagina_segundos,
      intervalo_min_segundos: cfg.intervalo_min_segundos,
      intervalo_max_segundos: cfg.intervalo_max_segundos,
    },
    radar_whatsapp: cfg.radar_whatsapp,
    chromium: cfg.chromium,
    prontidao: buildReadinessReport(cfg, env),
    seguranca_fluxo: {
      autofill_login: cfg.autofill_login,
      auto_login: false,
      preencher_formulario: cfg.preencher_formulario,
      clicar_avancar_automatico: false,
      auto_agendar_automatico: false,
    },
    dados_preenchidos: {
      endereco: cfg.dados.endereco || "(vazio)",
      altura_cm: cfg.dados.altura_cm || "(vazio)",
      estado_civil: cfg.dados.estado_civil || "(vazio)",
      cor_olhos: cfg.dados.cor_olhos || "(vazio)",
      filhos_menores: cfg.dados.filhos_menores,
      quantidade_filhos: cfg.dados.quantidade_filhos,
      passaporte_vencido: cfg.dados.passaporte_vencido,
      data_vencimento_passaporte: cfg.dados.data_vencimento_passaporte || "(vazio)",
    },
    acompanhantes_qtd: cfg.acompanhantes.length,
    documentos_configurados: cfg.documentos,
    arquivos_em_files: uploadedFiles,
    respostas_aprendidas_qtd: Object.keys(cfg.respostas_aprendidas).length,
    respostas_aprendidas: cfg.respostas_aprendidas,
    credenciais_definidas: {
      email_prenotami: Boolean(env.PRENOTAMI_EMAIL),
      senha_prenotami: Boolean(env.PRENOTAMI_SENHA),
      ntfy: Boolean(env.NTFY_TOPICO),
      telegram: Boolean(env.TELEGRAM_TOKEN && env.TELEGRAM_CHAT_ID),
      whatsapp: Boolean(env.WHATSAPP_APIKEY && env.WHATSAPP_TELEFONE),
    },
    pendencias_preflight: preflightProblems,
    historico: historySummary(),
  };
}

function searchCatalog(query: string) {
  const q = normalize(query);
  const matches: Array<{ id: number; consulado: string; nome: string }> = [];
  for (const [idStr, p] of Object.entries(SERVICE_PRESETS)) {
    const id = Number(idStr);
    if (!q || normalize(p.nome).includes(q) || String(id).includes(q)) {
      matches.push({ id, consulado: "Preset SP/CTB/BH", nome: p.nome });
    }
  }
  if (fs.existsSync(SERVICES_CACHE)) {
    try {
      const list = JSON.parse(fs.readFileSync(SERVICES_CACHE, "utf-8")) as Array<{
        id: number;
        nome: string;
        descricao?: string;
      }>;
      for (const s of list) {
        if (!q || normalize(s.nome).includes(q) || String(s.id).includes(q)) {
          matches.push({ id: s.id, consulado: "Minha Conta", nome: s.nome });
        }
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
          if (
            !q ||
            normalize(c.consulado).includes(q) ||
            normalize(s.nome).includes(q) ||
            String(s.id).includes(q)
          ) {
            matches.push({ id: s.id, consulado: c.consulado, nome: s.nome });
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return matches.slice(0, 15);
}

async function probePrenotamiStatus() {
  const started = Date.now();
  try {
    const resp = await fetch(`${SITE}/`, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9,it;q=0.8",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    const elapsedMs = Date.now() - started;
    const body = await resp.text().catch(() => "");
    const low = body.toLowerCase();
    return {
      ok: resp.status < 500,
      status: resp.status,
      elapsedMs,
      slow: elapsedMs > 5000,
      hasServerError: resp.status >= 500 || low.includes("/error"),
      hasCaptcha: low.includes("captcha") || low.includes("radware"),
      summary: `HTTP ${resp.status} em ${elapsedMs}ms${elapsedMs > 5000 ? " (portal lento)" : ""}`,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Date.now() - started,
      slow: true,
      hasServerError: true,
      hasCaptcha: false,
      summary: `Falha/timeout após ${Date.now() - started}ms: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function extractLabelsFromInput(raw: string): string[] {
  const labels = new Set<string>();
  const labelTagRe = /<label[^>]*>([\s\S]*?)<\/label>/gi;
  let m: RegExpExecArray | null;
  while ((m = labelTagRe.exec(raw)) !== null) {
    const clean = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (clean && clean.length <= 180) labels.add(clean);
  }
  const attrRe = /(?:placeholder|aria-label|title)=["']([^"']{2,140})["']/gi;
  while ((m = attrRe.exec(raw)) !== null) {
    labels.add(m[1].trim());
  }
  if (labels.size === 0) {
    for (const line of raw.split(/\r?\n|;/)) {
      const clean = line.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (clean && clean.length >= 2 && clean.length <= 180) {
        labels.add(clean);
      }
    }
  }
  return Array.from(labels).slice(0, 20);
}

const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "inspect_profile",
      description:
        "Inspeciona o perfil ativo, o estado atual do monitor (rodando/parado), o Radar WhatsApp PC, o fuso horário (16:00 BRT / 15:00 Cuiabá-AM), dados e pendências.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "update_safe_config",
      description:
        "Atualiza com segurança configurações do perfil (fuso, horário, serviços, intervalos >=20s, dados do formulário, Radar WhatsApp PC) e sincroniza a extensão/userscript. Mantém login, confirmação final e calendário manuais.",
      parameters: {
        type: "object",
        properties: {
          fuso_horario: { type: "string" },
          horario_alvo: { type: "string" },
          antecedencia_minutos: { type: "number", minimum: 1, maximum: 10 },
          dias_semana: { type: "array", items: { type: "number" } },
          servicos: { type: "array", items: { type: "number" } },
          intervalo_min_segundos: { type: "number", minimum: 20, maximum: 300 },
          intervalo_max_segundos: { type: "number", minimum: 20, maximum: 600 },
          abas_agendamento: { type: "number", minimum: 1, maximum: 3 },
          timeout_pagina_segundos: { type: "number", minimum: 20, maximum: 180 },
          manter_primeira_aba: { type: "boolean" },
          autofill_login: { type: "boolean" },
          preencher_formulario: { type: "boolean" },
          alerta_sonoro: { type: "boolean" },
          radar_whatsapp_patch: {
            type: "object",
            properties: {
              ativo: { type: "boolean" },
              numero_radar: { type: "string" },
              abrir_automatico: { type: "boolean" },
              notificar_push: { type: "boolean" },
            },
            additionalProperties: false,
          },
          chromium_patch: {
            type: "object",
            properties: {
              navegador: {
                type: "string",
                enum: ["chromium", "ungoogled-chromium", "brave", "edge", "chrome", "custom"],
              },
              porta_cdp: { type: "number", minimum: 1024, maximum: 65535 },
              diretorio_perfil: { type: "string" },
              abrir_whatsapp_ao_iniciar: { type: "boolean" },
              abrir_painel_ao_iniciar: { type: "boolean" },
              abrir_webmail_ao_iniciar: { type: "boolean" },
              url_webmail: { type: "string" },
              abrir_abas_extras: { type: "number", minimum: 0, maximum: 3 },
              idioma: { type: "string" },
              modo_dedicado: { type: "boolean" },
              bloquear_sites_externos: { type: "boolean" },
              auto_otp_email: { type: "boolean" },
            },
            additionalProperties: false,
          },
          dados_patch: {
            type: "object",
            properties: {
              endereco: { type: "string" },
              altura_cm: { type: "string" },
              estado_civil: { type: "string" },
              cor_olhos: { type: "string" },
              filhos_menores: { type: "string" },
              quantidade_filhos: { type: "string" },
              passaporte_vencido: { type: "string" },
              data_vencimento_passaporte: { type: "string" },
              observacoes: { type: "string" },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "learn_form_answers",
      description:
        "Extrai rótulos de HTML/texto do formulário Prenot@mi e salva respostas aprendidas na memória de autofill (respostas_aprendidas).",
      parameters: {
        type: "object",
        properties: {
          html_or_labels: { type: "string" },
          entries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                answer: { type: "string" },
              },
              required: ["label", "answer"],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "control_monitor",
      description:
        "Controla diretamente o monitor do servidor: inicia agendamento programado (1-2 min antes da abertura), inicia teste imediato, descobre serviços ou para o monitoramento.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["start_scheduled", "start_immediate_test", "start_discover", "stop"],
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trigger_radar_alert",
      description:
        "Interpreta e dispara um aviso de vaga do Radar WhatsApp (+55 47 92004-1774 / prenotamiradar.com.br) no painel, tocando alarme, enviando push e gerando o link seguro de prenotami.esteri.it.",
      parameters: {
        type: "object",
        properties: {
          sender: { type: "string" },
          message: { type: "string" },
          booking_url: { type: "string" },
        },
        required: ["message"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_prenotami_status",
      description:
        "Faz uma verificação única e respeitosa do status HTTP e latência atual do portal https://prenotami.esteri.it/.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_service_catalog",
      description:
        "Pesquisa IDs de serviços no catálogo do Prenot@mi por cidade, consulado ou nome.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "inspect_chromium_tabs",
      description:
        "Verifica se o navegador Chromium de código aberto está conectado localmente via CDP (127.0.0.1) e lista as guias abertas (Prenot@mi / WhatsApp Web).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "open_chromium_booking_tab",
      description:
        "Abre uma nova aba no Chromium local conectado (apenas https://prenotami.esteri.it/*, https://web.whatsapp.com/* ou webmail OTP), mantendo a 1ª aba intacta.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            enum: ["booking", "login", "whatsapp", "webmail"],
          },
        },
        required: ["target"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_prenotami_otp",
      description:
        "Consulta o último código OTP recebido de <noreply-prenotami@esteri.it> via Webmail ou IMAP.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
] as const;

export async function runConsularAgent(params: {
  mode: "readiness" | "map_field" | "chat" | "autonomous";
  prompt: string;
  fieldLabel: string;
  profile: string;
  env: EnvMap;
}): Promise<AgentResult> {
  const { mode, prompt, fieldLabel, profile, env } = params;
  const pPath = profilePath(profile);
  let cfg = loadConfig(pPath);
  let cfgModified = false;
  let runnerModified = false;
  const actions: AgentActionLog[] = [];
  let stepCounter = 0;

  const combinedInput = `${prompt} ${fieldLabel}`.trim();
  const mappedField = fieldLabel ? classifyLabel(fieldLabel) : null;

  if (isCaptchaEvasionRequest(combinedInput)) {
    return {
      source: "local",
      aiConfigured: Boolean((process.env.OPENAI_API_KEY ?? "").trim()),
      mappedKey: mappedField,
      suggestedValue: mappedField ? cfg.dados[mappedField] : "",
      actions: [
        {
          step: 1,
          tool: "safety_policy",
          summary: "Bloqueado pedido de evasão de CAPTCHA / ocultação anti-robô",
          ok: false,
        },
      ],
      reply: [
        "Não posso implementar técnicas para burlar, ocultar ou evitar a detecção de CAPTCHA / Radware no Prenot@mi.",
        "",
        "Como o Agente Principal reduz falhas e acelera sua resposta de forma legítima e segura:",
        "• Coordena todo o fluxo em um só lugar: ajusta fuso (16:00 Brasília = 15:00 Cuiabá-AM), checa latência do portal, sincroniza o Radar WhatsApp Web (+55 47 92004-1774) e inicia/para o monitor sob comando natural.",
        "• Mantém intervalos respeitosos (>= 20s) e tolerância a lentidão (timeout 60s), evitando tempestades de requisições que geram páginas /Error.",
        "• Preenche login (entrada manual) e formulários adaptativamente, preservando confirmação final e calendário manuais e pausando imediatamente em caso de CAPTCHA.",
      ].join("\n"),
    };
  }

  const executeTool = async (
    name: string,
    rawArgs: Record<string, any>
  ): Promise<string> => {
    stepCounter += 1;
    if (name === "inspect_profile") {
      const snap = redactConfigForAgent(cfg, env, profile);
      actions.push({
        step: stepCounter,
        tool: "inspect_profile",
        summary: `Perfil '${profile}' auditado (${snap.pendencias_preflight.length} pendência(s), monitor ${snap.monitor_atual.rodando ? "ativo" : "parado"})`,
        ok: true,
      });
      return JSON.stringify(snap);
    }

    if (name === "update_safe_config") {
      const next = structuredClone(cfg);
      const changed: string[] = [];

      if (typeof rawArgs.fuso_horario === "string" && rawArgs.fuso_horario.trim()) {
        next.fuso_horario = resolveTimeZone(rawArgs.fuso_horario);
        changed.push(`fuso=${next.fuso_horario}`);
      }
      if (typeof rawArgs.horario_alvo === "string" && /^\d{1,2}:\d{2}$/.test(rawArgs.horario_alvo.trim())) {
        next.horario_alvo = rawArgs.horario_alvo.trim();
        changed.push(`horario=${next.horario_alvo}`);
      } else if (rawArgs.fuso_horario && !rawArgs.horario_alvo) {
        next.horario_alvo = targetForTz(next.fuso_horario);
        changed.push(`horario=${next.horario_alvo}`);
      }
      if (typeof rawArgs.antecedencia_minutos === "number") {
        next.antecedencia_minutos = Math.min(10, Math.max(1, Math.round(rawArgs.antecedencia_minutos)));
        changed.push(`antecedencia=${next.antecedencia_minutos}m`);
      }
      if (Array.isArray(rawArgs.dias_semana)) {
        const cleanDays = rawArgs.dias_semana
          .map(Number)
          .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
        if (cleanDays.length) {
          next.dias_semana = Array.from(new Set(cleanDays)).sort();
          changed.push(`dias=[${next.dias_semana.join(",")}]`);
        }
      }
      if (Array.isArray(rawArgs.servicos)) {
        const cleanIds = rawArgs.servicos
          .map(Number)
          .filter((s) => Number.isInteger(s) && s > 0);
        if (cleanIds.length) {
          next.servicos = Array.from(new Set(cleanIds));
          changed.push(`servicos=[${next.servicos.join(",")}]`);
        }
      }
      if (typeof rawArgs.intervalo_min_segundos === "number") {
        next.intervalo_min_segundos = Math.min(300, Math.max(20, Math.round(rawArgs.intervalo_min_segundos)));
        changed.push(`min=${next.intervalo_min_segundos}s`);
      }
      if (typeof rawArgs.intervalo_max_segundos === "number") {
        next.intervalo_max_segundos = Math.max(
          next.intervalo_min_segundos,
          Math.min(600, Math.round(rawArgs.intervalo_max_segundos))
        );
        changed.push(`max=${next.intervalo_max_segundos}s`);
      }
      if (typeof rawArgs.abas_agendamento === "number") {
        next.abas_agendamento = Math.min(3, Math.max(1, Math.round(rawArgs.abas_agendamento)));
        changed.push(`abas=${next.abas_agendamento}`);
      }
      if (typeof rawArgs.timeout_pagina_segundos === "number") {
        next.timeout_pagina_segundos = Math.min(180, Math.max(20, Math.round(rawArgs.timeout_pagina_segundos)));
        changed.push(`timeout=${next.timeout_pagina_segundos}s`);
      }
      if (typeof rawArgs.manter_primeira_aba === "boolean") {
        next.manter_primeira_aba = rawArgs.manter_primeira_aba;
        changed.push(`manter_1a_aba=${next.manter_primeira_aba}`);
      }
      if (typeof rawArgs.autofill_login === "boolean") {
        next.autofill_login = rawArgs.autofill_login;
      }
      if (typeof rawArgs.preencher_formulario === "boolean") {
        next.preencher_formulario = rawArgs.preencher_formulario;
      }
      if (typeof rawArgs.alerta_sonoro === "boolean") {
        next.alerta_sonoro = rawArgs.alerta_sonoro;
      }
      if (rawArgs.radar_whatsapp_patch && typeof rawArgs.radar_whatsapp_patch === "object") {
        const rp = rawArgs.radar_whatsapp_patch;
        if (typeof rp.ativo === "boolean") next.radar_whatsapp.ativo = rp.ativo;
        if (typeof rp.numero_radar === "string" && rp.numero_radar.trim()) {
          next.radar_whatsapp.numero_radar = rp.numero_radar.trim().slice(0, 40);
        }
        if (typeof rp.abrir_automatico === "boolean") {
          next.radar_whatsapp.abrir_automatico = rp.abrir_automatico;
        }
        if (typeof rp.notificar_push === "boolean") {
          next.radar_whatsapp.notificar_push = rp.notificar_push;
        }
        changed.push(`radar_wa=${next.radar_whatsapp.ativo ? "on" : "off"}`);
      }
      if (rawArgs.chromium_patch && typeof rawArgs.chromium_patch === "object") {
        const cp = rawArgs.chromium_patch;
        const allowedNav = new Set([
          "chromium",
          "ungoogled-chromium",
          "brave",
          "edge",
          "chrome",
          "custom",
        ]);
        if (typeof cp.navegador === "string" && allowedNav.has(cp.navegador)) {
          next.chromium.navegador = cp.navegador;
        }
        if (typeof cp.porta_cdp === "number") {
          next.chromium.porta_cdp = safeCdpPort(cp.porta_cdp);
        }
        if (typeof cp.diretorio_perfil === "string" && cp.diretorio_perfil.trim()) {
          next.chromium.diretorio_perfil = sanitizeCliArgText(
            cp.diretorio_perfil,
            "chromium_perfil"
          );
        }
        if (typeof cp.abrir_whatsapp_ao_iniciar === "boolean") {
          next.chromium.abrir_whatsapp_ao_iniciar = cp.abrir_whatsapp_ao_iniciar;
        }
        if (typeof cp.abrir_painel_ao_iniciar === "boolean") {
          next.chromium.abrir_painel_ao_iniciar = cp.abrir_painel_ao_iniciar;
        }
        if (typeof cp.abrir_webmail_ao_iniciar === "boolean") {
          next.chromium.abrir_webmail_ao_iniciar = cp.abrir_webmail_ao_iniciar;
        }
        if (typeof cp.url_webmail === "string" && cp.url_webmail.trim()) {
          next.chromium.url_webmail = sanitizeWebmailUrl(cp.url_webmail);
        }
        if (typeof cp.abrir_abas_extras === "number") {
          next.chromium.abrir_abas_extras = Math.min(
            3,
            Math.max(0, Math.round(cp.abrir_abas_extras))
          );
        }
        if (typeof cp.idioma === "string" && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(cp.idioma.trim())) {
          next.chromium.idioma = cp.idioma.trim();
        }
        if (typeof cp.modo_dedicado === "boolean") {
          next.chromium.modo_dedicado = cp.modo_dedicado;
        }
        if (typeof cp.bloquear_sites_externos === "boolean") {
          next.chromium.bloquear_sites_externos = cp.bloquear_sites_externos;
        }
        if (typeof cp.auto_otp_email === "boolean") {
          next.chromium.auto_otp_email = cp.auto_otp_email;
        }
        changed.push(`chromium=${next.chromium.navegador}:${next.chromium.porta_cdp}`);
      }
      if (rawArgs.dados_patch && typeof rawArgs.dados_patch === "object") {
        const allowedKeys: Array<keyof DadosConfig> = [
          "endereco",
          "altura_cm",
          "estado_civil",
          "cor_olhos",
          "filhos_menores",
          "quantidade_filhos",
          "passaporte_vencido",
          "data_vencimento_passaporte",
          "observacoes",
        ];
        for (const k of allowedKeys) {
          if (typeof rawArgs.dados_patch[k] === "string") {
            next.dados[k] = rawArgs.dados_patch[k].trim();
            changed.push(`dados.${k}`);
          }
        }
      }

      next.auto_login = false;
      next.clicar_avancar = false;
      next.auto_agendar = false;

      saveConfig(next, pPath);
      cfg = loadConfig(pPath);
      ensureAndroidExtensionFiles(cfg, env);
      cfgModified = true;

      const summary = changed.length
        ? `Configuração atualizada e extensão sincronizada (${changed.join(", ")})`
        : "Configuração validada com parâmetros seguros";
      actions.push({ step: stepCounter, tool: "update_safe_config", summary, ok: true });
      return JSON.stringify({ ok: true, changed, agendamento: secondsUntilScheduledStart(cfg) });
    }

    if (name === "learn_form_answers") {
      const next = structuredClone(cfg);
      const extracted =
        typeof rawArgs.html_or_labels === "string" && rawArgs.html_or_labels.trim()
          ? extractLabelsFromInput(rawArgs.html_or_labels)
          : [];
      const classified = extracted.map((lbl) => {
        const key = classifyLabel(lbl);
        return {
          label: lbl,
          mappedKey: key,
          currentProfileValue: key ? next.dados[key] : next.respostas_aprendidas[normalize(lbl)] ?? "",
        };
      });

      const savedKeys: string[] = [];
      if (Array.isArray(rawArgs.entries)) {
        for (const item of rawArgs.entries) {
          const lbl = normalize(item?.label);
          const ans = String(item?.answer ?? "").trim();
          if (lbl && ans) {
            next.respostas_aprendidas[lbl] = ans;
            savedKeys.push(`${lbl}="${ans}"`);
          }
        }
      }

      if (savedKeys.length > 0) {
        saveConfig(next, pPath);
        cfg = loadConfig(pPath);
        ensureAndroidExtensionFiles(cfg, env);
        cfgModified = true;
      }

      const summary = savedKeys.length
        ? `${savedKeys.length} resposta(s) salva(s) na memória de autofill`
        : `${classified.length} rótulo(s) analisado(s) do HTML/formulário`;
      actions.push({ step: stepCounter, tool: "learn_form_answers", summary, ok: true });
      return JSON.stringify({ ok: true, classified, savedKeys });
    }

    if (name === "control_monitor") {
      const act = String(rawArgs.action ?? "");
      runnerModified = true;
      if (act === "stop") {
        runner.stop();
        actions.push({
          step: stepCounter,
          tool: "control_monitor",
          summary: "Monitoramento parado pelo agente",
          ok: true,
        });
        return JSON.stringify({ ok: true, action: "stop", state: runner.getState().bigStatus });
      }
      if (act === "start_discover") {
        const ok = runner.start(profile, true, true);
        actions.push({
          step: stepCounter,
          tool: "control_monitor",
          summary: ok ? "Listagem de serviços iniciada pelo agente" : "Monitor já estava em execução",
          ok,
        });
        return JSON.stringify({ ok, action: act });
      }
      if (act === "start_immediate_test") {
        const ok = runner.start(profile, false, true);
        if (ok) {
          void ensureChromiumDedicatedTabs(cfg.servicos[0] ?? 5402, cfg.chromium);
        }
        actions.push({
          step: stepCounter,
          tool: "control_monitor",
          summary: ok ? "Monitoramento imediato (teste) + abas Chromium iniciados pelo agente" : "Monitor já estava em execução",
          ok,
        });
        return JSON.stringify({ ok, action: act });
      }
      if (act === "start_scheduled") {
        const ok = runner.start(profile, false, false);
        if (ok) {
          void ensureChromiumDedicatedTabs(cfg.servicos[0] ?? 5402, cfg.chromium);
        }
        const sched = secondsUntilScheduledStart(cfg);
        actions.push({
          step: stepCounter,
          tool: "control_monitor",
          summary: ok
            ? `Monitor agendado iniciado (${sched.brasiliaLabel} BRT / ${sched.cuiabaLabel} Cuiabá-AM)`
            : "Monitor já estava em execução",
          ok,
        });
        return JSON.stringify({ ok, action: act, schedule: sched });
      }
      actions.push({
        step: stepCounter,
        tool: "control_monitor",
        summary: `Ação inválida: ${act}`,
        ok: false,
      });
      return JSON.stringify({ ok: false, error: "Invalid action" });
    }

    if (name === "trigger_radar_alert") {
      const sid = cfg.servicos[0] ?? 5402;
      const safeUrl = sanitizePrenotamiBookingUrl(rawArgs.booking_url, sid);
      const evt = runner.triggerRadarWhatsapp(
        profile,
        String(rawArgs.sender ?? cfg.radar_whatsapp.numero_radar ?? "+55 47 92004-1774"),
        String(rawArgs.message ?? "Alerta interpretado pelo Agente Consular"),
        safeUrl
      );
      runnerModified = true;
      actions.push({
        step: stepCounter,
        tool: "trigger_radar_alert",
        summary: `Alerta Radar WhatsApp acionado -> ${evt.bookingUrl}`,
        ok: true,
      });
      return JSON.stringify({ ok: true, trigger: evt });
    }

    if (name === "check_prenotami_status") {
      const probe = await probePrenotamiStatus();
      actions.push({
        step: stepCounter,
        tool: "check_prenotami_status",
        summary: probe.summary,
        ok: probe.ok,
      });
      return JSON.stringify(probe);
    }

    if (name === "list_service_catalog") {
      const q = String(rawArgs.query ?? "");
      const results = searchCatalog(q);
      actions.push({
        step: stepCounter,
        tool: "list_service_catalog",
        summary: `${results.length} serviço(s) encontrado(s) para "${q || "todos"}"`,
        ok: true,
      });
      return JSON.stringify({ results });
    }

    if (name === "inspect_chromium_tabs") {
      const cdp = await getChromiumBridgeStatus(cfg.chromium?.porta_cdp);
      actions.push({
        step: stepCounter,
        tool: "inspect_chromium_tabs",
        summary: cdp.connected
          ? `${cdp.browser} conectado (${cdp.tabs.length} aba(s))`
          : `Chromium CDP desconectado (porta ${cdp.port})`,
        ok: cdp.connected,
      });
      return JSON.stringify(cdp);
    }

    if (name === "open_chromium_booking_tab") {
      const t = String(rawArgs.target ?? "booking");
      const sid = cfg.servicos[0] ?? 5402;
      const targetUrl =
        t === "whatsapp"
          ? "https://web.whatsapp.com/"
          : t === "webmail"
            ? sanitizeWebmailUrl(cfg.chromium?.url_webmail)
            : t === "login"
              ? `${SITE}/`
              : `${SITE}/Services/Booking/${sid}`;
      const res = await openChromiumBridgeTab(targetUrl, cfg.chromium?.porta_cdp);
      actions.push({
        step: stepCounter,
        tool: "open_chromium_booking_tab",
        summary: res.ok
          ? `Aba aberta no Chromium: ${res.url}`
          : `Falha ao abrir no Chromium: ${res.error}`,
        ok: res.ok,
      });
      return JSON.stringify(res);
    }

    if (name === "check_prenotami_otp") {
      const cached = getCachedOtp();
      if (cached && cached.isFresh) {
        actions.push({
          step: stepCounter,
          tool: "check_prenotami_otp",
          summary: `OTP em cache (${cached.source}): ${cached.code}`,
          ok: true,
        });
        return JSON.stringify({ ok: true, otp: cached });
      }
      const res = await fetchLatestPrenotamiOtpViaImap(env, true);
      actions.push({
        step: stepCounter,
        tool: "check_prenotami_otp",
        summary: res.otp
          ? `OTP encontrado via ${res.otp.source}: ${res.otp.code}`
          : res.error || "Nenhum OTP recente de noreply-prenotami@esteri.it",
        ok: Boolean(res.otp),
      });
      return JSON.stringify(res);
    }

    actions.push({
      step: stepCounter,
      tool: name,
      summary: "Ferramenta desconhecida ignorada",
      ok: false,
    });
    return JSON.stringify({ error: "Unknown tool" });
  };

  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();

  // Sem OPENAI_API_KEY: executor de intenções locais inteligente em múltiplas etapas
  if (!apiKey) {
    const out: string[] = [];
    const lowPrompt = normalize(prompt);

    if (mode === "autonomous" || mode === "readiness") {
      await executeTool("inspect_profile", {});
      if (mode === "autonomous") {
        const tz = resolveTimeZone(cfg.fuso_horario);
        await executeTool("update_safe_config", {
          fuso_horario: tz,
          horario_alvo: targetForTz(tz),
          antecedencia_minutos: 2,
          dias_semana: [1],
          servicos: cfg.servicos.length ? cfg.servicos : [5402],
          abas_agendamento: Math.min(3, Math.max(2, cfg.abas_agendamento || 2)),
          timeout_pagina_segundos: Math.max(60, cfg.timeout_pagina_segundos || 60),
          manter_primeira_aba: true,
          autofill_login: true,
          preencher_formulario: true,
          alerta_sonoro: true,
          radar_whatsapp_patch: { ativo: true, abrir_automatico: true, notificar_push: true },
        });
      }
      const probeRaw = await executeTool("check_prenotami_status", {});
      const probe = JSON.parse(probeRaw) as { summary: string };
      const sched = secondsUntilScheduledStart(cfg);
      const probs = preflight(cfg, env);
      const missing: string[] = [];
      if (!cfg.dados.endereco.trim()) missing.push("Endereço completo");
      if (!cfg.dados.altura_cm.trim()) missing.push("Altura (cm)");
      if (!cfg.dados.estado_civil.trim()) missing.push("Estado civil");
      if (!cfg.dados.cor_olhos.trim()) missing.push("Cor dos olhos");

      out.push(
        mode === "autonomous"
          ? "Agente Principal concluiu auditoria, sincronização da extensão e verificação do portal (defina OPENAI_API_KEY no servidor para raciocínio GPT completo):"
          : `Auditoria de prontidão (${sched.brasiliaLabel} BRT / ${sched.cuiabaLabel} Cuiabá-AM):`
      );
      out.push(`• Fuso ativo: ${cfg.fuso_horario} | Alvo: ${cfg.horario_alvo} | Pré-início: ${sched.startLabel} (Segunda-feira)`);
      out.push(`• Radar WhatsApp PC: ${cfg.radar_whatsapp.ativo ? `ativo (${cfg.radar_whatsapp.numero_radar})` : "desativado"}`);
      out.push(`• Portal Prenot@mi agora: ${probe.summary}`);
      out.push(
        missing.length
          ? `• Campos de autofill faltando: ${missing.join(", ")}`
          : "• Formulário base (endereço, altura, estado civil, olhos): 100% pronto para autofill."
      );
      out.push(
        probs.length
          ? `• Pendências:\n  - ${probs.join("\n  - ")}`
          : "• Pré-voo: sem pendências críticas."
      );
    } else if (mode === "map_field") {
      await executeTool("learn_form_answers", { html_or_labels: fieldLabel });
      const val = mappedField ? cfg.dados[mappedField] : "";
      out.push(
        mappedField
          ? `Campo reconhecido como "${mappedField}". Valor atual: "${val || "(vazio)"}".`
          : `Rótulo/HTML analisado e disponível para aprendizado em "Memória do bot".`
      );
    } else {
      await executeTool("inspect_profile", {});

      if (lowPrompt.includes("parar") || lowPrompt.includes("pare") || lowPrompt.includes("stop")) {
        await executeTool("control_monitor", { action: "stop" });
      } else if (lowPrompt.includes("teste") && (lowPrompt.includes("iniciar") || lowPrompt.includes("rodar") || lowPrompt.includes("comecar"))) {
        await executeTool("control_monitor", { action: "start_immediate_test" });
      } else if (lowPrompt.includes("iniciar") || lowPrompt.includes("agendar") || lowPrompt.includes("comecar") || lowPrompt.includes("preparar tudo")) {
        if (lowPrompt.includes("cuiaba") || lowPrompt.includes("amazonas") || lowPrompt.includes("manaus")) {
          await executeTool("update_safe_config", { fuso_horario: "America/Cuiaba", horario_alvo: "15:00", dias_semana: [1] });
        } else if (lowPrompt.includes("brasilia") || lowPrompt.includes("sao paulo")) {
          await executeTool("update_safe_config", { fuso_horario: "America/Sao_Paulo", horario_alvo: "16:00", dias_semana: [1] });
        }
        await executeTool("control_monitor", { action: "start_scheduled" });
      } else if (lowPrompt.includes("cuiaba") || lowPrompt.includes("amazonas") || lowPrompt.includes("manaus")) {
        await executeTool("update_safe_config", { fuso_horario: "America/Cuiaba", horario_alvo: "15:00", dias_semana: [1] });
      } else if (lowPrompt.includes("brasilia") || lowPrompt.includes("sao paulo")) {
        await executeTool("update_safe_config", { fuso_horario: "America/Sao_Paulo", horario_alvo: "16:00", dias_semana: [1] });
      }

      if (lowPrompt.includes("simular radar") || lowPrompt.includes("testar radar") || lowPrompt.includes("radar whatsapp")) {
        await executeTool("trigger_radar_alert", { message: prompt });
      }
      if (/html|<label|<input|stato|indirizzo|olhos|altura/i.test(prompt)) {
        await executeTool("learn_form_answers", { html_or_labels: prompt });
      }
      if (/portal|site|status|lento|online|ar/i.test(prompt)) {
        await executeTool("check_prenotami_status", {});
      }
      if (/curitiba|bh|belo horizonte|porto alegre|rio|catalogo|servico|id/i.test(prompt)) {
        await executeTool("list_service_catalog", { query: prompt.slice(0, 40) });
      }

      out.push(
        "Agente Principal executou suas instruções localmente (defina OPENAI_API_KEY no ambiente do servidor para interpretação GPT avançada):"
      );
      out.push(
        actions.map((a) => `• [${a.tool}] ${a.summary}`).join("\n")
      );
    }

    return {
      source: "local",
      aiConfigured: false,
      mappedKey: mappedField,
      suggestedValue: mappedField ? cfg.dados[mappedField] : "",
      reply: out.join("\n"),
      actions,
      updatedCfg: cfgModified ? cfg : undefined,
      updatedRunner: runnerModified ? runner.getState() : undefined,
    };
  }

  // Modo OpenAI Principal Orchestrator (Multi-Step Tool-Calling Agent)
  const sched = secondsUntilScheduledStart(cfg);
  const systemPrompt = [
    "Você é o Agente Principal e Orquestrador do PrenotaBot Livre 2.0 (estilo AutoGen/Codex de ferramentas no domínio consular).",
    "Seu papel é evitar que o usuário precise configurar tudo de forma engessada: você inspeciona o estado atual, ajusta configurações seguras, aprende novos campos HTML, coordena o Radar WhatsApp PC (+55 47 92004-1774 / prenotamiradar.com.br), verifica a latência do portal e inicia/para o monitor diretamente com suas ferramentas.",
    "Regras de calendário consular:",
    "- Abertura toda segunda-feira às 16:00 de Brasília (America/Sao_Paulo) = 15:00 de Cuiabá/Amazonas (America/Cuiaba / America/Manaus), com pré-início de 1–2 minutos antes (15:58 BRT / 14:58 AMT).",
    "Regras estritas de segurança e política:",
    "1. O login é sempre manual (apenas autofill); a 1ª aba nunca é fechada; a confirmação final (#btnAvanti) e a seleção de data/hora no calendário são 100% manuais.",
    "2. NUNCA tente ou instrua evasão de CAPTCHA, bypass do Radware, spoofing anti-bot ou intervalos agressivos (< 20s).",
    "3. Sempre execute as ferramentas necessárias antes de responder em português do Brasil claro e objetivo.",
  ].join("\n");

  const initialUserMsg =
    mode === "autonomous"
      ? `Execute a orquestração completa para o perfil '${profile}':\n1) Use inspect_profile.\n2) Use update_safe_config para garantir fuso coerente (atual ${cfg.fuso_horario}, pré-início ${sched.brasiliaLabel} BRT / ${sched.cuiabaLabel} Cuiabá-AM), segunda-feira [1], intervalos >= 45s, timeout >= 60s, manter_primeira_aba=true, radar_whatsapp ativo.\n3) Use check_prenotami_status para medir latência atual.\n4) Se estiver pronto ou se faltarem dados, oriente claramente o usuário.`
      : mode === "readiness"
        ? `Audite a prontidão completa do perfil '${profile}' (use inspect_profile e check_prenotami_status) para segunda-feira às 16:00 Brasília / 15:00 Cuiabá-AM e para o Radar WhatsApp.`
        : mode === "map_field"
          ? `Analise o rótulo/HTML abaixo com inspect_profile e learn_form_answers:\n"${fieldLabel}"`
          : prompt;

  const messages: Array<Record<string, any>> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: initialUserMsg },
  ];

  const MAX_TURNS = 6;
  let finalReply = "";

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const aiResp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.2,
          messages,
          tools: AGENT_TOOLS,
          tool_choice: "auto",
        }),
        signal: AbortSignal.timeout(35000),
      });

      if (!aiResp.ok) {
        const errTxt = await aiResp.text();
        throw new Error(`OpenAI API HTTP ${aiResp.status}: ${errTxt.slice(0, 200)}`);
      }

      const data = (await aiResp.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id: string;
              type: string;
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      };

      const msg = data.choices?.[0]?.message;
      if (!msg) break;
      messages.push(msg);

      const toolCalls = msg.tool_calls ?? [];
      if (toolCalls.length === 0) {
        finalReply = (msg.content ?? "").trim();
        break;
      }

      for (const tc of toolCalls) {
        let parsedArgs: Record<string, any> = {};
        try {
          parsedArgs = tc.function.arguments
            ? (JSON.parse(tc.function.arguments) as Record<string, any>)
            : {};
        } catch {
          parsedArgs = {};
        }
        const toolOutput = await executeTool(tc.function.name, parsedArgs);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: toolOutput,
        });
      }
    }

    if (!finalReply) {
      finalReply =
        actions.length > 0
          ? `Agente Principal concluiu ${actions.length} ação(ões):\n` +
            actions.map((a) => `• [${a.tool}] ${a.summary}`).join("\n")
          : "Sem resposta do agente.";
    }

    return {
      source: "openai",
      aiConfigured: true,
      mappedKey: mappedField,
      suggestedValue: mappedField ? cfg.dados[mappedField] : "",
      reply: finalReply,
      actions,
      updatedCfg: cfgModified ? cfg : undefined,
      updatedRunner: runnerModified ? runner.getState() : undefined,
    };
  } catch (e) {
    throw new Error(
      `Erro no agente OpenAI: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
