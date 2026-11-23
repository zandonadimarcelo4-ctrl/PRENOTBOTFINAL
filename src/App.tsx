import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BootstrapResponse,
  BotConfig,
  COR_OLHOS,
  CatalogItem,
  ChromiumBridgeStatus,
  DIAS,
  ESTADO_CIVIL,
  EnvMap,
  FileEntry,
  HistoryRow,
  HistorySummary,
  OtpRecord,
  PARENTESCO,
  QUICK_SERVICES,
  ReadinessReport,
  RunnerState,
  SIM_NAO,
  TIMEZONE_OPTIONS,
} from "./types";
import { playBeep } from "./utils/audio";
import { Wizard } from "./components/Wizard";
import { ModalDialog } from "./components/ModalDialog";

type TabId = "inicio" | "dados" | "horario" | "chromium" | "historico";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "inicio", label: "Início" },
  { id: "dados", label: "Meus Dados" },
  { id: "horario", label: "Horário, Radar & OTP" },
  { id: "chromium", label: "Chromium Dedicado" },
  { id: "historico", label: "Histórico & IA" },
];

const MAX_PDF_BYTES = 2 * 1024 * 1024;

function computeStartLabel(horarioAlvo: string, antecedenciaMin: number): string {
  const m = String(horarioAlvo || "16:00").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "15:58";
  const totalMin =
    (Number(m[1]) * 60 + Number(m[2]) - Math.max(0, antecedenciaMin || 2) + 1440) %
    1440;
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function formatClockInZone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return date.toLocaleTimeString("pt-BR", { hour12: false });
  }
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return "Janela aberta agora!";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

function targetForTimezone(tz: string): string {
  if (
    tz === "America/Cuiaba" ||
    tz === "America/Manaus" ||
    tz === "America/Campo_Grande" ||
    tz === "America/Porto_Velho" ||
    tz === "America/Boa_Vista"
  ) {
    return "15:00";
  }
  return "16:00";
}

