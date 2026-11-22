"""
PrenotaBot Livre - motor de automacao do Prenot@mi (100% gratuito, codigo aberto).

Funcoes:
  * login automatico (portal antigo e novo IAM esteri.it), com fallback manual
  * captcha / bloqueio anti-robo: pausa e espera voce resolver
  * monitora um ou varios servicos, com janela de horario e dias da semana
  * descobre os servicos disponiveis na sua conta (lista IDs e nomes)
  * preenchimento inteligente do formulario pelos rotulos (it/pt/en/es)
  * acompanhantes (agendamento multiplo)
  * anexos automaticos, codigo OTP (manual ou lido do seu e-mail via IMAP)
  * escolha automatica de data/horario no calendario (com faixa de datas)
  * salva o comprovante (PDF ou imagem) em comprovantes/
  * alertas: som, notificacao no Telegram
"""

from __future__ import annotations

import email
import imaplib
import json
import logging
import os
import random
import re
import sys
import threading
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

import yaml
from dotenv import load_dotenv
from selenium import webdriver
from selenium.common.exceptions import (
    NoSuchElementException,
    TimeoutException,
    WebDriverException,
)
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select, WebDriverWait

BASE_DIR = Path(__file__).resolve().parent
FILES_DIR = BASE_DIR / "files"
LOGS_DIR = BASE_DIR / "logs"
PROOF_DIR = BASE_DIR / "comprovantes"
CONFIG_PATH = BASE_DIR / "config.yaml"
ENV_PATH = BASE_DIR / ".env"
SERVICES_CACHE = BASE_DIR / "servicos_da_conta.json"
PROFILES_DIR = BASE_DIR / "perfis"
HISTORY_CSV = LOGS_DIR / "historico_verificacoes.csv"
KEYRING_SERVICE = "PrenotaBotLivre"

SITE = "https://prenotami.esteri.it"
BOOKING_URL = SITE + "/Services/Booking/{id}"

UNAVAILABLE_HINTS = (
    "al momento non ci sono date disponibili",
    "non ci sono date disponibili",
    "all appointments for this service are currently booked",
    "stante l'elevata richiesta",
    "no hay citas disponibles",
    "nao ha datas disponiveis",
    "todas as vagas",
)

DEFAULT_CONFIG: dict = {
    "servicos": [],
    "intervalo_min_segundos": 45,
    "intervalo_max_segundos": 90,
    "max_tentativas": 0,
    "janela_horario": "",
    "dias_semana": [],
    "espera_bloqueio_minutos": 10,
    "usar_perfil_persistente": True,
    "auto_login": True,
    "preencher_formulario": True,
    "enviar_otp_automatico": True,
    "clicar_avancar": True,
    "auto_agendar": True,
    "data_minima": "",
    "data_maxima": "",
    "meses_a_procurar": 4,
    "salvar_comprovante": True,
    "somente_alertar": False,
    "segundo_plano": True,
    "preferencia_periodo": "qualquer",
    "dias_preferidos": [],
    "alerta_sonoro": True,
    "dados": {
        "endereco": "",
        "altura_cm": "",
        "estado_civil": "",
        "cor_olhos": "",
        "filhos_menores": "Nao",
        "quantidade_filhos": "0",
        "passaporte_vencido": "Nao",
        "data_vencimento_passaporte": "",
        "observacoes": "",
    },
    "acompanhantes": [],
    "documentos": [],
    "campos_extra": [],
    "respostas_aprendidas": {},
}

# ------------------------------------------------------------------------- #
# Utilidades
# ------------------------------------------------------------------------- #
log = logging.getLogger("prenotabot")


def normalize(text) -> str:
    text = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode()
    return " ".join(text.lower().split())


