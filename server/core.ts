import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import dotenv from "dotenv";

export const BASE_DIR = process.cwd();
export const FILES_DIR = path.join(BASE_DIR, "files");
export const LOGS_DIR = path.join(BASE_DIR, "logs");
export const PROOF_DIR = path.join(BASE_DIR, "comprovantes");
export const CONFIG_PATH = path.join(BASE_DIR, "config.yaml");
export const ENV_PATH = path.join(BASE_DIR, ".env");
export const SERVICES_CACHE = path.join(BASE_DIR, "servicos_da_conta.json");
export const CATALOG_PATH = path.join(BASE_DIR, "catalogo_servicos.json");
export const PROFILES_DIR = path.join(BASE_DIR, "perfis");
export const LAST_PROFILE_PATH = path.join(PROFILES_DIR, "_ultimo.txt");
export const HISTORY_CSV = path.join(LOGS_DIR, "historico_verificacoes.csv");
export const LOG_FILE = path.join(LOGS_DIR, "prenotabot.log");

export const SITE = "https://prenotami.esteri.it";
export const BOOKING_URL = `${SITE}/Services/Booking/{id}`;

export const UNAVAILABLE_HINTS = [
  "al momento non ci sono date disponibili",
  "non ci sono date disponibili",
  "all appointments for this service are currently booked",
  "stante l'elevata richiesta",
  "no hay citas disponibles",
  "nao ha datas disponiveis",
  "todas as vagas",
];

export const ENV_KEYS = [
  "PRENOTAMI_EMAIL",
  "PRENOTAMI_SENHA",
  "TELEGRAM_TOKEN",
  "TELEGRAM_CHAT_ID",
  "IMAP_EMAIL",
  "IMAP_SENHA_APP",
  "IMAP_SERVIDOR",
  "EMAIL_AVISO_DESTINO",
  "SMTP_SERVIDOR",
  "WHATSAPP_TELEFONE",
  "WHATSAPP_APIKEY",
  "NTFY_TOPICO",
] as const;

export type EnvKey = (typeof ENV_KEYS)[number];
export type EnvMap = Record<EnvKey, string>;

export interface Companion {
  nome: string;
  sobrenome: string;
  nascimento: string;
  parentesco: string;
}

export interface ExtraField {
  id: string;
  tipo: string;
  valor: string;
}

export interface DadosConfig {
  endereco: string;
  altura_cm: string;
  estado_civil: string;
  cor_olhos: string;
  filhos_menores: string;
  quantidade_filhos: string;
  passaporte_vencido: string;
  data_vencimento_passaporte: string;
  observacoes: string;
}

export interface RadarWhatsappConfig {
  ativo: boolean;
  numero_radar: string;
  nomes_radar: string[];
  palavras_chave: string[];
  abrir_automatico: boolean;
  notificar_push: boolean;
}

export interface ChromiumConfig {
  navegador:
    | "chromium"
    | "ungoogled-chromium"
    | "brave"
    | "edge"
    | "chrome"
    | "custom";
  caminho_executavel: string;
  porta_cdp: number;
  diretorio_perfil: string;
  abrir_whatsapp_ao_iniciar: boolean;
  abrir_painel_ao_iniciar: boolean;
  abrir_webmail_ao_iniciar: boolean;
  url_webmail: string;
  abrir_abas_extras: number;
  idioma: string;
  modo_dedicado: boolean;
  bloquear_sites_externos: boolean;
  auto_otp_email: boolean;
}

export interface BotConfig {
  servicos: number[];
  intervalo_min_segundos: number;
  intervalo_max_segundos: number;
  max_tentativas: number;
  janela_horario: string;
  fuso_horario: string;
  horario_alvo: string;
  antecedencia_minutos: number;
  manter_primeira_aba: boolean;
  abas_agendamento: number;
  timeout_pagina_segundos: number;
  dias_semana: number[];
  espera_bloqueio_minutos: number;
  usar_perfil_persistente: boolean;
  auto_login: boolean;
  autofill_login: boolean;
  preencher_formulario: boolean;
  enviar_otp_automatico: boolean;
  clicar_avancar: boolean;
  auto_agendar: boolean;
  data_minima: string;
  data_maxima: string;
  meses_a_procurar: number;
  salvar_comprovante: boolean;
  somente_alertar: boolean;
  segundo_plano: boolean;
  preferencia_periodo: "qualquer" | "manha" | "tarde";
  dias_preferidos: number[];
  alerta_sonoro: boolean;
  radar_whatsapp: RadarWhatsappConfig;
  chromium: ChromiumConfig;
  dados: DadosConfig;
  acompanhantes: Companion[];
  documentos: string[];
  campos_extra: ExtraField[];
  respostas_aprendidas: Record<string, string>;
}

