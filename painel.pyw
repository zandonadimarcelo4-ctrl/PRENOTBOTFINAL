"""
PrenotaBot Livre - Painel (interface grafica).
Abra com dois cliques em "iniciar.bat" (ou: python painel.pyw).
"""

from __future__ import annotations

import json
import logging
import os
import queue
import secrets
import shutil
import subprocess
import sys
import threading
import tkinter as tk
import webbrowser
from datetime import datetime
from tkinter import filedialog, messagebox, simpledialog, ttk

import core

APP = "PrenotaBot Livre"
VERSION = "2.0"
DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"]
CATALOG_PATH = core.BASE_DIR / "catalogo_servicos.json"
LAST_PROFILE = core.PROFILES_DIR / "_ultimo.txt"

ESTADO_CIVIL = ["", "Solteiro/Solteira", "Casado/a", "Divorciado/a", "Viuvo/a", "Separado/a",
                "Em uniao civil", "Separado/a de Uniao Civil", "Divorciado/a de Uniao Civil", "Viuvo/a de Uniao Civil"]
COR_OLHOS = ["", "Marrom", "Preto", "Azul", "Verde", "Cinza"]
QUICK_SERVICES = [
    ("São Paulo - PRIMEIRO PASSAPORTE (recomendado)", 5402,
     "Para quem nunca teve passaporte italiano. Anexo: comprovante de residência em seu nome."),
    ("São Paulo - Renovação de passaporte", 5256,
     "Para quem tem passaporte italiano vencido ou vencendo em até 12 meses. Anexo: cópia do passaporte."),
    ("Outro consulado / descobrir na minha conta", 0,
     "Depois de salvar, clique em 'Listar serviços da minha conta' para ver os IDs disponíveis para você."),
]
GREEN, RED, DARK = "#009246", "#CE2B37", "#1f2a37"
SIM_NAO = ["Nao", "Sim"]
PARENTESCO = ["Filho/a", "Conjuge", "Companheiro", "Pai/Mae", "Irmao/Irma", "Neto", "Genro/Nora", "Sogro/Sogra",
              "Menor sob tutela", "Filho de outro cônjuge", "Cônjuge separado", "Cônjuge divorciado"]


# ------------------------------------------------------------------------- #
class QueueHandler(logging.Handler):
    def __init__(self, q):
        super().__init__()
        self.q = q

    def emit(self, record):
        self.q.put(("log", self.format(record)))


class GuiUI:
    """Ponte entre o bot (thread) e a janela (thread principal)."""

    def __init__(self, app: "Painel"):
        self.app = app

    def _call(self, fn, *args):
        done, box = threading.Event(), {}

        def run():
            try:
                box["r"] = fn(*args)
            finally:
                done.set()

        self.app.q.put(("call", run))
        done.wait()
        return box.get("r")

    def ask(self, msg):
        self._call(self.app.modal_info, msg)

    def ask_text(self, msg):
        return self._call(self.app.modal_text, msg) or ""

    def status(self, msg):
        self.app.q.put(("status", msg))

    def finished(self):
        self.app.q.put(("finished", None))