def deep_merge(base: dict, extra: dict) -> dict:
    out = dict(base)
    for k, v in (extra or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def setup_logging(extra_handler: logging.Handler | None = None) -> None:
    LOGS_DIR.mkdir(exist_ok=True)
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%d/%m %H:%M:%S")
    log.setLevel(logging.INFO)
    log.handlers.clear()
    fh = logging.FileHandler(LOGS_DIR / "prenotabot.log", encoding="utf-8")
    fh.setFormatter(fmt)
    log.addHandler(fh)
    if extra_handler is None:
        extra_handler = logging.StreamHandler(sys.stdout)
    extra_handler.setFormatter(fmt)
    log.addHandler(extra_handler)


def load_config(path: Path = CONFIG_PATH) -> dict:
    user = {}
    if path.is_file():
        with open(path, "r", encoding="utf-8") as f:
            user = yaml.safe_load(f) or {}
    cfg = deep_merge(DEFAULT_CONFIG, user)
    cfg["servicos"] = [int(s) for s in (cfg.get("servicos") or []) if str(s).strip().isdigit()]
    lo, hi = float(cfg["intervalo_min_segundos"]), float(cfg["intervalo_max_segundos"])
    lo = max(lo, 20.0)
    cfg["intervalo_min_segundos"], cfg["intervalo_max_segundos"] = lo, max(hi, lo)
    return cfg


def save_config(cfg: dict, path: Path = CONFIG_PATH) -> None:
    header = (
        "# PrenotaBot Livre - configuracao (pode editar aqui ou pelo painel)\n"
        "# Veja LEIAME.md para a explicacao de cada opcao.\n"
    )
    with open(path, "w", encoding="utf-8") as f:
        f.write(header)
        yaml.safe_dump(cfg, f, allow_unicode=True, sort_keys=False, width=120)


ENV_KEYS = ("PRENOTAMI_EMAIL", "PRENOTAMI_SENHA",
            "TELEGRAM_TOKEN", "TELEGRAM_CHAT_ID",
            "IMAP_EMAIL", "IMAP_SENHA_APP", "IMAP_SERVIDOR",
            "EMAIL_AVISO_DESTINO", "SMTP_SERVIDOR",
            "WHATSAPP_TELEFONE", "WHATSAPP_APIKEY",
            "NTFY_TOPICO")


def load_env() -> dict:
    load_dotenv(ENV_PATH, override=True)
    env = {k: (os.getenv(k) or "").strip().strip('"\'') for k in ENV_KEYS}
    # compatibilidade com o .env antigo
    env["PRENOTAMI_EMAIL"] = env["PRENOTAMI_EMAIL"] or (os.getenv("username") or "").strip('"\' ')
    env["PRENOTAMI_SENHA"] = env["PRENOTAMI_SENHA"] or (os.getenv("password") or "").strip('"\' ')
    # senhas guardadas no cofre do Windows (Gerenciador de Credenciais) tem prioridade
    for key in SECRET_KEYS:
        v = vault_get(key)
        if v:
            env[key] = v
    return env


SECRET_KEYS = ("PRENOTAMI_SENHA", "IMAP_SENHA_APP", "TELEGRAM_TOKEN", "WHATSAPP_APIKEY")


def _keyring():
    try:
        import keyring  # type: ignore

        keyring.get_keyring()
        return keyring
    except Exception:
        return None


def vault_get(name: str) -> str:
    kr = _keyring()
    if not kr:
        return ""
    try:
        return kr.get_password(KEYRING_SERVICE, name) or ""
    except Exception:
        return ""


def vault_set(name: str, value: str) -> bool:
    kr = _keyring()
    if not kr:
        return False
    try:
        if value:
            kr.set_password(KEYRING_SERVICE, name, value)
        else:
            try:
                kr.delete_password(KEYRING_SERVICE, name)
            except Exception:
                pass
        return True
    except Exception:
        return False


def vault_available() -> bool:
    kr = _keyring()
    if not kr:
        return False
    name = type(kr.get_keyring()).__name__.lower()
    return "fail" not in name and "null" not in name


# ---------------- perfis ----------------
def list_profiles() -> list[str]:
    PROFILES_DIR.mkdir(exist_ok=True)
    return sorted(p.stem for p in PROFILES_DIR.glob("*.yaml"))


def profile_path(name: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_\- ]", "", name).strip().replace(" ", "_") or "padrao"
    PROFILES_DIR.mkdir(exist_ok=True)
    return PROFILES_DIR / f"{safe}.yaml"


def record_history(service_id: int, state: str) -> None:
    try:
        LOGS_DIR.mkdir(exist_ok=True)
        new = not HISTORY_CSV.exists()
        with open(HISTORY_CSV, "a", encoding="utf-8") as f:
            if new:
                f.write("data_hora;dia_semana;servico;resultado\n")
            now = datetime.now()
            f.write(f"{now:%Y-%m-%d %H:%M:%S};{now.isoweekday()};{service_id};{state}\n")
    except Exception:
        pass


def history_summary() -> dict:
    """Resumo do historico: total, vagas encontradas e horarios em que apareceram."""
    out = {"total": 0, "vagas": 0, "horas_com_vaga": {}}
    if not HISTORY_CSV.exists():
        return out
    for line in HISTORY_CSV.read_text(encoding="utf-8").splitlines()[1:]:
        parts = line.split(";")
        if len(parts) < 4:
            continue
        out["total"] += 1
        if parts[3] in ("disponivel", "calendario"):
            out["vagas"] += 1
            h = parts[0][11:13]
            out["horas_com_vaga"][h] = out["horas_com_vaga"].get(h, 0) + 1
    return out


def save_env(values: dict) -> None:
    lines = [f"{k}={values.get(k, '')}" for k in ENV_KEYS]
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_date(s) -> date | None:
    s = str(s or "").strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def in_time_window(cfg: dict, now: datetime | None = None) -> tuple[bool, float]:
    """(dentro_da_janela, segundos_ate_abrir)."""
    now = now or datetime.now()
    dias = [int(d) for d in (cfg.get("dias_semana") or [])]  # 1=seg ... 7=dom
    janela = str(cfg.get("janela_horario") or "").strip()
    start_t = end_t = None
    if janela:
        m = re.match(r"^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$", janela)
        if m:
            h1, m1, h2, m2 = map(int, m.groups())
            start_t, end_t = (h1, m1), (h2, m2)
    for add in range(0, 8):
        d = now + timedelta(days=add)
        if dias and d.isoweekday() not in dias:
            continue
        if start_t is None:
            if add == 0:
                return True, 0
            nxt = d.replace(hour=0, minute=0, second=0, microsecond=0)
            return False, (nxt - now).total_seconds()
        s = d.replace(hour=start_t[0], minute=start_t[1], second=0, microsecond=0)
        e = d.replace(hour=end_t[0], minute=end_t[1], second=0, microsecond=0)
        if add == 0 and s <= now <= e:
            return True, 0
        if s > now:
            return False, (s - now).total_seconds()
    return True, 0


# ------------------------------------------------------------------------- #
# Interface (terminal por padrao; o painel substitui)
# ------------------------------------------------------------------------- #
class ConsoleUI:
    def ask(self, msg: str) -> None:
        input(f"\n>>> {msg}\n>>> Pressione ENTER para continuar... ")

    def ask_text(self, msg: str) -> str:
        return input(f"\n>>> {msg}: ").strip()

    def status(self, msg: str) -> None:
        pass

    def finished(self) -> None:
        pass


# ------------------------------------------------------------------------- #
# Notificacoes
# ------------------------------------------------------------------------- #
def beep(times: int = 5) -> None:
    try:
        import winsound  # type: ignore

        for _ in range(times):
            winsound.Beep(1200, 350)
            time.sleep(0.12)
    except Exception:
        print("\a" * 3, end="", flush=True)


def _http(url: str, data: bytes | None = None, headers: dict | None = None) -> None:
    req = urllib.request.Request(url, data=data, headers=headers or {})
    urllib.request.urlopen(req, timeout=15).read()


def notify_telegram(env: dict, text: str) -> bool:
    token, chat = env.get("TELEGRAM_TOKEN"), env.get("TELEGRAM_CHAT_ID")
    if not (token and chat):
        return False
    _http(f"https://api.telegram.org/bot{token}/sendMessage",
          urllib.parse.urlencode({"chat_id": chat, "text": text}).encode())
    return True


def notify_whatsapp(env: dict, text: str) -> bool:
    """WhatsApp gratuito via CallMeBot (https://www.callmebot.com/blog/free-api-whatsapp-messages/)."""
    phone, key = env.get("WHATSAPP_TELEFONE"), env.get("WHATSAPP_APIKEY")
    if not (phone and key):
        return False
    phone = re.sub(r"[^\d+]", "", phone)
    q = urllib.parse.urlencode({"phone": phone, "text": text, "apikey": key})
    _http(f"https://api.callmebot.com/whatsapp.php?{q}")
    return True


def notify_ntfy(env: dict, text: str, title: str = "PrenotaBot") -> bool:
    """Notificacao push no celular, gratis, pelo app ntfy (Android/iPhone)."""
    topic = (env.get("NTFY_TOPICO") or "").strip()
    if not topic:
        return False
    url = topic if topic.startswith("http") else f"https://ntfy.sh/{topic}"
    _http(url, text.encode("utf-8"), {"Title": title, "Priority": "urgent", "Tags": "rotating_light"})
    return True


def notify_email(env: dict, text: str, subject: str = "PrenotaBot - aviso") -> bool:
    user, pwd = env.get("IMAP_EMAIL"), env.get("IMAP_SENHA_APP")
    dest = env.get("EMAIL_AVISO_DESTINO") or user
    if not (user and pwd and dest):
        return False
    import smtplib
    from email.mime.text import MIMEText

    server = env.get("SMTP_SERVIDOR") or ("smtp.gmail.com" if user.endswith("gmail.com") else
                                          "smtp-mail.outlook.com" if user.endswith(("outlook.com", "hotmail.com")) else "")
    if not server:
        return False
    msg = MIMEText(text, "plain", "utf-8")
    msg["Subject"], msg["From"], msg["To"] = subject, user, dest
    with smtplib.SMTP(server, 587, timeout=20) as s:
        s.starttls()
        s.login(user, pwd)
        s.sendmail(user, [d.strip() for d in dest.split(",")], msg.as_string())
    return True


CHANNELS = {
    "telegram": notify_telegram,
    "whatsapp": notify_whatsapp,
    "celular (ntfy)": notify_ntfy,
    "e-mail": notify_email,
}


def notify(env: dict, text: str, important: bool = True) -> dict:
    """Envia o aviso por todos os canais configurados. Retorna {canal: 'ok'|'erro'|'off'}."""
    result = {}
    for name, fn in CHANNELS.items():
        if name == "e-mail" and not important:
            result[name] = "off"
            continue
        try:
            result[name] = "ok" if fn(env, text) else "off"
        except Exception as e:
            result[name] = "erro"
            log.warning(f"Aviso por {name} falhou: {e}")
    return result


def notify_async(env: dict, text: str, important: bool = True) -> None:
    threading.Thread(target=notify, args=(env, text, important), daemon=True).start()


# ------------------------------------------------------------------------- #
# OTP pelo e-mail (opcional)
# ------------------------------------------------------------------------- #
def read_otp_from_email(env: dict, since: datetime, timeout: int = 150, stop: threading.Event | None = None) -> str | None:
    user, pwd = env.get("IMAP_EMAIL"), env.get("IMAP_SENHA_APP")
    if not (user and pwd):
        return None
    server = env.get("IMAP_SERVIDOR") or ("imap.gmail.com" if user.endswith("gmail.com") else "")
    if not server:
        return None
    deadline = time.time() + timeout
    log.info("Procurando o codigo OTP no seu e-mail...")
    while time.time() < deadline and not (stop and stop.is_set()):
        try:
            with imaplib.IMAP4_SSL(server) as M:
                M.login(user, pwd)
                M.select("INBOX")
                crit = f'(SINCE "{since.strftime("%d-%b-%Y")}")'
                _, data = M.search(None, crit)
                ids = data[0].split()[-10:]
                for mid in reversed(ids):
                    _, msg_data = M.fetch(mid, "(RFC822)")
                    msg = email.message_from_bytes(msg_data[0][1])
                    sender = (msg.get("From") or "").lower()
                    if "esteri" not in sender and "prenotami" not in sender:
                        continue
                    try:
                        when = email.utils.parsedate_to_datetime(msg.get("Date"))
                        if when.timestamp() < since.timestamp() - 60:
                            continue
                    except Exception:
                        pass
                    body = ""
                    for part in msg.walk():
                        if part.get_content_type() in ("text/plain", "text/html"):
                            try:
                                body += part.get_payload(decode=True).decode(errors="ignore")
                            except Exception:
                                pass
                    m = re.search(r"(?<!\d)(\d{6})(?!\d)", re.sub(r"<[^>]+>", " ", body))
                    if m:
                        log.info("Codigo OTP encontrado no e-mail.")
                        return m.group(1)
        except Exception as e:
            log.warning(f"IMAP: {e}")
            return None
        time.sleep(8)
    return None


# ------------------------------------------------------------------------- #
# Mapeamento inteligente de campos
# ------------------------------------------------------------------------- #
# ordem importa: os mais especificos primeiro
FIELD_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("quantidade_filhos", ("numero figli", "numero di figli", "quanti figli", "quantidade de filhos",
                           "numero de filhos", "number of children", "how many children", "numero de hijos",
                           "figli minorenni numero", "n. figli")),
    ("filhos_menores", ("figli minor", "filhos menores", "minor children", "underage", "hijos menores",
                        "figli minorenni", "children under")),
    ("data_vencimento_passaporte", ("data di scadenza", "data scadenza", "data de vencimento",
                                    "data de expiracao", "expiry date", "expiration date", "fecha de vencimiento")),
    ("passaporte_vencido", ("passaporto scaduto", "passaporte vencido", "expired passport",
                            "passaporto in scadenza", "pasaporte vencido", "passaporte italiano vencido")),
    ("estado_civil", ("stato civile", "estado civil", "marital status", "civil status")),
    ("cor_olhos", ("colore occhi", "colore degli occhi", "cor dos olhos", "eye color", "eyes colour", "color de ojos")),
    ("altura_cm", ("altezza", "altura", "statura", "height")),
    ("endereco", ("indirizzo", "endereco", "address", "residenza", "direccion", "domicilio")),
]

