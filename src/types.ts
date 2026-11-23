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

export interface EnvMap {
  PRENOTAMI_EMAIL: string;
  PRENOTAMI_SENHA: string;
  TELEGRAM_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  IMAP_EMAIL: string;
  IMAP_SENHA_APP: string;
  IMAP_SERVIDOR: string;
  EMAIL_AVISO_DESTINO: string;
  SMTP_SERVIDOR: string;
  WHATSAPP_TELEFONE: string;
  WHATSAPP_APIKEY: string;
  NTFY_TOPICO: string;
}

export interface CatalogItem {
  id: number;
  consulado: string;
  nome: string;
}

export interface FileEntry {
  name: string;
  size: number;
}

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
  lastRadarTrigger?: RadarTriggerEvent | null;
  logs: LogEntry[];
}

export interface HistorySummary {
  total: number;
  vagas: number;
  horas_com_vaga: Record<string, number>;
}

export interface HistoryRow {
  data_hora: string;
  dia_semana: string;
  servico: string;
  resultado: string;
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
  hasWebmailTab?: boolean;
  error?: string;
}

export interface OtpRecord {
  code: string;
  from: string;
  subject: string;
  receivedAt: string;
  source: "imap" | "webmail" | "manual";
  capturedAtMs: number;
  isFresh?: boolean;
}

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

export interface BootstrapResponse {
  profiles: string[];
  activeProfile: string;
  cfg: BotConfig;
  env: EnvMap;
  catalog: CatalogItem[];
  files: FileEntry[];
  proofs: FileEntry[];
  history: HistorySummary;
  runner: RunnerState;
  readiness?: ReadinessReport;
  otp?: OtpRecord | null;
}

export const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"];

export const ESTADO_CIVIL = [
  "",
  "Solteiro/Solteira",
  "Casado/a",
  "Divorciado/a",
  "Viuvo/a",
  "Separado/a",
  "Em uniao civil",
  "Separado/a de Uniao Civil",
  "Divorciado/a de Uniao Civil",
  "Viuvo/a de Uniao Civil",
];

export const COR_OLHOS = ["", "Marrom", "Preto", "Azul", "Verde", "Cinza"];
export const SIM_NAO = ["Nao", "Sim"];
export const PARENTESCO = [
  "Filho/a",
  "Conjuge",
  "Companheiro",
  "Pai/Mae",
  "Irmao/Irma",
  "Neto",
  "Genro/Nora",
  "Sogro/Sogra",
  "Menor sob tutela",
  "Filho de outro cônjuge",
  "Cônjuge separado",
  "Cônjuge divorciado",
];

export const QUICK_SERVICES = [
  {
    label: "São Paulo - PRIMEIRO PASSAPORTE (recomendado)",
    id: 5402,
    desc: "Para quem nunca teve passaporte italiano. Anexo: comprovante de residência em seu nome.",
  },
  {
    label: "São Paulo - Renovação de passaporte",
    id: 5256,
    desc: "Para quem tem passaporte italiano vencido ou vencendo em até 12 meses. Anexo: cópia do passaporte.",
  },
  {
    label: "Outro consulado / descobrir na minha conta",
    id: 0,
    desc: "Depois de salvar, clique em 'Listar serviços da minha conta' para ver os IDs disponíveis para você.",
  },
];

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
];
