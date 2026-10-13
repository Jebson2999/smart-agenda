# Critérios de conclusão (seção 13 da especificação)

Situação de cada critério e onde ele é demonstrado. Testes: `npm test` (67 testes de regras e APIs) e `npm run e2e` (fluxos pela interface no Chromium, com banco novo).

| # | Critério | Situação | Onde verificar |
|---|---|---|---|
| 1 | Login e permissões operacionais | Atendido | Login com bloqueio por tentativas, troca obrigatória da senha temporária, perfis e permissões extras. Testes: `api.test.ts` (401, 428, CSRF, coordenador sem criar/editar, permissão liberada pelo administrador, compromisso privado, usuário desativado, nunca sem administrador). E2E: primeiro acesso dos dois perfis. Tela *Usuários*. |
| 2 | Dashboard com indicadores vinculados à base | Atendido | Tela *Início*: saudação, data e relógio em tempo real, "Minha próxima missão" (unidade, período, prioridade, checklist, botão de detalhes), hoje e próximos 7 dias, auditorias em preparação, confirmações pendentes, visitas, concluídas e atrasadas, % de execução do mês, linha do tempo, alertas de conflito e gráfico por mês — tudo de `GET /api/dashboard`. |
| 3 | Calendário nos três modos (e mais) | Atendido | *Agenda*: mês, semana, dia, lista e linha do tempo; filtros por unidade, categoria e status; pesquisa; cores por tipo. |
| 4 | Os 10 eventos reais cadastrados corretamente | Atendido | `seed.test.ts` confere datas, categorias, unidades, status, prioridades, ausência de horário, checklist da preparação e o vínculo com a auditoria de Lucas do Rio Verde. |
| 5 | Criação, edição, conclusão e reagendamento | Atendido | Formulário de compromisso (com recorrência semanal/mensal), botão Reagendar, arrastar no calendário (com confirmação), Concluir e status. Histórico com o valor original. Testes em `api.test.ts`; E2E: arrastar 12–13/11 → 17–18/11. |
| 6 | Checklists persistidos e vinculados | Atendido | Itens por etapa, críticos, quem concluiu e quando; modelos editáveis em *Configurações*. Teste de persistência na API e no E2E (recarregar a página). |
| 7 | Detecção do possível conflito de 21/10 | Atendido | Alerta no painel, na agenda (ícone), no compromisso, nas auditorias, nos relatórios e no resumo. Testes em `intelligence.test.ts` e `seed.test.ts`. As datas não são alteradas. |
| 8 | Alertas de reuniões aguardando confirmação | Atendido | 27/10 e 09/12 aparecem como "Aguardando confirmação" no painel e no assistente; aviso diário no WhatsApp nos 7 dias anteriores. Testes em `seed.test.ts` e `intelligence.test.ts`. |
| 9 | Fila persistente de notificações com prevenção de duplicidade | Atendido | Tabela `notifications` com chave única; planejador idempotente; reserva em transação; recuperação de reserva abandonada como "incerto". Testes em `notifications.test.ts`. |
| 10 | Integração WhatsApp preparada e testada, distinguindo demonstração de envio real | Atendido (envio real depende das credenciais da Meta) | Cloud API oficial com templates, botões, retentativas e webhooks assinados. Testes com a resposta da Meta simulada: aceito, 429, 400, tempo esgotado, template não aprovado; webhooks de status, botões e PARAR. Modo demonstração identificado em todas as telas e nunca marcado como enviado. Passo a passo em [WHATSAPP.md](WHATSAPP.md). |
| 11 | Relatórios exportáveis | Atendido | Agenda mensal (PDF), resumo executivo semanal/mensal (PDF), agenda em Excel, ICS, relatório de auditoria (PDF), relatório de visitas e reuniões (PDF). Teste em `api.test.ts`. |
| 12 | Interface para celular, tablet e computador | Atendido | Layout responsivo com navegação inferior no celular e lateral no computador, modo escuro, PWA instalável. Verificado com capturas em 390, 820 e 1440 px e sem rolagem horizontal ([imagens](imagens)). |
| 13 | Testes automatizados e documentação | Atendido | `tests/` (67 testes), `scripts/e2e.mjs`; documentação em `README.md` e `docs/`. |
| 14 | Processo de implantação descrito | Atendido | [IMPLANTACAO.md](IMPLANTACAO.md): Docker + Caddy (HTTPS), plataformas com disco persistente, systemd, variáveis, backups, atualização e problemas comuns. |

## Dependências externas (etapas separadas)

Nada abaixo impede o uso do sistema; enquanto não forem concluídas, o WhatsApp fica em modo demonstração.

1. Conta Meta Business, app com WhatsApp e número remetente verificado.
2. Token permanente, chave secreta do app e token de verificação nas variáveis do servidor.
3. Os 9 templates criados e **aprovados** pela Meta (texto pronto em [WHATSAPP.md](WHATSAPP.md)).
4. Hospedagem com HTTPS, domínio e disco persistente.
5. Consentimento registrado do Supervisor Técnico e do Coordenador de Operações.
