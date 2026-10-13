# WhatsApp — conexão com a Cloud API oficial da Meta

O ASTRAL Smart Agenda envia avisos pela **WhatsApp Business Platform (Cloud API)**, a API oficial da Meta. Não usa WhatsApp Web, extensões ou automações não oficiais.

Enquanto a conexão não estiver configurada, o sistema roda em **modo demonstração**: a fila, os horários, as regras de quem recebe o quê e o texto de cada mensagem funcionam normalmente, mas **nada é enviado**. Cada aviso fica registrado como *"Demonstração — NÃO enviado"* e uma faixa amarela aparece no topo de todas as telas do administrador. Um aviso nunca é marcado como enviado sem a confirmação da Meta.

## O que você vai precisar

| Item | Onde fica | Onde cadastrar no sistema |
|---|---|---|
| Conta empresarial na Meta (Meta Business) | business.facebook.com | — |
| App da Meta com o produto **WhatsApp** | developers.facebook.com → Meus apps | — |
| Número de telefone remetente (não pode estar em uso no WhatsApp comum) | WhatsApp Manager → Números de telefone | — |
| **Phone Number ID** | App → WhatsApp → Configuração da API | Tela *WhatsApp → Número remetente* (ou `WHATSAPP_PHONE_NUMBER_ID`) |
| **WhatsApp Business Account ID (WABA)** | App → WhatsApp → Configuração da API | Tela *Número remetente* (ou `WHATSAPP_BUSINESS_ACCOUNT_ID`) |
| **Token permanente** (usuário do sistema) | Configurações do negócio → Usuários do sistema → Gerar token | **Somente** no servidor: `WHATSAPP_ACCESS_TOKEN` |
| **Chave secreta do app** (App Secret) | App → Configurações → Básico | **Somente** no servidor: `WHATSAPP_APP_SECRET` |
| **Token de verificação do webhook** | Você inventa (texto longo e aleatório) | Servidor: `WHATSAPP_VERIFY_TOKEN` e o mesmo valor no painel da Meta |

O token e a chave secreta **nunca** passam pelo navegador: são lidos das variáveis de ambiente do servidor. A tela do sistema só mostra se cada credencial está configurada.

## Passo a passo

1. **Conta e app.** Em developers.facebook.com, crie um app do tipo *Empresa*, vincule à conta empresarial da Astral e adicione o produto **WhatsApp**.
2. **Número remetente.** No WhatsApp Manager, adicione e verifique o número comercial que vai enviar os avisos. Recomenda-se também concluir a **verificação da empresa** no Meta Business (aumenta os limites de envio).
3. **Token permanente.** Em *Configurações do negócio → Usuários do sistema*, crie um usuário do sistema (administrador), atribua o app e a conta do WhatsApp e gere um token com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`. Tokens temporários de teste expiram em 24 horas — não use em produção.
4. **Variáveis no servidor.** Cadastre na hospedagem (ou no arquivo `.env`):
   ```env
   WHATSAPP_ACCESS_TOKEN=EAAG...            # token permanente
   WHATSAPP_APP_SECRET=abc123...           # chave secreta do app
   WHATSAPP_VERIFY_TOKEN=um-texto-longo-que-voce-inventa
   WHATSAPP_PHONE_NUMBER_ID=1234567890
   WHATSAPP_BUSINESS_ACCOUNT_ID=9876543210
   WHATSAPP_GRAPH_VERSION=v23.0            # use a versão indicada na Configuração da API
   LINK_SIGNING_SECRET=outro-texto-longo-e-aleatorio
   ```
   Reinicie o servidor depois de salvar.
5. **Webhook.** No app da Meta → WhatsApp → Configuração:
   - URL de retorno: `https://SEU-DOMINIO/api/whatsapp/webhook` (aparece pronta para copiar em *WhatsApp → Visão geral*)
   - Token de verificação: o mesmo valor de `WHATSAPP_VERIFY_TOKEN`
   - Assine o campo **messages** (traz status de entrega, leitura, falhas e as respostas dos botões).
   O sistema valida a assinatura `X-Hub-Signature-256` de cada chamada com a chave secreta do app e recusa o que não confere.
