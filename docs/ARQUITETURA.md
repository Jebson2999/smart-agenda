# Arquitetura

## Visão geral

```
 Celular / tablet / computador (PWA instalável)
        │  HTTPS (cookie de sessão, cabeçalho anti-CSRF)
        ▼
 ┌──────────────────────── Node.js 22 — um único processo ────────────────────────┐
 │  Servidor HTTP ── arquivos do app (gzip, cache) ── service worker              │
 │      │                                                                          │
 │  API autenticada ── autorização (perfil + permissões + visibilidade)            │
 │      │           └─ validação (zod) ── trilha de auditoria                      │
 │      ▼                                                                          │
 │  Regras de negócio ── motor de inteligência (funções puras, src/shared)         │
 │      │                                                                          │
 │  SQLite (node:sqlite, WAL) ── anexos em disco ── backups diários                │
 │      ▲                                                                          │
 │  Agendador (a cada minuto) ── planejador → fila → despachante ──► Cloud API Meta│
 │                                                    ▲                            │
 │  Webhook /api/whatsapp/webhook (assinatura HMAC) ──┘ status e respostas         │
 └────────────────────────────────────────────────────────────────────────────────┘
```

## Pilha e por que ela

| Camada | Escolha | Observação |
|---|---|---|
| Interface | React 19 + TypeScript, Tailwind CSS v4, ícones Lucide (`react-icons/lu`), fonte Inter | Componentes próprios no estilo shadcn/ui (`src/client/components/ui.tsx`) |
| App instalável | PWA: manifest, service worker, ícones maskable e Apple | Funciona offline para abrir o app; dados sempre pela rede |
| Servidor | Node.js 22 com roteador HTTP próprio (`src/server/http.ts`) | Sem framework; cabeçalhos de segurança em todas as respostas |
| Banco | SQLite embutido no Node (`node:sqlite`), modo WAL | Arquivo único, transações `BEGIN IMMEDIATE`, migrações versionadas |
| Validação | zod | Erros 422 com o campo e a mensagem em português |
| Relatórios | pdf-lib (PDF), XLSX próprio sobre JSZip, ICS (RFC 5545) | Gerados na hora, sem serviços externos |
| Mensagens | WhatsApp Business Platform — Cloud API (HTTP direto, `fetch`) | Modo demonstração identificado |
| Build | esbuild (app e servidor em um pacote), compilador do Tailwind | `dist/server.mjs` roda sem `node_modules` |
| Testes | `node:test` (67 testes de regras e APIs) + Playwright (ponta a ponta) | `npm test` e `npm run e2e` |

**Desvio da arquitetura recomendada (Next.js + Supabase/PostgreSQL).** O ambiente em que o sistema foi construído não tinha acesso ao registro do npm, então não era possível instalar e testar Next.js, Supabase ou um driver de PostgreSQL. O projeto já existente tinha sido iniciado sobre Node 22 + SQLite embutido, que atende os requisitos com vantagens práticas para dois a dez usuários: **zero dependências em produção, um único processo** (app, API, agendador e webhook), hospedagem barata e backup de um arquivo. Toda a regra de negócio fica isolada da interface e do banco, o que mantém aberta a migração abaixo.

### Migrar para PostgreSQL / Supabase (quando fizer sentido)

O acesso ao banco passa por quatro funções em `src/server/db.ts` (`all`, `get`, `run`, `tx`) e por SQL padrão nos módulos de repositório. Para usar PostgreSQL:

1. Trocar a implementação de `db.ts` pelo driver `pg` (pool de conexões), convertendo os marcadores `?` em `$1, $2…` e as transações para `BEGIN … COMMIT` com `SELECT … FOR UPDATE SKIP LOCKED` na reserva da fila (`notifications/dispatcher.ts → claim`).
2. Converter `src/server/migrations.ts`: `INTEGER PRIMARY KEY` → `BIGSERIAL`, `COLLATE NOCASE` → `CITEXT` ou `lower(email)`, `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`, `INSERT OR REPLACE` → `ON CONFLICT DO UPDATE`.
3. Migrar os dados com um script que lê o SQLite e insere no PostgreSQL na ordem das chaves estrangeiras.
4. Os anexos podem ir para o Supabase Storage (ou outro S3) trocando a gravação em disco em `routes/events.ts`.
5. As regras de negócio (`src/shared/intelligence.ts`), as telas e os testes de comportamento não mudam.