# ------------------------------------------------------------------------- #
class Painel(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(f"{APP} {VERSION}")
        self.geometry("1000x700")
        self.minsize(860, 560)
        self.q: queue.Queue = queue.Queue()
        self.bot_thread: threading.Thread | None = None
        self.stop = threading.Event()
        self.bot: core.PrenotaBot | None = None
        self.vars: dict[str, tk.Variable] = {}
        self.attempts = 0

        style = ttk.Style(self)
        try:
            style.theme_use("vista" if sys.platform == "win32" else "clam")
        except tk.TclError:
            style.theme_use("clam")
        style.configure("Big.TLabel", font=("Segoe UI", 13, "bold"))
        style.configure("Accent.TButton", font=("Segoe UI", 10, "bold"))

        core.setup_logging(QueueHandler(self.q))
        self.env = core.load_env()
        self.profile = self._last_profile()
        self.cfg = core.load_config(core.profile_path(self.profile))

        self._build()
        self._load_into_ui()
        self.after(150, self._poll)
        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self._check_first_run()

    # ---------------- perfis ----------------
    def _last_profile(self) -> str:
        profs = core.list_profiles()
        if LAST_PROFILE.exists():
            name = LAST_PROFILE.read_text(encoding="utf-8").strip()
            if name in profs:
                return name
        if not profs:  # primeiro uso: copia o config.yaml de exemplo
            if core.CONFIG_PATH.exists():
                shutil.copy(core.CONFIG_PATH, core.profile_path("meu_perfil"))
            else:
                core.save_config(core.DEFAULT_CONFIG, core.profile_path("meu_perfil"))
            return "meu_perfil"
        return profs[0]

    # ---------------- construcao da tela ----------------
    def _build(self):
        head = tk.Frame(self, bg=DARK)
        head.pack(fill="x")
        stripe = tk.Frame(head, height=5)
        stripe.pack(fill="x")
        for c in (GREEN, "#ffffff", RED):
            tk.Frame(stripe, bg=c, height=5).pack(side="left", fill="x", expand=True)
        tk.Label(head, text="PrenotaBot Livre", bg=DARK, fg="white", font=("Segoe UI", 18, "bold")
                 ).pack(side="left", padx=14, pady=8)
        tk.Label(head, text="agendamento de passaporte no Prenot@mi - grátis e no seu computador",
                 bg=DARK, fg="#cfd8dc", font=("Segoe UI", 10)).pack(side="left", pady=8)
        tk.Button(head, text="Assistente passo a passo", bg=GREEN, fg="white", relief="flat",
                  activebackground="#007a3a", font=("Segoe UI", 10, "bold"), padx=12,
                  command=lambda: Wizard(self)).pack(side="right", padx=12, pady=8)

        top = ttk.Frame(self, padding=(10, 8))
        top.pack(fill="x")
        ttk.Label(top, text="Perfil:").pack(side="left")
        self.cb_profile = ttk.Combobox(top, values=core.list_profiles(), width=28, state="readonly")
        self.cb_profile.set(self.profile)
        self.cb_profile.pack(side="left", padx=5)
        self.cb_profile.bind("<<ComboboxSelected>>", lambda e: self._switch_profile(self.cb_profile.get()))
        ttk.Button(top, text="Novo", command=self._new_profile).pack(side="left", padx=2)
        ttk.Button(top, text="Duplicar", command=lambda: self._new_profile(copy=True)).pack(side="left", padx=2)
        ttk.Button(top, text="Excluir", command=self._delete_profile).pack(side="left", padx=2)
        ttk.Button(top, text="Salvar", command=self.save_all).pack(side="left", padx=10)
        ttk.Label(top, text="Dados só neste PC", foreground="#2e7d32").pack(side="right")

        nb = ttk.Notebook(self)
        nb.pack(fill="both", expand=True, padx=10, pady=(0, 6))
        self.nb = nb
        self._tab_inicio(nb)
        self._tab_conta(nb)
        self._tab_servico(nb)
        self._tab_dados(nb)
        self._tab_agendamento(nb)
        self._tab_avisos(nb)
        self._tab_historico(nb)

        bar = ttk.Frame(self, padding=(10, 4))
        bar.pack(fill="x")
        self.status = tk.StringVar(value="Pronto.")
        ttk.Label(bar, textvariable=self.status).pack(side="left")

    def _v(self, key, default="", kind="str"):
        if key not in self.vars:
            self.vars[key] = tk.BooleanVar(value=bool(default)) if kind == "bool" else tk.StringVar(value=str(default))
        return self.vars[key]

    def _row(self, parent, r, label, key, width=40, kind="entry", values=None, show=None, hint=""):
        ttk.Label(parent, text=label).grid(row=r, column=0, sticky="w", pady=3, padx=(0, 8))
        if kind == "combo":
            w = ttk.Combobox(parent, textvariable=self._v(key), values=values or [], width=width - 3)
        elif kind == "check":
            w = ttk.Checkbutton(parent, variable=self._v(key, kind="bool"))
        else:
            w = ttk.Entry(parent, textvariable=self._v(key), width=width, show=show or "")
        w.grid(row=r, column=1, sticky="w", pady=3)
        if hint:
            ttk.Label(parent, text=hint, foreground="#666").grid(row=r, column=2, sticky="w", padx=8)
        return w

    def _scroll_tab(self, nb, title):
        """Aba com barra de rolagem (para telas pequenas de notebook)."""
        holder = ttk.Frame(nb)
        nb.add(holder, text=title)
        cv = tk.Canvas(holder, highlightthickness=0, bd=0)
        sb = ttk.Scrollbar(holder, orient="vertical", command=cv.yview)
        inner = ttk.Frame(cv, padding=14)
        win = cv.create_window((0, 0), window=inner, anchor="nw")
        inner.bind("<Configure>", lambda e: cv.configure(scrollregion=cv.bbox("all")))
        cv.bind("<Configure>", lambda e: cv.itemconfigure(win, width=e.width))
        cv.configure(yscrollcommand=sb.set)
        cv.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")

        def _wheel(e):
            if e.num == 4:
                cv.yview_scroll(-3, "units")
            elif e.num == 5:
                cv.yview_scroll(3, "units")
            else:
                cv.yview_scroll(int(-e.delta / 40), "units")
        holder.bind("<Enter>", lambda e: (cv.bind_all("<MouseWheel>", _wheel), cv.bind_all("<Button-4>", _wheel),
                                          cv.bind_all("<Button-5>", _wheel)))
        holder.bind("<Leave>", lambda e: (cv.unbind_all("<MouseWheel>"), cv.unbind_all("<Button-4>"),
                                          cv.unbind_all("<Button-5>")))
        return inner

    def _tab_inicio(self, nb):
        f = ttk.Frame(nb, padding=12)
        nb.add(f, text="  Início  ")
        self.big = tk.StringVar(value="Parado")
        ttk.Label(f, textvariable=self.big, style="Big.TLabel").pack(anchor="w")
        self.counters = tk.StringVar(value="Tentativas nesta sessão: 0")
        ttk.Label(f, textvariable=self.counters).pack(anchor="w", pady=(2, 8))

        self.summary = tk.StringVar()
        ttk.Label(f, textvariable=self.summary, foreground="#37474f", wraplength=900).pack(anchor="w", pady=(0, 8))
        btns = ttk.Frame(f)
        btns.pack(fill="x", pady=4)
        self.b_start = tk.Button(btns, text="  INICIAR  ", bg=GREEN, fg="white", font=("Segoe UI", 13, "bold"),
                                 relief="flat", activebackground="#007a3a", padx=18, pady=6,
                                 command=lambda: self.start_bot(False))
        self.b_start.pack(side="left", padx=(0, 8))
        self.b_stop = tk.Button(btns, text="  PARAR  ", bg="#9e9e9e", fg="white", font=("Segoe UI", 13, "bold"),
                                relief="flat", padx=18, pady=6, command=self.stop_bot, state="disabled")
        self.b_stop.pack(side="left", padx=8)
        b2 = ttk.Frame(f)
        b2.pack(fill="x", pady=(8, 0))
        ttk.Button(b2, text="Listar serviços da minha conta",
                   command=lambda: self.start_bot(True)).pack(side="left", padx=(0, 6))
        ttk.Button(b2, text="Verificar configuração", command=self.check_cfg).pack(side="left", padx=6)
        ttk.Button(b2, text="Testar avisos", command=self.test_notifications).pack(side="left", padx=6)
        ttk.Button(b2, text="Comprovantes",
                   command=lambda: self._open(core.PROOF_DIR)).pack(side="left", padx=6)
        ttk.Button(b2, text="Documentos",
                   command=lambda: self._open(core.FILES_DIR)).pack(side="left", padx=6)

        self.txt = tk.Text(f, height=24, wrap="word", font=("Consolas", 9), bg="#111", fg="#ddd",
                           insertbackground="#ddd")
        self.txt.pack(fill="both", expand=True, pady=(8, 0))
        self.txt.tag_config("warn", foreground="#ffcc66")
        self.txt.tag_config("err", foreground="#ff6b6b")
        self.txt.tag_config("ok", foreground="#7CFC00")

    def _tab_conta(self, nb):
        f = ttk.Frame(nb, padding=14)
        nb.add(f, text="  Conta  ")
        self._row(f, 0, "E-mail do Prenot@mi", "env.PRENOTAMI_EMAIL")
        pw = self._row(f, 1, "Senha do Prenot@mi", "env.PRENOTAMI_SENHA", show="*")
        sv = tk.BooleanVar(value=False)
        ttk.Checkbutton(f, text="mostrar", variable=sv,
                        command=lambda: pw.config(show="" if sv.get() else "*")).grid(row=1, column=2, sticky="w")
        self._v("cofre", default=core.vault_available(), kind="bool")
        ttk.Checkbutton(f, text="Guardar senhas no cofre do Windows (criptografado) em vez do arquivo .env",
                        variable=self.vars["cofre"]).grid(row=2, column=1, columnspan=2, sticky="w", pady=6)
        if not core.vault_available():
            ttk.Label(f, text="(cofre indisponivel neste computador - as senhas ficam no .env)",
                      foreground="#a00").grid(row=3, column=1, columnspan=2, sticky="w")
        self._row(f, 4, "Login automático", "auto_login", kind="check")
        self._row(f, 5, "Manter sessão salva", "usar_perfil_persistente", kind="check",
                  hint="guarda o login do Chrome na pasta chrome_profile")
        ttk.Label(f, text="Captchas e códigos sempre ficam com você: o bot para, toca o alarme e espera.",
                  foreground="#555").grid(row=6, column=0, columnspan=3, sticky="w", pady=(16, 0))

    def _tab_servico(self, nb):
        f = ttk.Frame(nb, padding=14)
        nb.add(f, text="  Serviço  ")
        q = ttk.LabelFrame(f, text="Escolha rápida", padding=8)
        q.grid(row=0, column=0, columnspan=3, sticky="ew", pady=(0, 8))
        for i, (lab, sid, desc) in enumerate(QUICK_SERVICES[:2]):
            ttk.Button(q, text=lab, command=lambda s_=sid: self.vars["servicos_txt"].set(str(s_))
                       ).grid(row=i, column=0, sticky="w", pady=2)
            ttk.Label(q, text=desc, foreground="#555").grid(row=i, column=1, sticky="w", padx=8)
        self._row(f, 0 + 10, "IDs dos serviços a monitorar", "servicos_txt", width=30,
                  hint="separe por virgula, ex.: 5402, 5256")
        ttk.Label(f, text="Clique duas vezes num serviço abaixo para adicionar. Use \"Listar serviços da minha conta\""
                         " na aba Início para ver os IDs exatos do seu consulado.",
                  foreground="#555", wraplength=850).grid(row=11, column=0, columnspan=3, sticky="w", pady=6)
        cols = ("id", "consulado", "servico")
        tv = ttk.Treeview(f, columns=cols, show="headings", height=16)
        for c, w in zip(cols, (70, 230, 520)):
            tv.heading(c, text=c.capitalize())
            tv.column(c, width=w, anchor="w")
        tv.grid(row=12, column=0, columnspan=3, sticky="nsew")
        f.rowconfigure(12, weight=1)
        f.columnconfigure(2, weight=1)
        tv.bind("<Double-1>", lambda e: self._add_service(tv))
        self.tv_services = tv
        ttk.Label(f, text="Mato Grosso: o atendimento de passaporte é no Vice-Consulado Honorário de Cuiabá"
                         " (jurisdição de São Paulo), com serviço próprio no Prenot@mi.",
                  foreground="#1565c0", wraplength=850).grid(row=13, column=0, columnspan=3, sticky="w", pady=6)
        self._fill_catalog()

    def _fill_catalog(self):
        tv = self.tv_services
        tv.delete(*tv.get_children())
        if core.SERVICES_CACHE.exists():
            for s in json.loads(core.SERVICES_CACHE.read_text(encoding="utf-8")):
                tv.insert("", "end", values=(s["id"], "MINHA CONTA", f"{s['nome']} {s.get('descricao', '')[:80]}"))
        if CATALOG_PATH.exists():
            for c in json.loads(CATALOG_PATH.read_text(encoding="utf-8")):
                for s in c["servicos"]:
                    tv.insert("", "end", values=(s["id"], c["consulado"], s["nome"]))

    def _add_service(self, tv):
        sel = tv.selection()
        if not sel:
            return
        sid = str(tv.item(sel[0])["values"][0])
        cur = [x.strip() for x in self.vars["servicos_txt"].get().split(",") if x.strip()]
        if sid not in cur:
            cur.append(sid)
        self.vars["servicos_txt"].set(", ".join(cur))

    def _tab_dados(self, nb):
        outer = self._scroll_tab(nb, "  Formulário  ")
        f = ttk.LabelFrame(outer, text="Seus dados (o bot reconhece os campos pelo nome, em qualquer serviço)",
                           padding=10)
        f.pack(fill="x")
        self._row(f, 0, "Endereço completo", "dados.endereco", width=60)
        self._row(f, 1, "Altura (cm)", "dados.altura_cm", width=10)
        self._row(f, 2, "Estado civil", "dados.estado_civil", kind="combo", values=ESTADO_CIVIL, width=30)
        self._row(f, 3, "Cor dos olhos", "dados.cor_olhos", kind="combo", values=COR_OLHOS, width=20)
        self._row(f, 4, "Tem filhos menores?", "dados.filhos_menores", kind="combo", values=SIM_NAO, width=10)
        self._row(f, 5, "Quantidade de filhos", "dados.quantidade_filhos", width=10)
        self._row(f, 6, "Tem passaporte vencido?", "dados.passaporte_vencido", kind="combo", values=SIM_NAO, width=10)
        self._row(f, 7, "Vencimento do passaporte", "dados.data_vencimento_passaporte", width=14, hint="dd/mm/aaaa")
        self._row(f, 8, "Observações", "dados.observacoes", width=60)

        mid = ttk.Frame(outer)
        mid.pack(fill="both", expand=True, pady=8)
        d = ttk.LabelFrame(mid, text="Documentos (na ordem dos anexos do site)", padding=8)
        d.pack(side="left", fill="both", expand=True, padx=(0, 6))
        self.lb_docs = tk.Listbox(d, height=6)
        self.lb_docs.pack(fill="both", expand=True)
        bd = ttk.Frame(d)
        bd.pack(fill="x", pady=4)
        ttk.Button(bd, text="Adicionar PDF...", command=self._add_doc).pack(side="left")
        ttk.Button(bd, text="Remover", command=lambda: self._lb_remove(self.lb_docs)).pack(side="left", padx=4)
        ttk.Button(bd, text="Subir", command=lambda: self._lb_move(self.lb_docs, -1)).pack(side="left")
        ttk.Button(bd, text="Descer", command=lambda: self._lb_move(self.lb_docs, 1)).pack(side="left", padx=4)

        a = ttk.LabelFrame(mid, text="Acompanhantes (agendamento múltiplo)", padding=8)
        a.pack(side="left", fill="both", expand=True)
        cols = ("nome", "sobrenome", "nascimento", "parentesco")
        self.tv_acomp = ttk.Treeview(a, columns=cols, show="headings", height=6)
        for c in cols:
            self.tv_acomp.heading(c, text=c.capitalize())
            self.tv_acomp.column(c, width=100)
        self.tv_acomp.pack(fill="both", expand=True)
        ba = ttk.Frame(a)
        ba.pack(fill="x", pady=4)
        ttk.Button(ba, text="Adicionar...", command=self._add_companion).pack(side="left")
        ttk.Button(ba, text="Remover", command=lambda: [self.tv_acomp.delete(i) for i in self.tv_acomp.selection()]
                   ).pack(side="left", padx=4)

        mm = ttk.LabelFrame(outer, text="Memória do bot (respostas que ele aprendeu com você em perguntas novas do site)",
                            padding=8)
        mm.pack(fill="both", expand=True)
        self.tv_mem = ttk.Treeview(mm, columns=("pergunta", "resposta"), show="headings", height=4)
        self.tv_mem.heading("pergunta", text="Pergunta do site")
        self.tv_mem.heading("resposta", text="Resposta")
        self.tv_mem.column("pergunta", width=520)
        self.tv_mem.pack(fill="both", expand=True, side="left")
        ttk.Button(mm, text="Esquecer", command=lambda: [self.tv_mem.delete(i) for i in self.tv_mem.selection()]
                   ).pack(side="left", padx=6, anchor="n")

    def _tab_agendamento(self, nb):
        f = self._scroll_tab(nb, "  Agendamento  ")
        m = ttk.LabelFrame(f, text="Monitoramento", padding=10)
        m.pack(fill="x")
        self._row(m, 0, "Intervalo mínimo (s)", "intervalo_min_segundos", width=8, hint="mínimo 20s")
        self._row(m, 1, "Intervalo máximo (s)", "intervalo_max_segundos", width=8)
        self._row(m, 2, "Máximo de tentativas", "max_tentativas", width=8, hint="0 = sem limite")
        self._row(m, 3, "Janela de horário", "janela_horario", width=14,
                  hint="ex.: 09:30-12:00 (vazio = o dia todo)")
        ttk.Label(m, text="Dias da semana").grid(row=4, column=0, sticky="w")
        dd = ttk.Frame(m)
        dd.grid(row=4, column=1, columnspan=2, sticky="w")
        for i, n in enumerate(DIAS, 1):
            ttk.Checkbutton(dd, text=n, variable=self._v(f"dia{i}", kind="bool")).pack(side="left")
        self._row(m, 5, "Espera após bloqueio (min)", "espera_bloqueio_minutos", width=8)
        self._row(m, 6, "Rodar em segundo plano", "segundo_plano", kind="check",
                  hint="Chrome minimizado; aparece sozinho quando precisar de você")

        c = ttk.LabelFrame(f, text="Quando a vaga abrir", padding=10)
        c.pack(fill="x", pady=8)
        self._row(c, 0, "Só avisar (não preencher nada)", "somente_alertar", kind="check")
        self._row(c, 1, "Preencher o formulário", "preencher_formulario", kind="check")
        self._row(c, 2, "Pedir o código OTP sozinho", "enviar_otp_automatico", kind="check")
        self._row(c, 3, "Clicar em Avançar", "clicar_avancar", kind="check")
        self._row(c, 4, "Escolher data/horario automaticamente", "auto_agendar", kind="check")
        self._row(c, 5, "Data mínima", "data_minima", width=14, hint="dd/mm/aaaa (vazio = qualquer)")
        self._row(c, 6, "Data máxima", "data_maxima", width=14)
        self._row(c, 7, "Meses a procurar", "meses_a_procurar", width=8)
        self._row(c, 8, "Período preferido", "preferencia_periodo", kind="combo",
                  values=["qualquer", "manha", "tarde"], width=14)
        ttk.Label(c, text="Dias preferidos").grid(row=9, column=0, sticky="w")
        dp = ttk.Frame(c)
        dp.grid(row=9, column=1, columnspan=2, sticky="w")
        for i, n in enumerate(DIAS, 1):
            ttk.Checkbutton(dp, text=n, variable=self._v(f"pref{i}", kind="bool")).pack(side="left")
        self._row(c, 10, "Salvar comprovante (PDF)", "salvar_comprovante", kind="check")
        self._row(c, 11, "Alarme sonoro", "alerta_sonoro", kind="check")

    def _tab_avisos(self, nb):
        f = self._scroll_tab(nb, "  Avisos  ")
        intro = ("Receba o aviso de vaga onde estiver. Todos os canais são gratuitos; preencha só os que quiser.")
        ttk.Label(f, text=intro, wraplength=880).pack(anchor="w")

        t = ttk.LabelFrame(f, text="Celular - notificação push (app gratuito ntfy, Android e iPhone)", padding=8)
        t.pack(fill="x", pady=5)
        self._row(t, 0, "Tópico ntfy", "env.NTFY_TOPICO", width=34)
        ttk.Button(t, text="Gerar tópico", command=lambda: self.vars["env.NTFY_TOPICO"].set(
            "prenotabot-" + secrets.token_hex(5))).grid(row=0, column=2, padx=6)
        ttk.Label(t, text="Instale o app ntfy, toque em + e assine o mesmo topico.", foreground="#666"
                  ).grid(row=1, column=1, columnspan=2, sticky="w")

        w = ttk.LabelFrame(f, text="WhatsApp (CallMeBot - gratuito)", padding=8)
        w.pack(fill="x", pady=5)
        self._row(w, 0, "Seu WhatsApp", "env.WHATSAPP_TELEFONE", width=20, hint="ex.: +5566999999999")
        self._row(w, 1, "API key do CallMeBot", "env.WHATSAPP_APIKEY", width=20)
        ttk.Button(w, text="Como obter a chave", command=lambda: webbrowser.open(
            "https://www.callmebot.com/blog/free-api-whatsapp-messages/")).grid(row=1, column=2, padx=6)

        g = ttk.LabelFrame(f, text="Telegram", padding=8)
        g.pack(fill="x", pady=5)
        self._row(g, 0, "Token do bot", "env.TELEGRAM_TOKEN", width=50)
        self._row(g, 1, "Chat ID", "env.TELEGRAM_CHAT_ID", width=20, hint="fale com @userinfobot para saber")

        e = ttk.LabelFrame(f, text="E-mail (avisos + leitura automática do código OTP)", padding=8)
        e.pack(fill="x", pady=5)
        self._row(e, 0, "Seu e-mail (Gmail/Outlook)", "env.IMAP_EMAIL", width=34)
        self._row(e, 1, "Senha de app", "env.IMAP_SENHA_APP", width=34, show="*",
                  hint="Gmail: myaccount.google.com/apppasswords")
        self._row(e, 2, "Enviar avisos para", "env.EMAIL_AVISO_DESTINO", width=34, hint="vazio = o mesmo e-mail")
        ttk.Button(f, text="Testar todos os avisos agora", style="Accent.TButton",
                   command=self.test_notifications).pack(anchor="w", pady=8)
        ttk.Label(f, text="SMS não é incluído porque todo envio de SMS é pago; o push do ntfy faz o mesmo papel, "
                         "de graca.", foreground="#666").pack(anchor="w")

    def _tab_historico(self, nb):
        f = ttk.Frame(nb, padding=14)
        nb.add(f, text="  Histórico  ")
        self.hist = tk.Text(f, height=20, font=("Consolas", 10))
        self.hist.pack(fill="both", expand=True)
        b = ttk.Frame(f)
        b.pack(fill="x", pady=6)
        ttk.Button(b, text="Atualizar", command=self.refresh_history).pack(side="left")
        ttk.Button(b, text="Abrir planilha (CSV)", command=lambda: self._open(core.HISTORY_CSV)).pack(side="left",
                                                                                                    padx=6)
        self.refresh_history()

    # ---------------- helpers de listas ----------------
    def _lb_remove(self, lb):
        for i in reversed(lb.curselection()):
            lb.delete(i)

    def _lb_move(self, lb, delta):
        sel = lb.curselection()
        if not sel:
            return
        i = sel[0]
        j = i + delta
        if 0 <= j < lb.size():
            v = lb.get(i)
            lb.delete(i)
            lb.insert(j, v)
            lb.selection_set(j)

    def _add_doc(self):
        paths = filedialog.askopenfilenames(title="Escolha os documentos",
                                            filetypes=[("PDF / imagens", "*.pdf *.jpg *.jpeg *.png"), ("Todos", "*.*")])
        core.FILES_DIR.mkdir(exist_ok=True)
        for p in paths:
            name = os.path.basename(p)
            dest = core.FILES_DIR / name
            if os.path.abspath(p) != str(dest):
                shutil.copy(p, dest)
            if name not in self.lb_docs.get(0, "end"):
                self.lb_docs.insert("end", name)

    def _add_companion(self):
        win = tk.Toplevel(self)
        win.title("Acompanhante")
        win.transient(self)
        vals = {k: tk.StringVar() for k in ("nome", "sobrenome", "nascimento", "parentesco")}
        for r, (k, lab) in enumerate((("nome", "Nome"), ("sobrenome", "Sobrenome"),
                                      ("nascimento", "Nascimento (dd/mm/aaaa)"), ("parentesco", "Parentesco"))):
            ttk.Label(win, text=lab).grid(row=r, column=0, padx=8, pady=4, sticky="w")
            if k == "parentesco":
                ttk.Combobox(win, textvariable=vals[k], values=PARENTESCO, width=27).grid(row=r, column=1, padx=8)
            else:
                ttk.Entry(win, textvariable=vals[k], width=30).grid(row=r, column=1, padx=8)

        def ok():
            if not core.parse_date(vals["nascimento"].get()):
                messagebox.showerror(APP, "Data de nascimento invalida (use dd/mm/aaaa).", parent=win)
                return
            self.tv_acomp.insert("", "end", values=tuple(vals[k].get() for k in vals))
            win.destroy()

        ttk.Button(win, text="Adicionar", command=ok).grid(row=5, column=1, sticky="e", padx=8, pady=8)

    def _open(self, path):
        path = str(path)
        if not os.path.exists(path):
            os.makedirs(path, exist_ok=True) if not os.path.splitext(path)[1] else None
        if not os.path.exists(path):
            messagebox.showinfo(APP, "Ainda não existe.")
            return
        if sys.platform == "win32":
            os.startfile(path)  # type: ignore[attr-defined]
        else:
            subprocess.Popen(["xdg-open", path])

    # ---------------- carregar / salvar ----------------
    def _load_into_ui(self):
        cfg, env = self.cfg, self.env
        for k, v in self.vars.items():
            if k.startswith("env."):
                v.set(env.get(k[4:], ""))
            elif k.startswith("dados."):
                v.set(str(cfg["dados"].get(k[6:], "") or ""))
            elif k in cfg:
                v.set(cfg[k] if isinstance(v, tk.BooleanVar) else str(cfg[k] if cfg[k] is not None else ""))
        self.vars["servicos_txt"].set(", ".join(str(s) for s in cfg.get("servicos", [])))
        dias = [int(x) for x in cfg.get("dias_semana") or []]
        pref = [int(x) for x in cfg.get("dias_preferidos") or []]
        for i in range(1, 8):
            self.vars[f"dia{i}"].set(i in dias)
            self.vars[f"pref{i}"].set(i in pref)
        self.lb_docs.delete(0, "end")
        for d in cfg.get("documentos") or []:
            self.lb_docs.insert("end", d)
        self.tv_mem.delete(*self.tv_mem.get_children())
        for k, v in (cfg.get("respostas_aprendidas") or {}).items():
            self.tv_mem.insert("", "end", values=(k, v))
        self._update_summary()
        self.tv_acomp.delete(*self.tv_acomp.get_children())
        for p in cfg.get("acompanhantes") or []:
            self.tv_acomp.insert("", "end", values=(p.get("nome", ""), p.get("sobrenome", ""),
                                                    p.get("nascimento", ""), p.get("parentesco", "")))

    def _collect(self) -> tuple[dict, dict]:
        cfg = json.loads(json.dumps(self.cfg))
        env = dict(self.env)
        nums = {"intervalo_min_segundos", "intervalo_max_segundos", "max_tentativas", "espera_bloqueio_minutos",
                "meses_a_procurar"}
        for k, v in self.vars.items():
            val = v.get()
            if k.startswith("env."):
                env[k[4:]] = str(val).strip()
            elif k.startswith("dados."):
                cfg["dados"][k[6:]] = str(val).strip()
            elif k in core.DEFAULT_CONFIG:
                if k in nums:
                    try:
                        val = int(float(val))
                    except ValueError:
                        val = core.DEFAULT_CONFIG[k]
                cfg[k] = val
        cfg["servicos"] = [int(x) for x in self.vars["servicos_txt"].get().replace(";", ",").split(",")
                           if x.strip().isdigit()]
        cfg["dias_semana"] = [i for i in range(1, 8) if self.vars[f"dia{i}"].get()]
        cfg["dias_preferidos"] = [i for i in range(1, 8) if self.vars[f"pref{i}"].get()]
        cfg["documentos"] = list(self.lb_docs.get(0, "end"))
        cfg["acompanhantes"] = [dict(zip(("nome", "sobrenome", "nascimento", "parentesco"),
                                         [str(x) for x in self.tv_acomp.item(i)["values"]]))
                                for i in self.tv_acomp.get_children()]
        cfg["respostas_aprendidas"] = {str(self.tv_mem.item(i)["values"][0]): str(self.tv_mem.item(i)["values"][1])
                                       for i in self.tv_mem.get_children()}
        return cfg, env

    def _update_summary(self):
        cfg, env = self.cfg, self.env
        nomes = []
        for sid in cfg.get("servicos") or []:
            pre = core.SERVICE_PRESETS.get(int(sid))
            nomes.append(f"{sid} ({pre['nome']})" if pre else str(sid))
        conta = env.get("PRENOTAMI_EMAIL") or "NAO CONFIGURADA"
        docs = ", ".join(cfg.get("documentos") or []) or "nenhum"
        self.summary.set(f"Conta: {conta}   |   Serviço: {', '.join(nomes) or 'nenhum'}   |   Documentos: {docs}"
                         f"   |   Segundo plano: {'sim' if cfg.get('segundo_plano', True) else 'não'}")

    def save_all(self, quiet=False):
        cfg, env = self._collect()
        core.save_config(cfg, core.profile_path(self.profile))
        LAST_PROFILE.write_text(self.profile, encoding="utf-8")
        file_env = dict(env)
        if self.vars["cofre"].get() and core.vault_available():
            for k in core.SECRET_KEYS:
                if core.vault_set(k, env.get(k, "")):
                    file_env[k] = ""
        core.save_env(file_env)
        self.cfg, self.env = core.load_config(core.profile_path(self.profile)), core.load_env()
        self._update_summary()
        if not quiet:
            self.status.set(f"Perfil '{self.profile}' salvo {datetime.now():%H:%M:%S}.")
        return True

    def _switch_profile(self, name):
        self.save_all(quiet=True)
        self.profile = name
        self.cfg = core.load_config(core.profile_path(name))
        LAST_PROFILE.write_text(name, encoding="utf-8")
        self._load_into_ui()
        self.status.set(f"Perfil '{name}' carregado.")

    def _new_profile(self, copy=False):
        name = simpledialog.askstring(APP, "Nome do novo perfil (ex.: passaporte_cuiaba):", parent=self)
        if not name:
            return
        self.save_all(quiet=True)
        path = core.profile_path(name)
        cfg = self._collect()[0] if copy else core.DEFAULT_CONFIG
        core.save_config(cfg, path)
        self.cb_profile["values"] = core.list_profiles()
        self.cb_profile.set(path.stem)
        self._switch_profile(path.stem)

    def _delete_profile(self):
        if len(core.list_profiles()) <= 1:
            messagebox.showinfo(APP, "Precisa existir pelo menos um perfil.")
            return
        if messagebox.askyesno(APP, f"Excluir o perfil '{self.profile}'?"):
            core.profile_path(self.profile).unlink(missing_ok=True)
            profs = core.list_profiles()
            self.cb_profile["values"] = profs
            self.cb_profile.set(profs[0])
            self.profile = profs[0]
            self.cfg = core.load_config(core.profile_path(self.profile))
            self._load_into_ui()

    # ---------------- acoes ----------------
    def check_cfg(self):
        self.save_all(quiet=True)
        probs = core.preflight(self.cfg, self.env)
        chans = [n for n, ok in (("celular", self.env.get("NTFY_TOPICO")), ("WhatsApp", self.env.get("WHATSAPP_APIKEY")),
                                 ("Telegram", self.env.get("TELEGRAM_TOKEN")), ("e-mail", self.env.get("IMAP_SENHA_APP")))
                 if ok]
        msg = "\n".join(f"- {p}" for p in probs) if probs else "Tudo certo!"
        msg += f"\n\nAvisos ativos: {', '.join(chans) if chans else 'nenhum (só alarme no PC)'}"
        msg += f"\nServiços: {', '.join(map(str, self.cfg['servicos'])) or 'nenhum'}"
        messagebox.showinfo(APP, msg)

    def test_notifications(self):
        self.save_all(quiet=True)

        def run():
            r = core.notify(self.env, "PrenotaBot: teste de aviso. Se você recebeu, está tudo certo!")
            self.q.put(("call", lambda: messagebox.showinfo(
                APP, "Resultado do teste:\n\n" + "\n".join(f"{k}: {v}" for k, v in r.items())
                     + "\n\nok = enviado | off = não configurado | erro = veja o log")))

        threading.Thread(target=run, daemon=True).start()
        threading.Thread(target=core.beep, args=(2,), daemon=True).start()

    def start_bot(self, discover: bool):
        if self.bot_thread and self.bot_thread.is_alive():
            return
        self.save_all(quiet=True)
        probs = [p for p in core.preflight(self.cfg, self.env) if p.startswith("Documento")]
        if probs and not discover and not self.cfg.get("somente_alertar"):
            if not messagebox.askyesno(APP, "\n".join(probs) + "\n\nContinuar mesmo assim?"):
                return
        self.stop.clear()
        self.attempts = 0
        self.bot = core.PrenotaBot(self.cfg, self.env, GuiUI(self), self.stop,
                                   cfg_path=core.profile_path(self.profile))
        self.bot_thread = threading.Thread(target=self._run_bot, args=(discover,), daemon=True)
        self.bot_thread.start()
        self.b_start.config(state="disabled", bg="#9e9e9e")
        self.b_stop.config(state="normal", bg=RED)
        self.big.set("Listando servicos..." if discover else "Monitorando...")
        self.nb.select(0)

    def _run_bot(self, discover):
        try:
            self.bot.run(only_discover=discover)
        except Exception as e:
            core.log.exception(f"Erro inesperado: {e}")
        finally:
            self.bot.quit()
            if discover:
                self.q.put(("call", self._fill_catalog))

    def stop_bot(self):
        self.stop.set()
        self.big.set("Parando...")
        if self.bot:
            threading.Thread(target=self.bot.quit, daemon=True).start()

    def refresh_history(self):
        h = core.history_summary()
        lines = [f"Verificacoes registradas: {h['total']}", f"Vezes em que havia vaga: {h['vagas']}", ""]
        if h["horas_com_vaga"]:
            lines.append("Horários em que as vagas apareceram (use para ajustar a janela de horário):")
            mx = max(h["horas_com_vaga"].values())
            for hr in sorted(h["horas_com_vaga"]):
                n = h["horas_com_vaga"][hr]
                lines.append(f"  {hr}h  {'#' * max(1, int(30 * n / mx))} {n}")
        else:
            lines.append("Ainda não há vagas registradas. O histórico cresce enquanto o monitor roda.")
        self.hist.delete("1.0", "end")
        self.hist.insert("end", "\n".join(lines))

    # ---------------- modais chamados pelo bot ----------------
    def modal_info(self, msg):
        self.deiconify()
        self.lift()
        self.attributes("-topmost", True)
        messagebox.showinfo(APP, msg, parent=self)
        self.attributes("-topmost", False)

    def modal_text(self, msg):
        self.deiconify()
        self.lift()
        return simpledialog.askstring(APP, msg, parent=self)

    # ---------------- loop de eventos ----------------
    def _poll(self):
        try:
            while True:
                kind, data = self.q.get_nowait()
                if kind == "log":
                    tag = "err" if "[ERROR]" in data else "warn" if "[WARNING]" in data else \
                        "ok" if ("VAGA" in data or "CONCLUIDO" in data) else ""
                    self.txt.insert("end", data + "\n", tag)
                    self.txt.see("end")
                    if int(self.txt.index("end-1c").split(".")[0]) > 3000:
                        self.txt.delete("1.0", "500.0")
                    if "Tentativa " in data:
                        self.attempts += 1
                        self.counters.set(f"Tentativas nesta sessao: {self.attempts}   |   ultima: "
                                          f"{datetime.now():%H:%M:%S}")
                elif kind == "status":
                    self.status.set(data)
                    if "VAGA" in data or "CONCLUIDO" in data:
                        self.big.set(data)
                elif kind == "finished":
                    self.b_start.config(state="normal", bg=GREEN)
                    self.b_stop.config(state="disabled", bg="#9e9e9e")
                    self.cfg = core.load_config(core.profile_path(self.profile))
                    self._load_into_ui()
                    if not self.big.get().startswith(("VAGA", "AGENDAMENTO")):
                        self.big.set("Parado")
                    self.refresh_history()
                elif kind == "call":
                    data()
        except queue.Empty:
            pass
        self.after(150, self._poll)

    def _check_first_run(self):
        if not self.env.get("PRENOTAMI_EMAIL") or not self.cfg.get("servicos"):
            self.after(400, lambda: Wizard(self))

    def _on_close(self):
        if self.bot_thread and self.bot_thread.is_alive():
            if not messagebox.askyesno(APP, "O monitor está rodando. Fechar mesmo assim?"):
                return
            self.stop_bot()
        try:
            self.save_all(quiet=True)
        except Exception:
            pass
        self.destroy()


# ------------------------------------------------------------------------- #
class Wizard(tk.Toplevel):
    """Assistente de configuracao em 5 passos, para quem nunca usou."""

    def __init__(self, app: Painel):
        super().__init__(app)
        self.app = app
        self.title("Assistente - PrenotaBot Livre")
        self.geometry("720x560")
        self.transient(app)
        self.grab_set()
        cfg, env = app._collect()
        self.cfg, self.env = cfg, env
        self.step = 0
        self.v = {
            "email": tk.StringVar(value=env.get("PRENOTAMI_EMAIL", "")),
            "senha": tk.StringVar(value=env.get("PRENOTAMI_SENHA", "")),
            "servico": tk.IntVar(value=(cfg.get("servicos") or [5402])[0]),
            "outro": tk.StringVar(value=""),
            "endereco": tk.StringVar(value=cfg["dados"].get("endereco", "")),
            "altura": tk.StringVar(value=cfg["dados"].get("altura_cm", "")),
            "civil": tk.StringVar(value=cfg["dados"].get("estado_civil", "")),
            "olhos": tk.StringVar(value=cfg["dados"].get("cor_olhos", "")),
            "filhos": tk.StringVar(value=cfg["dados"].get("quantidade_filhos", "0")),
            "venc": tk.StringVar(value=cfg["dados"].get("data_vencimento_passaporte", "")),
            "ntfy": tk.StringVar(value=env.get("NTFY_TOPICO", "")),
            "zap": tk.StringVar(value=env.get("WHATSAPP_TELEFONE", "")),
            "zapkey": tk.StringVar(value=env.get("WHATSAPP_APIKEY", "")),
        }
        self.docs = list(cfg.get("documentos") or [])
        head = tk.Frame(self, bg=DARK)
        head.pack(fill="x")
        self.h_title = tk.Label(head, bg=DARK, fg="white", font=("Segoe UI", 15, "bold"), anchor="w")
        self.h_title.pack(fill="x", padx=16, pady=(12, 0))
        self.h_sub = tk.Label(head, bg=DARK, fg="#cfd8dc", font=("Segoe UI", 10), anchor="w")
        self.h_sub.pack(fill="x", padx=16, pady=(0, 12))
        self.body = ttk.Frame(self, padding=18)
        self.body.pack(fill="both", expand=True)
        nav = ttk.Frame(self, padding=12)
        nav.pack(fill="x")
        self.b_back = ttk.Button(nav, text="< Voltar", command=lambda: self.go(-1))
        self.b_back.pack(side="left")
        self.b_next = tk.Button(nav, text="Próximo >", bg=GREEN, fg="white", relief="flat",
                                font=("Segoe UI", 10, "bold"), padx=16, command=lambda: self.go(1))
        self.b_next.pack(side="right")
        self.steps = [self.s_conta, self.s_servico, self.s_dados, self.s_docs, self.s_avisos, self.s_fim]
        self.render()

    def clear(self):
        for w in self.body.winfo_children():
            w.destroy()

    def header(self, title, sub):
        self.h_title.config(text=f"Passo {self.step + 1} de {len(self.steps)} - {title}")
        self.h_sub.config(text=sub)

    def field(self, r, label, var, show=None, width=44, values=None, hint=""):
        ttk.Label(self.body, text=label, font=("Segoe UI", 10)).grid(row=r, column=0, sticky="w", pady=6, padx=(0, 10))
        if values is not None:
            w = ttk.Combobox(self.body, textvariable=var, values=values, width=width - 3, state="readonly")
        else:
            w = ttk.Entry(self.body, textvariable=var, width=width, show=show or "", font=("Segoe UI", 10))
        w.grid(row=r, column=1, sticky="w")
        if hint:
            ttk.Label(self.body, text=hint, foreground="#777").grid(row=r + 1, column=1, sticky="w")
        return w

    def render(self):
        self.clear()
        self.steps[self.step]()
        self.b_back.config(state="normal" if self.step else "disabled")
        self.b_next.config(text="Concluir e salvar" if self.step == len(self.steps) - 1 else "Próximo >")

    def go(self, d):
        if d > 0 and not self.validate():
            return
        if d > 0 and self.step == len(self.steps) - 1:
            self.finish()
            return
        self.step = max(0, min(len(self.steps) - 1, self.step + d))
        self.render()

    def validate(self) -> bool:
        if self.step == 0 and (not self.v["email"].get().strip() or not self.v["senha"].get()):
            messagebox.showwarning(APP, "Informe o e-mail e a senha que você usa no site Prenot@mi.", parent=self)
            return False
        if self.step == 1 and self.v["servico"].get() == -1 and not self.v["outro"].get().strip().isdigit():
            messagebox.showwarning(APP, "Digite o número do serviço (só números).", parent=self)
            return False
        if self.step == 2 and not self.v["endereco"].get().strip():
            messagebox.showwarning(APP, "O endereço completo é obrigatório no formulário do consulado.", parent=self)
            return False
        if self.step == 3 and not self.docs:
            return messagebox.askyesno(APP, "Nenhum documento escolhido. O site exige anexo. Continuar mesmo assim?",
                                       parent=self)
        return True

    # ----- passos -----
    def s_conta(self):
        self.header("Sua conta do Prenot@mi", "Os mesmos dados que você usa para entrar em prenotami.esteri.it")
        self.field(0, "E-mail", self.v["email"])
        pw = self.field(1, "Senha", self.v["senha"], show="*")
        sv = tk.BooleanVar()
        ttk.Checkbutton(self.body, text="mostrar senha", variable=sv,
                        command=lambda: pw.config(show="" if sv.get() else "*")).grid(row=2, column=1, sticky="w")
        ttk.Label(self.body, text="Ainda não tem conta? Crie em prenotami.esteri.it (botão 'Registrati') e volte aqui.",
                  foreground="#555").grid(row=3, column=0, columnspan=2, sticky="w", pady=(18, 4))
        ttk.Button(self.body, text="Abrir o site para criar conta",
                   command=lambda: webbrowser.open("https://prenotami.esteri.it/")).grid(row=4, column=0, sticky="w")
        ttk.Label(self.body, text="Sua senha fica guardada só neste computador (no cofre do Windows quando disponível).",
                  foreground="#2e7d32").grid(row=5, column=0, columnspan=2, sticky="w", pady=(18, 0))

    def s_servico(self):
        self.header("O que você quer agendar?", "O bot já conhece os formulários do Consulado de São Paulo")
        for i, (lab, sid, desc) in enumerate(QUICK_SERVICES):
            ttk.Radiobutton(self.body, text=lab, value=sid if sid else -1, variable=self.v["servico"]
                            ).grid(row=i * 2, column=0, sticky="w", pady=(8, 0))
            ttk.Label(self.body, text=desc, foreground="#666", wraplength=600).grid(row=i * 2 + 1, column=0,
                                                                                    sticky="w", padx=24)
        ttk.Label(self.body, text="Número do serviço (se souber):").grid(row=8, column=0, sticky="w", pady=(14, 0))
        ttk.Entry(self.body, textvariable=self.v["outro"], width=12).grid(row=9, column=0, sticky="w", padx=24)
        ttk.Label(self.body, text="Mora em Mato Grosso? O passaporte é feito no Vice-Consulado de Cuiabá (serviço próprio):"
                                  " escolha a 3a opção e use 'Listar serviços da minha conta'.",
                  foreground="#1565c0", wraplength=640).grid(row=10, column=0, sticky="w", pady=(14, 0))

    def s_dados(self):
        renov = self.v["servico"].get() == 5256
        self.header("Seus dados para o formulário", "Preencha uma vez; o bot usa sempre que a vaga abrir")
        self.field(0, "Endereço completo *", self.v["endereco"], width=56,
                   hint="Rua, número, bairro, cidade, estado e CEP")
        self.field(2, "Altura (cm)", self.v["altura"], width=10, hint="ex.: 175")
        self.field(4, "Estado civil", self.v["civil"], values=ESTADO_CIVIL, width=32)
        self.field(5, "Cor dos olhos", self.v["olhos"], values=COR_OLHOS, width=20)
        if renov:
            self.field(6, "Quantidade de filhos menores", self.v["filhos"], width=6)
            self.field(7, "Vencimento do passaporte", self.v["venc"], width=14, hint="dd/mm/aaaa")
        ttk.Label(self.body, text="Vai agendar junto com filhos/cônjuge? Adicione-os depois na aba Formulário.",
                  foreground="#555").grid(row=10, column=0, columnspan=2, sticky="w", pady=(16, 0))

    def s_docs(self):
        sid = self.v["servico"].get()
        pre = core.SERVICE_PRESETS.get(sid, {})
        self.header("Documentos para anexar", pre.get("documentos") or "Os PDFs que o consulado pede no agendamento")
        self.lb = tk.Listbox(self.body, height=7, font=("Segoe UI", 10), width=60)
        self.lb.grid(row=0, column=0, columnspan=3, sticky="ew")
        for d in self.docs:
            self.lb.insert("end", d)
        ttk.Button(self.body, text="Escolher arquivo...", command=self.pick).grid(row=1, column=0, sticky="w", pady=8)
        ttk.Button(self.body, text="Remover selecionado", command=self.unpick).grid(row=1, column=1, sticky="w")
        ttk.Label(self.body, text="Dicas: use PDF de até 2 MB, legível e em seu nome. O primeiro da lista vai no "
                                  "primeiro campo de anexo do site, o segundo no segundo, e assim por diante.",
                  foreground="#555", wraplength=640).grid(row=2, column=0, columnspan=3, sticky="w", pady=(10, 0))

    def pick(self):
        paths = filedialog.askopenfilenames(parent=self, title="Escolha o(s) documento(s)",
                                            filetypes=[("PDF / imagem", "*.pdf *.jpg *.jpeg *.png"), ("Todos", "*.*")])
        core.FILES_DIR.mkdir(exist_ok=True)
        for p in paths:
            name = os.path.basename(p)
            dest = core.FILES_DIR / name
            if os.path.abspath(p) != str(dest):
                shutil.copy(p, dest)
            size = os.path.getsize(dest) / 1024 / 1024
            if size > 3:
                messagebox.showwarning(APP, f"{name} tem {size:.1f} MB. O site costuma recusar arquivos grandes; "
                                            "considere comprimir o PDF.", parent=self)
            if name not in self.docs:
                self.docs.append(name)
                self.lb.insert("end", name)

    def unpick(self):
        for i in reversed(self.lb.curselection()):
            self.docs.pop(i)
            self.lb.delete(i)

    def s_avisos(self):
        self.header("Avisos no celular (opcional, grátis)", "Para saber da vaga mesmo longe do computador")
        ttk.Label(self.body, text="1) Notificação no celular - instale o app 'ntfy' (Play Store / App Store), "
                                  "toque em + e digite o tópico abaixo:", wraplength=640).grid(row=0, column=0,
                                                                                            columnspan=3, sticky="w")
        ttk.Entry(self.body, textvariable=self.v["ntfy"], width=34, font=("Segoe UI", 11)).grid(row=1, column=0,
                                                                                               sticky="w", pady=6)
        ttk.Button(self.body, text="Gerar tópico", command=lambda: self.v["ntfy"].set(
            "prenotabot-" + secrets.token_hex(5))).grid(row=1, column=1, sticky="w")
        ttk.Label(self.body, text="2) WhatsApp - mande 'I allow callmebot to send me messages' para +34 644 71 81 99 "
                                  "no WhatsApp; você recebe uma API key. Cole abaixo:", wraplength=640
                  ).grid(row=2, column=0, columnspan=3, sticky="w", pady=(16, 0))
        self.field(3, "Seu WhatsApp", self.v["zap"], width=20)
        self.field(4, "API key", self.v["zapkey"], width=20)
        ttk.Label(self.body, text="Mais opções (Telegram, e-mail e leitura automática do código OTP) na aba Avisos.",
                  foreground="#555").grid(row=6, column=0, columnspan=3, sticky="w", pady=(16, 0))

    def s_fim(self):
        self.header("Tudo pronto!", "Revise e clique em Concluir")
        sid = self.v["servico"].get()
        sid = int(self.v["outro"].get()) if self.v["outro"].get().strip().isdigit() else sid
        pre = core.SERVICE_PRESETS.get(sid, {})
        linhas = [
            f"Conta: {self.v['email'].get()}",
            f"Serviço: {sid if sid > 0 else 'descobrir na conta'} {('- ' + pre['nome']) if pre else ''}",
            f"Endereço: {self.v['endereco'].get()}",
            f"Documentos: {', '.join(self.docs) or 'nenhum'}",
            f"Avisos no celular: {'sim' if self.v['ntfy'].get() or self.v['zapkey'].get() else 'não'}",
            "",
            "Como funciona: clique em INICIAR. O Chrome abre, entra na sua conta e fica minimizado verificando",
            "as vagas. Quando abrir, ele toca um alarme, preenche tudo, anexa os documentos, escolhe o horário",
            "e salva o comprovante. Se aparecer captcha ou código, ele chama você.",
        ]
        ttk.Label(self.body, text="\n".join(linhas), font=("Segoe UI", 10), justify="left").grid(row=0, column=0,
                                                                                               sticky="w")
        self.start_after = tk.BooleanVar(value=True)
        ttk.Checkbutton(self.body, text="Iniciar o monitoramento agora", variable=self.start_after
                        ).grid(row=1, column=0, sticky="w", pady=16)

    def finish(self):
        app = self.app
        sid = self.v["servico"].get()
        if self.v["outro"].get().strip().isdigit():
            sid = int(self.v["outro"].get())
        app.vars["env.PRENOTAMI_EMAIL"].set(self.v["email"].get().strip())
        app.vars["env.PRENOTAMI_SENHA"].set(self.v["senha"].get())
        app.vars["servicos_txt"].set(str(sid) if sid > 0 else "")
        for k, var in (("endereco", "endereco"), ("altura_cm", "altura"), ("estado_civil", "civil"),
                       ("cor_olhos", "olhos"), ("quantidade_filhos", "filhos"),
                       ("data_vencimento_passaporte", "venc")):
            app.vars[f"dados.{k}"].set(self.v[var].get())
        if sid == 5256:
            app.vars["dados.passaporte_vencido"].set("Sim")
        app.vars["env.NTFY_TOPICO"].set(self.v["ntfy"].get().strip())
        app.vars["env.WHATSAPP_TELEFONE"].set(self.v["zap"].get().strip())
        app.vars["env.WHATSAPP_APIKEY"].set(self.v["zapkey"].get().strip())
        app.lb_docs.delete(0, "end")
        for d in self.docs:
            app.lb_docs.insert("end", d)
        app.save_all()
        start = self.start_after.get()
        self.destroy()
        if start:
            app.start_bot(sid <= 0)


if __name__ == "__main__":
    Painel().mainloop()