6. **Templates.** Crie no WhatsApp Manager os 9 templates da lista abaixo, com **o mesmo nome**, categoria **Utilidade** e idioma **Português (BR)**. Depois, em *WhatsApp → Templates*, clique em **Sincronizar com a Meta** para trazer o status de aprovação.
7. **Destinatários e consentimento.** Em *WhatsApp → Destinatários*, cadastre o número do Supervisor Técnico e do Coordenador de Operações (de preferência vinculados aos usuários do sistema) e **registre o consentimento** de cada um, descrevendo como foi obtido. Cada pessoa também pode dar ou revogar o consentimento em *Configurações → Meu perfil*, e quem responder **PARAR** no WhatsApp é descadastrado automaticamente.
8. **Preferências.** Em cada destinatário, escolha quais dos 8 avisos recebe, se recebe de todos os compromissos ou só daqueles em que está envolvido, e os horários.
9. **Ativar o envio real.** Em *WhatsApp → Número remetente*, mude o modo para **Envio real pela Cloud API**. O sistema só permite isso com token, chave secreta e Phone Number ID presentes.
10. **Teste.** Em *Destinatários*, use **Enviar teste**. Acompanhe em *Fila de avisos*: "Aceito pela Meta" → "Entregue" → "Lido" chegam pelo webhook.

## Como os avisos funcionam

| Aviso | Quando sai (fuso America/Cuiaba, padrão) |
|---|---|
| Aviso antecipado | N dias antes (padrão 3), às 08:00 |
| Lembrete na véspera | Dia anterior, às 18:00 |
| Lembrete no dia | Primeiro dia, às 07:00 |
| Compromisso alterado ou cancelado | Assim que datas, horários, unidade ou status mudam |
| Reunião ainda não confirmada | Diariamente às 09:00, nos 7 dias anteriores, enquanto estiver "a confirmar" |
| Pendência próxima do vencimento | Ações com prazo em até 2 dias, às 08:00 |
| Resumo semanal | Segunda-feira, às 07:30 |
| Solicitação de confirmação de presença | Quando um participante (usuário do sistema) tem presença pendente — com botões "Confirmar presença" e "Não poderei ir" |

Garantias da fila:

- **Sem duplicidade:** cada aviso tem uma chave única (tipo, compromisso, destinatário, data). Rodar o agendador várias vezes, ou em mais de um processo, não repete mensagens.
- **Retentativa segura:** só repete quando a falha comprovadamente aconteceu antes da Meta aceitar a mensagem (limite de taxa, instabilidade 5xx, falha de conexão). Espera 1, 5, 15, 60 e 180 minutos.
- **Resultado incerto:** se a conexão cai depois do envio, o aviso fica "Resultado incerto" e **não** é reenviado sozinho — o administrador confere e autoriza o reenvio.
- **Dados atuais:** a mensagem é montada na hora do envio; se o compromisso mudou de data, foi concluído ou cancelado, o aviso antigo é cancelado.
- **Funciona com o navegador fechado:** o agendador roda no servidor a cada minuto.
- Botões de presença são **assinados** e só valem quando a resposta vem do número cadastrado do próprio participante.

## Custos

A Meta cobra pelas mensagens de template entregues, conforme a categoria (aqui: Utilidade) e o país do destinatário. As regras e valores mudam periodicamente — consulte a tabela oficial em https://developers.facebook.com/docs/whatsapp/pricing antes de ativar o envio real. Ao ativar o modo real, o sistema pede uma confirmação lembrando dessa cobrança.

## Erros comuns

| Código / sintoma | O que significa | O que fazer |
|---|---|---|
| "Template não está aprovado" | O template ainda não foi aprovado (ou o status não foi sincronizado) | Aguarde a aprovação e clique em *Sincronizar com a Meta* |
| 132001 | Template não existe com esse nome/idioma | Confira nome e idioma (`pt_BR`) em *Templates* |
| 131047 | Mensagem fora da janela de 24 horas sem template | Os avisos usam templates; verifique se o template correto está aprovado |
| 131026 | Mensagem não entregue (número sem WhatsApp, bloqueio, etc.) | Confirme o número com a pessoa |
| 190 | Token expirado ou inválido | Gere um token permanente de usuário do sistema |
| 130429 / HTTP 429 | Limite de envio atingido | O sistema tenta de novo automaticamente |
| Webhook "assinatura inválida" | `WHATSAPP_APP_SECRET` diferente do app que envia o webhook | Copie novamente a chave secreta do app |

## Templates para cadastrar na Meta

Regras atendidas em todos: categoria Utilidade, variáveis `{{n}}` nunca no início nem no fim do texto, parâmetros sem quebra de linha (o sistema limpa automaticamente). O botão "Visualizar agenda" é do tipo **URL dinâmica** com o endereço do seu sistema seguido de `/e/{{1}}`.

### Aviso antecipado de compromisso

- **Nome:** `astral_compromisso_programado`  ·  **Categoria:** Utilidade (UTILITY)  ·  **Idioma:** Português (BR) — `pt_BR`
- **Variáveis:** `{{1}}` atividade, `{{2}}` unidade, `{{3}}` periodo, `{{4}}` responsavel, `{{5}}` orientacao
- **Botões:** URL dinâmica "Visualizar agenda" → `https://agenda.seudominio.com.br/e/{{1}}` (exemplo do sufixo: `2`)

