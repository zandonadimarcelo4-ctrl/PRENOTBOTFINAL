const QUICK_DATA = {"endereco":"","altura":"","email":"","webmailUrl":"https://mail.google.com/","sid":5402,"fusoHorario":"America/Sao_Paulo","horarioAlvo":"16:00","antecedenciaMinutos":2};
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
