import fs from "node:fs";
import path from "node:path";
import { BASE_DIR, BotConfig, EnvMap, SERVICE_PRESETS } from "./core.ts";
import { sanitizeWebmailUrl } from "./chromiumBridge.ts";

export function buildUserscript(cfg: BotConfig, env: Partial<EnvMap>): string {
  const sid = cfg.servicos[0] ?? 5402;
  const preset = SERVICE_PRESETS[sid];
  const webmailUrl = sanitizeWebmailUrl(cfg.chromium?.url_webmail);
  const payload = {
    servico: sid,
    servicoNome: preset?.nome ?? `Serviço ${sid}`,
    intervaloMin: cfg.intervalo_min_segundos,
    intervaloMax: cfg.intervalo_max_segundos,
    fusoHorario: cfg.fuso_horario || "America/Sao_Paulo",
    horarioAlvo: cfg.horario_alvo || "16:00",
    antecedenciaMinutos: Math.min(10, Math.max(1, cfg.antecedencia_minutos || 2)),
    diasSemana: cfg.dias_semana && cfg.dias_semana.length ? cfg.dias_semana : [1],
    manterPrimeiraAba: cfg.manter_primeira_aba !== false,
    abasAgendamento: Math.min(3, Math.max(1, cfg.abas_agendamento || 2)),
    autofillLogin: cfg.autofill_login !== false,
    email: env.PRENOTAMI_EMAIL ?? "",
    senha: env.PRENOTAMI_SENHA ?? "",
    clicarAvancar: false,
    autoAgendar: false,
    enviarOtp: Boolean(cfg.enviar_otp_automatico),
    autoOtpEmail: cfg.chromium?.auto_otp_email !== false,
    otpSender: "noreply-prenotami@esteri.it",
    webmailUrl,
    somenteAlertar: Boolean(cfg.somente_alertar),
    ntfyTopico: env.NTFY_TOPICO ?? "",
    radarWhatsapp: cfg.radar_whatsapp,
    dados: cfg.dados,
    acompanhantes: cfg.acompanhantes,
    respostasAprendidas: cfg.respostas_aprendidas,
  };

  return `// ==UserScript==
// @name         PrenotaBot Livre 2.0 (Chromium Dedicado, OTP Email & Radar WhatsApp)
// @namespace    https://github.com/zandonadimarcelo4-ctrl/PRENOTBOTFINAL
// @version      2.2.0
// @description  Autofill de login e formulario no Prenot@mi, captura automatica de OTP (<noreply-prenotami@esteri.it>), inicio programado (16h BRT / 15h Cuiaba-AM), monitor do Radar WhatsApp Web (+55 47 92004-1774) e confirmacao/data manuais.
// @match        https://prenotami.esteri.it/*
// @match        https://iam.esteri.it/*
// @match        https://web.whatsapp.com/*
// @match        https://mail.google.com/*
// @match        https://outlook.live.com/*
// @match        https://outlook.office.com/*
// @match        https://mail.yahoo.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      ntfy.sh
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = ${JSON.stringify(payload, null, 2)};

  const UNAVAILABLE = [
    'al momento non ci sono date disponibili',
    'non ci sono date disponibili',
    'all appointments for this service are currently booked',
    "stante l'elevata richiesta",
    'no hay citas disponibles',
    'nao ha datas disponiveis'
  ];

  const SELECT_CODES = {
    estado_civil: {
      casado: '13', divorciado: '14', viuvo: '15', solteiro: '16',
      separado: '17', 'em uniao civil': '18'
    },
    cor_olhos: { azul: '22', marrom: '23', castanho: '23', cinza: '24', preto: '25', verde: '26' },
    filhos_menores: { sim: '11', nao: '12' },
    passaporte_vencido: { sim: '1', nao: '2' }
  };

  const norm = (s) => String(s || '').normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/\\s+/g, ' ').trim();
  const digitsOnly = (s) => String(s || '').replace(/\\D+/g, '');

  function setCrossMode(mode) {
    try { localStorage.setItem('pb_mode', mode); } catch (_) {}
    try { if (typeof GM_setValue === 'function') GM_setValue('pb_mode', mode); } catch (_) {}
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ pb_mode: mode });
      }
    } catch (_) {}
  }

  function getCrossMode(cb) {
    let localVal = 'idle';
    try { localVal = localStorage.getItem('pb_mode') || 'idle'; } catch (_) {}
    if (location.hash && location.hash.includes('pb_radar=1')) {
      setCrossMode('active');
      cb('active');
      return;
    }
    try {
      if (typeof GM_getValue === 'function') {
        const gmVal = GM_getValue('pb_mode', localVal);
        if (gmVal === 'active' || localVal === 'active') {
          cb('active');
          return;
        }
        cb(localVal || gmVal || 'idle');
        return;
      }
    } catch (_) {}
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['pb_mode', 'pb_radar_triggered_at'], (res) => {
          const freshRadar = res && res.pb_radar_triggered_at && (Date.now() - res.pb_radar_triggered_at < 300000);
          if ((res && res.pb_mode === 'active') || freshRadar) cb('active');
          else cb(localVal);
        });
        return;
      }
    } catch (_) {}
    cb(localVal);
  }

  function sanitizeBookingUrl(rawUrl) {
    const fallback = 'https://prenotami.esteri.it/Services/Booking/' + CONFIG.servico;
    if (!rawUrl) return fallback;
    try {
      const u = new URL(String(rawUrl).trim());
      if (u.protocol === 'https:' && u.hostname.toLowerCase() === 'prenotami.esteri.it') {
        return u.toString();
      }
    } catch (_) {}
    return fallback;
  }

  function sendNtfy(msg) {
    if (!CONFIG.ntfyTopico) return;
    const url = CONFIG.ntfyTopico.startsWith('http') ? CONFIG.ntfyTopico : 'https://ntfy.sh/' + CONFIG.ntfyTopico;
    try {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'POST',
          url,
          data: msg,
          headers: { Title: 'PrenotaBot Livre', Priority: 'urgent', Tags: 'rotating_light' }
        });
      } else {
        fetch(url, { method: 'POST', body: msg, headers: { Title: 'PrenotaBot Livre', Priority: 'urgent' } }).catch(() => {});
      }
    } catch (_) {}
  }

  function reportRadarToPanel(sender, message, bookingUrl) {
    const payloadStr = JSON.stringify({ sender, message, bookingUrl });
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'REPORT_RADAR_TRIGGER', payload: { sender, message, bookingUrl } });
      } else if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'POST',
          url: 'http://localhost:3000/api/radar/whatsapp-trigger',
          headers: { 'Content-Type': 'application/json' },
          data: payloadStr
        });
      }
    } catch (_) {}
  }

  function saveCapturedOtp(code, subject, from) {
    if (!/^\\d{4,8}$/.test(String(code || ''))) return;
    const rec = { code: String(code), from: from || CONFIG.otpSender, subject: subject || 'OTP Prenot@mi', at: Date.now() };
    try { localStorage.setItem('pb_last_otp', JSON.stringify(rec)); } catch (_) {}
    try { if (typeof GM_setValue === 'function') GM_setValue('pb_last_otp', rec); } catch (_) {}
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'REPORT_OTP_CODE', payload: rec });
      } else if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'POST',
          url: 'http://localhost:3000/api/otp/report',
          headers: { 'Content-Type': 'application/json' },
          data: JSON.stringify(rec)
        });
      }
    } catch (_) {}
  }

  function fetchLatestOtp(cb) {
    const useCachedIfFresh = (fallback) => {
      try {
        const raw = localStorage.getItem('pb_last_otp');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.code && Date.now() - (parsed.at || 0) < 15 * 60000) {
            cb(parsed.code, 'cache');
            return;
          }
        }
      } catch (_) {}
      if (fallback) fallback();
    };

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'FETCH_OTP_FROM_PANEL' }, (res) => {
          if (res && res.code) {
            cb(res.code, res.source || 'servidor');
          } else {
            useCachedIfFresh(() => cb(null, 'none'));
          }
        });
        return;
      }
    } catch (_) {}

    try {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET',
          url: 'http://localhost:3000/api/otp/latest?refresh=1',
          onload: (r) => {
            try {
              const d = JSON.parse(r.responseText || '{}');
              if (d && d.otp && d.otp.code) {
                cb(d.otp.code, d.otp.source || 'imap');
                return;
              }
            } catch (_) {}
            useCachedIfFresh(() => cb(null, 'none'));
          },
          onerror: () => useCachedIfFresh(() => cb(null, 'none'))
        });
        return;
      }
    } catch (_) {}

    useCachedIfFresh(() => cb(null, 'none'));
  }

  function extractOtpFromText(txt) {
    const clean = String(txt || '').replace(/\\s+/g, ' ').trim();
    const m = clean.match(/(?:codigo\\s*otp|codice\\s*otp|otp|codice\\s*(?:di\\s*)?verifica|verification\\s*code|pin|codice)[^\\d]{0,45}(\\b\\d{4,8}\\b)/i);
    if (m && m[1]) return m[1];
    const cands = clean.match(/\\b\\d{5,8}\\b/g) || [];
    for (const c of cands) {
      if (c === '05402' || c === '05256') continue;
      if (c.length === 4 && Number(c) >= 1990 && Number(c) <= 2040) continue;
      return c;
    }
    return null;
  }

  function beepAlarm() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < 4; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 1200;
        gain.gain.value = 0.25;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.45);
        osc.stop(ctx.currentTime + i * 0.45 + 0.3);
      }
    } catch (_) {}
  }

  function setSelect(el, wanted, key) {
    if (!el || !wanted) return;
    const target = norm(wanted);
    const opts = [...el.options];
    let match = opts.find((o) => norm(o.text) === target || norm(o.value) === target);
    if (!match && target.length >= 3) {
      match = opts.find((o) => norm(o.text).includes(target) || target.includes(norm(o.text)));
    }
    if (!match && key && SELECT_CODES[key]) {
      const clean = target.replace(/\\/a/g, '').replace(/\\/solteira/g, '').trim();
      const code = SELECT_CODES[key][clean];
      if (code) match = opts.find((o) => o.value === code);
    }
    if (match) {
      el.value = match.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function setInput(el, value) {
    if (!el || !value) return;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Autofill apenas nas credenciais de login — usuario faz o login manualmente
  function autofillLoginOnly() {
    if (!CONFIG.autofillLogin) return;
    const emailEl = document.querySelector('#login-email, input[autocomplete="username"], input[type="email"]');
    const passEl = document.querySelector('#login-password, input[type="password"]');
    if (emailEl && CONFIG.email && !emailEl.value) {
      setInput(emailEl, CONFIG.email);
    }
    if (passEl && CONFIG.senha && !passEl.value) {
      setInput(passEl, CONFIG.senha);
    }
  }

  function findVisibleOtpInput() {
    const candidates = Array.from(document.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type])'));
    return candidates.find((el) => {
      if (el.offsetParent === null) return false;
      const meta = norm((el.id || '') + ' ' + (el.name || '') + ' ' + (el.placeholder || '') + ' ' + (el.getAttribute('aria-label') || ''));
      if (meta.includes('otp') || meta.includes('codice') || meta.includes('pin') || meta.includes('verification')) {
        return true;
      }
      const grp = el.closest('.modal, .form-group, div');
      const grpText = grp ? norm(grp.innerText || '') : '';
      return grpText.includes('codice otp') || grpText.includes('codigo otp') || grpText.includes('inserisci otp');
    }) || null;
  }

  function tryFillOtpOnPage() {
    if (!CONFIG.autoOtpEmail) return false;
    const otpInput = findVisibleOtpInput();
    if (!otpInput) return false;
    if (String(otpInput.value || '').trim().length >= 4) return true;

    fetchLatestOtp((code, src) => {
      if (!code) return;
      setInput(otpInput, code);
      otpInput.style.outline = '3px solid #009246';
      const st = document.getElementById('pb-otp-status');
      if (st) st.textContent = 'OTP preenchido (' + code + ' via ' + src + ')';
    });
    return true;
  }

  // Preenche o formulario e PARA antes do botao Confirmar/Avanti (usuario confirma e escolhe a data manualmente)
  function fillBookingForm() {
    let filledCount = 0;
    const tipo = document.getElementById('typeofbookingddl');
    if (tipo) {
      tipo.value = CONFIG.acompanhantes && CONFIG.acompanhantes.length ? '2' : '1';
      tipo.dispatchEvent(new Event('change', { bubbles: true }));
      filledCount++;
    }

    const d = CONFIG.dados || {};
    const rules = [
      ['quantidade_filhos', ['numero figli', 'quanti figli', 'quantidade de filhos', 'number of children']],
      ['filhos_menores', ['figli minor', 'filhos menores', 'minor children']],
      ['data_vencimento_passaporte', ['data di scadenza', 'data de vencimento', 'expiry date']],
      ['passaporte_vencido', ['passaporto scaduto', 'passaporte vencido', 'expired passport']],
      ['estado_civil', ['stato civile', 'estado civil', 'marital status']],
      ['cor_olhos', ['colore occhi', 'colore degli occhi', 'cor dos olhos', 'eye color']],
      ['altura_cm', ['altezza', 'altura', 'height']],
      ['endereco', ['indirizzo', 'endereco', 'address', 'residenza']]
    ];

    document.querySelectorAll('form select, form input, form textarea').forEach((el) => {
      const t = (el.type || el.tagName).toLowerCase();
      if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'file'].includes(t)) return;
      let label = '';
      if (el.id) {
        const l = document.querySelector('label[for="' + el.id + '"]');
        if (l) label = l.innerText;
      }
      if (!label) {
        const grp = el.closest('.form-group, .row, div');
        const l = grp && grp.querySelector('label');
        if (l) label = l.innerText;
      }
      const lab = norm(label || el.placeholder || '');
      let key = null;
      for (const [k, words] of rules) {
        if (words.some((w) => lab.includes(w))) { key = k; break; }
      }
      const val = key ? d[key] : (CONFIG.respostasAprendidas || {})[lab];
      if (!val) return;
      if (el.tagName.toLowerCase() === 'select') setSelect(el, val, key);
      else setInput(el, val);
      filledCount++;
    });

    // Campos conhecidos SP 5402 / 5256
    setInput(document.querySelector('[id="DatiAddizionaliPrenotante[0]._testo"], [name="DatiAddizionaliPrenotante[0]._testo"]'), d.endereco);
    setSelect(document.getElementById('ddls_1'), d.estado_civil, 'estado_civil');
    setInput(document.querySelector('[id="DatiAddizionaliPrenotante[2]._testo"], [name="DatiAddizionaliPrenotante[2]._testo"]'), d.altura_cm);
    setSelect(document.getElementById('ddls_3'), d.cor_olhos, 'cor_olhos');
    setInput(document.getElementById('BookingNotes'), d.observacoes);

    // Preenchimento basico de acompanhantes se campos visiveis existirem
    if (Array.isArray(CONFIG.acompanhantes) && CONFIG.acompanhantes.length > 0) {
      CONFIG.acompanhantes.forEach((ac, idx) => {
        const nEl = document.querySelector('[name*="[' + idx + ']"][name*="Nome"], [id*="Nome_' + idx + '"]');
        const sEl = document.querySelector('[name*="[' + idx + ']"][name*="Cognome"], [id*="Cognome_' + idx + '"]');
        const dEl = document.querySelector('[name*="[' + idx + ']"][name*="Nasc"], [id*="DataNascita_' + idx + '"]');
        if (nEl) { setInput(nEl, ac.nome); filledCount++; }
        if (sEl) { setInput(sEl, ac.sobrenome); filledCount++; }
        if (dEl) { setInput(dEl, ac.nascimento); filledCount++; }
      });
    }

    const priv = document.getElementById('PrivacyCheck');
    if (priv && !priv.checked) { priv.click(); filledCount++; }

    tryFillOtpOnPage();

    // Destaca em ambar campos ainda vazios visiveis para conferencia rapida
    let missingCount = 0;
    document.querySelectorAll('form input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]), form select').forEach((el) => {
      if (el.offsetParent !== null && !String(el.value || '').trim()) {
        el.style.outline = '2px dashed #f59e0b';
        missingCount++;
      }
    });

    const fillBtn = document.getElementById('pb-fill');
    if (fillBtn) {
      fillBtn.textContent = 'Preenchidos: ' + filledCount + ' | Pendentes: ' + missingCount;
    }

    // Destaca o botao Confirmar/Avanti sem clicar (confirmacao manual do usuario)
    const avanti = document.getElementById('btnAvanti');
    if (avanti) {
      avanti.style.outline = '4px solid #009246';
      avanti.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function openBookingTabs(customUrl, fromRadar) {
    const baseUrl = sanitizeBookingUrl(customUrl);
    const targetUrl = fromRadar && !baseUrl.includes('#pb_radar=1') ? baseUrl + '#pb_radar=1' : baseUrl;
    const count = Math.min(3, Math.max(1, CONFIG.abasAgendamento || 1));
    const urls = Array.from({ length: count }, () => targetUrl);

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'OPEN_BOOKING_TABS', urls, fromRadar: Boolean(fromRadar) });
      return;
    }

    for (let i = 0; i < urls.length; i++) {
      if (typeof GM_openInTab === 'function') {
        GM_openInTab(urls[i], { active: i === 0, insert: true });
      } else {
        window.open(urls[i], '_blank', 'noopener,noreferrer');
      }
    }
  }

  // ---------------- Captura Automatica de OTP no Webmail (<noreply-prenotami@esteri.it>) ----------------
  function mountWebmailOtpWatcher() {
    if (!CONFIG.autoOtpEmail) return;
    let lastCode = '';

    if (!document.getElementById('pb-otp-mail-badge')) {
      const badge = document.createElement('div');
      badge.id = 'pb-otp-mail-badge';
      Object.assign(badge.style, {
        position: 'fixed', bottom: '18px', right: '18px', zIndex: '999999',
        background: '#1f2a37', color: '#fff', padding: '10px 14px', borderRadius: '10px',
        fontFamily: 'sans-serif', fontSize: '12px', boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
        borderTop: '4px solid #009246', maxWidth: '300px'
      });
      badge.innerHTML =
        '<div style="font-weight:bold;margin-bottom:3px">Leitor OTP Prenot@mi</div>' +
        '<div id="pb-otp-mail-status" style="color:#cbd5e1">Aguardando email de noreply-prenotami@esteri.it...</div>';
      document.body.appendChild(badge);
    }

    const scanMailDom = () => {
      const candidates = [];
      // Linhas da caixa de entrada + corpo de email aberto (Gmail / Outlook / Yahoo)
      document.querySelectorAll('tr, [role="listitem"], [role="option"], [role="main"] [data-message-id], [role="region"], main').forEach((node) => {
        const t = node.innerText || '';
        const lower = t.toLowerCase();
        if (lower.includes('noreply-prenotami@esteri.it') || (lower.includes('prenotami') && (lower.includes('otp') || lower.includes('codice') || lower.includes('verifica')))) {
          candidates.push(t);
        }
      });
      for (const txt of candidates) {
        const code = extractOtpFromText(txt);
        if (code && code !== lastCode) {
          lastCode = code;
          saveCapturedOtp(code, txt.slice(0, 120), CONFIG.otpSender);
          const st = document.getElementById('pb-otp-mail-status');
          if (st) st.textContent = 'OTP capturado: ' + code + ' (sincronizado p/ Prenot@mi)';
          break;
        }
      }
    };

    setTimeout(scanMailDom, 1500);
    setInterval(scanMailDom, 2000);
  }

  // ---------------- Monitoramento WhatsApp Web PC (Radar +55 47 92004-1774) ----------------
  function mountWhatsappRadar() {
    const radar = CONFIG.radarWhatsapp || { ativo: true, numero_radar: '+55 47 92004-1774', nomes_radar: [], palavras_chave: [], abrir_automatico: true };
    if (!radar.ativo) return;

    const fullDigits = digitsOnly(radar.numero_radar || '5547920041774');
    const shortDigits = fullDigits.length >= 9 ? fullDigits.slice(-9) : fullDigits;
    const dddShortDigits = fullDigits.length >= 11 ? fullDigits.slice(-11) : fullDigits;
    const aliases = (radar.nomes_radar || []).map(norm).filter(Boolean);
    const keywords = (radar.palavras_chave || ['vaga', 'disponivel', 'abriu', 'agendamento', 'prenotami']).map(norm).filter(Boolean);

    const seen = new Set();
    let warmupUntil = Date.now() + 3000;
    let lastTriggerAt = 0;
    let paused = localStorage.getItem('pb_radar_paused') === '1';

    if (!document.getElementById('pb-radar-wa-badge')) {
      const badge = document.createElement('div');
      badge.id = 'pb-radar-wa-badge';
      Object.assign(badge.style, {
        position: 'fixed', bottom: '18px', right: '18px', zIndex: '999999',
        background: '#1f2a37', color: '#fff', padding: '10px 14px', borderRadius: '10px',
        fontFamily: 'sans-serif', fontSize: '12px', boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
        borderTop: '4px solid #009246', maxWidth: '290px'
      });
      badge.innerHTML =
        '<div style="font-weight:bold;margin-bottom:4px">Radar WA Prenot@mi</div>' +
        '<div id="pb-radar-status" style="color:#cbd5e1;margin-bottom:6px"></div>' +
        '<div style="display:flex;gap:6px">' +
        '<button id="pb-radar-toggle" style="flex:1;padding:6px;border:none;border-radius:6px;background:#334155;color:#fff;font-weight:bold;cursor:pointer"></button>' +
        '<button id="pb-radar-test" style="flex:1;padding:6px;border:none;border-radius:6px;background:#009246;color:#fff;font-weight:bold;cursor:pointer">Testar abrir</button>' +
        '</div>';
      document.body.appendChild(badge);

      const syncBadge = () => {
        const st = document.getElementById('pb-radar-status');
        const tg = document.getElementById('pb-radar-toggle');
        if (st) st.textContent = paused ? 'Pausado no WhatsApp Web' : 'Monitorando ' + (radar.numero_radar || '+55 47 92004-1774');
        if (tg) tg.textContent = paused ? 'Retomar' : 'Pausar';
      };
      syncBadge();

      document.getElementById('pb-radar-toggle').onclick = () => {
        paused = !paused;
        localStorage.setItem('pb_radar_paused', paused ? '1' : '0');
        syncBadge();
      };
      document.getElementById('pb-radar-test').onclick = () => {
        setCrossMode('active');
        beepAlarm();
        reportRadarToPanel(radar.numero_radar || '+55 47 92004-1774', 'Teste manual no WhatsApp Web', sanitizeBookingUrl(''));
        openBookingTabs('', true);
      };
    }

    function matchesSender(text) {
      const d = digitsOnly(text);
      if (d && (d.includes(fullDigits) || (dddShortDigits.length >= 10 && d.includes(dddShortDigits)) || (shortDigits.length >= 8 && d.includes(shortDigits)))) {
        return true;
      }
      const n = norm(text);
      return aliases.some((a) => a && n.includes(a));
    }

    function extractPrenotamiLink(el, rawText) {
      if (el) {
        const links = el.querySelectorAll('a[href*="prenotami.esteri.it"]');
        if (links.length > 0) return sanitizeBookingUrl(links[0].href);
      }
      const m = String(rawText || '').match(/https:\\/\\/prenotami\\.esteri\\.it[^\\s<>"]*/i);
      return m ? sanitizeBookingUrl(m[0]) : sanitizeBookingUrl('');
    }

    function handleMatch(senderLabel, msgText, linkEl) {
      const fingerprint = norm(senderLabel) + '|' + norm(msgText).slice(0, 140);
      if (seen.has(fingerprint)) return;
      seen.add(fingerprint);
      if (seen.size > 300) {
        const first = seen.values().next().value;
        seen.delete(first);
      }
      if (Date.now() < warmupUntil || paused) return;

      const msgNorm = norm(msgText);
      const hasKeyword = keywords.some((k) => msgNorm.includes(k)) || msgNorm.includes('prenotami.esteri.it');
      if (!hasKeyword) return;

      const now = Date.now();
      if (now - lastTriggerAt < 45000) return;
      lastTriggerAt = now;

      const bookingUrl = extractPrenotamiLink(linkEl, msgText);
      const stEl = document.getElementById('pb-radar-status');
      if (stEl) stEl.textContent = 'VAGA DETECTADA! Abrindo ' + bookingUrl;

      setCrossMode('active');
      beepAlarm();
      sendNtfy('RADAR WHATSAPP (' + senderLabel + '): ' + msgText.slice(0, 140));
      reportRadarToPanel(senderLabel, msgText.slice(0, 260), bookingUrl);
      if (radar.abrir_automatico !== false) {
        openBookingTabs(bookingUrl, true);
      }
    }

    function scanWhatsapp() {
      document.querySelectorAll('#pane-side [role="listitem"], #pane-side [role="row"]').forEach((row) => {
        const raw = row.innerText || '';
        if (!raw || !matchesSender(raw)) return;
        handleMatch(radar.numero_radar || 'Radar WhatsApp', raw, row);
      });

      const mainEl = document.getElementById('main');
      if (mainEl) {
        const headerEl = mainEl.querySelector('header');
        const headerText = headerEl ? (headerEl.innerText || '') : '';
        const headerMatches = matchesSender(headerText);
        const msgs = mainEl.querySelectorAll('.message-in, [data-pre-plain-text]');
        const slice = Array.from(msgs).slice(-8);
        slice.forEach((msgNode) => {
          const pre = msgNode.getAttribute('data-pre-plain-text') || '';
          const txt = msgNode.innerText || '';
          if (headerMatches || matchesSender(pre) || matchesSender(txt)) {
            handleMatch(headerText.split('\\n')[0] || radar.numero_radar || 'Radar WhatsApp', txt, msgNode);
          }
        });
      }
    }

    setTimeout(scanWhatsapp, 1200);
    setInterval(scanWhatsapp, 1500);
    const appRoot = document.getElementById('app') || document.body;
    const obs = new MutationObserver(() => { scanWhatsapp(); });
    obs.observe(appRoot, { childList: true, subtree: true });
  }

  function getZonedParts(date, timeZone) {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short'
    });
    const map = {};
    fmt.formatToParts(date).forEach((p) => { map[p.type] = p.value; });
    const wmap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    return {
      year: Number(map.year), month: Number(map.month), day: Number(map.day),
      hour: Number(map.hour) % 24, minute: Number(map.minute), second: Number(map.second),
      weekday: wmap[map.weekday] || 1
    };
  }

  function zonedWallClockToUtc(y, m, d, hh, mm, ss, tz) {
    const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
    const p = getZonedParts(new Date(guess), tz);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return new Date(guess - (seen - guess));
  }

  function msUntilScheduledStart() {
    const tz = CONFIG.fusoHorario || 'America/Sao_Paulo';
    const parts = String(CONFIG.horarioAlvo || '16:00').split(':');
    const h = Number(parts[0]) || 16;
    const m = Number(parts[1]) || 0;
    const lead = Math.min(10, Math.max(1, Number(CONFIG.antecedenciaMinutos) || 2));
    const dias = Array.isArray(CONFIG.diasSemana) && CONFIG.diasSemana.length ? CONFIG.diasSemana : [1];
    const now = new Date();
    const nowParts = getZonedParts(now, tz);

    for (let add = 0; add < 8; add++) {
      const refUtc = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day + add, 12, 0, 0));
      const dp = getZonedParts(refUtc, tz);
      if (!dias.includes(dp.weekday)) continue;
      const targetUtc = zonedWallClockToUtc(dp.year, dp.month, dp.day, h, m, 0, tz);
      const start = new Date(targetUtc.getTime() - lead * 60000);
      const windowEnd = new Date(targetUtc.getTime() + 90 * 60000);
      if (now.getTime() >= start.getTime() && now.getTime() <= windowEnd.getTime()) {
        return { diffMs: 0, start };
      }
      if (start.getTime() > now.getTime()) {
        return { diffMs: start.getTime() - now.getTime(), start };
      }
    }
    return { diffMs: 0, start: now };
  }

  function mountPanel() {
    if (document.getElementById('pb-livre-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'pb-livre-btn';
    btn.textContent = 'PB';
    Object.assign(btn.style, {
      position: 'fixed', bottom: '18px', right: '18px', zIndex: '999999',
      width: '52px', height: '52px', borderRadius: '50%', border: '3px solid #fff',
      background: '#009246', color: '#fff', fontWeight: 'bold', fontSize: '16px',
      boxShadow: '0 4px 14px rgba(0,0,0,0.35)', cursor: 'pointer'
    });

    const box = document.createElement('div');
    box.style.display = 'none';
    Object.assign(box.style, {
      position: 'fixed', bottom: '80px', right: '18px', zIndex: '999999',
      width: '320px', background: '#1f2a37', color: '#fff', padding: '14px',
      borderRadius: '10px', fontFamily: 'sans-serif', fontSize: '13px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.45)', borderTop: '4px solid #009246'
    });

    const mode = localStorage.getItem('pb_mode') || 'idle';
    const sched = msUntilScheduledStart();
    const brt = getZonedParts(sched.start, 'America/Sao_Paulo');
    const amt = getZonedParts(sched.start, 'America/Cuiaba');
    const pad2 = (n) => String(n).padStart(2, '0');
    const brtStr = pad2(brt.hour) + ':' + pad2(brt.minute);
    const amtStr = pad2(amt.hour) + ':' + pad2(amt.minute);

    box.innerHTML =
      '<div style="font-weight:bold;font-size:15px;margin-bottom:4px">PrenotaBot • Chromium Dedicado</div>' +
      '<div style="color:#cbd5e1;margin-bottom:8px">Serviço ' + CONFIG.servico + ' • ' + CONFIG.abasAgendamento + ' aba(s) • 1a aba preservada</div>' +
      '<div id="pb-countdown" style="color:#fbbf24;font-size:12px;margin-bottom:8px"></div>' +
      '<button id="pb-sched" style="width:100%;padding:9px;border:none;border-radius:6px;background:' + (mode === 'scheduled' ? '#CE2B37' : '#009246') + ';color:#fff;font-weight:bold;cursor:pointer;margin-bottom:6px">' +
      (mode === 'scheduled' ? 'PARAR AGENDADO (' + brtStr + ' BRT / ' + amtStr + ' AMT)' : 'INICIAR ' + brtStr + ' BRT / ' + amtStr + ' Cuiabá-AM') + '</button>' +
      '<button id="pb-test" style="width:100%;padding:9px;border:none;border-radius:6px;background:#2563eb;color:#fff;font-weight:bold;cursor:pointer;margin-bottom:6px">Iniciar agora (teste)</button>' +
      '<button id="pb-fill" style="width:100%;padding:8px;border:none;border-radius:6px;background:#334155;color:#fff;cursor:pointer;margin-bottom:6px">Preencher formulário (confirmar manual)</button>' +
      '<button id="pb-otp-btn" style="width:100%;padding:8px;border:none;border-radius:6px;background:#0f766e;color:#fff;font-weight:bold;cursor:pointer;margin-bottom:4px">Buscar e preencher OTP do email</button>' +
      '<div id="pb-otp-status" style="color:#94a3b8;font-size:11px">Fonte: noreply-prenotami@esteri.it</div>';

    btn.onclick = () => { box.style.display = box.style.display === 'none' ? 'block' : 'none'; };
    document.body.appendChild(btn);
    document.body.appendChild(box);

    document.getElementById('pb-sched').onclick = () => {
      const next = (localStorage.getItem('pb_mode') || 'idle') === 'scheduled' ? 'idle' : 'scheduled';
      setCrossMode(next);
      location.reload();
    };

    document.getElementById('pb-test').onclick = () => {
      setCrossMode('active');
      openBookingTabs('', false);
    };

    document.getElementById('pb-fill').onclick = fillBookingForm;

    document.getElementById('pb-otp-btn').onclick = () => {
      const st = document.getElementById('pb-otp-status');
      if (st) st.textContent = 'Buscando OTP de noreply-prenotami@esteri.it...';
      fetchLatestOtp((code, src) => {
        if (!code) {
          if (st) st.textContent = 'Nenhum OTP recente encontrado ainda.';
          return;
        }
        const otpInput = findVisibleOtpInput();
        if (otpInput) {
          setInput(otpInput, code);
          otpInput.style.outline = '3px solid #009246';
          if (st) st.textContent = 'OTP ' + code + ' preenchido (' + src + ')!';
        } else {
          try { navigator.clipboard.writeText(code); } catch (_) {}
          if (st) st.textContent = 'OTP ' + code + ' copiado (' + src + ').';
        }
      });
    };

    if (mode === 'scheduled') {
      const cd = document.getElementById('pb-countdown');
      const tick = setInterval(() => {
        const { diffMs } = msUntilScheduledStart();
        if (diffMs <= 0) {
          clearInterval(tick);
          setCrossMode('active');
          openBookingTabs('', false);
        } else {
          const s = Math.ceil(diffMs / 1000);
          const hLeft = Math.floor(s / 3600);
          const mLeft = Math.floor((s % 3600) / 60);
          const sLeft = s % 60;
          if (cd) cd.textContent = 'Aguardando ' + brtStr + ' BRT / ' + amtStr + ' AMT (' + (hLeft ? hLeft + 'h ' : '') + mLeft + 'm ' + sLeft + 's)...';
        }
      }, 1000);
    }
  }

  window.addEventListener('load', () => {
    const host = location.hostname.toLowerCase();
    if (host === 'web.whatsapp.com') {
      mountWhatsappRadar();
      return;
    }

    if (
      host === 'mail.google.com' ||
      host === 'outlook.live.com' ||
      host === 'outlook.office.com' ||
      host === 'mail.yahoo.com'
    ) {
      mountWebmailOtpWatcher();
      return;
    }

    mountPanel();
    const url = location.href.toLowerCase();
    const body = norm(document.body.innerText);

    // Captcha ou pagina de erro: pausa imediatamente e alerta usuario (sem burlar)
    if (url.includes('perfdrive') || url.includes('/error')) {
      setCrossMode('idle');
      beepAlarm();
      sendNtfy('Captcha ou erro no Prenot@mi! Resolva manualmente no navegador.');
      return;
    }

    // Login: apenas autofill, usuario entra manualmente
    if (url.includes('iam.esteri.it') || url.includes('signin') || document.getElementById('login-email')) {
      autofillLoginOnly();
      tryFillOtpOnPage();
      return;
    }

    // Calendario: usuario escolhe data e horario manualmente
    if (url.includes('/bookingcalendar')) {
      beepAlarm();
      sendNtfy('Calendário aberto! Escolha a data e o horário manualmente.');
      return;
    }

    // Monitora aparicao dinamica de modal/campo OTP na pagina
    if (CONFIG.autoOtpEmail) {
      let otpAttempts = 0;
      const otpInterval = setInterval(() => {
        otpAttempts++;
        const filled = tryFillOtpOnPage();
        if (filled || otpAttempts > 20) clearInterval(otpInterval);
      }, 2500);
    }

    // Formulario de vaga: autofill e deixa o botao Confirmar/Avanti manual
    if (document.getElementById('typeofbookingddl') || document.getElementById('PrivacyCheck')) {
      beepAlarm();
      sendNtfy('VAGA ENCONTRADA! Formulário preenchido — clique em Avanti manualmente.');
      if (!CONFIG.somenteAlertar) fillBookingForm();
      return;
    }

    // Apenas recarrega nas abas secundarias de booking (mantendo a 1a aba /UserArea ou /Services intacta)
    getCrossMode((activeMode) => {
      if (activeMode === 'active' && url.includes('/services/booking/')) {
        if (UNAVAILABLE.some((h) => body.includes(h))) {
          const wait = (CONFIG.intervaloMin + Math.random() * (CONFIG.intervaloMax - CONFIG.intervaloMin)) * 1000;
          setTimeout(() => {
            location.href = 'https://prenotami.esteri.it/Services/Booking/' + CONFIG.servico;
          }, wait);
        } else if (
          body.includes('502 bad gateway') ||
          body.includes('503 service') ||
          body.includes('504 gateway')
        ) {
          setTimeout(() => {
            location.href = 'https://prenotami.esteri.it/Services/Booking/' + CONFIG.servico;
          }, 20000);
        }
      }
    });
  });
})();
`;
}