export const DEFAULT_CONFIG: BotConfig = {
  servicos: [5402],
  intervalo_min_segundos: 45,
  intervalo_max_segundos: 90,
  max_tentativas: 0,
  janela_horario: "",
  fuso_horario: "America/Sao_Paulo",
  horario_alvo: "16:00",
  antecedencia_minutos: 2,
  manter_primeira_aba: true,
  abas_agendamento: 2,
  timeout_pagina_segundos: 60,
  dias_semana: [1],
  espera_bloqueio_minutos: 10,
  usar_perfil_persistente: true,
  auto_login: false,
  autofill_login: true,
  preencher_formulario: true,
  enviar_otp_automatico: false,
  clicar_avancar: false,
  auto_agendar: false,
  data_minima: "",
  data_maxima: "",
  meses_a_procurar: 4,
  salvar_comprovante: true,
  somente_alertar: false,
  segundo_plano: false,
  preferencia_periodo: "qualquer",
  dias_preferidos: [],
  alerta_sonoro: true,
  radar_whatsapp: {
    ativo: true,
    numero_radar: "+55 47 92004-1774",
    nomes_radar: [
      "Prenot@mi Radar",
      "Prenotami Radar",
      "prenotamiradar.com.br",
      "+55 47 92004-1774",
      "47 92004-1774",
      "92004-1774",
    ],
    palavras_chave: [
      "vaga",
      "vagas",
      "disponivel",
      "abriu",
      "agendamento",
      "agende",
      "corre",
      "passaporte",
      "prenotami.esteri.it",
    ],
    abrir_automatico: true,
    notificar_push: true,
  },
  chromium: {
    navegador: "chromium",
    caminho_executavel: "",
    porta_cdp: 9222,
    diretorio_perfil: "chromium_perfil",
    abrir_whatsapp_ao_iniciar: true,
    abrir_painel_ao_iniciar: true,
    abrir_webmail_ao_iniciar: true,
    url_webmail: "https://mail.google.com/",
    abrir_abas_extras: 2,
    idioma: "pt-BR",
    modo_dedicado: true,
    bloquear_sites_externos: false,
    auto_otp_email: true,
  },
  dados: {
    endereco: "",
    altura_cm: "",
    estado_civil: "",
    cor_olhos: "",
    filhos_menores: "Nao",
    quantidade_filhos: "0",
    passaporte_vencido: "Nao",
    data_vencimento_passaporte: "",
    observacoes: "",
  },
  acompanhantes: [],
  documentos: [],
  campos_extra: [],
  respostas_aprendidas: {},
};

export const FIELD_RULES: Array<[keyof DadosConfig, string[]]> = [
  [
    "quantidade_filhos",
    [
      "numero figli",
      "numero di figli",
      "quanti figli",
      "quantidade de filhos",
      "numero de filhos",
      "number of children",
      "how many children",
      "numero de hijos",
      "figli minorenni numero",
      "n. figli",
    ],
  ],
  [
    "filhos_menores",
    [
      "figli minor",
      "filhos menores",
      "minor children",
      "underage",
      "hijos menores",
      "figli minorenni",
      "children under",
    ],
  ],
  [
    "data_vencimento_passaporte",
    [
      "data di scadenza",
      "data scadenza",
      "data de vencimento",
      "data de expiracao",
      "expiry date",
      "expiration date",
      "fecha de vencimiento",
    ],
  ],
  [
    "passaporte_vencido",
    [
      "passaporto scaduto",
      "passaporte vencido",
      "expired passport",
      "passaporto in scadenza",
      "pasaporte vencido",
      "passaporte italiano vencido",
    ],
  ],
  [
    "estado_civil",
    ["stato civile", "estado civil", "marital status", "civil status"],
  ],
  [
    "cor_olhos",
    [
      "colore occhi",
      "colore degli occhi",
      "cor dos olhos",
      "eye color",
      "eyes colour",
      "color de ojos",
    ],
  ],
  ["altura_cm", ["altezza", "altura", "statura", "height"]],
  [
    "endereco",
    [
      "indirizzo",
      "endereco",
      "address",
      "residenza",
      "direccion",
      "domicilio",
    ],
  ],
];

