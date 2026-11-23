function isSafePrenotamiUrl(raw) {
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
  if (msg.type === 'REPORT_OTP_CODE' && msg.payload && /^\d{4,8}$/.test(String(msg.payload.code || ''))) {
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
  if (msg.type === 'START_ALL_INTEGRATED') {
    fetch('http://localhost:3000/api/automation/start-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forceImmediate: Boolean(msg.forceImmediate) })
    })
      .then((r) => r.json())
      .then((data) => {
        chrome.storage.local.set({ pb_mode: 'active' });
        sendResponse({ ok: true, data });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
      });
    return true;
  }
  if (msg.type === 'SYNC_LIVE_CONFIG') {
    fetch('http://localhost:3000/api/extension/live-config')
      .then((r) => r.json())
      .then((data) => {
        if (data && data.ok) {
          const patch = { pb_live_sync: data };
          if (data.runner && data.runner.running) {
            const waiting = String(data.runner.bigStatus || '').startsWith('Aguardando');
            patch.pb_mode = waiting ? 'scheduled' : 'active';
          }
          if (data.otp && data.otp.code) {
            patch.pb_last_otp = data.otp;
          }
          chrome.storage.local.set(patch);
        }
        sendResponse({ ok: true, data });
      })
      .catch(() => {
        chrome.storage.local.get(['pb_live_sync'], (res) => {
          sendResponse({ ok: false, data: res && res.pb_live_sync ? res.pb_live_sync : null });
        });
      });
    return true;
  }
});

// Sincronia automatica em segundo plano a cada 15s entre o Painel e o Chromium
setInterval(() => {
  fetch('http://localhost:3000/api/extension/live-config')
    .then((r) => r.json())
    .then((data) => {
      if (!data || !data.ok) return;
      const patch = { pb_live_sync: data };
      if (data.runner && data.runner.running) {
        const waiting = String(data.runner.bigStatus || '').startsWith('Aguardando');
        patch.pb_mode = waiting ? 'scheduled' : 'active';
      }
      if (data.otp && data.otp.code) {
        patch.pb_last_otp = data.otp;
      }
      chrome.storage.local.set(patch);
    })
    .catch(() => {});
}, 15000);
