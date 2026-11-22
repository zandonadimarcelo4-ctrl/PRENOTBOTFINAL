# PrenotaBot Livre 2.0

O PrenotaBot Livre agenda o **passaporte italiano no Prenot@mi**, com foco no **primeiro passaporte no Consulado de São Paulo (serviço 5402)**. É gratuito, não tem licença nem serial e não tem rastreador. Ele roda no seu computador e também no celular.

Você cadastra uma vez a sua conta, os seus dados e o PDF. Depois disso, o bot:

- entra no site sozinho e verifica as vagas no intervalo que você escolher;
- toca um alarme e avisa no celular quando a vaga abre;
- preenche o formulário, anexa o documento e pede o código do e-mail;
- escolhe a data e o horário;
- salva o comprovante.

![Painel](docs/imagens/painel_inicio.png)

---

## 1. Instalar no Windows (2 cliques)

1. Extraia este zip numa pasta, por exemplo `Documentos\PrenotaBot`. **Não rode de dentro do zip.**
2. Dê dois cliques em **`INICIAR.bat`**.
   - Se o computador não tiver Python, o próprio arquivo instala o Python 3.12 (clique em *Sim* se o Windows pedir). Depois, rode o `INICIAR.bat` de novo.
   - Na primeira vez, ele prepara tudo em 1 ou 2 minutos e cria o atalho **PrenotaBot Livre** na Área de Trabalho.
3. O painel abre com o **Assistente passo a passo**.

> É preciso ter o **Google Chrome** instalado. O driver do Chrome é baixado sozinho.

## 2. Assistente: 6 passos

| Passo | O que fazer |
|---|---|
| 1. Conta | E-mail e senha do Prenot@mi (os mesmos do site). A senha vai para o cofre do Windows. |
| 2. Serviço | **São Paulo – PRIMEIRO PASSAPORTE** já vem marcado. Também há Renovação (5256) e "Outro consulado". |
| 3. Dados | Endereço completo (obrigatório), altura, estado civil e cor dos olhos. |
| 4. Documentos | Selecione o PDF. Para o primeiro passaporte em SP, o site pede **1 anexo: o comprovante de residência em seu nome**. |
| 5. Avisos | Tópico do app ntfy (notificação no celular) e/ou WhatsApp. Tudo opcional e grátis. |
| 6. Pronto | Clique em **Concluir** e, se quiser, deixe marcado "Iniciar agora". |

![Assistente](docs/imagens/assistente_servico.png)

Tudo isso também pode ser editado depois, nas abas do painel: Conta, Serviço, Formulário, Agendamento, Avisos e Histórico.

![Formulário](docs/imagens/painel_formulario.png)

## 3. O que acontece quando você clica em INICIAR

1. O Chrome abre, **entra na sua conta** (login novo pelo IAM ou login antigo) e fica **minimizado**, sem atrapalhar o uso do PC.
2. Ele verifica o serviço a cada 45–90 s (aleatório, para parecer humano). Também respeita a janela de horário e os dias da semana que você escolher.
3. Quando a **vaga abre**, ele:
   - toca o alarme, traz o Chrome para a frente e avisa no celular;
   - preenche o formulário. Nos campos que já conhece, como os do 5402 em São Paulo, usa os campos exatos. Nos outros, reconhece pelo rótulo, em italiano, português, inglês ou espanhol;
   - escolhe "agendamento único" ou "múltiplo" (com os acompanhantes cadastrados), anexa os PDFs e marca a privacidade.
4. Ele clica em **enviar código (OTP)**. Se a leitura de e-mail estiver configurada, lê o código sozinho no seu Gmail. Se não, pede para você digitar o código.
5. Ele **confere os campos obrigatórios**. Se faltar algum, destaca o campo em vermelho e chama você.
6. No **calendário**, ele procura o primeiro horário livre dentro das suas preferências (datas mínima e máxima, manhã ou tarde, dias preferidos) e reserva.
7. Ele salva o **comprovante em PDF** na pasta `comprovantes/` e avisa que deu certo.

**Memória inteligente:** se o site trouxer uma pergunta nova que o bot não conhece, ele pede para você responder uma vez. A resposta fica salva no perfil, e o bot preenche sozinho da próxima vez. As respostas aprendidas aparecem na aba Formulário.

**Captcha:** quando o site mostra o captcha anti-robô (Radware), o bot para, toca o alarme e espera você resolver. Isso é proposital e não deve ser burlado.

## 4. Avisos (todos grátis)

| Canal | Como ativar |
|---|---|
| **Celular (recomendado)** | Instale o app **ntfy** (Play Store/App Store), toque em **+** e assine o tópico gerado no painel (botão "Gerar tópico"). |
| **WhatsApp** | No WhatsApp, mande `I allow callmebot to send me messages` para **+34 644 71 81 99**. Você recebe uma API key: cole a chave e o seu número no painel. |
| **Telegram** | Crie um bot com o @BotFather, pegue o token e o seu chat ID (@userinfobot). |
| **E-mail e leitura do código** | Gmail: crie uma **senha de app** em myaccount.google.com/apppasswords (exige verificação em 2 etapas) e cole na aba Avisos. |