export const SELECT_CODES: Record<string, Record<string, string>> = {
  estado_civil: {
    casado: "13",
    divorciado: "14",
    viuvo: "15",
    solteiro: "16",
    separado: "17",
    "em uniao civil": "18",
    "separado/a de uniao civil": "19",
    "divorciado/a de uniao civil": "20",
    "viuvo/a de uniao civil": "21",
  },
  cor_olhos: {
    azul: "22",
    marrom: "23",
    castanho: "23",
    cinza: "24",
    preto: "25",
    verde: "26",
  },
  filhos_menores: { sim: "11", nao: "12" },
  passaporte_vencido: { sim: "1", nao: "2" },
};

export const SERVICE_PRESETS: Record<
  number,
  { nome: string; campos: Record<string, string>; documentos: string }
> = {
  5402: {
    nome: "São Paulo - Primeiro passaporte",
    campos: {
      "DatiAddizionaliPrenotante[0]._testo": "endereco",
      ddls_1: "estado_civil",
      "DatiAddizionaliPrenotante[2]._testo": "altura_cm",
      ddls_3: "cor_olhos",
    },
    documentos: "Comprovante de residência (em seu nome) - PDF",
  },
  5256: {
    nome: "São Paulo - Renovação de passaporte",
    campos: {
      "DatiAddizionaliPrenotante[0]._testo": "endereco",
      ddls_1: "estado_civil",
      "DatiAddizionaliPrenotante[2]._testo": "altura_cm",
      ddls_3: "cor_olhos",
      "DatiAddizionaliPrenotante[4]._testo": "quantidade_filhos",
      "DatiAddizionaliPrenotante[5]._data": "data_vencimento_passaporte",
    },
    documentos:
      "Cópia do passaporte italiano vencido/a vencer (ou B.O. de perda/roubo) - PDF",
  },
  4705: {
    nome: "Curitiba - Passaporte",
    campos: {},
    documentos: "Comprovante de residência - PDF",
  },
  2391: {
    nome: "Belo Horizonte - Passaporte",
    campos: {
      DatiAddizionaliPrenotante_1___testo: "endereco",
      ddls_0: "estado_civil",
      ddls_4: "filhos_menores",
      ddls_7: "passaporte_vencido",
      BookingNotes: "altura_cm",
      ddls_2: "cor_olhos",
    },
    documentos: "",
  },
};

export function normalize(text: unknown): string {
  const s = String(text ?? "");
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function classifyLabel(label: string): keyof DadosConfig | null {
  const lab = normalize(label);
  for (const [key, words] of FIELD_RULES) {
    if (words.some((w) => lab.includes(w))) {
      return key;
    }
  }
  return null;
}

export function codeFor(key: string, value: string): string | null {
  const table = SELECT_CODES[key];
  if (!table) return null;
  const v = normalize(value).replace(/\/a/g, "").replace(/\/solteira/g, "").trim();
  if (v in table) return table[v];
  for (const [k, code] of Object.entries(table)) {
    if (k.includes(v) || v.includes(k)) return code;
  }
  return null;
}

export function sanitizePrenotamiBookingUrl(
  rawUrl: unknown,
  fallbackServiceId = 5402
): string {
  const fallback = `${SITE}/Services/Booking/${fallbackServiceId || 5402}`;
  const candidate = String(rawUrl ?? "").trim();
  if (!candidate) return fallback;
  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase() === "prenotami.esteri.it"
    ) {
      return parsed.toString();
    }
  } catch {
    // fallback below
  }
  return fallback;
}