SYNONYMS = [
    {"yes", "si", "sim", "s"},
    {"no", "nao", "n"},
]

RELATION_CODES = {  # usados pelo site no select TypeOfRelationDDL
    "companheiro": "9", "conjuge": "2", "conjuge divorciado": "11", "conjuge separado": "1",
    "filho de outro conjuge": "8", "filho": "5", "filha": "5", "genro": "3", "nora": "3",
    "irmao": "7", "irma": "7", "menor sob tutela": "12", "neto": "10", "neta": "10",
    "pai": "6", "mae": "6", "sogro": "4", "sogra": "4",
}

# Valores internos usados pelo Prenot@mi nos selects (servem de reserva se o texto mudar)
SELECT_CODES = {
    "estado_civil": {"casado": "13", "divorciado": "14", "viuvo": "15", "solteiro": "16", "separado": "17",
                     "em uniao civil": "18", "separado/a de uniao civil": "19",
                     "divorciado/a de uniao civil": "20", "viuvo/a de uniao civil": "21"},
    "cor_olhos": {"azul": "22", "marrom": "23", "castanho": "23", "cinza": "24", "preto": "25", "verde": "26"},
    "filhos_menores": {"sim": "11", "nao": "12"},
    "passaporte_vencido": {"sim": "1", "nao": "2"},
}

# Servicos com campos conhecidos (consulado de Sao Paulo em destaque)
SERVICE_PRESETS: dict[int, dict] = {
    5402: {"nome": "São Paulo - Primeiro passaporte",
           "campos": {"DatiAddizionaliPrenotante[0]._testo": "endereco", "ddls_1": "estado_civil",
                      "DatiAddizionaliPrenotante[2]._testo": "altura_cm", "ddls_3": "cor_olhos"},
           "documentos": "Comprovante de residência (em seu nome) - PDF"},
    5256: {"nome": "São Paulo - Renovação de passaporte",
           "campos": {"DatiAddizionaliPrenotante[0]._testo": "endereco", "ddls_1": "estado_civil",
                      "DatiAddizionaliPrenotante[2]._testo": "altura_cm", "ddls_3": "cor_olhos",
                      "DatiAddizionaliPrenotante[4]._testo": "quantidade_filhos",
                      "DatiAddizionaliPrenotante[5]._data": "data_vencimento_passaporte"},
           "documentos": "Cópia do passaporte italiano vencido/a vencer (ou B.O. de perda/roubo) - PDF"},
    4705: {"nome": "Curitiba - Passaporte", "campos": {}, "documentos": "Comprovante de residência - PDF"},
    2391: {"nome": "Belo Horizonte - Passaporte", "campos": {
        "DatiAddizionaliPrenotante_1___testo": "endereco", "ddls_0": "estado_civil", "ddls_4": "filhos_menores",
        "ddls_7": "passaporte_vencido", "BookingNotes": "altura_cm", "ddls_2": "cor_olhos"}, "documentos": ""},
}


