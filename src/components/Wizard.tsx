import React, { useState } from "react";
import {
  BotConfig,
  COR_OLHOS,
  ESTADO_CIVIL,
  EnvMap,
  QUICK_SERVICES,
} from "../types";

interface WizardProps {
  cfg: BotConfig;
  env: EnvMap;
  onUploadFiles: (files: FileList) => Promise<string[]>;
  onFinish: (
    nextCfg: BotConfig,
    nextEnv: EnvMap,
    startMode: "none" | "scheduled" | "test" | "discover"
  ) => void;
  onClose: () => void;
}

const STEPS = [
  {
    title: "Sua conta do Prenot@mi",
    sub: "Usada apenas para autofill — o login é feito manualmente por você no site",
  },
  {
    title: "O que você quer agendar?",
    sub: "O bot já conhece os formulários do Consulado de São Paulo",
  },
  {
    title: "Seus dados para o formulário",
    sub: "Preencha uma vez; o bot faz autofill e você confirma manualmente no final",
  },
  {
    title: "Documentos para anexar",
    sub: "Os PDFs que o consulado pede no agendamento",
  },
  {
    title: "Avisos no celular (opcional, grátis)",
    sub: "Para saber da vaga mesmo longe do computador",
  },
  {
    title: "Tudo pronto!",
    sub: "Revise e clique em Concluir",
  },
];