function escHtmlAttr(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildExtensionBundleEntries(
  cfg: BotConfig,
  env: Partial<EnvMap>
): Array<{ name: string; content: string }> {
  const sid = cfg.servicos[0] ?? 5402;
  const webmailUrl = sanitizeWebmailUrl(cfg.chromium?.url_webmail);
  const dedicatedMode = cfg.chromium?.modo_dedicado !== false;

  const manifest: Record<string, unknown> = {
    manifest_version: 3,
    name: "PrenotaBot Livre — Chromium Dedicado Prenot@mi",
    version: "2.2.0",
    description:
      "Navegador dedicado ao Prenot@mi com autofill, captura automática de OTP (<noreply-prenotami@esteri.it>) e Radar WhatsApp Web (+55 47 92004-1774).",
    permissions: ["storage", "activeTab", "tabs"],
    host_permissions: [
      "https://prenotami.esteri.it/*",
      "https://iam.esteri.it/*",
      "https://web.whatsapp.com/*",
      "https://mail.google.com/*",
      "https://outlook.live.com/*",
      "https://outlook.office.com/*",
      "https://mail.yahoo.com/*",
      "https://ntfy.sh/*",
      "http://localhost:3000/*",
      "http://127.0.0.1:3000/*",
    ],
    background: {
      service_worker: "background.js",
    },
    action: {
      default_popup: "popup.html",
      default_title: "PrenotaBot Dedicado",
    },
    content_scripts: [
      {
        matches: [
          "https://prenotami.esteri.it/*",
          "https://iam.esteri.it/*",
          "https://web.whatsapp.com/*",
          "https://mail.google.com/*",
          "https://outlook.live.com/*",
          "https://outlook.office.com/*",
          "https://mail.yahoo.com/*",
        ],
        js: ["content.js"],
        run_at: "document_idle",
      },
    ],
  };

  if (dedicatedMode) {
    manifest.chrome_url_overrides = {
      newtab: "newtab.html",
    };
  }

  const backgroundJs = `function isSafePrenotamiUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    return u.protocol === 'https:' && u.hostname.toLowerCase() === 'prenotami.esteri.it';
  } catch (_) {
    return false;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'OPEN_BOOKING_TABS') {
    const urls = Array.isArray(msg.urls) ? msg.urls.filter(isSafePrenotamiUrl).slice(0, 3) : [];
    if (msg.fromRadar) {
      chrome.storage.local.set({ pb_mode: 'active', pb_radar_triggered_at: Date.now() });
    }
    urls.forEach((url, idx) => {
      chrome.tabs.create({ url, active: idx === 0 });
    });
    sendResponse({ ok: true, opened: urls.length });
    return true;
  }
  if (msg.type === 'REPORT_RADAR_TRIGGER' && msg.payload) {
    fetch('http://localhost:3000/api/radar/whatsapp-trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg.payload)
    }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'REPORT_OTP_CODE' && msg.payload && /^\\d{4,8}$/.test(String(msg.payload.code || ''))) {
    chrome.storage.local.set({ pb_last_otp: msg.payload });
    fetch('http://localhost:3000/api/otp/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg.payload)
    }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'FETCH_OTP_FROM_PANEL') {
    fetch('http://localhost:3000/api/otp/latest?refresh=1')
      .then((r) => r.json())
      .then((data) => {
        if (data && data.otp && data.otp.code) {
          const rec = { code: data.otp.code, from: data.otp.from, subject: data.otp.subject, at: Date.now(), source: data.otp.source || 'imap' };
          chrome.storage.local.set({ pb_last_otp: rec });
          sendResponse({ ok: true, code: rec.code, source: rec.source, otp: rec });
        } else {
          chrome.storage.local.get(['pb_last_otp'], (res) => {
            const cached = res && res.pb_last_otp;
            if (cached && cached.code && Date.now() - (cached.at || 0) < 15 * 60000) {
              sendResponse({ ok: true, code: cached.code, source: 'storage', otp: cached });
            } else {
              sendResponse({ ok: false, code: null });
            }
          });
        }
      })
      .catch(() => {
        chrome.storage.local.get(['pb_last_otp'], (res) => {
          const cached = res && res.pb_last_otp;
          if (cached && cached.code && Date.now() - (cached.at || 0) < 15 * 60000) {
            sendResponse({ ok: true, code: cached.code, source: 'storage', otp: cached });
          } else {
            sendResponse({ ok: false, code: null });
          }
        });
      });
    return true;
  }
});
`;

  const popupHtml = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PrenotaBot Dedicado</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; width: 328px; background: #f8fafc; color: #1f2a37; }
    .stripe { display: flex; height: 5px; }
    .stripe div { flex: 1; }
    header { background: #1f2a37; color: #fff; padding: 12px 14px; }
    header h1 { margin: 0; font-size: 16px; }
    header p { margin: 2px 0 0; font-size: 11px; color: #cbd5e1; }
    main { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
    label { font-size: 12px; font-weight: 600; display: block; margin-bottom: 3px; }
    input { width: 100%; box-sizing: border-box; padding: 7px 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; }
    button { padding: 9px 12px; border: none; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 13px; color: #fff; }
    .green { background: #009246; }
    .blue { background: #2563eb; }
    .emerald { background: #047857; }
    .teal { background: #0f766e; }
    .dark { background: #334155; }
    .otp-box { background: #ecfdf5; border: 1px solid #10b981; border-radius: 6px; padding: 8px 10px; font-size: 12px; display: flex; justify-content: space-between; align-items: center; }
    .note { font-size: 11px; color: #475569; line-height: 1.4; }
  </style>
</head>
<body>
  <div class="stripe">
    <div style="background:#009246"></div>
    <div style="background:#ffffff"></div>
    <div style="background:#CE2B37"></div>
  </div>
  <header>
    <h1>PrenotaBot • Chromium Dedicado</h1>
    <p>Login manual + Autofill + OTP Email + Radar WA</p>
  </header>
  <main>
    <div class="otp-box">
      <div>
        <div style="font-size:10px;color:#047857;font-weight:700">OTP &lt;noreply-prenotami@esteri.it&gt;</div>
        <div id="otpVal" style="font-family:monospace;font-size:15px;font-weight:800;color:#065f46">—</div>
      </div>
      <div style="display:flex;gap:4px">
        <button id="checkOtp" class="teal" style="padding:5px 8px;font-size:11px">Buscar</button>
        <button id="copyOtp" class="dark" style="padding:5px 8px;font-size:11px">Copiar</button>
      </div>
    </div>
    <div>
      <label for="sid">ID do Serviço (ex.: 5402)</label>
      <input id="sid" type="number" value="${sid}" />
    </div>
    <div>
      <label for="tabs">Abas adicionais de agendamento</label>
      <input id="tabs" type="number" min="1" max="3" value="${Math.min(3, Math.max(1, cfg.abas_agendamento || 2))}" />
    </div>
    <div>
      <label for="ntfy">Tópico ntfy (opcional)</label>
      <input id="ntfy" type="text" value="${escHtmlAttr(env.NTFY_TOPICO ?? "")}" />
    </div>
    <button id="save" class="dark">Salvar ajustes</button>
    <button id="openLogin" class="green">1. Abrir site (login manual + autofill)</button>
    <button id="openTabs" class="blue">2. Abrir abas do serviço (teste agora)</button>
    <button id="openWa" class="emerald">3. Abrir WhatsApp Web (Radar +55 47 92004-1774)</button>
    <button id="openMail" class="teal">4. Abrir Webmail OTP</button>
    <div style="display:flex;gap:6px;margin-top:2px">
      <button id="copyEnd" class="dark" style="flex:1;font-size:11px;padding:6px">Copiar Endereço</button>
      <button id="copyAlt" class="dark" style="flex:1;font-size:11px;padding:6px">Copiar Altura</button>
      <button id="copyMail" class="dark" style="flex:1;font-size:11px;padding:6px">Copiar E-mail</button>
    </div>
    <p class="note">Chromium configurado exclusivamente para o Prenot@mi: captura OTP de &lt;noreply-prenotami@esteri.it&gt; e dispara com o Radar WhatsApp.</p>
  </main>
  <script src="popup.js"></script>
</body>
</html>
`;

  const quickDataJson = JSON.stringify({
    endereco: cfg.dados.endereco || "",
    altura: cfg.dados.altura_cm || "",
    email: env.PRENOTAMI_EMAIL || "",
    webmailUrl,
    sid,
    fusoHorario: cfg.fuso_horario || "America/Sao_Paulo",
    horarioAlvo: cfg.horario_alvo || "16:00",
    antecedenciaMinutos: Math.min(10, Math.max(1, cfg.antecedencia_minutos || 2)),
  });

  const popupJs = `const QUICK_DATA = ${quickDataJson};
let latestOtpCode = '';

function refreshOtp(showWorking) {
  if (showWorking) document.getElementById('otpVal').textContent = 'Buscando...';
  chrome.runtime.sendMessage({ type: 'FETCH_OTP_FROM_PANEL' }, (res) => {
    if (res && res.code) {
      latestOtpCode = res.code;
      document.getElementById('otpVal').textContent = res.code;
    } else if (showWorking) {
      document.getElementById('otpVal').textContent = 'Sem OTP recente';
    }
  });
}

refreshOtp(false);

document.getElementById('checkOtp').addEventListener('click', () => refreshOtp(true));
document.getElementById('copyOtp').addEventListener('click', async () => {
  if (!latestOtpCode) return;
  try {
    await navigator.clipboard.writeText(latestOtpCode);
    document.getElementById('copyOtp').textContent = 'OK!';
    setTimeout(() => { document.getElementById('copyOtp').textContent = 'Copiar'; }, 1000);
  } catch (_) {}
});

document.getElementById('save').addEventListener('click', () => {
  const sid = Number(document.getElementById('sid').value) || 5402;
  const tabs = Math.min(3, Math.max(1, Number(document.getElementById('tabs').value) || 2));
  const ntfy = document.getElementById('ntfy').value.trim();
  chrome.storage.local.set({ pb_servico: sid, pb_tabs: tabs, pb_ntfy: ntfy }, () => {
    document.getElementById('save').textContent = 'Salvo!';
    setTimeout(() => { document.getElementById('save').textContent = 'Salvar ajustes'; }, 1200);
  });
});

document.getElementById('openLogin').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://prenotami.esteri.it/', active: true });
});

document.getElementById('openTabs').addEventListener('click', () => {
  const sid = Number(document.getElementById('sid').value) || 5402;
  const tabs = Math.min(3, Math.max(1, Number(document.getElementById('tabs').value) || 2));
  for (let i = 0; i < tabs; i++) {
    chrome.tabs.create({
      url: 'https://prenotami.esteri.it/Services/Booking/' + sid,
      active: i === 0
    });
  }
});

document.getElementById('openWa').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://web.whatsapp.com/', active: true });
});

document.getElementById('openMail').addEventListener('click', () => {
  chrome.tabs.create({ url: QUICK_DATA.webmailUrl, active: true });
});

function bindCopy(id, val, label) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', async () => {
    if (!val) { el.textContent = 'Vazio'; return; }
    try {
      await navigator.clipboard.writeText(val);
      el.textContent = 'Copiado!';
      setTimeout(() => { el.textContent = label; }, 1000);
    } catch (_) {}
  });
}
bindCopy('copyEnd', QUICK_DATA.endereco, 'Copiar Endereço');
bindCopy('copyAlt', QUICK_DATA.altura, 'Copiar Altura');
bindCopy('copyMail', QUICK_DATA.email, 'Copiar E-mail');
`;

  const newtabHtml = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Chromium Dedicado — Prenot@mi Command Center</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; min-height: 100vh; display: flex; flex-direction: column; }
    .stripe { display: flex; height: 6px; width: 100%; }
    .stripe div { flex: 1; }
    .wrap { max-width: 980px; width: 100%; margin: 0 auto; padding: 32px 20px; display: flex; flex-direction: column; gap: 20px; }
    .hero { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 16px; background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px 24px; }
    h1 { margin: 0; font-size: 22px; }
    .sub { color: #cbd5e1; font-size: 13px; margin-top: 4px; }
    .clocks { display: flex; gap: 18px; font-family: monospace; font-size: 14px; background: #0f172a; padding: 10px 14px; border-radius: 8px; border: 1px solid #334155; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
    a.card, button.card { text-decoration: none; text-align: left; background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 16px; color: #fff; cursor: pointer; transition: border-color .15s, transform .1s; display: block; }
    a.card:hover, button.card:hover { border-color: #10b981; transform: translateY(-1px); }
    .card .title { font-weight: 700; font-size: 15px; margin-bottom: 4px; }
    .card .desc { font-size: 12px; color: #94a3b8; }
    .panel { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 18px 20px; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 14px; }
    .btn { border: none; border-radius: 8px; padding: 10px 14px; font-weight: 700; cursor: pointer; font-size: 13px; color: #fff; background: #009246; }
    .btn-sec { background: #334155; }
  </style>
</head>
<body>
  <div class="stripe">
    <div style="background:#009246"></div>
    <div style="background:#ffffff"></div>
    <div style="background:#CE2B37"></div>
  </div>
  <div class="wrap">
    <div class="hero">
      <div>
        <h1>Navegador Chromium — Edição Dedicada Prenot@mi</h1>
        <div class="sub">Serviço ${sid} • Pré-início Segunda-feira (16:00 Brasília = 15:00 Cuiabá / Amazonas) • Confirmação e data manuais</div>
      </div>
      <div class="clocks">
        <div>Brasília: <strong id="clkBrt">--:--:--</strong></div>
        <div>Cuiabá/AM: <strong id="clkAmt">--:--:--</strong></div>
      </div>
    </div>

    <div class="grid">
      <a class="card" href="https://prenotami.esteri.it/">
        <div class="title" style="color:#34d399">1. Login Manual Prenot@mi</div>
        <div class="desc">Abre o portal oficial com autofill de credenciais mantendo a 1ª aba intacta.</div>
      </a>
      <a class="card" href="https://prenotami.esteri.it/Services/Booking/${sid}">
        <div class="title" style="color:#60a5fa">2. Agendamento Serviço ${sid}</div>
        <div class="desc">Aba dedicada ao serviço escolhido para preenchimento automático de formulário.</div>
      </a>
      <a class="card" href="https://web.whatsapp.com/">
        <div class="title" style="color:#2dd4bf">3. WhatsApp Web Radar</div>
        <div class="desc">Monitora ${escHtmlAttr(cfg.radar_whatsapp?.numero_radar || "+55 47 92004-1774")} em tempo real.</div>
      </a>
      <a class="card" href="${escHtmlAttr(webmailUrl)}">
        <div class="title" style="color:#fbbf24">4. Webmail OTP</div>
        <div class="desc">Captura automaticamente códigos de &lt;noreply-prenotami@esteri.it&gt;.</div>
      </a>
      <a class="card" href="http://localhost:3000/">
        <div class="title" style="color:#c084fc">5. Painel PrenotaBot & IA</div>
        <div class="desc">Orquestrador, histórico, PDFs (&lt;= 2 MB) e Agente Principal IA.</div>
      </a>
    </div>

    <div class="panel">
      <div>
        <div style="font-size:12px;color:#34d399;font-weight:700">LEITOR AUTOMÁTICO DE OTP (&lt;noreply-prenotami@esteri.it&gt;)</div>
        <div id="ntOtp" style="font-family:monospace;font-size:26px;font-weight:800;margin-top:4px">Aguardando...</div>
        <div id="ntOtpSrc" style="font-size:12px;color:#94a3b8;margin-top:2px">Via IMAP ou Webmail aberto no Chromium</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="ntFetchOtp" class="btn">Verificar E-mail OTP agora</button>
        <button id="ntCopyOtp" class="btn btn-sec">Copiar OTP</button>
        <button id="ntCopyMail" class="btn btn-sec">Copiar E-mail</button>
        <button id="ntCopyEnd" class="btn btn-sec">Copiar Endereço</button>
      </div>
    </div>
  </div>
  <script src="newtab.js"></script>
</body>
</html>
`;

  const newtabJs = `const DATA = ${quickDataJson};
let currentOtp = '';

function updateClocks() {
  const now = new Date();
  const fmt = (tz) => new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now);
  document.getElementById('clkBrt').textContent = fmt('America/Sao_Paulo');
  document.getElementById('clkAmt').textContent = fmt('America/Cuiaba');
}
updateClocks();
setInterval(updateClocks, 1000);

function checkOtp(activeFeedback) {
  if (activeFeedback) document.getElementById('ntOtp').textContent = 'Buscando...';
  chrome.runtime.sendMessage({ type: 'FETCH_OTP_FROM_PANEL' }, (res) => {
    if (res && res.code) {
      currentOtp = res.code;
      document.getElementById('ntOtp').textContent = res.code;
      document.getElementById('ntOtpSrc').textContent = 'Recebido via ' + (res.source || 'email');
    } else if (activeFeedback) {
      document.getElementById('ntOtp').textContent = 'Nenhum ainda';
    }
  });
}
checkOtp(false);
setInterval(() => checkOtp(false), 15000);

document.getElementById('ntFetchOtp').addEventListener('click', () => checkOtp(true));
document.getElementById('ntCopyOtp').addEventListener('click', async () => {
  if (!currentOtp) return;
  try { await navigator.clipboard.writeText(currentOtp); } catch (_) {}
});
document.getElementById('ntCopyMail').addEventListener('click', async () => {
  if (!DATA.email) return;
  try { await navigator.clipboard.writeText(DATA.email); } catch (_) {}
});
document.getElementById('ntCopyEnd').addEventListener('click', async () => {
  if (!DATA.endereco) return;
  try { await navigator.clipboard.writeText(DATA.endereco); } catch (_) {}
});
`;

  const contentJs = buildUserscript(cfg, env);

  return [
    { name: "manifest.json", content: JSON.stringify(manifest, null, 2) },
    { name: "background.js", content: backgroundJs },
    { name: "popup.html", content: popupHtml },
    { name: "popup.js", content: popupJs },
    { name: "newtab.html", content: newtabHtml },
    { name: "newtab.js", content: newtabJs },
    { name: "content.js", content: contentJs },
  ];
}

export function ensureAndroidExtensionFiles(
  cfg: BotConfig,
  env: Partial<EnvMap>
): string {
  const extDir = path.join(BASE_DIR, "extensao_android");
  fs.mkdirSync(extDir, { recursive: true });
  const entries = buildExtensionBundleEntries(cfg, env);
  for (const e of entries) {
    fs.writeFileSync(path.join(extDir, e.name), e.content, "utf-8");
  }
  return extDir;
}