def code_for(key: str, value: str) -> str | None:
    table = SELECT_CODES.get(key) or {}
    v = normalize(value).replace("/a", "").replace("/solteira", "").strip()
    if v in table:
        return table[v]
    for k, code in table.items():
        if k in v or v in k:
            return code
    return None


JS_COLLECT_FIELDS = r"""
const out = [];
const els = document.querySelectorAll('form select, form input, form textarea');
for (const el of els) {
  const type = (el.type || el.tagName).toLowerCase();
  if (['hidden','submit','button','checkbox','radio','file'].includes(type)) continue;
  if (!el.offsetParent && type !== 'date') continue;
  let label = '';
  if (el.id) { const l = document.querySelector(`label[for="${el.id}"]`); if (l) label = l.innerText; }
  if (!label) {
    let p = el.closest('.form-group, .row, div');
    for (let i = 0; i < 3 && p && !label; i++) {
      const l = p.querySelector('label'); if (l) label = l.innerText; p = p.parentElement;
    }
  }
  out.push({id: el.id || '', name: el.name || '', tag: el.tagName.toLowerCase(), type, label: label || el.placeholder || ''});
}
return out;
"""


def classify_label(label: str) -> str | None:
    lab = normalize(label)
    for key, words in FIELD_RULES:
        if any(w in lab for w in words):
            return key
    return None


def select_option(select_el, wanted: str) -> bool:
    sel = Select(select_el)
    target = normalize(wanted)
    cands = {target}
    for group in SYNONYMS:
        if target in group:
            cands |= group
    opts = [(o, normalize(o.text), o.get_attribute("value")) for o in sel.options]
    for o, t, v in opts:
        if t in cands or (v and normalize(v) == target):
            sel.select_by_visible_text(o.text) if o.text else sel.select_by_value(v)
            return True
    for o, t, v in opts:
        if t and len(target) >= 3 and (target in t or t in target):
            sel.select_by_visible_text(o.text)
            return True
    log.warning(f"Opcao '{wanted}' nao encontrada em {select_el.get_attribute('id') or select_el.get_attribute('name')}."
                f" Opcoes: {[o.text for o, _, _ in opts if o.text]}")
    return False