export function deepMerge<T extends Record<string, any>>(
  base: T,
  extra: Record<string, any> | null | undefined
): T {
  const out: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      out[k] &&
      typeof out[k] === "object" &&
      !Array.isArray(out[k])
    ) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export function parseDate(s: unknown): Date | null {
  const str = String(s ?? "").trim();
  if (!str) return null;

  let m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return validDate(+yyyy, +mm, +dd);
  }
  m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [, yyyy, mm, dd] = m;
    return validDate(+yyyy, +mm, +dd);
  }
  m = str.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return validDate(+yyyy, +mm, +dd);
  }
  return null;
}

function validDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d;
}

export const TIMEZONE_OPTIONS = [
  {
    value: "America/Sao_Paulo",
    label: "Brasília / São Paulo (BRT, UTC-3 — abertura 16:00)",
    defaultTarget: "16:00",
  },
  {
    value: "America/Cuiaba",
    label: "Cuiabá / Mato Grosso (AMT, UTC-4 — abertura 15:00)",
    defaultTarget: "15:00",
  },
  {
    value: "America/Manaus",
    label: "Manaus / Amazonas (AMT, UTC-4 — abertura 15:00)",
    defaultTarget: "15:00",
  },
] as const;

export function resolveTimeZone(tz?: string): string {
  const raw = String(tz ?? "").trim();
  if (!raw || raw === "auto") {
    return "America/Sao_Paulo";
  }
  try {
    Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    return "America/Sao_Paulo";
  }
}

export function getZonedParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    map[p.type] = p.value;
  }
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayMap[map.weekday] ?? 1,
  };
}

export function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const guessUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const p = getZonedParts(new Date(guessUtc), timeZone);
  const seenAsUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second
  );
  let result = new Date(guessUtc - (seenAsUtc - guessUtc));
  const p2 = getZonedParts(result, timeZone);
  const seen2 = Date.UTC(
    p2.year,
    p2.month - 1,
    p2.day,
    p2.hour,
    p2.minute,
    p2.second
  );
  const diff2 = Date.UTC(year, month - 1, day, hour, minute, second) - seen2;
  if (diff2 !== 0) {
    result = new Date(result.getTime() + diff2);
  }
  return result;
}