Texto (corpo):

```text
🟢 ASTRAL SMART AGENDA

📅 COMPROMISSO PROGRAMADO

Atividade: {{1}}
Unidade: {{2}}
Período: {{3}}
Responsável: {{4}}

⚠️ {{5}}

Acesse o sistema para consultar o checklist completo.
```

Exemplos para o formulário da Meta: `{{1}}` = "Auditoria GMP+ — Lucas do Rio Verde" · `{{2}}` = "Lucas do Rio Verde" · `{{3}}` = "19 a 21/10/2026" · `{{4}}` = "Supervisor Técnico" · `{{5}}` = "Prepare a documentação, revise as pendências e confirme as condições da unidade."

### Lembrete na véspera

- **Nome:** `astral_lembrete_vespera`  ·  **Categoria:** Utilidade (UTILITY)  ·  **Idioma:** Português (BR) — `pt_BR`
- **Variáveis:** `{{1}}` atividade, `{{2}}` unidade, `{{3}}` periodo, `{{4}}` responsavel, `{{5}}` pendencias
- **Botões:** URL dinâmica "Visualizar agenda" → `https://agenda.seudominio.com.br/e/{{1}}` (exemplo do sufixo: `2`)

Texto (corpo):

```text
🟢 ASTRAL SMART AGENDA

⏰ LEMBRETE: É AMANHÃ

Atividade: {{1}}
Unidade: {{2}}
Período: {{3}}
Responsável: {{4}}

Pendências no checklist: {{5}}

Confira os detalhes no sistema antes do deslocamento.
```

Exemplos para o formulário da Meta: `{{1}}` = "Auditoria GMP+ — Sorriso" · `{{2}}` = "Sorriso" · `{{3}}` = "21 a 22/10/2026" · `{{4}}` = "Supervisor Técnico" · `{{5}}` = "3 item(ns) em aberto"

### Lembrete no dia

- **Nome:** `astral_lembrete_hoje`  ·  **Categoria:** Utilidade (UTILITY)  ·  **Idioma:** Português (BR) — `pt_BR`
- **Variáveis:** `{{1}}` atividade, `{{2}}` unidade, `{{3}}` periodo, `{{4}}` responsavel, `{{5}}` pendencias
- **Botões:** URL dinâmica "Visualizar agenda" → `https://agenda.seudominio.com.br/e/{{1}}` (exemplo do sufixo: `2`)

Texto (corpo):

```text
🟢 ASTRAL SMART AGENDA

📍 COMPROMISSO HOJE

Atividade: {{1}}
Unidade: {{2}}
Período: {{3}}
Responsável: {{4}}

Pendências no checklist: {{5}}

Registre o andamento no sistema ao longo do dia.
```

Exemplos para o formulário da Meta: `{{1}}` = "Visita técnica — Lucas do Rio Verde" · `{{2}}` = "Lucas do Rio Verde" · `{{3}}` = "12 a 13/11/2026" · `{{4}}` = "Supervisor Técnico" · `{{5}}` = "nenhuma ✅"

### Compromisso alterado ou cancelado

- **Nome:** `astral_compromisso_alterado`  ·  **Categoria:** Utilidade (UTILITY)  ·  **Idioma:** Português (BR) — `pt_BR`
- **Variáveis:** `{{1}}` situacao, `{{2}}` atividade, `{{3}}` unidade, `{{4}}` periodo, `{{5}}` mudancas, `{{6}}` autor
- **Botões:** URL dinâmica "Visualizar agenda" → `https://agenda.seudominio.com.br/e/{{1}}` (exemplo do sufixo: `2`)

Texto (corpo):

```text
🟢 ASTRAL SMART AGENDA

🔄 COMPROMISSO {{1}}

Atividade: {{2}}
Unidade: {{3}}
Período atual: {{4}}
O que mudou: {{5}}

Alteração registrada por {{6}}. Consulte o histórico no sistema.
```

Exemplos para o formulário da Meta: `{{1}}` = "ALTERADO" · `{{2}}` = "Visita técnica — Lucas do Rio Verde" · `{{3}}` = "Lucas do Rio Verde" · `{{4}}` = "17 a 18/11/2026" · `{{5}}` = "data inicial, data final" · `{{6}}` = "Supervisor Técnico"

### Reunião ainda não confirmada