# ------------------------------------------------------------------------- #
# Bot
# ------------------------------------------------------------------------- #
class PrenotaBot:
    def __init__(self, cfg: dict, env: dict, ui=None, stop: threading.Event | None = None,
                 cfg_path: Path | None = None):
        self.cfg, self.env = cfg, env
        self.cfg_path = cfg_path
        self.current_service = 0
        self.ui = ui or ConsoleUI()
        self.stop = stop or threading.Event()
        self.driver = None

    # ---------- infraestrutura ----------
    def sleep(self, sec: float) -> bool:
        """Dorme; retorna False se o usuario mandou parar."""
        return not self.stop.wait(max(0.0, sec))

    def bring_front(self) -> None:
        """Traz o Chrome para a frente (usado quando precisa de voce)."""
        try:
            self.driver.switch_to.window(self.driver.current_window_handle)
            self.driver.set_window_position(0, 0)
            self.driver.maximize_window()
            self.driver.execute_script("window.focus()")
        except Exception:
            pass

    def to_background(self) -> None:
        if not self.cfg.get("segundo_plano", True):
            return
        try:
            self.driver.minimize_window()
        except Exception:
            pass

    def alert(self, msg: str, tg: bool = True, important: bool = True) -> None:
        self.bring_front()
        log.info("=" * 50)
        log.info(msg)
        log.info("=" * 50)
        self.ui.status(msg)
        if self.cfg.get("alerta_sonoro", True):
            threading.Thread(target=beep, daemon=True).start()
        if tg:
            notify_async(self.env, f"PrenotaBot: {msg}", important=important)

    def start_browser(self):
        opts = webdriver.ChromeOptions()
        opts.add_argument("--start-maximized")
        opts.add_argument("--disable-blink-features=AutomationControlled")
        opts.add_argument("--lang=pt-BR")
        opts.add_experimental_option("excludeSwitches", ["enable-automation"])
        opts.add_experimental_option("useAutomationExtension", False)
        opts.add_experimental_option("prefs", {"credentials_enable_service": False,
                                               "profile.password_manager_enabled": False})
        if self.cfg.get("usar_perfil_persistente", True):
            prof = BASE_DIR / "chrome_profile"
            prof.mkdir(exist_ok=True)
            opts.add_argument(f"--user-data-dir={prof}")
        if os.getenv("PRENOTABOT_HEADLESS"):
            opts.add_argument("--headless=new")
            opts.add_argument("--no-sandbox")
        if self.cfg.get("segundo_plano", True):
            # evita que o Chrome "durma" quando minimizado
            for a in ("--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
                      "--disable-renderer-backgrounding"):
                opts.add_argument(a)
        self.driver = webdriver.Chrome(options=opts)
        self.driver.set_page_load_timeout(90)
        return self.driver

    def quit(self):
        try:
            if self.driver:
                self.driver.quit()
        except Exception:
            pass
        self.driver = None

    def save_page(self, name: str) -> None:
        try:
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            (LOGS_DIR / f"{name}_{stamp}.html").write_text(self.driver.page_source, encoding="utf-8")
        except Exception:
            pass

    # ---------- deteccoes ----------
    def url(self) -> str:
        try:
            return self.driver.current_url.lower()
        except WebDriverException:
            return ""

    def is_captcha(self) -> bool:
        u = self.url()
        try:
            title = (self.driver.title or "").lower()
        except WebDriverException:
            title = ""
        return "perfdrive" in u or "validate." in u or "captcha" in title

    def is_blocked(self) -> bool:
        return "/error" in self.url()

    def is_logged_in(self) -> bool:
        u = self.url()
        if "iam.esteri.it" in u or "signin" in u:
            return False
        d = self.driver
        if d.find_elements(By.ID, "login-email") or d.find_elements(By.ID, "pingid-button"):
            return False
        if "/userarea" in u or "/services" in u or "/bookingcalendar" in u or "/reservation" in u:
            return True
        return bool(d.find_elements(By.XPATH, "//a[contains(@href,'Logout') or contains(@href,'logout')]"))

    def handle_captcha(self) -> None:
        if self.is_captcha():
            self.alert("Captcha / verificacao anti-robo na tela. Resolva no Chrome.", important=False)
            self.ui.ask("Resolva o captcha na janela do Chrome e depois clique OK / ENTER.")
            self.sleep(2)
            self.to_background()

    def handle_blocked(self) -> None:
        if self.is_blocked():
            mins = float(self.cfg.get("espera_bloqueio_minutos", 10))
            log.warning(f"O site bloqueou temporariamente (pagina de erro). Aguardando {mins:.0f} min...")
            self.ui.status(f"Bloqueio temporario - aguardando {mins:.0f} min")
            try:
                self.driver.delete_all_cookies()
            except WebDriverException:
                pass
            self.sleep(mins * 60)

    # ---------- login ----------
    def login(self) -> bool:
        d = self.driver
        d.get(SITE + "/")
        self.sleep(3)
        self.handle_captcha()
        if self.is_logged_in():
            log.info("Sessao ja ativa.")
            return True

        email_, pwd = self.env.get("PRENOTAMI_EMAIL"), self.env.get("PRENOTAMI_SENHA")
        if self.cfg.get("auto_login", True) and email_ and pwd:
            try:
                self._auto_login(email_, pwd)
                WebDriverWait(d, 45).until(lambda _: self.is_logged_in() or self.is_captcha())
                self.handle_captcha()
                if self.is_logged_in():
                    log.info("Login automatico OK.")
                    return True
            except (TimeoutException, WebDriverException) as e:
                log.warning(f"Login automatico nao concluiu ({type(e).__name__}).")

        self.alert("Faca o login manualmente no Chrome.", tg=False)
        self.ui.ask("Faca o login no Chrome (resolva captcha / codigo se pedir) e depois clique OK / ENTER.")
        if self.is_logged_in():
            log.info("Login manual confirmado.")
            return True
        d.get(SITE + "/UserArea")
        self.sleep(3)
        return self.is_logged_in()

    def _type(self, el, text: str) -> None:
        el.clear()
        for ch in text:
            el.send_keys(ch)
            time.sleep(random.uniform(0.04, 0.12))

    def _auto_login(self, email_: str, pwd: str) -> None:
        d = self.driver
        # portal antigo
        if d.find_elements(By.ID, "login-email"):
            self._type(d.find_element(By.ID, "login-email"), email_)
            self._type(d.find_element(By.ID, "login-password"), pwd)
            self.sleep(random.uniform(1, 2))
            btn = d.find_elements(By.XPATH, "//button[contains(@class,'g-recaptcha') or @type='submit']")
            if btn:
                btn[0].click()
            return
        # portal novo (IAM)
        ping = d.find_elements(By.ID, "pingid-button")
        if ping:
            ping[0].click()
        WebDriverWait(d, 40).until(
            lambda _: d.find_elements(By.CSS_SELECTOR, "input[autocomplete='username'], input[type='email']")
            or self.is_captcha() or self.is_logged_in()
        )
        self.handle_captcha()
        if self.is_logged_in():
            return
        user_in = d.find_elements(By.CSS_SELECTOR, "input[autocomplete='username'], input[type='email']")[0]
        self._type(user_in, email_)
        pw = d.find_elements(By.CSS_SELECTOR, "input[type='password']")
        if not pw:  # alguns fluxos pedem o e-mail e depois a senha
            d.find_element(By.CSS_SELECTOR, "button[type='submit']").click()
            pw = WebDriverWait(d, 20).until(lambda _: d.find_elements(By.CSS_SELECTOR, "input[type='password']"))
        self._type(pw[0], pwd)
        self.sleep(random.uniform(0.8, 1.6))
        d.find_element(By.CSS_SELECTOR, "button[type='submit']").click()

    # ---------- descoberta de servicos ----------
    def discover_services(self) -> list[dict]:
        d = self.driver
        d.get(SITE + "/Services")
        self.sleep(4)
        self.handle_captcha()
        servicos = d.execute_script(r"""
            const out = [];
            document.querySelectorAll("a[href*='/Services/Booking/']").forEach(a => {
              const id = parseInt(a.getAttribute('href').split('/').pop());
              const tr = a.closest('tr');
              let nome = '', desc = '';
              if (tr) { const tds = tr.querySelectorAll('td'); nome = (tds[0]||{}).innerText||''; desc = (tds[1]||{}).innerText||''; }
              out.push({id, nome: nome.trim(), descricao: desc.trim().slice(0, 200), botao: a.innerText.trim()});
            });
            return out;
        """) or []
        uniq = {s["id"]: s for s in servicos if s.get("id")}
        lista = list(uniq.values())
        SERVICES_CACHE.write_text(json.dumps(lista, ensure_ascii=False, indent=2), encoding="utf-8")
        log.info(f"{len(lista)} servicos encontrados na sua conta (salvos em {SERVICES_CACHE.name}):")
        for s in lista:
            log.info(f"  {s['id']:>6}  {s['nome']}  {('- ' + s['descricao'][:80]) if s['descricao'] else ''}")
        return lista

    # ---------- disponibilidade ----------
    def check_availability(self, timeout: int = 30) -> str:
        def state(d):
            if self.is_captcha():
                return "captcha"
            if self.is_blocked():
                return "bloqueado"
            if d.find_elements(By.ID, "login-email") or "signin" in self.url():
                return "deslogado"
            if "/bookingcalendar" in self.url():
                return "calendario"
            if d.find_elements(By.ID, "btnAvanti") or d.find_elements(By.ID, "PrivacyCheck") \
                    or d.find_elements(By.ID, "typeofbookingddl"):
                return "disponivel"
            for dlg in d.find_elements(By.XPATH, "//div[@role='dialog' or contains(@class,'jconfirm-box')]"):
                try:
                    if dlg.is_displayed():
                        return "indisponivel"
                except WebDriverException:
                    pass
            try:
                body = normalize(d.find_element(By.TAG_NAME, "body").text)
            except WebDriverException:
                body = ""
            if any(h in body for h in UNAVAILABLE_HINTS):
                return "indisponivel"
            if "/userarea" in self.url() or self.url().rstrip("/").endswith("/services"):
                return "indisponivel"  # redirecionado de volta = sem vaga
            return False

        try:
            st = WebDriverWait(self.driver, timeout, poll_frequency=0.5).until(state)
        except TimeoutException:
            return "desconhecido"
        if st == "indisponivel":
            for b in self.driver.find_elements(
                    By.XPATH, "//div[@role='dialog']//button | //div[contains(@class,'jconfirm')]//button"):
                try:
                    if b.is_displayed():
                        b.click()
                        break
                except WebDriverException:
                    pass
        return st

    # ---------- formulario ----------
    def _set_value(self, el, value: str, kind: str, key: str | None = None) -> bool:
        if kind == "select":
            if select_option(el, value):
                return True
            code = code_for(key, value) if key else None
            if code and any(o.get_attribute("value") == code for o in Select(el).options):
                Select(el).select_by_value(code)
                self.driver.execute_script("arguments[0].dispatchEvent(new Event('change',{bubbles:true}))", el)
                log.info(f"Selecionado pelo codigo interno {code}.")
                return True
            return False
        elif kind == "date":
            dt = parse_date(value)
            v = dt.isoformat() if dt else value
            self.driver.execute_script(
                "arguments[0].value=arguments[1];arguments[0].dispatchEvent(new Event('input',{bubbles:true}));"
                "arguments[0].dispatchEvent(new Event('change',{bubbles:true}));", el, v)
        else:
            el.clear()
            el.send_keys(str(value))
        return True

    def _find(self, ident: str):
        d = self.driver
        for by, val in ((By.ID, ident), (By.NAME, ident), (By.CSS_SELECTOR, ident)):
            try:
                els = d.find_elements(by, val)
            except WebDriverException:
                els = []
            if els:
                return els[0]
        return None

    def fill_form(self) -> None:
        d, cfg = self.driver, self.cfg
        dados = cfg.get("dados", {})
        acomp = cfg.get("acompanhantes") or []

        # 1) tipo de agendamento + acompanhantes
        tipo = d.find_elements(By.ID, "typeofbookingddl")
        if tipo:
            try:
                Select(tipo[0]).select_by_value("2" if acomp else "1")
                d.execute_script("arguments[0].dispatchEvent(new Event('change',{bubbles:true}))", tipo[0])
                self.sleep(1.5)
            except Exception as e:
                log.warning(f"Tipo de agendamento: {e}")
        if acomp:
            self._fill_companions(acomp)

        # 2) campos reconhecidos pelos rotulos
        filled = set()
        self._unknown: list[dict] = []
        fields = d.execute_script(JS_COLLECT_FIELDS) or []
        mapa = []
        for f in fields:
            key = classify_label(f["label"])
            ident = f["id"] or f["name"]
            mapa.append({**f, "reconhecido_como": key})
            if not ident or "accompagnatori" in normalize(ident) or ident in ("typeofbookingddl",
                                                                              "ddlnumberofcompanions", "otp-input"):
                continue
            if not key:
                lab = normalize(f["label"])
                learned = (cfg.get("respostas_aprendidas") or {}).get(lab)
                if learned:
                    el = self._find(f["id"]) if f["id"] else d.find_element(By.NAME, f["name"])
                    kind = "select" if f["tag"] == "select" else ("date" if f["type"] == "date" else "text")
                    try:
                        self._set_value(el, learned, kind)
                        filled.add(ident)
                        log.info(f"Preenchido pela memoria: {f['label'][:50]} = {learned}")
                    except Exception as e:
                        log.warning(f"Memoria '{f['label'][:40]}': {e}")
                elif lab:
                    self._unknown.append(f)
                continue
            value = str(dados.get(key, "") or "")
            if not value:
                log.info(f"Campo '{f['label'][:50]}' sem valor no config - preencha manualmente.")
                continue
            el = self._find(f["id"]) if f["id"] else d.find_element(By.NAME, f["name"])
            kind = "select" if f["tag"] == "select" else ("date" if f["type"] == "date" else "text")
            try:
                self._set_value(el, value, kind, key)
                filled.add(ident)
                filled.add(f["id"])
                filled.add(f["name"])
                log.info(f"Preenchido: {f['label'][:50]} = {value}")
                self.sleep(random.uniform(0.2, 0.6))
            except Exception as e:
                log.warning(f"Falha ao preencher '{f['label'][:40]}': {e}")
        (LOGS_DIR / "mapa_campos_ultimo_formulario.json").write_text(
            json.dumps(mapa, ensure_ascii=False, indent=2), encoding="utf-8")

        # 2b) campos exatos conhecidos do servico (ex.: Sao Paulo 5402) que nao foram reconhecidos
        preset = SERVICE_PRESETS.get(int(getattr(self, "current_service", 0) or 0), {})
        for ident, key in preset.get("campos", {}).items():
            if ident in filled:
                continue
            value = str(dados.get(key, "") or "")
            el = self._find(ident)
            if el is None or not value:
                continue
            kind = "select" if el.tag_name == "select" else ("date" if (el.get_attribute("type") == "date"
                                                                          or ident.endswith("_data")) else "text")
            try:
                self._set_value(el, value, kind, key)
                log.info(f"Preenchido (campo conhecido {ident}): {value}")
            except Exception as e:
                log.warning(f"Campo conhecido {ident}: {e}")

        # 3) observacoes
        notes = d.find_elements(By.ID, "BookingNotes")
        if notes and dados.get("observacoes"):
            notes[0].clear()
            notes[0].send_keys(dados["observacoes"])

        # 4) campos extras explicitos (id, name ou seletor CSS)
        for c in cfg.get("campos_extra") or []:
            el = self._find(str(c.get("id", "")))
            if el is None:
                log.warning(f"Campo extra {c.get('id')} nao encontrado.")
                continue
            kind = c.get("tipo") or ("select" if el.tag_name == "select" else "text")
            try:
                self._set_value(el, str(c.get("valor", "")), kind)
            except Exception as e:
                log.warning(f"Campo extra {c.get('id')}: {e}")

        # 5) anexos
        files = [f for f in d.find_elements(By.CSS_SELECTOR, "input[type='file']")]
        docs = cfg.get("documentos") or []
        for i, inp in enumerate(files):
            if i >= len(docs):
                log.warning(f"Ha mais campos de anexo ({len(files)}) do que documentos configurados ({len(docs)}).")
                break
            path = FILES_DIR / docs[i]
            if path.is_file():
                inp.send_keys(str(path))
                log.info(f"Anexado: {docs[i]}")
                self.sleep(0.8)
            else:
                log.warning(f"Documento nao encontrado: {path}")

        # 6) privacidade
        priv = d.find_elements(By.ID, "PrivacyCheck")
        if priv and not priv[0].is_selected():
            d.execute_script("arguments[0].click()", priv[0])

        # 7) OTP
        self._handle_otp()

        # 8) checagem de campos obrigatorios vazios
        missing = self.check_required()
        if missing:
            self.alert(f"Faltam {len(missing)} campo(s) obrigatorio(s): " + "; ".join(missing[:6]), important=False)
            self.ui.ask("Complete os campos que faltam no Chrome (eles foram destacados em vermelho) "
                        "e clique OK / ENTER. O bot aprende suas respostas e clica em Avancar em seguida.")
        if self._unknown:
            self.learn_answers(self._unknown)

        # 9) avancar
        if cfg.get("clicar_avancar", True):
            btn = d.find_elements(By.ID, "btnAvanti")
            if btn:
                d.execute_script("arguments[0].scrollIntoView({block:'center'})", btn[0])
                self.sleep(0.5)
                btn[0].click()
                log.info("Formulario enviado (Avanti).")

    JS_REQUIRED = r"""
    const miss = [];
    document.querySelectorAll('form select, form input, form textarea').forEach(el => {
      const t = (el.type || '').toLowerCase();
      if (['hidden','submit','button'].includes(t) || el.disabled) return;
      if (!el.offsetParent && t !== 'file') return;
      let lab = '';
      if (el.id) { const l = document.querySelector(`label[for="${el.id}"]`); if (l) lab = l.innerText; }
      const req = el.required || el.getAttribute('aria-required') === 'true' || el.getAttribute('data-val-required')
                  || /\*\s*$/.test(lab.trim());
      if (!req) return;
      const empty = t === 'checkbox' ? !el.checked : t === 'file' ? !(el.files && el.files.length) : !String(el.value || '').trim();
      if (empty) { el.style.outline = '3px solid #e53935'; miss.push((lab || el.name || el.id).replace(/\s+/g,' ').trim().slice(0, 60)); }
    });
    return miss;
    """

    def learn_answers(self, fields: list[dict]) -> None:
        """Le o que voce preencheu nos campos desconhecidos e guarda para as proximas vezes."""
        learned = dict(self.cfg.get("respostas_aprendidas") or {})
        new = 0
        for f in fields:
            el = self._find(f["id"]) if f["id"] else self._find(f["name"])
            if el is None:
                continue
            try:
                if el.tag_name == "select":
                    opt = Select(el).first_selected_option
                    val = opt.text.strip() if opt.get_attribute("value") else ""
                else:
                    val = (el.get_attribute("value") or "").strip()
            except Exception:
                continue
            lab = normalize(f["label"])
            if val and lab and learned.get(lab) != val:
                learned[lab] = val
                new += 1
        if new:
            self.cfg["respostas_aprendidas"] = learned
            log.info(f"Aprendi {new} resposta(s) nova(s) - da proxima vez preencho sozinho.")
            if self.cfg_path:
                try:
                    save_config(self.cfg, self.cfg_path)
                except Exception as e:
                    log.warning(f"Nao consegui salvar a memoria: {e}")

    def check_required(self) -> list[str]:
        try:
            miss = self.driver.execute_script(self.JS_REQUIRED) or []
        except WebDriverException:
            return []
        if miss:
            log.warning("Campos obrigatorios vazios: " + " | ".join(miss))
        else:
            log.info("Checagem do formulario: todos os campos obrigatorios estao preenchidos.")
        return miss

    def _fill_companions(self, acomp: list[dict]) -> None:
        d = self.driver
        num = d.find_elements(By.ID, "ddlnumberofcompanions")
        if not num:
            log.warning("Este servico nao aceita acompanhantes.")
            return
        try:
            Select(num[0]).select_by_value(str(len(acomp)))
        except Exception:
            d.execute_script("arguments[0].value=arguments[1]", num[0], str(len(acomp)))
        d.execute_script("arguments[0].dispatchEvent(new Event('change',{bubbles:true}))", num[0])
        self.sleep(3)
        for i, p in enumerate(acomp):
            try:
                ln = d.find_element(By.NAME, f"Accompagnatori[{i}].CognomeAccompagnatore")
                fn = d.find_element(By.NAME, f"Accompagnatori[{i}].NomeAccompagnatore")
                bd = d.find_element(By.NAME, f"Accompagnatori[{i}].DataNascitaAccompagnatore")
                ln.clear(); ln.send_keys(p.get("sobrenome", ""))
                fn.clear(); fn.send_keys(p.get("nome", ""))
                self._set_value(bd, p.get("nascimento", ""), "date")
                rel = d.find_elements(By.ID, f"TypeOfRelationDDL{i}")
                if rel:
                    wanted = str(p.get("parentesco", ""))
                    if not select_option(rel[0], wanted):
                        code = RELATION_CODES.get(normalize(wanted).replace("/a", ""))
                        if code:
                            d.execute_script(
                                "const s=arguments[0];if(![...s.options].some(o=>o.value==arguments[1]))"
                                "{const o=document.createElement('option');o.value=arguments[1];o.text=arguments[2];s.add(o)}"
                                "s.value=arguments[1];s.dispatchEvent(new Event('change',{bubbles:true}))",
                                rel[0], code, wanted)
                log.info(f"Acompanhante {i + 1}: {p.get('nome')} {p.get('sobrenome')}")
            except NoSuchElementException as e:
                log.warning(f"Acompanhante {i + 1}: campo nao encontrado ({e.msg[:60]})")

    def _handle_otp(self) -> None:
        d = self.driver
        send = d.find_elements(By.ID, "otp-send")
        box = d.find_elements(By.ID, "otp-input")
        if not send and not box:
            return
        sent_at = datetime.now()
        if send and self.cfg.get("enviar_otp_automatico", True):
            try:
                d.execute_script("arguments[0].click()", send[0])
                log.info("Codigo OTP solicitado - chega no seu e-mail.")
                notify_async(self.env, "PrenotaBot: codigo OTP enviado para o seu e-mail. Fique atento!", False)
            except WebDriverException:
                pass
        if not box:
            return
        code = read_otp_from_email(self.env, sent_at, stop=self.stop)
        if not code:
            beep(2)
            code = self.ui.ask_text("Digite o codigo OTP que chegou no seu e-mail (ou deixe vazio se ja digitou no Chrome)")
        if code:
            box[0].clear()
            box[0].send_keys(code)
            log.info("Codigo OTP preenchido.")

    # ---------- calendario ----------
    JS_AUTO_SCHEDULE = r"""
    const done = arguments[arguments.length - 1];
    const [months, minD, maxD, period, prefDays] = [arguments[0], arguments[1], arguments[2], arguments[3], arguments[4] || []];
    const dow = iso => { const d = new Date(iso + 'T12:00:00'); return d.getDay() === 0 ? 7 : d.getDay(); };
    const okPeriod = s => period === 'manha' ? s.OrarioInizioFascia.Hours < 12 : period === 'tarde' ? s.OrarioInizioFascia.Hours >= 12 : true;
    const post = async (url, body) => {
      const r = await fetch(url, {method: 'POST', credentials: 'same-origin',
        headers: {'Content-Type': 'application/json; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest'},
        body: JSON.stringify(body)});
      const t = await r.text(); try { let j = JSON.parse(t); if (typeof j === 'string') j = JSON.parse(j); return j; } catch (e) { return t; }
    };
    (async () => {
      const inp = document.querySelector('input#idServizio');
      if (!inp || !inp.value) return done({ok: false, motivo: 'idServizio nao encontrado'});
      const sid = inp.value; const tried = [];
      for (let m = 0; m < months; m++) {
        const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + m); d.setDate(28);
        let days = await post('/BookingCalendar/RetrieveCalendarAvailability', {_Servizio: sid, selectedDay: d.toISOString()});
        if (!Array.isArray(days)) days = [];
        days = days.filter(x => x.SlotRimanenti > 0).map(x => ({...x, iso: x.DateLibere.split(' ')[0].split('/').reverse().join('-')}))
                   .filter(x => (!minD || x.iso >= minD) && (!maxD || x.iso <= maxD))
                   .sort((a, b) => a.iso.localeCompare(b.iso));
        if (prefDays.length) days = [...days.filter(x => prefDays.includes(dow(x.iso))), ...days.filter(x => !prefDays.includes(dow(x.iso)))];
        for (const day of days) {
          let slots = await post('/BookingCalendar/RetrieveTimeSlots', {selectedDay: day.iso, idService: sid});
          if (!Array.isArray(slots)) slots = [];
          slots = slots.filter(x => x.SlotRimanenti > 0);
          slots = [...slots.filter(okPeriod), ...slots.filter(x => !okPeriod(x))];
          for (const s of slots) {
            const p = n => String(n).padStart(2, '0');
            const hr = `${p(s.OrarioInizioFascia.Hours)}:${p(s.OrarioInizioFascia.Minutes)} - ${p(s.OrarioFineFascia.Hours)}:${p(s.OrarioFineFascia.Minutes)}\n(${s.SlotLiberi})`;
            tried.push(day.iso + ' ' + hr.split('\n')[0]);
            const res = await post('/BookingCalendar/InsertNewBooking', {idCalendarioGiornaliero: s.IDCalendarioServizioGiornaliero, selectedDay: day.iso, selectedHour: hr});
            if (res && res.url && res.url.includes('/ReservationDetail/')) return done({ok: true, url: res.url, dia: day.iso, hora: hr.split('\n')[0]});
          }
        }
      }
      done({ok: false, motivo: 'nenhum horario livre na faixa', tentados: tried});
    })().catch(e => done({ok: false, motivo: String(e)}));
    """

    def handle_calendar(self) -> bool:
        d = self.driver
        try:
            WebDriverWait(d, 60).until(lambda _: "/bookingcalendar" in self.url() or "/reservation" in self.url())
        except TimeoutException:
            return False
        if "/reservation" in self.url():
            return True
        self.alert("Calendario aberto! Procurando data/horario...")
        if not self.cfg.get("auto_agendar", True):
            self.ui.ask("Escolha a data e o horario no Chrome e confirme. Depois clique OK / ENTER.")
            return "/reservation" in self.url()
        mn = parse_date(self.cfg.get("data_minima"))
        mx = parse_date(self.cfg.get("data_maxima"))
        d.set_script_timeout(180)
        WebDriverWait(d, 30).until(lambda _: d.execute_script(
            "const i=document.querySelector('input#idServizio');return i&&i.value"))
        res = d.execute_async_script(self.JS_AUTO_SCHEDULE, int(self.cfg.get("meses_a_procurar", 4)),
                                     mn.isoformat() if mn else "", mx.isoformat() if mx else "",
                                     str(self.cfg.get("preferencia_periodo") or "qualquer"),
                                     [int(x) for x in (self.cfg.get("dias_preferidos") or [])])
        if res and res.get("ok"):
            log.info(f"Agendado para {res['dia']} {res['hora']}")
            d.get(SITE + res["url"] if res["url"].startswith("/") else res["url"])
            return True
        log.warning(f"Agendamento automatico nao concluiu: {res and res.get('motivo')}")
        self.alert("Escolha a data manualmente no calendario.")
        self.ui.ask("Escolha a data e o horario no Chrome e confirme. Depois clique OK / ENTER.")
        return "/reservation" in self.url()

    def save_proof(self) -> Path | None:
        if not self.cfg.get("salvar_comprovante", True):
            return None
        PROOF_DIR.mkdir(exist_ok=True)
        self.sleep(4)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        try:
            import base64
            pdf = self.driver.print_page()
            path = PROOF_DIR / f"comprovante_{stamp}.pdf"
            path.write_bytes(base64.b64decode(pdf))
        except Exception:
            path = PROOF_DIR / f"comprovante_{stamp}.png"
            self.driver.save_screenshot(str(path))
        (PROOF_DIR / f"comprovante_{stamp}.html").write_text(self.driver.page_source, encoding="utf-8")
        log.info(f"Comprovante salvo em {path}")
        return path

    # ---------- fluxo principal ----------
    def run(self, only_discover: bool = False) -> int:
        cfg = self.cfg
        try:
            self.ui.status("Abrindo o Chrome...")
            self.start_browser()
            if not self.login():
                log.error("Nao foi possivel entrar na conta.")
                return 1
            if not only_discover:
                self.to_background()
                if self.cfg.get("segundo_plano", True):
                    log.info("Rodando em segundo plano: o Chrome fica minimizado e aparece sozinho quando precisar.")
            if only_discover or not cfg["servicos"]:
                self.discover_services()
                if not cfg["servicos"]:
                    log.warning("Nenhum servico configurado. Escolha um ID da lista acima e coloque em 'servicos'.")
                return 0

            attempt, unknown_streak = 0, 0
            max_t = int(cfg.get("max_tentativas") or 0)
            while not self.stop.is_set() and (max_t == 0 or attempt < max_t):
                ok, wait = in_time_window(cfg)
                if not ok:
                    log.info(f"Fora da janela de horario. Proxima verificacao em {wait / 60:.0f} min.")
                    self.ui.status(f"Aguardando janela de horario ({wait / 60:.0f} min)")
                    if not self.sleep(min(wait, 900)):
                        break
                    continue

                for sid in cfg["servicos"]:
                    if self.stop.is_set():
                        break
                    attempt += 1
                    self.current_service = sid
                    try:
                        self.driver.get(BOOKING_URL.format(id=sid))
                        st = self.check_availability()
                    except WebDriverException as e:
                        st = "desconhecido"
                        log.warning(f"Erro de navegacao: {getattr(e, 'msg', e)}")
                    log.info(f"Tentativa {attempt} | servico {sid}: {st}")
                    record_history(sid, st)
                    self.ui.status(f"Tentativa {attempt} | servico {sid}: {st}")

                    if st in ("disponivel", "calendario"):
                        self.alert(f"VAGA ENCONTRADA no servico {sid}!")
                        self.save_page(f"formulario_{sid}")
                        if cfg.get("somente_alertar"):
                            self.ui.ask("Vaga aberta! Conclua o agendamento no Chrome. Clique OK / ENTER quando terminar.")
                            return 0
                        if st == "disponivel" and cfg.get("preencher_formulario", True):
                            self.fill_form()
                        if self.handle_calendar():
                            proof = self.save_proof()
                            self.alert(f"AGENDAMENTO CONCLUIDO! Comprovante: {proof.name if proof else 'veja o site'}")
                        else:
                            self.ui.ask("Conclua o agendamento no Chrome. Clique OK / ENTER quando terminar.")
                        return 0
                    if st == "captcha":
                        self.handle_captcha()
                    elif st == "bloqueado":
                        self.handle_blocked()
                        self.login()
                    elif st == "deslogado":
                        log.info("Sessao expirada - entrando de novo.")
                        if not self.login():
                            return 1
                    unknown_streak = unknown_streak + 1 if st == "desconhecido" else 0

                if max_t and attempt >= max_t:
                    break
                wait = random.uniform(cfg["intervalo_min_segundos"], cfg["intervalo_max_segundos"])
                if unknown_streak >= 3:
                    wait *= 2
                    self.save_page("pagina_desconhecida")
                log.info(f"Proxima verificacao em {wait:.0f}s.")
                if not self.sleep(wait):
                    break
            log.info("Monitoramento encerrado.")
            return 0
        except KeyboardInterrupt:
            log.info("Interrompido (Ctrl+C).")
            return 130
        except WebDriverException as e:
            log.error(f"O Chrome foi fechado ou falhou: {getattr(e, 'msg', e)}")
            return 1
        finally:
            self.ui.finished()


def preflight(cfg: dict, env: dict) -> list[str]:
    problems = []
    for doc in cfg.get("documentos") or []:
        if not (FILES_DIR / doc).is_file():
            problems.append(f"Documento faltando: files/{doc}")
    if not (env.get("PRENOTAMI_EMAIL") and env.get("PRENOTAMI_SENHA")):
        problems.append("E-mail/senha do Prenot@mi nao configurados (sera preciso logar manualmente).")
    if not cfg.get("servicos"):
        problems.append("Nenhum servico configurado - o bot vai listar os servicos da sua conta.")
    return problems