export function formatHMInZone(date: Date, timeZone: string): string {
  const p = getZonedParts(date, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function inTimeWindow(
  cfg: Partial<BotConfig>,
  now: Date = new Date()
): [boolean, number] {
  const dias = (cfg.dias_semana ?? []).map(Number).filter((n) => n >= 1 && n <= 7);
  const janela = String(cfg.janela_horario ?? "").trim();
  let startT: [number, number] | null = null;
  let endT: [number, number] | null = null;
  if (janela) {
    const m = janela.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (m) {
      startT = [Number(m[1]), Number(m[2])];
      endT = [Number(m[3]), Number(m[4])];
    }
  }

  const tz = cfg.fuso_horario
    ? resolveTimeZone(cfg.fuso_horario)
    : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const nowParts = getZonedParts(now, tz);

  for (let add = 0; add < 8; add++) {
    const refUtc = new Date(
      Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day + add, 12, 0, 0)
    );
    const dayParts = getZonedParts(refUtc, tz);
    if (dias.length && !dias.includes(dayParts.weekday)) {
      continue;
    }
    if (!startT || !endT) {
      if (add === 0) return [true, 0];
      const nxt = zonedWallClockToUtc(
        dayParts.year,
        dayParts.month,
        dayParts.day,
        0,
        0,
        0,
        tz
      );
      return [false, (nxt.getTime() - now.getTime()) / 1000];
    }
    const s = zonedWallClockToUtc(
      dayParts.year,
      dayParts.month,
      dayParts.day,
      startT[0],
      startT[1],
      0,
      tz
    );
    const e = zonedWallClockToUtc(
      dayParts.year,
      dayParts.month,
      dayParts.day,
      endT[0],
      endT[1],
      0,
      tz
    );
    if (add === 0 && s.getTime() <= now.getTime() && now.getTime() <= e.getTime()) {
      return [true, 0];
    }
    if (s.getTime() > now.getTime()) {
      return [false, (s.getTime() - now.getTime()) / 1000];
    }
  }
  return [true, 0];
}

/**
 * Calcula quantos segundos faltam ate (horario_alvo - antecedencia_minutos) no fuso configurado.
 * Padrao consular: 16:00 America/Sao_Paulo (Brasilia) = 15:00 America/Cuiaba / America/Manaus toda segunda-feira.
 */
export function secondsUntilScheduledStart(
  cfg: Partial<BotConfig>,
  now: Date = new Date()
): {
  waitSeconds: number;
  startLabel: string;
  brasiliaLabel: string;
  cuiabaLabel: string;
  timeZone: string;
  targetUtcIso: string;
} {
  const tz = resolveTimeZone(cfg.fuso_horario);
  const raw = String(cfg.horario_alvo ?? "16:00").trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) {
    return {
      waitSeconds: 0,
      startLabel: "imediato",
      brasiliaLabel: "imediato",
      cuiabaLabel: "imediato",
      timeZone: tz,
      targetUtcIso: now.toISOString(),
    };
  }
  const targetH = Math.min(23, Math.max(0, Number(m[1])));
  const targetM = Math.min(59, Math.max(0, Number(m[2])));
  const leadMin = Math.min(10, Math.max(0, Number(cfg.antecedencia_minutos ?? 2)));
  const dias = (cfg.dias_semana ?? []).map(Number).filter((n) => n >= 1 && n <= 7);

  const nowParts = getZonedParts(now, tz);

  for (let add = 0; add < 8; add++) {
    const refUtc = new Date(
      Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day + add, 12, 0, 0)
    );
    const dayParts = getZonedParts(refUtc, tz);
    if (dias.length && !dias.includes(dayParts.weekday)) {
      continue;
    }

    const targetUtc = zonedWallClockToUtc(
      dayParts.year,
      dayParts.month,
      dayParts.day,
      targetH,
      targetM,
      0,
      tz
    );
    const startUtc = new Date(targetUtc.getTime() - leadMin * 60_000);
    const windowEndUtc = new Date(targetUtc.getTime() + 90 * 60_000);

    const startLabel = formatHMInZone(startUtc, tz);
    const brasiliaLabel = formatHMInZone(startUtc, "America/Sao_Paulo");
    const cuiabaLabel = formatHMInZone(startUtc, "America/Cuiaba");

    if (now.getTime() >= startUtc.getTime() && now.getTime() <= windowEndUtc.getTime()) {
      return {
        waitSeconds: 0,
        startLabel,
        brasiliaLabel,
        cuiabaLabel,
        timeZone: tz,
        targetUtcIso: startUtc.toISOString(),
      };
    }
    if (startUtc.getTime() > now.getTime()) {
      return {
        waitSeconds: (startUtc.getTime() - now.getTime()) / 1000,
        startLabel,
        brasiliaLabel,
        cuiabaLabel,
        timeZone: tz,
        targetUtcIso: startUtc.toISOString(),
      };
    }
  }

  return {
    waitSeconds: 0,
    startLabel: "imediato",
    brasiliaLabel: "imediato",
    cuiabaLabel: "imediato",
    timeZone: tz,
    targetUtcIso: now.toISOString(),
  };
}