- **Nome:** `astral_reuniao_nao_confirmada`  ·  **Categoria:** Utilidade (UTILITY)  ·  **Idioma:** Português (BR) — `pt_BR`
- **Variáveis:** `{{1}}` compromisso, `{{2}}` data, `{{3}}` local, `{{4}}` pendencia
- **Botões:** URL dinâmica "Visualizar agenda" → `https://agenda.seudominio.com.br/e/{{1}}` (exemplo do sufixo: `2`)

Texto (corpo):

```text
🟢 ASTRAL SMART AGENDA

⚠️ REUNIÃO AINDA NÃO CONFIRMADA

Compromisso: {{1}}
Data prevista: {{2}}
Local: {{3}}
Pendência: {{4}}

Confirme a agenda e atualize o status no sistema.
```

Exemplos para o formulário da Meta: `{{1}}` = "Reunião mensal com André — Nova Ubiratã" · `{{2}}` = "11/11/2026" · `{{3}}` = "Nova Ubiratã" · `{{4}}` = "Agenda aguardando confirmação"

### Pendência próxima do vencimento

- **Nome:** `astral_pendencia_vencimento`  ·  **Categoria:** Utilidade (UTILITY)  ·  **Idioma:** Português (BR) — `pt_BR`
- **Variáveis:** `{{1}}` acao, `{{2}}` prazo, `{{3}}` responsavel, `{{4}}` progresso, `{{5}}` origem

Texto (corpo):

```text
🟢 ASTRAL SMART AGENDA

📌 PENDÊNCIA PRÓXIMA DO VENCIMENTO

Ação: {{1}}
Prazo: {{2}}
Responsável: {{3}}
Progresso: {{4}}
Origem: {{5}}

Atualize o andamento no painel de ações.
```

Exemplos para o formulário da Meta: `{{1}}` = "Corrigir registro de calibração" · `{{2}}` = "20/10/2026" · `{{3}}` = "Equipe da unidade" · `{{4}}` = "40% · prioridade alta" · `{{5}}` = "Pré-auditoria — Auditoria GMP+ — Sorriso"

### Resumo semanal da agenda

- **Nome:** `astral_resumo_semanal`  ·  **Categoria:** Utilidade (UTILITY)  ·  **Idioma:** Português (BR) — `pt_BR`
- **Variáveis:** `{{1}}` semana, `{{2}}` total, `{{3}}` lista, `{{4}}` alertas

Texto (corpo):

```text
🟢 ASTRAL SMART AGENDA

🗓️ RESUMO DA SEMANA {{1}}

Compromissos: {{2}}
Agenda: {{3}}
Atenção: {{4}}

Acesse o sistema para ver a agenda completa.
```

Exemplos para o formulário da Meta: `{{1}}` = "19/10 a 25/10" · `{{2}}` = "3 compromisso(s)" · `{{3}}` = "19/10 Auditoria GMP+ — Lucas do Rio Verde (Lucas do Rio Verde) | 21/10 Auditoria GMP+ — Sorriso (Sorriso)" · `{{4}}` = "possível conflito em 21/10"

### Solicitação de confirmação de presença

- **Nome:** `astral_confirmacao_presenca`  ·  **Categoria:** Utilidade (UTILITY)  ·  **Idioma:** Português (BR) — `pt_BR`
- **Variáveis:** `{{1}}` nome, `{{2}}` atividade, `{{3}}` unidade, `{{4}}` periodo
- **Botões:** Resposta rápida "Confirmar presença"; Resposta rápida "Não poderei ir"

Texto (corpo):

```text
🟢 ASTRAL SMART AGENDA

✅ CONFIRMAÇÃO DE PRESENÇA

Olá, {{1}}. Sua presença é solicitada em:
Atividade: {{2}}
Unidade: {{3}}
Período: {{4}}

Responda pelos botões abaixo para confirmar.
```

Exemplos para o formulário da Meta: `{{1}}` = "André" · `{{2}}` = "Reunião mensal com André — Nova Ubiratã" · `{{3}}` = "Nova Ubiratã" · `{{4}}` = "11/11/2026"

### Mensagem de teste

- **Nome:** `astral_mensagem_teste`  ·  **Categoria:** Utilidade (UTILITY)  ·  **Idioma:** Português (BR) — `pt_BR`
- **Variáveis:** `{{1}}` nome, `{{2}}` data_hora

Texto (corpo):

```text
🟢 ASTRAL SMART AGENDA

Mensagem de teste para {{1}}. Se você recebeu, as notificações do WhatsApp estão funcionando.

Enviada em {{2}} pelo sistema.
```

Exemplos para o formulário da Meta: `{{1}}` = "Supervisor Técnico" · `{{2}}` = "13/10/2026 09:00"

