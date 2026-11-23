const DATA = {"endereco":"","altura":"","email":"","webmailUrl":"https://mail.google.com/","sid":5402,"fusoHorario":"America/Sao_Paulo","horarioAlvo":"16:00","antecedenciaMinutos":2};
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