export function App() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("inicio");
  const [profiles, setProfiles] = useState<string[]>([]);
  const [activeProfile, setActiveProfile] = useState("");
  const [cfg, setCfg] = useState<BotConfig | null>(null);
  const [env, setEnv] = useState<EnvMap | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [proofs, setProofs] = useState<FileEntry[]>([]);
  const [readiness, setReadiness] = useState<ReadinessReport | null>(null);
  const [latestOtp, setLatestOtp] = useState<OtpRecord | null>(null);
  const [otpChecking, setOtpChecking] = useState(false);
  const [otpFeedback, setOtpFeedback] = useState("");
  const [chromiumStatus, setChromiumStatus] =
    useState<ChromiumBridgeStatus | null>(null);
  const [chromiumChecking, setChromiumChecking] = useState(false);

  const [history, setHistory] = useState<HistorySummary>({
    total: 0,
    vagas: 0,
    horas_com_vaga: {},
  });
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [runner, setRunner] = useState<RunnerState>({
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
  });
  const [statusBar, setStatusBar] = useState("Pronto.");
  const [showPass, setShowPass] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [showDocsModal, setShowDocsModal] = useState(false);
  const [showProofsModal, setShowProofsModal] = useState(false);
  const [showCompanionModal, setShowCompanionModal] = useState(false);
  const [newCompanion, setNewCompanion] = useState({
    nome: "",
    sobrenome: "",
    nascimento: "",
    parentesco: "Filho/a",
  });
  const [extFiles, setExtFiles] = useState<
    Array<{ name: string; content: string }>
  >([]);
  const [selectedExtFile, setSelectedExtFile] = useState("content.js");
  const [catalogFilter, setCatalogFilter] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiFieldLabel, setAiFieldLabel] = useState("");
  const [aiFieldAnswer, setAiFieldAnswer] = useState("");
  const [aiReply, setAiReply] = useState("");
  const [aiActions, setAiActions] = useState<
    Array<{ step: number; tool: string; summary: string; ok: boolean }>
  >([]);
  const [nowClock, setNowClock] = useState(() => new Date());
  const detectedBrowserTz = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo",
    []
  );

  const [dialog, setDialog] = useState<{
    title: string;
    message: string;
    mode: "info" | "confirm" | "prompt";
    defaultValue?: string;
    resolve: (res: string | boolean | null) => void;
  } | null>(null);

  const lastBeepRef = useRef(0);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  const openDialog = useCallback(
    (
      message: string,
      mode: "info" | "confirm" | "prompt" = "info",
      defaultValue = "",
      title = "PrenotaBot Livre"
    ) => {
      return new Promise<string | boolean | null>((resolve) => {
        setDialog({ title, message, mode, defaultValue, resolve });
      });
    },
    []
  );

  const fetchBootstrap = useCallback(async () => {
    const resp = await fetch("/api/bootstrap");
    const data = (await resp.json()) as BootstrapResponse;
    setProfiles(data.profiles);
    setActiveProfile(data.activeProfile);
    setCfg(data.cfg);
    setEnv(data.env);
    setCatalog(data.catalog);
    setFiles(data.files);
    setProofs(data.proofs);
    setHistory(data.history);
    setRunner(data.runner);
    if (data.readiness) setReadiness(data.readiness);
    if (data.otp !== undefined) setLatestOtp(data.otp ?? null);
    lastBeepRef.current = data.runner.beepSeq;
    setLoading(false);

    if (!data.env.PRENOTAMI_EMAIL || !data.cfg.servicos.length) {
      setShowWizard(true);
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    const resp = await fetch("/api/history");
    const data = (await resp.json()) as {
      summary: HistorySummary;
      recent: HistoryRow[];
    };
    setHistory(data.summary);
    setHistoryRows(data.recent);
  }, []);

  const refreshExtFiles = useCallback(async (profile: string) => {
    const resp = await fetch(
      `/api/extension/files?profile=${encodeURIComponent(profile)}`
    );
    const data = (await resp.json()) as {
      files: Array<{ name: string; content: string }>;
    };
    setExtFiles(data.files);
  }, []);

  const refreshChromiumStatus = useCallback(async (profile: string) => {
    setChromiumChecking(true);
    try {
      const resp = await fetch(
        `/api/chromium/status?profile=${encodeURIComponent(profile)}`
      );
      const data = (await resp.json()) as ChromiumBridgeStatus;
      setChromiumStatus(data);
    } catch {
      // ignore
    } finally {
      setChromiumChecking(false);
    }
  }, []);

  const checkOtpNow = useCallback(async (refreshImap = true) => {
    setOtpChecking(true);
    try {
      const resp = await fetch(
        `/api/otp/latest?refresh=${refreshImap ? "1" : "0"}&force=${refreshImap ? "1" : "0"}`
      );
      const data = (await resp.json()) as {
        ok: boolean;
        otp: OtpRecord | null;
        error?: string;
      };
      if (data.otp) {
        setLatestOtp(data.otp);
        setOtpFeedback(`Código ${data.otp.code} pronto (${data.otp.source}).`);
      } else if (data.error) {
        setOtpFeedback(data.error);
      } else {
        setOtpFeedback("Nenhum código recente encontrado de noreply-prenotami@esteri.it.");
      }
    } catch (e) {
      setOtpFeedback(e instanceof Error ? e.message : String(e));
    } finally {
      setOtpChecking(false);
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNowClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    void fetchBootstrap();
    void refreshHistory();
  }, [fetchBootstrap, refreshHistory]);

  useEffect(() => {
    if (activeProfile) {
      void refreshExtFiles(activeProfile);
      void refreshChromiumStatus(activeProfile);
    }
  }, [activeProfile, refreshExtFiles, refreshChromiumStatus]);

  useEffect(() => {
    const interval = setInterval(
      async () => {
        try {
          const resp = await fetch("/api/bot/status");
          const data = (await resp.json()) as {
            runner: RunnerState;
            catalog: CatalogItem[];
            history: HistorySummary;
            readiness?: ReadinessReport;
            otp?: OtpRecord | null;
          };
          setRunner(data.runner);
          setHistory(data.history);
          if (data.readiness) setReadiness(data.readiness);
          if (data.otp !== undefined) setLatestOtp(data.otp ?? null);
          if (data.runner.beepSeq > lastBeepRef.current) {
            lastBeepRef.current = data.runner.beepSeq;
            playBeep(4);
          }
        } catch {
          // ignore
        }
      },
      runner.running ? 1200 : 4000
    );
    return () => clearInterval(interval);
  }, [runner.running]);

  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [runner.logs.length]);

  const saveAll = async (
    quiet = false,
    nextCfg?: BotConfig,
    nextEnv?: EnvMap
  ) => {
    const c = nextCfg ?? cfg;
    const e = nextEnv ?? env;
    if (!c || !e) return;
    const resp = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: activeProfile, cfg: c, env: e }),
    });
    const data = await resp.json();
    setCfg(data.cfg);
    setEnv(data.env);
    if (data.readiness) setReadiness(data.readiness);
    void refreshExtFiles(activeProfile);
    if (!quiet) {
      setStatusBar(`Salvo às ${data.savedAt}.`);
    }
  };

  const switchProfile = async (name: string) => {
    await saveAll(true);
    const resp = await fetch("/api/profiles/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await resp.json();
    setActiveProfile(data.activeProfile);
    setCfg(data.cfg);
    setProfiles(data.profiles);
    if (data.readiness) setReadiness(data.readiness);
    setStatusBar(`Perfil '${name}' carregado.`);
  };

  const createProfile = async (copy = false) => {
    const name = await openDialog(
      "Nome do novo perfil (ex.: cuiaba_passaporte):",
      "prompt"
    );
    if (typeof name !== "string" || !name.trim()) return;
    await saveAll(true);
    const resp = await fetch("/api/profiles/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        cfg: copy ? cfg : undefined,
      }),
    });
    const data = await resp.json();
    setActiveProfile(data.activeProfile);
    setCfg(data.cfg);
    setProfiles(data.profiles);
    if (data.readiness) setReadiness(data.readiness);
    setStatusBar(`Perfil '${data.activeProfile}' criado.`);
  };

  const handleTestNotifications = async () => {
    if (!env) return;
    await saveAll(true);
    playBeep(2);
    const resp = await fetch("/api/test-notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ env }),
    });
    const data = (await resp.json()) as {
      results: Record<string, string>;
    };
    const msg =
      "Resultado do teste:\n\n" +
      Object.entries(data.results)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
    await openDialog(msg);
  };

  const handleTestImapOtp = async () => {
    if (!env) return;
    setOtpChecking(true);
    try {
      await saveAll(true);
      const resp = await fetch("/api/otp/test-imap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env }),
      });
      const data = await resp.json();
      if (data.otp) {
        setLatestOtp(data.otp);
        setOtpFeedback(
          `Conectado (${data.host})! Último OTP: ${data.otp.code} (${data.matchedCount ?? 1} e-mail(s) de noreply-prenotami@esteri.it).`
        );
      } else if (data.ok) {
        setOtpFeedback(
          `Conectado com sucesso em ${data.host}! Nenhum OTP recente na caixa de entrada agora.`
        );
      } else {
        setOtpFeedback(data.error || "Falha ao consultar IMAP.");
      }
    } catch (e) {
      setOtpFeedback(e instanceof Error ? e.message : String(e));
    } finally {
      setOtpChecking(false);
    }
  };

  const startBot = async (
    discover: boolean,
    forceImmediate = false,
    overrideCfg?: BotConfig,
    overrideEnv?: EnvMap
  ) => {
    const c = overrideCfg ?? cfg;
    const e = overrideEnv ?? env;
    if (!c || !e) return;
    await saveAll(true, c, e);

    const endpoint = discover ? "/api/bot/start" : "/api/automation/start-all";
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: activeProfile,
        discover,
        forceImmediate,
        cfg: c,
        env: e,
      }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      await openDialog(err.error || "Não foi possível iniciar.");
      return;
    }
    const data = await resp.json();
    setRunner(data.runner);
    if (data.chromiumSync?.connected) {
      setStatusBar(
        `Monitor, Radar e Chromium sincronizados (${data.chromiumSync.opened?.length ?? 0} aba(s) nova(s)).`
      );
      void refreshChromiumStatus(activeProfile);
    }
    setActiveTab("inicio");
  };

  const stopBot = async () => {
    const resp = await fetch("/api/bot/stop", { method: "POST" });
    const data = await resp.json();
    setRunner(data.runner);
  };

  const uploadFiles = async (fileList: FileList): Promise<string[]> => {
    const fd = new FormData();
    Array.from(fileList).forEach((f) => fd.append("files", f));
    const resp = await fetch("/api/files", { method: "POST", body: fd });
    const data = (await resp.json()) as {
      uploaded: Array<{ name: string }>;
      files: FileEntry[];
    };
    setFiles(data.files);
    return data.uploaded.map((f) => f.name);
  };

  const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length || !cfg) return;
    const added = await uploadFiles(e.target.files);
    const nextCfg = {
      ...cfg,
      documentos: Array.from(new Set([...cfg.documentos, ...added])),
    };
    setCfg(nextCfg);
    await saveAll(true, nextCfg);
    e.target.value = "";
  };

  const deleteUploadedFile = async (name: string) => {
    const resp = await fetch(`/api/files/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    const data = (await resp.json()) as { files: FileEntry[] };
    setFiles(data.files);
  };

  const addServiceId = (sid: number) => {
    if (!cfg) return;
    if (!cfg.servicos.includes(sid)) {
      setCfg({ ...cfg, servicos: [...cfg.servicos, sid] });
      setStatusBar(`Serviço ${sid} adicionado.`);
    }
  };

  const detectBrowserTimezone = async () => {
    if (!cfg) return;
    const isUtcMinus4 =
      detectedBrowserTz === "America/Cuiaba" ||
      detectedBrowserTz === "America/Manaus" ||
      detectedBrowserTz === "America/Campo_Grande" ||
      detectedBrowserTz === "America/Porto_Velho" ||
      detectedBrowserTz === "America/Boa_Vista";
    const chosenTz = isUtcMinus4
      ? detectedBrowserTz
      : detectedBrowserTz.startsWith("America/")
        ? detectedBrowserTz
        : "America/Sao_Paulo";
    const target = targetForTimezone(chosenTz);
    const nextCfg: BotConfig = {
      ...cfg,
      fuso_horario: chosenTz,
      horario_alvo: target,
      dias_semana: cfg.dias_semana.length ? cfg.dias_semana : [1],
    };
    await saveAll(false, nextCfg, env ?? undefined);
  };

  const runAiAssist = async (
    mode: "readiness" | "map_field" | "chat" | "autonomous",
    overridePrompt?: string
  ) => {
    if (aiLoading) return;
    setAiLoading(true);
    try {
      await saveAll(true);
      const effectivePrompt =
        typeof overridePrompt === "string" ? overridePrompt : aiPrompt;
      const resp = await fetch("/api/ai/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          prompt: effectivePrompt,
          fieldLabel: aiFieldLabel,
          profile: activeProfile,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setAiReply(`Erro: ${data.error || "Falha ao consultar assistente."}`);
        setAiActions([]);
      } else {
        setAiReply(data.reply || "");
        setAiActions(Array.isArray(data.actions) ? data.actions : []);
        if (data.updatedCfg) {
          setCfg(data.updatedCfg);
          void refreshExtFiles(activeProfile);
          setStatusBar("Configuração otimizada pelo Agente IA.");
        }
        if (data.updatedRunner) {
          setRunner(data.updatedRunner);
        }
        if (data.suggestedValue && !aiFieldAnswer) {
          setAiFieldAnswer(data.suggestedValue);
        }
      }
    } catch (e) {
      setAiReply(
        `Erro de conexão: ${e instanceof Error ? e.message : String(e)}`
      );
      setAiActions([]);
    } finally {
      setAiLoading(false);
    }
  };

  const openInChromium = async (url: string) => {
    try {
      const resp = await fetch("/api/chromium/open-tab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: activeProfile, url }),
      });
      const data = await resp.json();
      if (data.ok) {
        setStatusBar(`Aba aberta no Chromium: ${data.url}`);
        void refreshChromiumStatus(activeProfile);
      } else {
        setStatusBar(data.error || "Inicie o pacote Chromium local primeiro.");
      }
    } catch {
      setStatusBar("Inicie o Chromium Dedicado local para abrir abas remotamente.");
    }
  };

  const generateNtfyTopic = () => {
    if (!env) return;
    const arr = new Uint8Array(5);
    crypto.getRandomValues(arr);
    const hex = Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
    setEnv({ ...env, NTFY_TOPICO: `prenotabot-${hex}` });
  };

  const simulateWhatsappRadar = async () => {
    if (!cfg) return;
    await saveAll(true);
    playBeep(3);
    const sid = cfg.servicos[0] ?? 5402;
    const resp = await fetch("/api/radar/whatsapp-trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: activeProfile,
        sender: cfg.radar_whatsapp.numero_radar || "+55 47 92004-1774",
        message: `VAGA DISPONIVEL serviço ${sid} — Prenot@mi Radar`,
        bookingUrl: `https://prenotami.esteri.it/Services/Booking/${sid}`,
      }),
    });
    const data = await resp.json();
    if (data.runner) setRunner(data.runner);
    setStatusBar("Alerta do Radar WhatsApp disparado.");
  };

  const filteredCatalog = useMemo(() => {
    const q = catalogFilter.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (c) =>
        String(c.id).includes(q) ||
        c.consulado.toLowerCase().includes(q) ||
        c.nome.toLowerCase().includes(q)
    );
  }, [catalog, catalogFilter]);

  if (loading || !cfg || !env) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-600 text-sm">
        Carregando PrenotaBot Livre...
      </div>
    );
  }

  const primarySid = cfg.servicos[0] ?? 5402;
  const startLabel = computeStartLabel(
    cfg.horario_alvo,
    cfg.antecedencia_minutos
  );
  const score = readiness?.score ?? 0;

  const badgeTargetTab = (id: string): TabId => {
    if (id === "horario" || id === "radar") return "horario";
    return "dados";
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-900">
      {/* Compact Header with Tricolor Bar */}
      <header className="bg-[#1f2a37] text-white shadow-sm">
        <div className="flex h-1.5 w-full">
          <div className="flex-1 bg-[#009246]" />
          <div className="flex-1 bg-white" />
          <div className="flex-1 bg-[#CE2B37]" />
        </div>
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-lg font-bold tracking-tight">
              PrenotaBot Livre
            </h1>
            <span className="text-xs text-slate-300 hidden sm:inline">
              Chromium Dedicado • OTP Automático • Radar WhatsApp
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <select
              aria-label="Perfil ativo"
              value={activeProfile}
              onChange={(e) => void switchProfile(e.target.value)}
              className="rounded border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs font-medium text-white"
            >
              {profiles.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void saveAll(false)}
              className="rounded bg-[#009246] px-3 py-1 font-semibold text-white hover:bg-[#007a3a] transition"
            >
              Salvar
            </button>
            <button
              type="button"
              onClick={() => setShowWizard(true)}
              className="rounded border border-slate-500 px-2.5 py-1 text-slate-200 hover:bg-slate-700 transition"
            >
              Assistente
            </button>
          </div>
        </div>
      </header>

      {/* Main Clean 5-Tab Workspace */}
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-4">
        <nav className="flex flex-wrap gap-1 border-b border-slate-300">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setActiveTab(t.id);
                if (t.id === "historico") void refreshHistory();
                if (t.id === "chromium") void refreshChromiumStatus(activeProfile);
              }}
              className={`rounded-t-md px-4 py-2.5 text-xs font-semibold transition ${
                activeTab === t.id
                  ? "border border-b-white border-slate-300 bg-white text-[#1f2a37] -mb-px"
                  : "text-slate-600 hover:bg-slate-200/70"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 rounded-b-lg border border-t-0 border-slate-300 bg-white p-5 shadow-sm">
          {/* ==================== TAB 1: INICIO (SIMPLES & DIRETO) ==================== */}
          {activeTab === "inicio" && (
            <div className="space-y-5">
              {/* Hero Control Card: Status + Countdown + 2 Primary Actions Only */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 to-emerald-50/40 p-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${
                        runner.running ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
                      }`}
                    />
                    <span className="text-lg font-bold text-[#1f2a37]">
                      {runner.bigStatus}
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                        score >= 80
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      Prontidão {score}%
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                    <span>
                      Brasília: <strong className="font-mono text-slate-800">{formatClockInZone(nowClock, "America/Sao_Paulo")}</strong> (16:00)
                    </span>
                    <span>
                      Cuiabá/AM: <strong className="font-mono text-slate-800">{formatClockInZone(nowClock, "America/Cuiaba")}</strong> (15:00)
                    </span>
                    {readiness && (
                      <span className="text-emerald-800 font-semibold">
                        Próximo início: {formatRemaining(readiness.secondsRemaining)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {!runner.running ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void startBot(false, false)}
                        className="rounded-lg bg-[#009246] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[#007a3a] transition"
                      >
                        Iniciar Segunda ({startLabel})
                      </button>
                      <button
                        type="button"
                        onClick={() => void startBot(false, true)}
                        className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700 transition"
                      >
                        Testar Agora
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void stopBot()}
                      className="rounded-lg bg-[#CE2B37] px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-red-700 transition"
                    >
                      Parar Monitoramento
                    </button>
                  )}
                </div>
              </div>

              {/* Radar Alert Banner (Only shown when triggered) */}
              {runner.lastRadarTrigger && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-[#009246] bg-emerald-50 p-3.5 text-xs text-emerald-950">
                  <div>
                    <div className="font-bold text-[#007a3a]">
                      VAGA DETECTADA PELO RADAR ({runner.lastRadarTrigger.sender}) às {runner.lastRadarTrigger.at}
                    </div>
                    <div className="mt-0.5">{runner.lastRadarTrigger.message}</div>
                  </div>
                  <a
                    href={`${runner.lastRadarTrigger.bookingUrl}#pb_radar=1`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg bg-[#009246] px-4 py-2 font-bold text-white shadow-sm hover:bg-[#007a3a]"
                  >
                    Abrir Vaga Agora
                  </a>
                </div>
              )}

              {/* Clickable Readiness Checklist (Guides lay users directly to missing fields) */}
              {readiness && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 text-xs">
                  {readiness.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      title={item.detail}
                      onClick={() => setActiveTab(badgeTargetTab(item.id))}
                      className={`rounded-lg border p-2.5 text-left transition ${
                        item.ok
                          ? "border-emerald-200 bg-emerald-50/60 text-emerald-900 hover:bg-emerald-50"
                          : "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                      }`}
                    >
                      <div className="font-bold flex items-center justify-between">
                        <span>{item.label}</span>
                        <span>{item.ok ? "✓" : "!"}</span>
                      </div>
                      <div className="truncate text-[11px] opacity-80 mt-0.5">
                        {item.detail}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* 3 Clear Visual Step Cards — No Wall of Buttons */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-xs">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 flex flex-col justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                      Passo 1 • Portal Oficial
                    </div>
                    <h3 className="text-sm font-bold text-slate-800 mt-1">
                      Login manual &amp; aba do serviço {primarySid}
                    </h3>
                    <p className="text-slate-600 mt-1 leading-relaxed">
                      Entre na sua conta manualmente na 1ª aba. O formulário preenche sozinho e você confirma no final.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <a
                      href="https://prenotami.esteri.it/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 rounded-md border border-emerald-600 bg-white py-2 text-center font-semibold text-emerald-800 hover:bg-emerald-50"
                    >
                      Abrir Login
                    </a>
                    <a
                      href={`https://prenotami.esteri.it/Services/Booking/${primarySid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 rounded-md bg-[#1f2a37] py-2 text-center font-semibold text-white hover:bg-slate-800"
                    >
                      Abrir Serviço {primarySid}
                    </a>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 flex flex-col justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-teal-700">
                      Passo 2 • Radar WA &amp; OTP Email
                    </div>
                    <h3 className="text-sm font-bold text-slate-800 mt-1">
                      {latestOtp ? `Último OTP: ${latestOtp.code}` : "Monitor Radar + Leitor OTP"}
                    </h3>
                    <p className="text-slate-600 mt-1 leading-relaxed">
                      Captura códigos de <strong>noreply-prenotami@esteri.it</strong> e vigia o Radar <strong>{cfg.radar_whatsapp?.numero_radar || "+55 47 92004-1774"}</strong>.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <a
                      href="https://web.whatsapp.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 rounded-md border border-teal-600 bg-white py-2 text-center font-semibold text-teal-800 hover:bg-teal-50"
                    >
                      WhatsApp Web
                    </a>
                    <button
                      type="button"
                      disabled={otpChecking}
                      onClick={() => void checkOtpNow(true)}
                      className="flex-1 rounded-md bg-teal-700 py-2 font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                    >
                      {otpChecking ? "Buscando..." : "Buscar OTP"}
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 flex flex-col justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-blue-700">
                      Passo 3 • Pacote Pré-Instalado
                    </div>
                    <h3 className="text-sm font-bold text-slate-800 mt-1">
                      Programa + Chromium Dedicado
                    </h3>
                    <p className="text-slate-600 mt-1 leading-relaxed">
                      Tudo pré-instalado: basta extrair o ZIP e clicar em <strong>INICIAR-AQUI.bat</strong> (ou <code>./iniciar-aqui.sh</code>).
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={`/api/release/portable-zip?profile=${encodeURIComponent(activeProfile)}`}
                      download="PrenotaBot-Livre-Portatil.zip"
                      className="flex-1 rounded-md bg-blue-600 py-2 text-center font-semibold text-white hover:bg-blue-700"
                    >
                      Baixar Completo (.zip)
                    </a>
                    <button
                      type="button"
                      onClick={() => setActiveTab("chromium")}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Ajustar
                    </button>
                  </div>
                </div>
              </div>

              {/* Clean Single-Bar AI Command */}
              <div className="rounded-xl border border-purple-200 bg-purple-50/40 p-3.5 space-y-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-purple-950">
                    Assistente IA — Peça qualquer ajuste em português simples
                  </span>
                  <button
                    type="button"
                    disabled={aiLoading}
                    onClick={() => void runAiAssist("autonomous")}
                    className="rounded-md bg-purple-700 px-3 py-1 font-semibold text-white hover:bg-purple-800 disabled:opacity-50"
                  >
                    {aiLoading ? "Executando..." : "Otimizar tudo automaticamente"}
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && aiPrompt.trim() && !aiLoading) {
                        void runAiAssist("chat");
                      }
                    }}
                    placeholder="Ex.: 'Ajuste para Cuiabá 15h', 'Verifique se o site está lento' ou 'Inicie teste agora'..."
                    className="flex-1 rounded-lg border border-purple-200 bg-white px-3 py-2"
                  />
                  <button
                    type="button"
                    disabled={aiLoading || !aiPrompt.trim()}
                    onClick={() => void runAiAssist("chat")}
                    className="rounded-lg bg-[#1f2a37] px-4 py-2 font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    Enviar
                  </button>
                </div>
                {(aiActions.length > 0 || aiReply) && (
                  <div className="rounded-lg border border-purple-200 bg-white p-3 space-y-1.5">
                    {aiActions.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {aiActions.map((act) => (
                          <span
                            key={`${act.step}-${act.tool}`}
                            className={`rounded px-2 py-0.5 font-mono text-[11px] font-semibold ${
                              act.ok
                                ? "bg-emerald-100 text-emerald-900"
                                : "bg-red-100 text-red-900"
                            }`}
                          >
                            {act.step}. {act.summary}
                          </span>
                        ))}
                      </div>
                    )}
                    {aiReply && (
                      <div className="whitespace-pre-wrap text-slate-700 leading-relaxed">
                        {aiReply}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Clean Live Log Console + Discrete Modals Trigger */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span className="font-semibold">
                    Registro ao vivo ({runner.attempts} tentativa(s))
                  </span>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowDocsModal(true)}
                      className="text-slate-700 hover:underline font-medium"
                    >
                      PDFs enviados ({files.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowProofsModal(true)}
                      className="text-slate-700 hover:underline font-medium"
                    >
                      Comprovantes ({proofs.length})
                    </button>
                  </div>
                </div>
                <div
                  ref={logBoxRef}
                  className="h-56 overflow-y-auto rounded-lg bg-[#111827] p-3 font-mono text-xs leading-relaxed text-slate-200"
                >
                  {runner.logs.length === 0 ? (
                    <div className="text-slate-400">
                      Tudo pronto. Clique em &quot;Iniciar Segunda ({startLabel})&quot; para aguardar o horário de abertura ou &quot;Testar Agora&quot; para checar imediatamente.
                    </div>
                  ) : (
                    runner.logs.map((entry) => {
                      const cls =
                        entry.level === "ERROR"
                          ? "text-red-400"
                          : entry.level === "WARNING"
                            ? "text-amber-300"
                            : entry.level === "OK"
                              ? "text-emerald-400"
                              : "text-slate-200";
                      return (
                        <div key={entry.id} className={cls}>
                          {entry.time} [{entry.level}] {entry.message}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ==================== TAB 2: MEUS DADOS (CONTA + SERVICO + FORMULARIO) ==================== */}
          {activeTab === "dados" && (
            <div className="space-y-6 text-xs">
              {/* Account Card */}
              <section className="rounded-xl border border-slate-200 p-4 space-y-3">
                <h2 className="text-sm font-bold text-slate-800">
                  1. Conta do Prenot@mi (apenas para autofill no navegador)
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      E-mail de acesso
                    </label>
                    <input
                      type="email"
                      value={env.PRENOTAMI_EMAIL}
                      onChange={(e) =>
                        setEnv({ ...env, PRENOTAMI_EMAIL: e.target.value })
                      }
                      className="w-full rounded border border-slate-300 px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Senha (você confirma o login manualmente)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type={showPass ? "text" : "password"}
                        value={env.PRENOTAMI_SENHA}
                        onChange={(e) =>
                          setEnv({ ...env, PRENOTAMI_SENHA: e.target.value })
                        }
                        className="flex-1 rounded border border-slate-300 px-3 py-2"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass(!showPass)}
                        className="rounded border border-slate-300 px-2.5 py-2 text-slate-600 hover:bg-slate-50"
                      >
                        {showPass ? "Ocultar" : "Ver"}
                      </button>
                    </div>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-slate-700 font-medium">
                  <input
                    type="checkbox"
                    checked={cfg.autofill_login}
                    onChange={(e) =>
                      setCfg({
                        ...cfg,
                        autofill_login: e.target.checked,
                        auto_login: false,
                      })
                    }
                  />
                  Preencher e-mail e senha automaticamente na tela de login (mantendo login e 1ª aba sob seu controle)
                </label>
              </section>

              {/* Service Card */}
              <section className="rounded-xl border border-slate-200 p-4 space-y-3">
                <h2 className="text-sm font-bold text-slate-800">
                  2. Serviço Consular
                </h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {QUICK_SERVICES.slice(0, 2).map((q) => {
                    const active = cfg.servicos.includes(q.id);
                    return (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => setCfg({ ...cfg, servicos: [q.id] })}
                        className={`rounded-lg border p-3 text-left transition ${
                          active
                            ? "border-[#009246] bg-emerald-50 text-emerald-950"
                            : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                        }`}
                      >
                        <div className="font-bold">{q.label}</div>
                        <div className="text-[11px] text-slate-600 mt-0.5">{q.desc}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <label className="font-semibold text-slate-700">
                    ID(s) selecionado(s):
                  </label>
                  <input
                    type="text"
                    value={cfg.servicos.join(", ")}
                    onChange={(e) => {
                      const ids = e.target.value
                        .replace(/;/g, ",")
                        .split(",")
                        .map((x) => x.trim())
                        .filter((x) => /^\d+$/.test(x))
                        .map(Number);
                      setCfg({ ...cfg, servicos: ids });
                    }}
                    className="w-40 rounded border border-slate-300 px-3 py-1.5"
                  />
                  <details className="flex-1 min-w-[240px]">
                    <summary className="cursor-pointer font-semibold text-blue-700 hover:underline">
                      Buscar outro consulado / serviço no catálogo
                    </summary>
                    <div className="mt-2 space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={catalogFilter}
                          onChange={(e) => setCatalogFilter(e.target.value)}
                          placeholder="Filtrar por cidade, nome ou ID..."
                          className="flex-1 rounded border border-slate-300 px-3 py-1.5"
                        />
                        <button
                          type="button"
                          disabled={runner.running}
                          onClick={() => void startBot(true, true)}
                          className="rounded border border-slate-300 bg-slate-50 px-3 py-1.5 font-semibold hover:bg-slate-100"
                        >
                          Atualizar lista
                        </button>
                      </div>
                      <div className="max-h-48 overflow-y-auto rounded border border-slate-200">
                        <table className="w-full text-left">
                          <tbody className="divide-y divide-slate-100">
                            {filteredCatalog.map((c) => (
                              <tr key={`${c.consulado}-${c.id}`} className="hover:bg-slate-50">
                                <td className="px-2 py-1.5 font-mono font-semibold">{c.id}</td>
                                <td className="px-2 py-1.5">{c.consulado}</td>
                                <td className="px-2 py-1.5">{c.nome}</td>
                                <td className="px-2 py-1.5 text-right">
                                  <button
                                    type="button"
                                    onClick={() => addServiceId(c.id)}
                                    className="rounded border border-slate-300 px-2 py-0.5 hover:bg-[#009246] hover:text-white"
                                  >
                                    Usar
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </details>
                </div>
              </section>

              {/* Personal Form Data Card */}
              <section className="rounded-xl border border-slate-200 p-4 space-y-3">
                <h2 className="text-sm font-bold text-slate-800">
                  3. Dados para preencher o formulário automaticamente
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="sm:col-span-2 lg:col-span-3">
                    <label className="block font-semibold text-slate-700 mb-1">
                      Endereço completo
                    </label>
                    <input
                      type="text"
                      value={cfg.dados.endereco}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          dados: { ...cfg.dados, endereco: e.target.value },
                        })
                      }
                      placeholder="Ex.: Rua Exemplo, 123 - Bairro - Cidade/UF - CEP"
                      className="w-full rounded border border-slate-300 px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Altura (cm)
                    </label>
                    <input
                      type="text"
                      value={cfg.dados.altura_cm}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          dados: { ...cfg.dados, altura_cm: e.target.value },
                        })
                      }
                      placeholder="175"
                      className="w-full rounded border border-slate-300 px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Estado civil
                    </label>
                    <select
                      value={cfg.dados.estado_civil}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          dados: { ...cfg.dados, estado_civil: e.target.value },
                        })
                      }
                      className="w-full rounded border border-slate-300 px-3 py-2 bg-white"
                    >
                      {ESTADO_CIVIL.map((o) => (
                        <option key={o} value={o}>
                          {o || "Selecione..."}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Cor dos olhos
                    </label>
                    <select
                      value={cfg.dados.cor_olhos}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          dados: { ...cfg.dados, cor_olhos: e.target.value },
                        })
                      }
                      className="w-full rounded border border-slate-300 px-3 py-2 bg-white"
                    >
                      {COR_OLHOS.map((o) => (
                        <option key={o} value={o}>
                          {o || "Selecione..."}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Filhos menores?
                    </label>
                    <select
                      value={cfg.dados.filhos_menores}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          dados: { ...cfg.dados, filhos_menores: e.target.value },
                        })
                      }
                      className="w-full rounded border border-slate-300 px-3 py-2 bg-white"
                    >
                      {SIM_NAO.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Quantidade de filhos
                    </label>
                    <input
                      type="text"
                      value={cfg.dados.quantidade_filhos}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          dados: {
                            ...cfg.dados,
                            quantidade_filhos: e.target.value,
                          },
                        })
                      }
                      className="w-full rounded border border-slate-300 px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Passaporte italiano vencido?
                    </label>
                    <select
                      value={cfg.dados.passaporte_vencido}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          dados: {
                            ...cfg.dados,
                            passaporte_vencido: e.target.value,
                          },
                        })
                      }
                      className="w-full rounded border border-slate-300 px-3 py-2 bg-white"
                    >
                      {SIM_NAO.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              {/* Documents (with <= 2 MB validator) & Companions */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <section className="rounded-xl border border-slate-200 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-slate-800">
                      4. Documentos PDF (limite 2 MB no Prenot@mi)
                    </h2>
                    <label className="cursor-pointer rounded bg-[#1f2a37] px-3 py-1.5 font-semibold text-white hover:bg-slate-800">
                      + Enviar PDF
                      <input
                        type="file"
                        multiple
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={handleDocUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                  {cfg.documentos.length === 0 ? (
                    <p className="text-slate-500">
                      Nenhum documento anexado. Para Primeiro Passaporte, envie seu comprovante de residência em PDF com até 2 MB.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {cfg.documentos.map((doc) => {
                        const meta = files.find((f) => f.name === doc);
                        const oversized = meta ? meta.size > MAX_PDF_BYTES : false;
                        return (
                          <div
                            key={doc}
                            className={`flex items-center justify-between rounded border px-3 py-2 ${
                              oversized
                                ? "border-red-300 bg-red-50 text-red-900"
                                : "border-slate-200 bg-slate-50"
                            }`}
                          >
                            <div>
                              <span className="font-semibold">{doc}</span>{" "}
                              {meta ? (
                                <span
                                  className={`ml-1 text-[11px] font-mono ${
                                    oversized ? "text-red-700 font-bold" : "text-emerald-700"
                                  }`}
                                >
                                  ({(meta.size / 1024).toFixed(0)} KB
                                  {oversized ? " — Acima de 2 MB!" : " OK"})
                                </span>
                              ) : (
                                <span className="ml-1 text-[11px] text-amber-700">
                                  (não encontrado em files/)
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setCfg({
                                  ...cfg,
                                  documentos: cfg.documentos.filter((d) => d !== doc),
                                })
                              }
                              className="text-red-600 hover:underline font-medium"
                            >
                              Remover
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="rounded-xl border border-slate-200 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-slate-800">
                      5. Acompanhantes (se houver)
                    </h2>
                    <button
                      type="button"
                      onClick={() => setShowCompanionModal(true)}
                      className="rounded border border-slate-300 bg-slate-50 px-3 py-1.5 font-semibold hover:bg-slate-100"
                    >
                      + Adicionar
                    </button>
                  </div>
                  {cfg.acompanhantes.length === 0 ? (
                    <p className="text-slate-500">
                      Agendamento individual (sem acompanhantes).
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {cfg.acompanhantes.map((a, idx) => (
                        <div
                          key={`${a.nome}-${idx}`}
                          className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2"
                        >
                          <span>
                            <strong>{a.nome} {a.sobrenome}</strong> • {a.nascimento} ({a.parentesco})
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setCfg({
                                ...cfg,
                                acompanhantes: cfg.acompanhantes.filter(
                                  (_, i) => i !== idx
                                ),
                              })
                            }
                            className="text-red-600 hover:underline"
                          >
                            Excluir
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}

          {/* ==================== TAB 3: HORARIO, RADAR & OTP ==================== */}
          {activeTab === "horario" && (
            <div className="space-y-5 text-xs">
              {/* Timezone & Monday Opening */}
              <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-bold text-slate-800">
                      1. Horário de Abertura (Segunda-feira: 16h Brasília = 15h Cuiabá/AM)
                    </h2>
                    <p className="text-slate-600">
                      O monitor inicia automaticamente 1 a 2 minutos antes para garantir velocidade sem bloqueios.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void detectBrowserTimezone()}
                    className="rounded-lg border border-emerald-600 bg-white px-3 py-1.5 font-semibold text-emerald-800 hover:bg-emerald-50"
                  >
                    Detectar meu fuso ({detectedBrowserTz})
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-slate-700 mb-1">
                      Fuso horário
                    </label>
                    <select
                      value={cfg.fuso_horario || "America/Sao_Paulo"}
                      onChange={(e) => {
                        const tz = e.target.value;
                        setCfg({
                          ...cfg,
                          fuso_horario: tz,
                          horario_alvo: targetForTimezone(tz),
                        });
                      }}
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2"
                    >
                      {TIMEZONE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                      {!TIMEZONE_OPTIONS.some(
                        (o) => o.value === cfg.fuso_horario
                      ) &&
                        cfg.fuso_horario && (
                          <option value={cfg.fuso_horario}>
                            {cfg.fuso_horario}
                          </option>
                        )}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Horário alvo
                    </label>
                    <input
                      type="text"
                      value={cfg.horario_alvo}
                      onChange={(e) =>
                        setCfg({ ...cfg, horario_alvo: e.target.value })
                      }
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Antecedência (min)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={cfg.antecedencia_minutos}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          antecedencia_minutos: Number(e.target.value) || 2,
                        })
                      }
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 pt-1">
                  <span className="font-semibold text-slate-700">Dias:</span>
                  {DIAS.map((nome, idx) => {
                    const d = idx + 1;
                    const checked = cfg.dias_semana.includes(d);
                    return (
                      <label key={nome} className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...cfg.dias_semana, d].sort()
                              : cfg.dias_semana.filter((x) => x !== d);
                            setCfg({ ...cfg, dias_semana: next });
                          }}
                        />
                        {nome}
                      </label>
                    );
                  })}
                </div>
              </section>

              {/* Automatic OTP Email Reader (<noreply-prenotami@esteri.it>) */}
              <section className="rounded-xl border-2 border-blue-200 bg-blue-50/40 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-bold text-blue-950">
                      2. Leitor Automático de OTP (&lt;noreply-prenotami@esteri.it&gt;)
                    </h2>
                    <p className="text-slate-700">
                      O Chromium lê automaticamente pelo Webmail aberto <strong>OU</strong> pelo acesso IMAP abaixo (com Senha de App) e preenche o campo OTP no Prenot@mi.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={otpChecking}
                    onClick={() => void handleTestImapOtp()}
                    className="rounded-lg bg-blue-600 px-3.5 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {otpChecking ? "Verificando..." : "Testar e Buscar OTP agora"}
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      E-mail para ler OTP (IMAP)
                    </label>
                    <input
                      type="email"
                      value={env.IMAP_EMAIL}
                      onChange={(e) => setEnv({ ...env, IMAP_EMAIL: e.target.value })}
                      placeholder={env.PRENOTAMI_EMAIL || "seuemail@gmail.com"}
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Senha de App (Gmail/Outlook)
                    </label>
                    <input
                      type="password"
                      value={env.IMAP_SENHA_APP}
                      onChange={(e) =>
                        setEnv({ ...env, IMAP_SENHA_APP: e.target.value })
                      }
                      placeholder="16 caracteres (sem espaços)"
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Servidor IMAP (opcional)
                    </label>
                    <input
                      type="text"
                      value={env.IMAP_SERVIDOR}
                      onChange={(e) =>
                        setEnv({ ...env, IMAP_SERVIDOR: e.target.value })
                      }
                      placeholder="Auto (imap.gmail.com)"
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2"
                    />
                  </div>
                </div>

                {(otpFeedback || latestOtp) && (
                  <div className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-slate-700 flex flex-wrap items-center justify-between gap-2">
                    <span>{otpFeedback || "Monitor de OTP ativo."}</span>
                    {latestOtp && (
                      <span className="rounded bg-emerald-100 px-2.5 py-1 font-mono font-bold text-emerald-900">
                        OTP: {latestOtp.code} ({latestOtp.source})
                      </span>
                    )}
                  </div>
                )}
              </section>

              {/* Radar WhatsApp PC */}
              <section className="rounded-xl border border-teal-200 bg-teal-50/40 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-bold text-teal-950">
                      3. Radar WhatsApp Web PC (prenotamiradar.com.br)
                    </h2>
                    <p className="text-slate-600">
                      Monitora o WhatsApp Web no Chromium e abre a aba do agendamento assim que o Radar avisar vaga.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void simulateWhatsappRadar()}
                    className="rounded-lg border border-teal-700 bg-white px-3 py-1.5 font-semibold text-teal-800 hover:bg-teal-50"
                  >
                    Simular Radar Agora
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 font-semibold text-slate-800">
                    <input
                      type="checkbox"
                      checked={cfg.radar_whatsapp?.ativo !== false}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          radar_whatsapp: {
                            ...cfg.radar_whatsapp,
                            ativo: e.target.checked,
                          },
                        })
                      }
                    />
                    Radar ativo
                  </label>
                  <label className="flex items-center gap-2 font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={cfg.radar_whatsapp?.abrir_automatico !== false}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          radar_whatsapp: {
                            ...cfg.radar_whatsapp,
                            abrir_automatico: e.target.checked,
                          },
                        })
                      }
                    />
                    Abrir Prenot@mi + autofill ao detectar aviso
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Número do Radar
                    </label>
                    <input
                      type="text"
                      value={cfg.radar_whatsapp?.numero_radar ?? "+55 47 92004-1774"}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          radar_whatsapp: {
                            ...cfg.radar_whatsapp,
                            numero_radar: e.target.value,
                          },
                        })
                      }
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Palavras-chave de vaga
                    </label>
                    <input
                      type="text"
                      value={(cfg.radar_whatsapp?.palavras_chave ?? []).join(", ")}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          radar_whatsapp: {
                            ...cfg.radar_whatsapp,
                            palavras_chave: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          },
                        })
                      }
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2"
                    />
                  </div>
                </div>
              </section>

              {/* Optional Push Notifications Collapsible */}
              <details className="rounded-xl border border-slate-200 p-4">
                <summary className="cursor-pointer text-sm font-bold text-slate-800">
                  4. Avisos no celular (ntfy, WhatsApp CallMeBot, Telegram) — opcional
                </summary>
                <div className="mt-3 space-y-3">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <label className="block font-semibold text-slate-700 mb-1">
                        Tópico ntfy (app gratuito de push)
                      </label>
                      <input
                        type="text"
                        value={env.NTFY_TOPICO}
                        onChange={(e) =>
                          setEnv({ ...env, NTFY_TOPICO: e.target.value })
                        }
                        placeholder="prenotabot-xxxxxx"
                        className="w-full rounded border border-slate-300 px-3 py-2"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={generateNtfyTopic}
                      className="rounded border border-slate-300 bg-slate-50 px-3 py-2 font-semibold hover:bg-slate-100"
                    >
                      Gerar tópico
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Telegram Bot Token
                      </label>
                      <input
                        type="text"
                        value={env.TELEGRAM_TOKEN}
                        onChange={(e) =>
                          setEnv({ ...env, TELEGRAM_TOKEN: e.target.value })
                        }
                        className="w-full rounded border border-slate-300 px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Telegram Chat ID
                      </label>
                      <input
                        type="text"
                        value={env.TELEGRAM_CHAT_ID}
                        onChange={(e) =>
                          setEnv({ ...env, TELEGRAM_CHAT_ID: e.target.value })
                        }
                        className="w-full rounded border border-slate-300 px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        WhatsApp CallMeBot (telefone)
                      </label>
                      <input
                        type="text"
                        value={env.WHATSAPP_TELEFONE}
                        onChange={(e) =>
                          setEnv({ ...env, WHATSAPP_TELEFONE: e.target.value })
                        }
                        className="w-full rounded border border-slate-300 px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        WhatsApp CallMeBot API Key
                      </label>
                      <input
                        type="text"
                        value={env.WHATSAPP_APIKEY}
                        onChange={(e) =>
                          setEnv({ ...env, WHATSAPP_APIKEY: e.target.value })
                        }
                        className="w-full rounded border border-slate-300 px-3 py-2"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleTestNotifications()}
                    className="rounded-lg bg-[#009246] px-4 py-2 font-bold text-white hover:bg-[#007a3a]"
                  >
                    Testar avisos no celular
                  </button>
                </div>
              </details>
            </div>
          )}

          {/* ==================== TAB 4: CHROMIUM DEDICADO ==================== */}
          {activeTab === "chromium" && (
            <div className="space-y-5 text-xs">
              {/* Main One-Click Bundle Hero */}
              <section className="rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-slate-50 p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1 max-w-xl">
                    <h2 className="text-base font-bold text-emerald-950">
                      Pacote Pré-Instalado + Chromium Edição Dedicada Prenot@mi
                    </h2>
                    <p className="text-emerald-900 leading-relaxed">
                      Baixe o programa completo já pré-instalado (sem precisar de <code>npm install</code>) ou apenas o pacote do Chromium. Abre tudo integrado: painel web, Prenot@mi com autofill, captura automática de OTP (<strong>noreply-prenotami@esteri.it</strong>) e Radar WhatsApp.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`/api/release/portable-zip?profile=${encodeURIComponent(activeProfile)}`}
                      download="PrenotaBot-Livre-Portatil.zip"
                      className="rounded-xl bg-[#009246] px-5 py-3 text-sm font-bold text-white shadow hover:bg-[#007a3a] transition"
                    >
                      Baixar Programa Completo (.zip)
                    </a>
                    <a
                      href={`/api/chromium/bundle-zip?profile=${encodeURIComponent(activeProfile)}`}
                      download="chromium-dedicado-prenotami.zip"
                      className="rounded-xl border border-emerald-700 bg-white px-4 py-3 text-sm font-bold text-emerald-900 hover:bg-emerald-50 transition"
                    >
                      Só Chromium (.zip)
                    </a>
                  </div>
                </div>
                <div className="text-[11px] text-emerald-900 border-t border-emerald-200/70 pt-2">
                  <strong>Como usar em 2 passos:</strong> 1) Extraia o arquivo ZIP em uma pasta no PC • 2) Clique duas vezes em <code>INICIAR-AQUI.bat</code> (Windows) ou execute <code>./iniciar-aqui.sh</code> (Linux/macOS).
                </div>
              </section>

              {/* Simple Personalization */}
              <section className="rounded-xl border border-slate-200 p-4 space-y-4">
                <h3 className="text-sm font-bold text-slate-800">
                  Personalizar o Navegador
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Navegador Base
                    </label>
                    <select
                      value={cfg.chromium?.navegador ?? "chromium"}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          chromium: {
                            ...cfg.chromium,
                            navegador: e.target.value as BotConfig["chromium"]["navegador"],
                          },
                        })
                      }
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2"
                    >
                      <option value="chromium">Chromium (Código Aberto)</option>
                      <option value="ungoogled-chromium">Ungoogled Chromium</option>
                      <option value="brave">Brave Browser</option>
                      <option value="edge">Microsoft Edge</option>
                      <option value="chrome">Google Chrome</option>
                      <option value="custom">Caminho personalizado</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Abas extras do serviço {primarySid}
                    </label>
                    <select
                      value={cfg.chromium?.abrir_abas_extras ?? 2}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          chromium: {
                            ...cfg.chromium,
                            abrir_abas_extras: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2"
                    >
                      <option value={0}>0 abas extras</option>
                      <option value={1}>1 aba de agendamento</option>
                      <option value={2}>2 abas (recomendado)</option>
                      <option value={3}>3 abas de agendamento</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Webmail p/ capturar OTP
                    </label>
                    <select
                      value={
                        [
                          "https://mail.google.com/",
                          "https://outlook.live.com/mail/",
                          "https://mail.yahoo.com/",
                        ].includes(cfg.chromium?.url_webmail ?? "https://mail.google.com/")
                          ? cfg.chromium?.url_webmail ?? "https://mail.google.com/"
                          : "custom"
                      }
                      onChange={(e) => {
                        if (e.target.value !== "custom") {
                          setCfg({
                            ...cfg,
                            chromium: {
                              ...cfg.chromium,
                              url_webmail: e.target.value,
                            },
                          });
                        }
                      }}
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2"
                    >
                      <option value="https://mail.google.com/">Gmail (mail.google.com)</option>
                      <option value="https://outlook.live.com/mail/">Outlook / Hotmail</option>
                      <option value="https://mail.yahoo.com/">Yahoo Mail</option>
                      <option value="custom">Outro webmail (HTTPS)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Idioma do Chromium
                    </label>
                    <select
                      value={cfg.chromium?.idioma ?? "pt-BR"}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          chromium: {
                            ...cfg.chromium,
                            idioma: e.target.value,
                          },
                        })
                      }
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2"
                    >
                      <option value="pt-BR">Português (pt-BR)</option>
                      <option value="it-IT">Italiano (it-IT)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 pt-1">
                  <label className="flex items-center gap-2 font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={cfg.chromium?.modo_dedicado !== false}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          chromium: {
                            ...cfg.chromium,
                            modo_dedicado: e.target.checked,
                          },
                        })
                      }
                    />
                    Nova Aba exclusiva + Barra de Favoritos Prenot@mi
                  </label>
                  <label className="flex items-center gap-2 font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={cfg.chromium?.auto_otp_email !== false}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          chromium: {
                            ...cfg.chromium,
                            auto_otp_email: e.target.checked,
                          },
                        })
                      }
                    />
                    Capturar e preencher OTP automaticamente (&lt;noreply-prenotami@esteri.it&gt;)
                  </label>
                  <label className="flex items-center gap-2 font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={cfg.chromium?.abrir_whatsapp_ao_iniciar !== false}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          chromium: {
                            ...cfg.chromium,
                            abrir_whatsapp_ao_iniciar: e.target.checked,
                          },
                        })
                      }
                    />
                    Abrir WhatsApp Web (Radar) automaticamente ao iniciar
                  </label>
                  <label className="flex items-center gap-2 font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={cfg.chromium?.abrir_webmail_ao_iniciar !== false}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          chromium: {
                            ...cfg.chromium,
                            abrir_webmail_ao_iniciar: e.target.checked,
                          },
                        })
                      }
                    />
                    Abrir aba do Webmail (OTP) automaticamente ao iniciar
                  </label>
                  <label className="flex items-center gap-2 font-medium text-slate-800 sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={Boolean(cfg.chromium?.bloquear_sites_externos)}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          chromium: {
                            ...cfg.chromium,
                            bloquear_sites_externos: e.target.checked,
                          },
                        })
                      }
                    />
                    Modo Foco Total: incluir política Chromium permitindo apenas Prenot@mi, WhatsApp Web, Webmail e painel local
                  </label>
                </div>

                {/* Live Local CDP Status */}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-bold text-slate-800">
                      Ponte Chromium Local (127.0.0.1:{cfg.chromium?.porta_cdp ?? 9222}):{" "}
                      <span
                        className={
                          chromiumStatus?.connected
                            ? "text-emerald-700"
                            : "text-slate-500"
                        }
                      >
                        {chromiumStatus?.connected
                          ? `Conectado (${chromiumStatus.tabs.length} aba(s))`
                          : "Aguardando inicialização local"}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={chromiumChecking}
                      onClick={() => void refreshChromiumStatus(activeProfile)}
                      className="rounded border border-slate-300 bg-white px-3 py-1 font-semibold hover:bg-slate-100"
                    >
                      {chromiumChecking ? "Verificando..." : "Verificar conexão"}
                    </button>
                    {chromiumStatus?.connected && (
                      <button
                        type="button"
                        onClick={() =>
                          void openInChromium(
                            `https://prenotami.esteri.it/Services/Booking/${primarySid}`
                          )
                        }
                        className="rounded bg-[#009246] px-3 py-1 font-semibold text-white hover:bg-[#007a3a]"
                      >
                        Abrir serviço no Chromium
                      </button>
                    )}
                  </div>
                </div>
              </section>

              {/* Advanced Options neatly collapsed */}
              <details className="rounded-xl border border-slate-200 p-4">
                <summary className="cursor-pointer font-bold text-slate-700">
                  Opções avançadas (Tampermonkey, executável customizado, código da extensão)
                </summary>
                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        URL Webmail personalizada
                      </label>
                      <input
                        type="text"
                        value={cfg.chromium?.url_webmail ?? "https://mail.google.com/"}
                        onChange={(e) =>
                          setCfg({
                            ...cfg,
                            chromium: {
                              ...cfg.chromium,
                              url_webmail: e.target.value,
                            },
                          })
                        }
                        className="w-full rounded border border-slate-300 px-3 py-1.5"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Caminho do executável (opcional)
                      </label>
                      <input
                        type="text"
                        value={cfg.chromium?.caminho_executavel ?? ""}
                        onChange={(e) =>
                          setCfg({
                            ...cfg,
                            chromium: {
                              ...cfg.chromium,
                              caminho_executavel: e.target.value,
                            },
                          })
                        }
                        placeholder="Detectar automaticamente"
                        className="w-full rounded border border-slate-300 px-3 py-1.5"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Porta CDP Local
                      </label>
                      <input
                        type="number"
                        min={1024}
                        max={65535}
                        value={cfg.chromium?.porta_cdp ?? 9222}
                        onChange={(e) =>
                          setCfg({
                            ...cfg,
                            chromium: {
                              ...cfg.chromium,
                              porta_cdp: Number(e.target.value) || 9222,
                            },
                          })
                        }
                        className="w-full rounded border border-slate-300 px-3 py-1.5"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`/api/extension/download-zip?profile=${encodeURIComponent(activeProfile)}`}
                      download="prenotabot-chromium-extensao.zip"
                      className="rounded border border-slate-300 bg-slate-50 px-3 py-1.5 font-semibold hover:bg-slate-100"
                    >
                      Apenas Extensão (.zip)
                    </a>
                    <a
                      href={`/api/extension/userscript?profile=${encodeURIComponent(activeProfile)}`}
                      download="prenotabot-livre.user.js"
                      className="rounded border border-slate-300 bg-slate-50 px-3 py-1.5 font-semibold hover:bg-slate-100"
                    >
                      Userscript Tampermonkey (.user.js)
                    </a>
                    <a
                      href={`/api/chromium/launcher?os=win&profile=${encodeURIComponent(activeProfile)}`}
                      download="iniciar-prenotabot-chromium.bat"
                      className="rounded border border-slate-300 bg-slate-50 px-3 py-1.5 font-semibold hover:bg-slate-100"
                    >
                      Somente Inicializador Windows (.bat)
                    </a>
                    <a
                      href={`/api/chromium/launcher?os=linux&profile=${encodeURIComponent(activeProfile)}`}
                      download="iniciar-prenotabot-chromium.sh"
                      className="rounded border border-slate-300 bg-slate-50 px-3 py-1.5 font-semibold hover:bg-slate-100"
                    >
                      Somente Inicializador Linux (.sh)
                    </a>
                  </div>

                  <div>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {extFiles.map((f) => (
                        <button
                          key={f.name}
                          type="button"
                          onClick={() => setSelectedExtFile(f.name)}
                          className={`rounded px-2.5 py-1 font-mono ${
                            selectedExtFile === f.name
                              ? "bg-[#1f2a37] text-white"
                              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          {f.name}
                        </button>
                      ))}
                    </div>
                    <pre className="max-h-60 overflow-auto rounded bg-slate-900 p-3 font-mono text-[11px] text-slate-100">
                      {extFiles.find((f) => f.name === selectedExtFile)?.content ||
                        ""}
                    </pre>
                  </div>
                </div>
              </details>
            </div>
          )}

          {/* ==================== TAB 5: HISTORICO & IA ==================== */}
          {activeTab === "historico" && (
            <div className="space-y-5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2">
                    <div className="text-slate-500">Verificações</div>
                    <div className="text-lg font-bold">{history.total}</div>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2">
                    <div className="text-emerald-700">Vezes com vaga</div>
                    <div className="text-lg font-bold text-emerald-800">
                      {history.vagas}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void createProfile(false)}
                    className="rounded border border-slate-300 bg-white px-3 py-1.5 font-semibold hover:bg-slate-50"
                  >
                    + Novo Perfil
                  </button>
                  <a
                    href="/api/history/csv"
                    download="historico_verificacoes.csv"
                    className="rounded bg-[#1f2a37] px-3 py-1.5 font-semibold text-white hover:bg-slate-800"
                  >
                    Baixar CSV
                  </a>
                </div>
              </div>

              <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-3 py-2">Data / Hora</th>
                      <th className="px-3 py-2">Serviço</th>
                      <th className="px-3 py-2">Resultado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {historyRows.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-3 py-4 text-slate-500">
                          Nenhuma verificação registrada ainda.
                        </td>
                      </tr>
                    ) : (
                      historyRows.map((row, idx) => (
                        <tr key={`${row.data_hora}-${idx}`}>
                          <td className="px-3 py-1.5 font-mono">{row.data_hora}</td>
                          <td className="px-3 py-1.5">{row.servico}</td>
                          <td className="px-3 py-1.5 font-semibold">{row.resultado}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Field Teaching with AI */}
              <section className="rounded-xl border border-slate-200 p-4 space-y-3">
                <h3 className="text-sm font-bold text-slate-800">
                  Ensinar campo novo do formulário para o autofill
                </h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <input
                    type="text"
                    value={aiFieldLabel}
                    onChange={(e) => setAiFieldLabel(e.target.value)}
                    placeholder="Rótulo ou HTML do campo (ex.: Stato civile)"
                    className="rounded border border-slate-300 px-3 py-2"
                  />
                  <input
                    type="text"
                    value={aiFieldAnswer}
                    onChange={(e) => setAiFieldAnswer(e.target.value)}
                    placeholder="Sua resposta fixa para esse campo"
                    className="rounded border border-slate-300 px-3 py-2"
                  />
                  <button
                    type="button"
                    disabled={!aiFieldLabel.trim() || !aiFieldAnswer.trim()}
                    onClick={() => {
                      if (!cfg) return;
                      const normKey = aiFieldLabel
                        .normalize("NFKD")
                        .replace(/[\u0300-\u036f]/g, "")
                        .toLowerCase()
                        .trim()
                        .replace(/\s+/g, " ");
                      const nextCfg = {
                        ...cfg,
                        respostas_aprendidas: {
                          ...cfg.respostas_aprendidas,
                          [normKey]: aiFieldAnswer.trim(),
                        },
                      };
                      void saveAll(false, nextCfg, env ?? undefined);
                    }}
                    className="rounded bg-[#009246] px-4 py-2 font-bold text-white hover:bg-[#007a3a] disabled:opacity-50"
                  >
                    Salvar na Memória
                  </button>
                </div>
                {Object.keys(cfg.respostas_aprendidas).length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {Object.entries(cfg.respostas_aprendidas).map(([k, v]) => (
                      <span
                        key={k}
                        className="inline-flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2.5 py-1"
                      >
                        <strong>{k}:</strong> {v}
                        <button
                          type="button"
                          onClick={() => {
                            const next = { ...cfg.respostas_aprendidas };
                            delete next[k];
                            setCfg({ ...cfg, respostas_aprendidas: next });
                          }}
                          className="text-red-600 font-bold"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </main>

      {/* Clean Minimal Footer */}
      <footer className="border-t border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <span>{statusBar}</span>
          <span>Login manual • Confirmação e data no calendário manuais</span>
        </div>
      </footer>

      {/* Wizard Modal */}
      {showWizard && (
        <Wizard
          cfg={cfg}
          env={env}
          onUploadFiles={uploadFiles}
          onFinish={(nextCfg, nextEnv, mode) => {
            setShowWizard(false);
            if (mode === "none") {
              void saveAll(false, nextCfg, nextEnv);
            } else if (mode === "discover") {
              void startBot(true, true, nextCfg, nextEnv);
            } else if (mode === "test") {
              void startBot(false, true, nextCfg, nextEnv);
            } else {
              void startBot(false, false, nextCfg, nextEnv);
            }
          }}
          onClose={() => setShowWizard(false)}
        />
      )}

      {/* Documents Modal */}
      {showDocsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">Documentos PDF (máx. 2 MB)</h3>
              <button
                type="button"
                onClick={() => setShowDocsModal(false)}
                className="text-slate-500 hover:text-slate-800"
              >
                Fechar
              </button>
            </div>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {files.length === 0 ? (
                <p className="text-slate-500">Nenhum arquivo enviado ainda.</p>
              ) : (
                files.map((f) => {
                  const oversized = f.size > MAX_PDF_BYTES;
                  return (
                    <div
                      key={f.name}
                      className={`flex items-center justify-between rounded border px-3 py-2 ${
                        oversized ? "border-red-300 bg-red-50" : "border-slate-200"
                      }`}
                    >
                      <span>
                        {f.name} ({Math.round(f.size / 1024)} KB
                        {oversized ? " — ACIMA DE 2 MB!" : ""})
                      </span>
                      <div className="flex gap-3">
                        <a
                          href={`/api/files/${encodeURIComponent(f.name)}`}
                          className="text-blue-600 hover:underline"
                        >
                          Baixar
                        </a>
                        <button
                          type="button"
                          onClick={() => void deleteUploadedFile(f.name)}
                          className="text-red-600 hover:underline"
                        >
                          Excluir
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <label className="inline-block cursor-pointer rounded-lg bg-[#009246] px-4 py-2 font-bold text-white">
              Enviar arquivo(s)...
              <input
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleDocUpload}
                className="hidden"
              />
            </label>
          </div>
        </div>
      )}

      {/* Proofs Modal */}
      {showProofsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">Comprovantes salvos</h3>
              <button
                type="button"
                onClick={() => setShowProofsModal(false)}
                className="text-slate-500 hover:text-slate-800"
              >
                Fechar
              </button>
            </div>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {proofs.length === 0 ? (
                <p className="text-slate-500">Nenhum comprovante salvo ainda.</p>
              ) : (
                proofs.map((p) => (
                  <div
                    key={p.name}
                    className="flex items-center justify-between rounded border border-slate-200 px-3 py-2"
                  >
                    <span>{p.name}</span>
                    <a
                      href={`/api/proofs/${encodeURIComponent(p.name)}`}
                      className="text-blue-600 hover:underline"
                    >
                      Baixar
                    </a>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Companion Modal */}
      {showCompanionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl space-y-3 text-xs">
            <h3 className="text-sm font-bold">Adicionar acompanhante</h3>
            <input
              type="text"
              placeholder="Nome"
              value={newCompanion.nome}
              onChange={(e) =>
                setNewCompanion({ ...newCompanion, nome: e.target.value })
              }
              className="w-full rounded border border-slate-300 px-3 py-2"
            />
            <input
              type="text"
              placeholder="Sobrenome"
              value={newCompanion.sobrenome}
              onChange={(e) =>
                setNewCompanion({ ...newCompanion, sobrenome: e.target.value })
              }
              className="w-full rounded border border-slate-300 px-3 py-2"
            />
            <input
              type="text"
              placeholder="Nascimento (dd/mm/aaaa)"
              value={newCompanion.nascimento}
              onChange={(e) =>
                setNewCompanion({ ...newCompanion, nascimento: e.target.value })
              }
              className="w-full rounded border border-slate-300 px-3 py-2"
            />
            <select
              value={newCompanion.parentesco}
              onChange={(e) =>
                setNewCompanion({ ...newCompanion, parentesco: e.target.value })
              }
              className="w-full rounded border border-slate-300 px-3 py-2 bg-white"
            >
              {PARENTESCO.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCompanionModal(false)}
                className="rounded border border-slate-300 px-3 py-1.5"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(newCompanion.nascimento)) {
                    void openDialog(
                      "Data de nascimento inválida (use dd/mm/aaaa)."
                    );
                    return;
                  }
                  setCfg({
                    ...cfg,
                    acompanhantes: [...cfg.acompanhantes, newCompanion],
                  });
                  setNewCompanion({
                    nome: "",
                    sobrenome: "",
                    nascimento: "",
                    parentesco: "Filho/a",
                  });
                  setShowCompanionModal(false);
                }}
                className="rounded bg-[#009246] px-4 py-1.5 font-bold text-white"
              >
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generic In-App Dialog */}
      {dialog && (
        <ModalDialog
          title={dialog.title}
          message={dialog.message}
          mode={dialog.mode}
          defaultValue={dialog.defaultValue}
          onClose={(res) => {
            const r = dialog.resolve;
            setDialog(null);
            r(res);
          }}
        />
      )}
    </div>
  );
}

export default App;