SMS não foi incluído porque todo envio de SMS é pago. O push do ntfy faz o mesmo papel e chega na hora.

Use o botão **Testar avisos** para conferir tudo.

## 5. Celular (Android)

Veja **[celular/COMO_INSTALAR_NO_CELULAR.md](celular/COMO_INSTALAR_NO_CELULAR.md)**. Em resumo:

1. Instale o Firefox e o Tampermonkey.
2. Instale o script `prenotabot-livre.user.js`.
3. Abra o prenotami.esteri.it e toque no botão **PB**.

Ele tem as mesmas funções: login, monitoramento, preenchimento, anexo, calendário automático e avisos. O script também funciona no PC, com o Tampermonkey no Chrome ou no Edge.

## 6. Mora em Mato Grosso?

Mato Grosso pertence à jurisdição do Consulado de São Paulo, mas o passaporte é feito no **Vice-Consulado Honorário de Cuiabá**, que tem um serviço próprio no Prenot@mi e exige comprovante de residência em MT. No painel, clique em **Listar serviços da minha conta**: o bot mostra todos os IDs da sua conta. Depois, coloque o número do serviço de Cuiabá na aba Serviço.

Mais informações: [Consulado de São Paulo – residentes em Mato Grosso](https://conssanpaolo.esteri.it/pt/servizi-consolari-e-visti/servizi-per-il-cittadino-italiano/passaporti/cittadini-italiani-residenti-in-mato-grosso-importante/).

## 7. Regras do consulado que vale saber

- São Paulo libera as vagas de primeiro passaporte e de renovação **semanalmente**. Deixe o bot rodando nos dias e horários em que costuma abrir. A aba **Histórico** mostra em que horários o bot já encontrou vagas.
- O agendamento múltiplo é só para o núcleo familiar (cônjuge e filhos). Cadastre os acompanhantes na aba Formulário.
- Renovação: é preciso anexar a cópia do passaporte vencido ou a vencer em até 12 meses (ou o B.O. em caso de perda ou roubo).
- O site **não permite cancelar** um agendamento pelo sistema. Confira os dados antes de iniciar.

Fonte: [Modalidades de agendamento – Consulado de São Paulo](https://conssanpaolo.esteri.it/pt/servizi-consolari-e-visti/servizi-per-il-cittadino-italiano/passaporti/modalita-di-prenotazione-tramite-il-portale-prenotmi/).

## 8. Problemas comuns

| Problema | Solução |
|---|---|
| "Python não encontrado" | Deixe o `INICIAR.bat` instalar, ou instale pelo python.org marcando *Add python.exe to PATH*. |
| O Chrome não abre | Instale ou atualize o Google Chrome. Feche outros Chromes que estejam usando o perfil do bot. |
| Página `/Error` | O site bloqueou por excesso de tentativas. O bot espera sozinho (10 min, configurável). Aumente o intervalo. |
| Login não entra | Entre manualmente na janela do Chrome. Como a sessão fica salva, isso é raro. |
| Campo não preenchido | Veja `logs/mapa_campos_ultimo_formulario.json` e preencha manualmente uma vez. O bot aprende. |
| Quero usar sem o painel | Use `modo_terminal.bat` (opções: `--listar`, `--verificar`, `--testar-avisos`, `--perfil NOME`). |

## 9. Arquivos

| Arquivo | Para quê |
|---|---|
| `INICIAR.bat` | Instala, se precisar, e abre o painel. |
| `criar_atalho.bat` | Recria o atalho na Área de Trabalho. |
| `modo_terminal.bat` | Roda o bot sem o painel. |
| `testar.bat` | Roda os testes automáticos. |
| `painel.pyw` / `core.py` / `main.py` | Painel, motor e linha de comando. |
| `perfis/` | Um perfil por pessoa ou serviço (Novo, Duplicar, Excluir). |
| `files/` | Seus PDFs. |
| `comprovantes/` | Comprovantes salvos. |
| `logs/` | Registro e histórico de verificações. |
| `celular/` | Versão para Android (userscript). |

## 10. Privacidade e segurança

- Tudo fica **no seu computador**. A senha vai para o Gerenciador de Credenciais do Windows, quando disponível, e o resto fica em `.env` e `perfis/`. **Não compartilhe esses arquivos.**
- O bot não manda dados para ninguém, a não ser os avisos que você ativar (ntfy, CallMeBot, Telegram, seu e-mail).
- **Atenção a extensões pagas de terceiros:** na análise de uma extensão comercial para o Prenot@mi, foi encontrado código que envia os cookies da sua sessão para o servidor do vendedor, guarda a senha em texto aberto e inclui um rastreador do Facebook. Desconfie de qualquer ferramenta que peça a sua senha e mande dados para fora.

## 11. Uso responsável

O bot imita uma pessoa: usa intervalos aleatórios, não burla captcha e deixa o código OTP com você. Use só com a sua própria conta e com intervalos razoáveis. Se muita gente verificar rápido demais, o site fica lento para todos. O agendamento é pessoal e gratuito no consulado: **nunca pague por vagas**.
