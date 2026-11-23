# PrenotaBot Livre 2.0 (Web & Extensão Android)

O **PrenotaBot Livre** organiza a preparação, o monitoramento de horários e o preenchimento rápido (autofill) para agendamento de **passaporte italiano no Prenot@mi**, com foco no **primeiro passaporte no Consulado de São Paulo (serviço 5402)**. É gratuito, aberto e sem rastreadores.

## Principais Recursos

1. **Painel Web Completo (Node.js + Express + React)**:
   - **Perfis salvos** (`perfis/*.yaml`) com criação, duplicação e troca rápida.
   - **Assistente passo a passo** (6 etapas) para configuração inicial.
   - **Fluxo seguro com controle manual**:
     - **Login manual + autofill**: a extensão preenche apenas e-mail/senha; você faz o login manualmente e a 1ª aba permanece aberta.
     - **Início programado para Segunda-feira 15:00**: aguarda automaticamente até 1–2 minutos antes das `15:00` (ex.: `14:58`), com botão separado **Iniciar agora (teste)** para testes imediatos.
     - **Formulário autofill + confirmação manual**: preenche todos os campos configurados (endereço, altura, estado civil, cor dos olhos, acompanhantes, memória de respostas) e destaca o botão Confirmar sem enviar sozinho; a escolha de data e horário no calendário também é manual.
     - **Respeito a Captcha e bloqueios**: se aparecer captcha anti-robô (Radware) ou erro, pausa e alerta você para resolver manualmente (sem burlar captcha).
2. **Alertas Gratuitos em Tempo Real**:
   - **ntfy** (push no celular Android/iPhone), **WhatsApp (CallMeBot)**, **Telegram** e alarme sonoro no navegador.
3. **Extensão Android & Userscript (`extensao_android/`)**:
   - Na aba **Celular / Extensão**, baixe o `prenotabot-livre.user.js` (Firefox Android + Tampermonkey) ou use os arquivos em `extensao_android/` (Lemur / Quetta / Edge Android).
4. **Modo IA (Assistente Consular)**:
   - Integrado via rota segura no servidor (`/api/ai/assist`) usando `OPENAI_API_KEY` no ambiente do servidor (`.env`), ajudando a revisar prontidão para segunda-feira às 15:00 e mapear rótulos desconhecidos do formulário.

## Como rodar

```bash
npm install
npm run dev      # inicia servidor em http://0.0.0.0:3000
npm test         # executa testes unitários
npm run build    # gera build de produção
```