export const Wizard: React.FC<WizardProps> = ({
  cfg,
  env,
  onUploadFiles,
  onFinish,
  onClose,
}) => {
  const [step, setStep] = useState(0);
  const [showPass, setShowPass] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);

  const initialSid = cfg.servicos[0] ?? 5402;
  const [email, setEmail] = useState(env.PRENOTAMI_EMAIL || "");
  const [senha, setSenha] = useState(env.PRENOTAMI_SENHA || "");
  const [servicoChoice, setServicoChoice] = useState<number>(
    initialSid === 5402 || initialSid === 5256 ? initialSid : -1
  );
  const [outroSid, setOutroSid] = useState(
    initialSid !== 5402 && initialSid !== 5256 && initialSid > 0
      ? String(initialSid)
      : ""
  );
  const [endereco, setEndereco] = useState(cfg.dados.endereco || "");
  const [altura, setAltura] = useState(cfg.dados.altura_cm || "");
  const [civil, setCivil] = useState(cfg.dados.estado_civil || "");
  const [olhos, setOlhos] = useState(cfg.dados.cor_olhos || "");
  const [filhos, setFilhos] = useState(cfg.dados.quantidade_filhos || "0");
  const [venc, setVenc] = useState(
    cfg.dados.data_vencimento_passaporte || ""
  );
  const [docs, setDocs] = useState<string[]>(cfg.documentos || []);
  const [ntfy, setNtfy] = useState(env.NTFY_TOPICO || "");
  const [zap, setZap] = useState(env.WHATSAPP_TELEFONE || "");
  const [zapKey, setZapKey] = useState(env.WHATSAPP_APIKEY || "");
  const [startMode, setStartMode] = useState<"none" | "scheduled" | "test">(
    "scheduled"
  );

  const resolvedSid =
    servicoChoice === -1
      ? /^\d+$/.test(outroSid.trim())
        ? Number(outroSid.trim())
        : 0
      : servicoChoice;

  const generateTopic = () => {
    const arr = new Uint8Array(5);
    crypto.getRandomValues(arr);
    const hex = Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join(
      ""
    );
    setNtfy(`prenotabot-${hex}`);
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const added = await onUploadFiles(e.target.files);
    setDocs((prev) => {
      const next = [...prev];
      for (const name of added) {
        if (!next.includes(name)) next.push(name);
      }
      return next;
    });
    e.target.value = "";
  };

  const next = () => {
    setWarn(null);
    if (step === 0 && !email.trim()) {
      setWarn("Informe o e-mail que você usa no site Prenot@mi (para autofill).");
      return;
    }
    if (step === 1 && servicoChoice === -1 && !/^\d+$/.test(outroSid.trim())) {
      setWarn("Digite o número do serviço (só números).");
      return;
    }
    if (step === 2 && !endereco.trim()) {
      setWarn(
        "O endereço completo é obrigatório no formulário do consulado."
      );
      return;
    }
    if (step === STEPS.length - 1) {
      const nextCfg: BotConfig = {
        ...cfg,
        servicos: resolvedSid > 0 ? [resolvedSid] : [],
        documentos: docs,
        auto_login: false,
        autofill_login: true,
        clicar_avancar: false,
        auto_agendar: false,
        dados: {
          ...cfg.dados,
          endereco: endereco.trim(),
          altura_cm: altura.trim(),
          estado_civil: civil,
          cor_olhos: olhos,
          quantidade_filhos: filhos.trim() || "0",
          data_vencimento_passaporte: venc.trim(),
          passaporte_vencido:
            resolvedSid === 5256 ? "Sim" : cfg.dados.passaporte_vencido,
        },
      };
      const nextEnv: EnvMap = {
        ...env,
        PRENOTAMI_EMAIL: email.trim(),
        PRENOTAMI_SENHA: senha,
        NTFY_TOPICO: ntfy.trim(),
        WHATSAPP_TELEFONE: zap.trim(),
        WHATSAPP_APIKEY: zapKey.trim(),
      };
      onFinish(
        nextCfg,
        nextEnv,
        resolvedSid <= 0 && startMode !== "none" ? "discover" : startMode
      );
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl border border-slate-200">
        <div className="flex h-1.5">
          <div className="flex-1 bg-[#009246]" />
          <div className="flex-1 bg-white" />
          <div className="flex-1 bg-[#CE2B37]" />
        </div>
        <div className="flex items-start justify-between bg-[#1f2a37] px-5 py-4 text-white">
          <div>
            <h2 className="text-lg font-bold">
              Passo {step + 1} de {STEPS.length} — {STEPS[step].title}
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">{STEPS[step].sub}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 hover:text-white"
          >
            Fechar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-sm">
          {warn && (
            <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
              {warn}
            </div>
          )}

          {step === 0 && (
            <div className="space-y-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  E-mail do Prenot@mi
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 focus:border-[#009246] focus:outline-none"
                  placeholder="seu@email.com"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Senha (opcional, só para autofill)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type={showPass ? "text" : "password"}
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    className="flex-1 rounded border border-slate-300 px-3 py-2 focus:border-[#009246] focus:outline-none"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showPass}
                      onChange={(e) => setShowPass(e.target.checked)}
                    />
                    mostrar senha
                  </label>
                </div>
              </div>
              <div className="rounded bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-900">
                O login nunca é enviado automaticamente: a extensão faz apenas o autofill e você entra na conta manualmente, mantendo a 1ª aba aberta.
              </div>
              <a
                href="https://prenotami.esteri.it/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Abrir site prenotami.esteri.it
              </a>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              {QUICK_SERVICES.map((item) => {
                const val = item.id === 0 ? -1 : item.id;
                return (
                  <label
                    key={item.label}
                    className={`block cursor-pointer rounded-lg border p-3 transition ${
                      servicoChoice === val
                        ? "border-[#009246] bg-emerald-50/50"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold text-slate-800">
                      <input
                        type="radio"
                        name="wiz_srv"
                        checked={servicoChoice === val}
                        onChange={() => setServicoChoice(val)}
                      />
                      {item.label}
                    </div>
                    <p className="mt-1 pl-5 text-xs text-slate-600">
                      {item.desc}
                    </p>
                  </label>
                );
              })}

              {servicoChoice === -1 && (
                <div className="pt-1">
                  <label className="block font-semibold text-slate-700 mb-1">
                    Número do serviço (ID)
                  </label>
                  <input
                    type="text"
                    value={outroSid}
                    onChange={(e) => setOutroSid(e.target.value)}
                    placeholder="ex.: 4705"
                    className="w-40 rounded border border-slate-300 px-3 py-2"
                  />
                </div>
              )}

              <p className="text-xs text-blue-700 pt-1">
                Mora em Mato Grosso? O passaporte é feito no Vice-Consulado de Cuiabá (serviço próprio): escolha a 3ª opção e use &quot;Listar serviços da minha conta&quot;.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">
                  Endereço completo *
                </label>
                <input
                  type="text"
                  value={endereco}
                  onChange={(e) => setEndereco(e.target.value)}
                  placeholder="Rua, número, bairro, cidade/UF e CEP"
                  className="w-full rounded border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Altura (cm)
                </label>
                <input
                  type="text"
                  value={altura}
                  onChange={(e) => setAltura(e.target.value)}
                  placeholder="ex.: 175"
                  className="w-full rounded border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Cor dos olhos
                </label>
                <select
                  value={olhos}
                  onChange={(e) => setOlhos(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 bg-white"
                >
                  {COR_OLHOS.map((o) => (
                    <option key={o} value={o}>
                      {o || "Selecione..."}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">
                  Estado civil
                </label>
                <select
                  value={civil}
                  onChange={(e) => setCivil(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 bg-white"
                >
                  {ESTADO_CIVIL.map((c) => (
                    <option key={c} value={c}>
                      {c || "Selecione..."}
                    </option>
                  ))}
                </select>
              </div>
              {resolvedSid === 5256 && (
                <>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Quantidade de filhos menores
                    </label>
                    <input
                      type="text"
                      value={filhos}
                      onChange={(e) => setFilhos(e.target.value)}
                      className="w-full rounded border border-slate-300 px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Vencimento do passaporte
                    </label>
                    <input
                      type="text"
                      value={venc}
                      onChange={(e) => setVenc(e.target.value)}
                      placeholder="dd/mm/aaaa"
                      className="w-full rounded border border-slate-300 px-3 py-2"
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                {docs.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Nenhum documento adicionado ainda.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {docs.map((d, idx) => (
                      <li
                        key={d}
                        className="flex items-center justify-between rounded bg-white px-3 py-1.5 border border-slate-200 text-xs"
                      >
                        <span>
                          {idx + 1}. {d}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setDocs((prev) => prev.filter((x) => x !== d))
                          }
                          className="text-red-600 hover:underline"
                        >
                          Remover
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded bg-[#1f2a37] px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800">
                Enviar PDF / Imagem...
                <input
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={handleFilePick}
                  className="hidden"
                />
              </label>
              <p className="text-xs text-slate-500">
                Use PDF legível de até 2 MB em seu nome (para SP Primeiro Passaporte 5402, é exigido o comprovante de residência).
              </p>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Tópico do app ntfy (gratuito, Android/iPhone)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={ntfy}
                    onChange={(e) => setNtfy(e.target.value)}
                    placeholder="ex.: prenotabot-12345"
                    className="flex-1 rounded border border-slate-300 px-3 py-2"
                  />
                  <button
                    type="button"
                    onClick={generateTopic}
                    className="rounded border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold hover:bg-slate-100"
                  >
                    Gerar tópico
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Seu WhatsApp (CallMeBot)
                  </label>
                  <input
                    type="text"
                    value={zap}
                    onChange={(e) => setZap(e.target.value)}
                    placeholder="+5511999999999"
                    className="w-full rounded border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    API Key CallMeBot
                  </label>
                  <input
                    type="text"
                    value={zapKey}
                    onChange={(e) => setZapKey(e.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Mais opções (Telegram e E-mail) ficam disponíveis na aba Avisos.
              </p>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs space-y-1.5 text-slate-700">
                <div>
                  <strong>Conta (autofill):</strong> {email || "não informada"}
                </div>
                <div>
                  <strong>Serviço:</strong>{" "}
                  {resolvedSid > 0 ? resolvedSid : "descobrir na conta"}
                </div>
                <div>
                  <strong>Endereço:</strong> {endereco}
                </div>
                <div>
                  <strong>Documentos:</strong>{" "}
                  {docs.length ? docs.join(", ") : "nenhum"}
                </div>
                <div>
                  <strong>Fluxo:</strong> Login manual + autofill • Segunda-feira{" "}
                  {cfg.horario_alvo} ({cfg.fuso_horario}, pré-início{" "}
                  {cfg.antecedencia_minutos} min antes) ou botão de teste imediato • Formulário com autofill e confirmação/calendário manuais.
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                  <input
                    type="radio"
                    name="wiz_start"
                    checked={startMode === "scheduled"}
                    onChange={() => setStartMode("scheduled")}
                  />
                  Iniciar no modo agendado (Segunda 16h Brasília / 15h Cuiabá-AM, 1–2 min antes)
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                  <input
                    type="radio"
                    name="wiz_start"
                    checked={startMode === "test"}
                    onChange={() => setStartMode("test")}
                  />
                  Iniciar agora imediatamente (modo teste)
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                  <input
                    type="radio"
                    name="wiz_start"
                    checked={startMode === "none"}
                    onChange={() => setStartMode("none")}
                  />
                  Apenas salvar e abrir o painel
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button
            type="button"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="rounded border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40"
          >
            &lt; Voltar
          </button>
          <button
            type="button"
            onClick={next}
            className="rounded bg-[#009246] px-5 py-2 text-xs font-bold text-white hover:bg-[#007a3a]"
          >
            {step === STEPS.length - 1 ? "Concluir e salvar" : "Próximo >"}
          </button>
        </div>
      </div>
    </div>
  );
};