## Organização do código

```
src/
  shared/          regras e tipos usados no servidor e na interface
    constants.ts   categorias, status, prioridades, perfis, permissões, tipos de aviso
    dates.ts       datas sem horário, fusos (America/Cuiaba), formatos pt-BR
    holidays.ts    feriados nacionais (inclui Páscoa móvel e Consciência Negra)
    intelligence.ts motor de análise (conflitos, preparação, confirmações, prioridades, resumos)
  server/
    index.ts  app.ts  http.ts  config.ts  db.ts  migrations.ts  seed.ts  auth.ts  backup.ts
    repo/          compromissos (visibilidade, histórico), configurações
    routes/        auth, events, insights (painel, auditorias, assistente), actions, admin, whatsapp, reports
    notifications/ planner, queue, dispatcher, provider (Cloud API), webhook, recipients, messages, scheduler
    reports/       pdf, xlsx, ics
  client/
    main.tsx       provedores, rotas e controle de sessão
    pages/         Painel, Agenda (5 visões), Compromisso, Formulário, Auditorias, Ações,
                   Assistente, Relatórios, WhatsApp, Usuários, Configurações, Login
    components/    ui (botões, cartões, modais, abas…), Layout, EventBits
tests/             testes automatizados (node:test)
scripts/           build, e2e, capturas de tela, ícones
```

## Modelo de dados

| Tabela | Conteúdo |
|---|---|
| `users`, `sessions`, `login_attempts` | Contas, perfis, permissões extras, sessões (hash do token), bloqueio de tentativas |
| `units`, `custom_holidays` | Unidades (cliente, município) e feriados municipais/estaduais |
| `events` | Compromissos: título, descrição, datas, **horário opcional**, cliente, unidade, município, categoria, responsável, prioridade, status, visibilidade, observações, detalhes por categoria (visita/reunião/auditoria), configurações de aviso, vínculo com a preparação, série recorrente, versão |
| `event_participants` | Participantes internos e externos, presença solicitada/confirmada/recusada, canal da resposta |
| `checklist_items`, `checklist_templates` | Itens por etapa (geral, pré, durante, pós), críticos, quem concluiu e quando; modelos editáveis |
| `event_history`, `event_comments` | Histórico de alterações (de → para, com o cadastro original) e observações |
| `attachments` | Fotos e documentos (hash SHA-256, nome aleatório no disco) |
| `actions` | Apontamentos, encaminhamentos e tarefas: responsável, prazo, progresso, prioridade, origem |
| `whatsapp_recipients` | Números, vínculo com usuário, consentimento (data, forma, versão do texto), preferências |
| `wa_templates` | Templates por tipo de aviso, status de aprovação |
| `notifications`, `message_log` | Fila persistente (chave de deduplicação única, tentativas, próxima tentativa, reserva) e registro de cada passo |
| `webhook_events`, `inbound_messages` | Webhooks recebidos (assinatura válida ou não) e IDs de mensagens já processadas |
| `settings`, `audit_trail` | Configurações (ex.: remetente do WhatsApp) e trilha de auditoria |

## Permissões

- **Permissão** = o que a pessoa pode fazer (ex.: `events.edit`). **Visibilidade** = quais compromissos ela vê.
- Perfis: Administrador/Supervisor (tudo), Coordenador (vê compartilhados, confirma participação, comenta, exporta relatórios, recebe avisos), Técnico e Gestor (expansão).
- O administrador libera permissões extras por pessoa (ex.: deixar o coordenador editar compromissos).
- Compromissos **privados** só aparecem para responsável, participantes e quem tem `events.view_all`.
- A interface esconde o que a pessoa não pode usar, mas **a autorização real é sempre no servidor** (testada em `tests/api.test.ts`).

## Motor de inteligência

Funções puras em `src/shared/intelligence.ts`, cobertas por testes. **Nenhuma altera compromissos** — só alertam e sugerem; reagendar sempre exige confirmação da pessoa.