export function ensureDirs(): void {
  for (const dir of [FILES_DIR, LOGS_DIR, PROOF_DIR, PROFILES_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function profilePath(name: string): string {
  ensureDirs();
  const safe =
    name
      .replace(/[^A-Za-z0-9_\- ]/g, "")
      .trim()
      .replace(/\s+/g, "_") || "padrao";
  return path.join(PROFILES_DIR, `${safe}.yaml`);
}

export function listProfiles(): string[] {
  ensureDirs();
  const files = fs
    .readdirSync(PROFILES_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(/\.yaml$/, ""))
    .sort();
  if (files.length === 0) {
    const dest = profilePath("meu_perfil");
    if (fs.existsSync(CONFIG_PATH)) {
      fs.copyFileSync(CONFIG_PATH, dest);
    } else {
      saveConfig(DEFAULT_CONFIG, dest);
    }
    return ["meu_perfil"];
  }
  return files;
}

export function getLastProfile(): string {
  const profs = listProfiles();
  if (fs.existsSync(LAST_PROFILE_PATH)) {
    const name = fs.readFileSync(LAST_PROFILE_PATH, "utf-8").trim();
    if (profs.includes(name)) return name;
  }
  return profs[0];
}

export function setLastProfile(name: string): void {
  ensureDirs();
  fs.writeFileSync(LAST_PROFILE_PATH, name, "utf-8");
}

export function loadConfig(filePath: string = CONFIG_PATH): BotConfig {
  let user: Record<string, any> = {};
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      user = (yaml.load(raw) as Record<string, any>) || {};
    } catch {
      user = {};
    }
  }
  const cfg = deepMerge(structuredClone(DEFAULT_CONFIG), user);
  cfg.servicos = (cfg.servicos ?? [])
    .map((s) => String(s).trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number);

  let lo = Number(cfg.intervalo_min_segundos) || 45;
  const hi = Number(cfg.intervalo_max_segundos) || 90;
  lo = Math.max(lo, 20);
  cfg.intervalo_min_segundos = lo;
  cfg.intervalo_max_segundos = Math.max(hi, lo);
  return cfg;
}

export function saveConfig(cfg: BotConfig, filePath: string = CONFIG_PATH): void {
  ensureDirs();
  const header =
    "# PrenotaBot Livre - configuracao (pode editar aqui ou pelo painel)\n" +
    "# Veja LEIAME.md para a explicacao de cada opcao.\n";
  const body = yaml.dump(cfg, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(filePath, header + body, "utf-8");
}

export function loadEnv(): EnvMap {
  if (fs.existsSync(ENV_PATH)) {
    dotenv.config({ path: ENV_PATH, override: true });
  }
  const env = {} as EnvMap;
  for (const k of ENV_KEYS) {
    env[k] = (process.env[k] ?? "").trim().replace(/^["']|["']$/g, "");
  }
  if (!env.PRENOTAMI_EMAIL && process.env.username) {
    env.PRENOTAMI_EMAIL = process.env.username.trim().replace(/^["']|["']$/g, "");
  }
  if (!env.PRENOTAMI_SENHA && process.env.password) {
    env.PRENOTAMI_SENHA = process.env.password.trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

export function saveEnv(values: Partial<EnvMap>): void {
  const merged = { ...loadEnv(), ...values };
  const lines = ENV_KEYS.map((k) => `${k}=${merged[k] ?? ""}`);
  fs.writeFileSync(ENV_PATH, lines.join("\n") + "\n", "utf-8");
  for (const k of ENV_KEYS) {
    process.env[k] = merged[k] ?? "";
  }
}

export const MAX_PRENOTAMI_FILE_BYTES = 2 * 1024 * 1024;

export function preflight(cfg: BotConfig, env: Partial<EnvMap>): string[] {
  const problems: string[] = [];
  for (const doc of cfg.documentos ?? []) {
    const p = path.join(FILES_DIR, doc);
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
      problems.push(`Documento faltando: files/${doc}`);
    } else {
      const sz = fs.statSync(p).size;
      if (sz > MAX_PRENOTAMI_FILE_BYTES) {
        const mb = (sz / (1024 * 1024)).toFixed(2);
        problems.push(
          `Documento ${doc} tem ${mb} MB (o Prenot@mi rejeita anexos acima de 2 MB).`
        );
      }
    }
  }
  if (!env.PRENOTAMI_EMAIL || !env.PRENOTAMI_SENHA) {
    problems.push(
      "E-mail/senha do Prenot@mi nao configurados (sera preciso logar manualmente)."
    );
  }
  if (!cfg.servicos || cfg.servicos.length === 0) {
    problems.push(
      "Nenhum servico configurado - o bot vai listar os servicos da sua conta."
    );
  }
  return problems;
}

export interface ReadinessItem {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface ReadinessReport {
  score: number;
  items: ReadinessItem[];
  brasiliaStart: string;
  cuiabaStart: string;
  secondsRemaining: number;
}

export function buildReadinessReport(
  cfg: BotConfig,
  env: Partial<EnvMap>
): ReadinessReport {
  const sched = secondsUntilScheduledStart(cfg);
  const hasCreds = Boolean(env.PRENOTAMI_EMAIL && env.PRENOTAMI_SENHA);
  const hasService = Boolean(cfg.servicos && cfg.servicos.length > 0);
  const hasMonday =
    Array.isArray(cfg.dias_semana) && cfg.dias_semana.includes(1);
  const formComplete = Boolean(
    cfg.dados.endereco.trim() &&
      cfg.dados.altura_cm.trim() &&
      cfg.dados.estado_civil.trim() &&
      cfg.dados.cor_olhos.trim()
  );

  let docsOk = true;
  let docsDetail = "Nenhum PDF obrigatório listado ou todos <= 2 MB.";
  if ((cfg.documentos ?? []).length > 0) {
    const oversized: string[] = [];
    const missing: string[] = [];
    for (const doc of cfg.documentos) {
      const p = path.join(FILES_DIR, doc);
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
        missing.push(doc);
      } else if (fs.statSync(p).size > MAX_PRENOTAMI_FILE_BYTES) {
        oversized.push(doc);
      }
    }
    if (missing.length || oversized.length) {
      docsOk = false;
      docsDetail = [
        missing.length ? `Faltando: ${missing.join(", ")}` : "",
        oversized.length ? `Acima de 2 MB: ${oversized.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" | ");
    } else {
      docsDetail = `${cfg.documentos.length} arquivo(s) verificado(s) (<= 2 MB).`;
    }
  }

  const hasAlerts = Boolean(
    cfg.alerta_sonoro ||
      env.NTFY_TOPICO ||
      env.TELEGRAM_TOKEN ||
      env.WHATSAPP_APIKEY ||
      cfg.radar_whatsapp?.ativo
  );

  const items: ReadinessItem[] = [
    {
      id: "conta",
      label: "Credenciais p/ autofill",
      ok: hasCreds,
      detail: hasCreds
        ? "E-mail e senha salvos p/ autofill (login manual)"
        : "Falta e-mail ou senha na aba Conta",
    },
    {
      id: "servico",
      label: "Serviço consular",
      ok: hasService,
      detail: hasService
        ? `ID(s): ${cfg.servicos.join(", ")}`
        : "Nenhum ID selecionado",
    },
    {
      id: "horario",
      label: "Fuso & Segunda-feira",
      ok: hasMonday,
      detail: `${cfg.fuso_horario} • ${sched.brasiliaLabel} BRT / ${sched.cuiabaLabel} Cuiabá-AM`,
    },
    {
      id: "formulario",
      label: "Dados p/ autofill",
      ok: formComplete,
      detail: formComplete
        ? "Endereço, altura, estado civil e olhos preenchidos"
        : "Complete endereço, altura, estado civil e olhos na aba Formulário",
    },
    {
      id: "documentos",
      label: "PDFs (<= 2 MB)",
      ok: docsOk,
      detail: docsDetail,
    },
    {
      id: "radar",
      label: "Alertas & Radar WA",
      ok: hasAlerts,
      detail: cfg.radar_whatsapp?.ativo
        ? `Radar WA ativo (${cfg.radar_whatsapp.numero_radar})`
        : "Somente alerta no painel",
    },
  ];

  const okCount = items.filter((i) => i.ok).length;
  const score = Math.round((okCount / items.length) * 100);
  return {
    score,
    items,
    brasiliaStart: sched.brasiliaLabel,
    cuiabaStart: sched.cuiabaLabel,
    secondsRemaining: Math.max(0, Math.round(sched.waitSeconds)),
  };
}

function formatDateTime(d: Date, timeZone = "America/Sao_Paulo"): string {
  const p = getZonedParts(d, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

export function recordHistory(serviceId: number, state: string): void {
  try {
    ensureDirs();
    const isNew = !fs.existsSync(HISTORY_CSV);
    const now = new Date();
    const p = getZonedParts(now, "America/Sao_Paulo");
    const line = `${formatDateTime(now, "America/Sao_Paulo")};${p.weekday};${serviceId};${state}\n`;
    const prefix = isNew ? "data_hora;dia_semana;servico;resultado\n" : "";
    fs.appendFileSync(HISTORY_CSV, prefix + line, "utf-8");
  } catch {
    // ignore
  }
}

export function historySummary(csvPath: string = HISTORY_CSV): {
  total: number;
  vagas: number;
  horas_com_vaga: Record<string, number>;
} {
  const out = { total: 0, vagas: 0, horas_com_vaga: {} as Record<string, number> };
  if (!fs.existsSync(csvPath)) return out;
  const lines = fs.readFileSync(csvPath, "utf-8").split(/\r?\n/).slice(1);
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split(";");
    if (parts.length < 4) continue;
    out.total += 1;
    if (parts[3] === "disponivel" || parts[3] === "calendario") {
      out.vagas += 1;
      const h = parts[0].slice(11, 13);
      out.horas_com_vaga[h] = (out.horas_com_vaga[h] || 0) + 1;
    }
  }
  return out;
}

export async function notifyNtfy(
  env: Partial<EnvMap>,
  text: string,
  title = "PrenotaBot"
): Promise<boolean> {
  const topic = (env.NTFY_TOPICO ?? "").trim();
  if (!topic) return false;
  const url = topic.startsWith("http") ? topic : `https://ntfy.sh/${topic}`;
  const resp = await fetch(url, {
    method: "POST",
    body: text,
    headers: {
      Title: title,
      Priority: "urgent",
      Tags: "rotating_light",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    throw new Error(`ntfy HTTP ${resp.status}`);
  }
  return true;
}

export async function notifyTelegram(
  env: Partial<EnvMap>,
  text: string
): Promise<boolean> {
  const token = env.TELEGRAM_TOKEN;
  const chat = env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  const body = new URLSearchParams({ chat_id: chat, text });
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    throw new Error(`Telegram HTTP ${resp.status}`);
  }
  return true;
}

export async function notifyWhatsapp(
  env: Partial<EnvMap>,
  text: string
): Promise<boolean> {
  const phone = env.WHATSAPP_TELEFONE;
  const key = env.WHATSAPP_APIKEY;
  if (!phone || !key) return false;
  const cleanPhone = phone.replace(/[^\d+]/g, "");
  const q = new URLSearchParams({ phone: cleanPhone, text, apikey: key });
  const resp = await fetch(
    `https://api.callmebot.com/whatsapp.php?${q.toString()}`,
    { signal: AbortSignal.timeout(15000) }
  );
  if (!resp.ok) {
    throw new Error(`CallMeBot HTTP ${resp.status}`);
  }
  return true;
}

export async function notifyEmail(
  env: Partial<EnvMap>,
  _text: string
): Promise<boolean> {
  const user = env.IMAP_EMAIL;
  const pwd = env.IMAP_SENHA_APP;
  const dest = env.EMAIL_AVISO_DESTINO || user;
  if (!user || !pwd || !dest) return false;
  throw new Error(
    "Envio SMTP direto bloqueado neste container web (use ntfy, Telegram ou WhatsApp)."
  );
}

export async function notify(
  env: Partial<EnvMap>,
  text: string,
  important = true,
  onWarn?: (msg: string) => void
): Promise<Record<string, "ok" | "erro" | "off">> {
  const channels: Array<[string, () => Promise<boolean>]> = [
    ["telegram", () => notifyTelegram(env, text)],
    ["whatsapp", () => notifyWhatsapp(env, text)],
    ["celular (ntfy)", () => notifyNtfy(env, text)],
    [
      "e-mail",
      () => (important ? notifyEmail(env, text) : Promise.resolve(false)),
    ],
  ];
  const result: Record<string, "ok" | "erro" | "off"> = {};
  for (const [name, fn] of channels) {
    try {
      const sent = await fn();
      result[name] = sent ? "ok" : "off";
    } catch (e) {
      result[name] = "erro";
      onWarn?.(
        `Aviso por ${name} falhou: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  return result;
}
