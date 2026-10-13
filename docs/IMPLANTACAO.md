# Implantação

O ASTRAL Smart Agenda é **um único processo Node.js 22** que serve o aplicativo (PWA), a API, o agendador de notificações e o webhook do WhatsApp. Não há dependências em produção: o pacote compilado (`dist/`) roda com `node dist/server.mjs`.

Requisitos mínimos:

- **Node.js 22.18 ou mais novo** (usa o SQLite embutido do Node e TypeScript nativo nos testes).
- **Disco persistente** para a pasta de dados (banco, anexos e cópias de segurança). Sem disco persistente, os dados somem a cada reinício.
- **HTTPS** com domínio próprio — exigido para instalar o app no celular e para o webhook da Meta.
- Processo **sempre ligado** (não usar hospedagem "serverless" que dorme): o agendador precisa rodar a cada minuto para os avisos saírem com o navegador fechado.

Uma VPS pequena (1 vCPU, 1 GB de RAM) atende com folga dois a dez usuários.

---

## Opção A — VPS com Docker (recomendada)

Inclui HTTPS automático com Caddy (Let's Encrypt).

```bash
# no servidor (Ubuntu/Debian com Docker instalado)
git clone <repositório> astral-smart-agenda   # ou envie a pasta do projeto
cd astral-smart-agenda
cp .env.example .env
nano .env            # APP_URL=https://agenda.seudominio.com.br, senhas iniciais, segredos
nano Caddyfile       # troque agenda.seudominio.com.br pelo seu domínio
docker compose up -d --build
docker compose logs -f app
```

1. No provedor do domínio, crie um registro **A** apontando `agenda.seudominio.com.br` para o IP da VPS **antes** de subir (o Caddy precisa dele para emitir o certificado).
2. Libere as portas 80 e 443 no firewall.
3. O build da imagem roda os testes automatizados; se algum falhar, a imagem não é criada.
4. Os dados ficam no volume Docker `astral-data` (`/data` dentro do contêiner).

Atualizar para uma nova versão: `git pull && docker compose up -d --build`. As migrações do banco rodam sozinhas na inicialização e nunca apagam dados.

## Opção B — Plataforma com disco persistente (Render, Railway, Fly.io e similares)

Use o `Dockerfile` do projeto e configure na plataforma:

| Configuração | Valor |
|---|---|
| Tipo de serviço | Web service (sempre ligado) com **disco/volume persistente** montado em `/data` |
| Porta | `3000` (ou a variável `PORT` que a plataforma define) |
| Health check | `GET /api/health` |
| Variáveis | as do `.env.example`, com `DATABASE_PATH=/data/astral.db`, `ATTACHMENTS_DIR=/data/anexos`, `BACKUP_DIR=/data/backups`, `TRUST_PROXY=1` |
| Domínio | domínio próprio com HTTPS (a plataforma emite o certificado) |

Não use o plano gratuito que "hiberna" o serviço: com o processo dormindo, os lembretes atrasam. Se a plataforma não oferecer processo sempre ligado, desligue o agendador interno (`DISABLE_SCHEDULER=1`) e configure um agendador externo chamando a cada minuto:

```bash
curl -X POST https://agenda.seudominio.com.br/api/cron/tick -H "Authorization: Bearer $CRON_SECRET"
```

## Opção C — Servidor sem Docker (systemd)

```bash
# Node.js 22 instalado; usuário "astral" sem privilégios
sudo mkdir -p /opt/astral /var/lib/astral && sudo chown astral: /opt/astral /var/lib/astral
# copie o projeto para /opt/astral (o pacote já traz dist/ compilado)
cd /opt/astral && cp .env.example .env && nano .env
#   DATABASE_PATH=/var/lib/astral/astral.db
#   ATTACHMENTS_DIR=/var/lib/astral/anexos
#   BACKUP_DIR=/var/lib/astral/backups
```

`/etc/systemd/system/astral.service`:

```ini
[Unit]
Description=ASTRAL Smart Agenda
After=network.target

[Service]
User=astral
WorkingDirectory=/opt/astral
EnvironmentFile=/opt/astral/.env
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning dist/server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now astral
journalctl -u astral -f
```

Coloque um proxy reverso com HTTPS na frente (Caddy: `reverse_proxy 127.0.0.1:3000`) e use `TRUST_PROXY=1`.

Para recompilar a partir do código-fonte (só se alterar o sistema): `npm install && npm run build && npm test`.

---

## Primeiro acesso

1. Na primeira inicialização o sistema cria as contas do **Supervisor Técnico** (administrador) e do **Coordenador de Operações**, os modelos de checklist, os templates do WhatsApp e os **10 compromissos reais de 2026**.
2. O login do administrador é `supervisao.snp@grupoastral.com.br` (mude com `SUPERVISOR_EMAIL`); o do coordenador vem de `COORDINATOR_EMAIL`. Depois, o administrador pode trocar o e-mail de qualquer pessoa em *Usuários → Editar*.
3. As senhas iniciais vêm de `SUPERVISOR_INITIAL_PASSWORD` e `COORDINATOR_INITIAL_PASSWORD`. Se ficarem em branco, o sistema gera senhas fortes e grava em `data/credenciais-iniciais.txt` — **apague o arquivo depois de usar**.
4. A troca de senha é obrigatória no primeiro login.
5. Em *Configurações → Meu perfil*, cada pessoa informa o WhatsApp e dá o consentimento. O administrador pode cadastrar outros números em *WhatsApp → Destinatários*.
6. Conecte o WhatsApp seguindo [WHATSAPP.md](WHATSAPP.md). Até lá, tudo funciona em modo demonstração.

## Variáveis de ambiente

| Variável | Padrão | Para que serve |
|---|---|---|
| `NODE_ENV` | — | `production` ativa HSTS e cookie seguro |
| `PORT` | `3000` | Porta HTTP |
| `APP_URL` | `http://localhost:3000` | Endereço público (links das mensagens e do webhook) |
| `TRUST_PROXY` | — | `1` atrás de proxy reverso (IP real do cliente, host e protocolo) |
| `DATABASE_PATH` | `./data/astral.db` | Banco SQLite (disco persistente) |
| `ATTACHMENTS_DIR` | `./data/anexos` | Fotos e documentos anexados (disco persistente) |
| `BACKUP_DIR` | `<pasta do banco>/backups` | Cópias de segurança |
| `BACKUP_KEEP` | `14` | Quantas cópias diárias manter |
| `DISABLE_BACKUP` | — | `1` desliga a cópia diária |
| `APP_TIMEZONE` | `America/Cuiaba` | Fuso padrão do sistema e dos avisos |
| `SUPERVISOR_*`, `COORDINATOR_*` | — | Contas criadas na primeira inicialização |
| `SCHEDULER_INTERVAL_MS` | `60000` | Intervalo do agendador |
| `DISABLE_SCHEDULER` | — | `1` só quando um agendador externo chama `/api/cron/tick` |
| `CRON_SECRET` | — | Segredo do agendador externo |
| `LINK_SIGNING_SECRET` | gerado e guardado no banco | Assina os botões de presença (pode definir um valor próprio) |
| `WHATSAPP_*` | — | Credenciais da Cloud API ([WHATSAPP.md](WHATSAPP.md)) |

## Cópias de segurança

- **Automática:** todos os dias a partir das 03:00 o servidor grava `astral-diario-AAAAMMDD.db` em `BACKUP_DIR` e mantém as `BACKUP_KEEP` mais recentes.
- **Manual:** *Configurações → App e aparência → Cópias de segurança → Gerar cópia agora* (e baixar), ou no servidor `npm run backup -- /caminho/copia.db` (pode rodar com o sistema no ar).
- Copie também a pasta de **anexos** (`ATTACHMENTS_DIR`).
- **Restaurar:** pare o sistema, substitua o arquivo do banco pela cópia (e a pasta de anexos, se for o caso) e inicie de novo.
- Guarde cópias **fora do servidor** (ex.: semanalmente no Google Drive da empresa).

## Segurança aplicada

- Senhas com scrypt; sessão por token aleatório guardado só como hash; cookie `HttpOnly`, `SameSite=Lax` e `Secure` em HTTPS.
- Bloqueio de 15 minutos após 5 tentativas de login erradas.
- Toda alteração exige cabeçalho próprio e mesma origem (proteção CSRF).
- Autorização no servidor em todas as rotas (perfil + permissões extras + visibilidade de compromissos privados).
- Credenciais do WhatsApp só em variáveis de ambiente; assinatura dos webhooks validada.
- Anexos fora da pasta pública, com nome aleatório, tipos permitidos e download só com sessão.
- Trilha de auditoria de logins, usuários, consentimentos, configurações e envios; histórico completo de cada compromisso.
- Cabeçalhos de segurança (CSP, HSTS em produção, X-Frame-Options, nosniff).

## Monitoramento

- `GET /api/health` — usado pelo health check do Docker/plataforma.
- *WhatsApp → Visão geral* mostra a última execução do agendador e os avisos por status.
- Logs do processo: `docker compose logs -f app` ou `journalctl -u astral -f`.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Dados somem após reiniciar | Pasta de dados fora de um disco persistente |
| Não aparece "Instalar app" | Site sem HTTPS ou aberto por IP |
| Lembretes atrasados | Serviço hibernando — use processo sempre ligado ou agendador externo |
| Webhook não verifica | `WHATSAPP_VERIFY_TOKEN` diferente do informado na Meta, ou `APP_URL` sem HTTPS |
| "Requisição bloqueada (origem não confirmada)" | Proxy reescrevendo o host — defina `TRUST_PROXY=1` |