| Função | O que faz |
|---|---|
| `detectConflicts` | "Conflito confirmado" quando os dois têm horário e os horários se cruzam; "possível conflito" quando as datas se cruzam e falta horário. Marca municípios diferentes (deslocamento). |
| `holidayAlerts` | Feriados nacionais e locais no período de cada compromisso |
| `auditReadiness` | % de preparação (checklist da preparação vinculada + pré-auditoria), pendências críticas, prazo restante e nível (pronta, em preparação, insuficiente…) |
| `pendingConfirmations` | Compromissos "a confirmar" e presenças pendentes |
| `overdueItems` | Compromissos vencidos não concluídos e ações com prazo vencido |
| `suggestFreeSlots` | Dias úteis livres e janelas de horário (feriados e dias com compromisso sem horário contam como ocupados) |
| `recommendPriorities` | Ordena por prazo, prioridade, preparação insuficiente e confirmações |
| `tasksBefore` | O que precisa estar feito antes de cada compromisso |
| `buildSummary` | Resumo executivo da semana ou do mês, só com dados cadastrados |

### Assistente e IA conversacional futura

`GET /api/assistant?q=` já responde as perguntas do dia a dia ("agenda da próxima semana", "o que preparar para a auditoria GMP+", "reuniões a confirmar", "resumo de novembro para o coordenador") **montando a resposta a partir das funções acima**, com a lista dos compromissos usados como fonte. Para plugar um modelo de linguagem depois:

1. Manter as mesmas funções como "ferramentas" que o modelo pode chamar (todas recebem o usuário e respeitam a visibilidade dele).
2. Instruir o modelo a responder **somente** com o retorno dessas ferramentas e a citar os compromissos de origem — exatamente o que a resposta atual já devolve em `sources`.
3. Nunca dar ao modelo permissão de escrita: qualquer alteração continua passando pela interface com confirmação.

## Notificações (fluxo)

1. **Planejador** (`planner.ts`), a cada minuto: para cada destinatário com consentimento e cada compromisso aberto, calcula os avisos devidos no fuso America/Cuiaba e coloca na fila com uma **chave única** — repetir não duplica.
2. **Alterações**: ao mudar data, horário, unidade ou status, os lembretes pendentes são cancelados (o planejador recria) e o aviso de alteração entra na fila.
3. **Despachante** (`dispatcher.ts`): reserva os avisos vencidos em transação, **remonta a mensagem com os dados atuais**, confere consentimento e preferências e envia — ou registra "demonstração".
4. **Resultado**: aceito (guarda o ID da Meta), retentativa com espera (limite/instabilidade), falha definitiva, ou **incerto** (sem reenvio automático).
5. **Webhook**: atualiza para entregue/lido/falhou (sem regredir status), registra respostas dos botões de presença (assinadas) e descadastra quem responde PARAR. Webhooks repetidos são ignorados pelo ID.

## Integração futura com o ERP ASTRAL Control Intelligence

O aplicativo é independente e **não altera o ERP**. Caminhos previstos, sem mudar o que existe:

- **Leitura pela API REST** do Smart Agenda com um usuário de integração (perfil Gestor ou Técnico, só leitura) — `GET /api/events`, `/api/audits`, `/api/actions`, `/api/summary`.
- **Arquivos padrão**: ICS (agenda) e Excel (compromissos, checklists e ações) para importação.
- **Cadastros compartilhados**: unidades e clientes do Smart Agenda têm os mesmos campos do escopo do ERP (cliente → unidade → município), facilitando um sincronismo futuro por código da unidade.
- Quando o ERP tiver o motor de autorização central pronto, o login pode passar a ser delegado a ele (o Smart Agenda já separa autenticação, perfil e permissões em `auth.ts`).

## PWA

- `manifest.webmanifest` com ícones, atalhos (Agenda, Novo compromisso, Auditorias), `display: standalone`, cor `#0B4336`.
- Service worker: arquivos do app em cache (nomes com hash), navegação com fallback offline, **API nunca em cache** (dados não ficam guardados no aparelho).
- Os avisos não dependem do app aberto: chegam pelo WhatsApp a partir do servidor.
