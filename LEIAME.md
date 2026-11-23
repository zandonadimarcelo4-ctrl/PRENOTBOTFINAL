# PrenotaBot Livre 2.0 (Chromium Dedicado, OTP Automático & Pacote Pré-Instalado)

O **PrenotaBot Livre** organiza a preparação, o monitoramento de horários e o preenchimento rápido (autofill) para agendamento de **passaporte italiano no Prenot@mi**, com foco no **Consulado de São Paulo (serviço 5402 / 5256)** e suporte automático a **16:00 Brasília / 15:00 Cuiabá-Amazonas toda segunda-feira**. É gratuito, aberto e sem rastreadores.

## Modo Fácil: Pacote Portátil Pré-Instalado (Descomprimir e Usar)

Você pode baixar o arquivo **`PrenotaBot-Livre-Portatil.zip`** diretamente no painel (**Baixar Programa Completo (.zip)**) ou via **GitHub Releases** (`.github/workflows/release.yml` gera e publica automaticamente a cada release):

1. Extraia o ZIP em qualquer pasta do computador (ex.: `C:\PrenotaBot-Livre`).
2. **Não precisa rodar `npm install`** — o painel (`dist/`), o servidor (`dist-server/server.mjs`), a extensão (`extensao_android/`), o seed de favoritos e a política do Chromium já vêm pré-instalados.
3. Clique duas vezes em **`INICIAR-AQUI.bat`** (Windows) ou execute **`./iniciar-aqui.sh`** (Linux/macOS):
   - Sobe automaticamente o servidor local em `http://localhost:3000`;
   - Abre o **Chromium Edição Dedicada Prenot@mi** com o portal oficial (`https://prenotami.esteri.it/`), abas do serviço, WhatsApp Web (Radar `+55 47 92004-1774`) e Webmail com leitura automática de OTP (`<noreply-prenotami@esteri.it>`).

## Fluxo Integrado e Seguro (Controle Manual Preservado)

- **Login manual + autofill**: a extensão preenche e-mail/senha; você realiza o login manualmente na 1ª aba (preservada intacta).
- **OTP Automático**: captura códigos de `<noreply-prenotami@esteri.it>` pelo Webmail aberto no Chromium **ou** via IMAP SSL, preenchendo automaticamente o campo de código.
- **Início Integrado em 1 Clique**: ao clicar em **Iniciar Segunda** ou **Testar Agora**, o painel sincroniza as abas do Chromium Dedicado (via CDP `127.0.0.1:9222`), arma o leitor de OTP IMAP e inicia o monitor + Radar WhatsApp juntos.
- **Formulário autofill + confirmação manual**: preenche os campos salvos e destaca o botão Confirmar (`Avanti`) sem clicar sozinho; a escolha de data/horário no calendário e a resolução de eventual CAPTCHA também são manuais.

## Para Desenvolvedores / Gerar Release Localmente

```bash
npm install
npm run dev            # desenvolvimento em http://0.0.0.0:3000
npm test               # testes unitários
npm run release:build  # gera dist/, dist-server/server.mjs e release/PrenotaBot-Livre-Portatil.zip
```

