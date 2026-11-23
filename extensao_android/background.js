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
});
