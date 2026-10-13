// Administração do WhatsApp (Cloud API oficial da Meta): remetente, destinatários e consentimento,
// preferências, templates, envio de teste, fila, logs e webhooks. Modo demonstração sempre identificado.
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  LuCircleCheck,
  LuCircleDashed,
  LuCopy,
  LuKeyRound,
  LuListChecks,
  LuMessageCircle,
  LuPhone,
  LuPlay,
  LuPlus,
  LuRefreshCw,
  LuRotateCcw,
  LuBan,
  LuScrollText,
  LuSend,
  LuSettings2,
  LuShieldCheck,
  LuTrash2,
  LuTriangleAlert,
  LuUserCheck,
  LuUserX,
  LuWebhook,
  LuInbox,
  LuServer,
} from 'react-icons/lu';
import { api } from '../lib/api.ts';
import { useApi } from '../lib/hooks.ts';
import { useRouter } from '../lib/router.tsx';
import { cn, fmtDateTime } from '../lib/util.ts';
import { PageHeader } from '../components/Layout.tsx';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, IconButton, Input, Modal, Select, Skeleton, Switch, Tabs, Textarea, useFeedback } from '../components/ui.tsx';
import { CONSENT_STATUSES, NOTIFICATION_STATUSES } from '../../shared/constants.ts';
import type { NotificationStatus, NotificationType } from '../../shared/constants.ts';
import type { NotificationRow, Recipient, RecipientPreferences } from '../../shared/types.ts';

type Tab = 'visao' | 'remetente' | 'destinatarios' | 'templates' | 'fila' | 'logs';

interface Status {
  config: { mode: 'demo' | 'live'; displayNumber: string; phoneNumberId: string; businessAccountId: string; graphVersion: string; businessName: string };
  credentials: { accessToken: boolean; appSecret: boolean; verifyToken: boolean; phoneNumberId: boolean; businessAccountId: boolean; readyForLive: boolean; effectiveMode: 'demo' | 'live' };
  webhookUrl: string;
  counts: Record<string, number>;
  lastTick: { at: string; plan?: { created: number }; dispatch?: { processed: number; sent: number; demo: number; failed: number; retried: number; uncertain: number; cancelled: number }; error?: string } | null;
  consentText: string;
  notificationTypes: Record<NotificationType, { label: string; description: string }>;
  configurableTypes: NotificationType[];
}

type Rec = Recipient & { phoneFormatted: string };

interface Template {
  type: NotificationType;
  name: string;
  language: string;
  category: string;
  body: string;
  variables: string[];
  buttons: Array<{ type: 'URL'; text: string; url: string } | { type: 'QUICK_REPLY'; text: string }>;
  status: string;
  label: string;
}

type Notif = NotificationRow & { recipient_name?: string; recipient_phone?: string; event_title?: string };

const TPL_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted' | 'info' }> = {
  nao_submetido: { label: 'Não submetido', tone: 'muted' },
  pendente: { label: 'Em análise na Meta', tone: 'info' },
  aprovado: { label: 'Aprovado', tone: 'ok' },
  rejeitado: { label: 'Rejeitado', tone: 'danger' },
  pausado: { label: 'Pausado', tone: 'warn' },
};

export function WhatsAppPage() {
  const { loc, navigate } = useRouter();
  const tab = ((['visao', 'remetente', 'destinatarios', 'templates', 'fila', 'logs'] as Tab[]).find((t) => t === loc.search.get('aba')) ?? 'visao') as Tab;
  const status = useApi<Status>('/api/whatsapp/status');
  const setTab = (t: Tab) => navigate(`/whatsapp?aba=${t}`, { replace: true });
  if (status.loading && !status.data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-28 w-full rounded-card" />
        <Skeleton className="h-96 w-full rounded-card" />
      </div>
    );
  if (status.error && !status.data) return <ErrorState error={status.error} onRetry={status.reload} />;
  if (!status.data) return null;
  const s = status.data;
  const demo = s.credentials.effectiveMode === 'demo';

  return (
    <div>
      <PageHeader title="WhatsApp" subtitle="Notificações pela WhatsApp Business Platform — Cloud API oficial da Meta." />
      <div className={cn('mb-5 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between', demo ? 'border-[#F7DDA0] bg-soft-amber dark:border-[#5A4413]' : 'border-[#BDE9D3] bg-soft-emerald dark:border-[#1D5A44]')}>
        <div className="flex items-start gap-3">
          <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-2xl', demo ? 'bg-amber/20 text-[#8A5300] dark:text-amber' : 'bg-emerald/15 text-emerald')}>{demo ? <LuTriangleAlert className="size-5" /> : <LuShieldCheck className="size-5" />}</span>
          <div>
            <div className={cn('text-[15px] font-semibold', demo ? 'text-[#7A4A00] dark:text-amber' : 'text-forest dark:text-mint')}>{demo ? 'MODO DEMONSTRAÇÃO — nenhuma mensagem é enviada' : 'Conectado à Cloud API — envio real ativo'}</div>
            <p className="mt-0.5 text-[13px] text-ink-2">
              {demo
                ? 'A fila, os templates e as regras funcionam normalmente; cada aviso é montado e registrado como "Demonstração — NÃO enviado". Nunca é marcado como enviado.'
                : `Remetente ${s.config.displayNumber || s.config.phoneNumberId} · API ${s.config.graphVersion}. Os status de entrega chegam pelo webhook.`}
            </p>
          </div>
        </div>
        {demo && (
          <Button variant="secondary" size="sm" onClick={() => setTab('remetente')}>
            Configurar conexão
          </Button>
        )}
      </div>
      <div className="mb-4">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'visao', label: 'Visão geral', icon: <LuMessageCircle className="size-4" /> },
            { key: 'remetente', label: 'Número remetente', icon: <LuPhone className="size-4" /> },
            { key: 'destinatarios', label: 'Destinatários', icon: <LuUserCheck className="size-4" /> },
            { key: 'templates', label: 'Templates', icon: <LuListChecks className="size-4" /> },
            { key: 'fila', label: 'Fila de avisos', count: s.counts.pendente ?? 0, icon: <LuInbox className="size-4" /> },
            { key: 'logs', label: 'Logs e webhooks', icon: <LuScrollText className="size-4" /> },
          ]}
        />
      </div>
      {tab === 'visao' && <Overview s={s} reload={status.reload} goTab={setTab} />}
      {tab === 'remetente' && <SenderTab s={s} reload={status.reload} />}
      {tab === 'destinatarios' && <RecipientsTab s={s} />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'fila' && <QueueTab reloadStatus={status.reload} />}
      {tab === 'logs' && <LogsTab />}
    </div>
  );
}

// ------------------------------------------------------------------ visão geral

function Step({ ok, title, text, action }: { ok: boolean; title: string; text: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-3">
      {ok ? <LuCircleCheck className="mt-0.5 size-5 shrink-0 text-emerald" /> : <LuCircleDashed className="mt-0.5 size-5 shrink-0 text-muted" />}
      <div className="min-w-0 flex-1">
        <div className={cn('text-[14px] font-medium', ok ? 'text-ink' : 'text-ink-2')}>{title}</div>
        <div className="mt-0.5 text-[12.5px] text-muted">{text}</div>
      </div>
      {action}
    </li>
  );
}

function Overview({ s, reload, goTab }: { s: Status; reload: () => void; goTab: (t: Tab) => void }) {
  const { toast } = useFeedback();
  const [running, setRunning] = useState(false);
  const recs = useApi<{ recipients: Rec[] }>('/api/whatsapp/recipients');
  const tpls = useApi<{ templates: Template[] }>('/api/whatsapp/templates');
  const consented = recs.data?.recipients.filter((r) => r.consent_status === 'concedido' && r.active).length ?? 0;
  const approved = tpls.data?.templates.filter((t) => t.type !== 'teste' && t.status === 'aprovado').length ?? 0;
  const totalTpl = tpls.data?.templates.filter((t) => t.type !== 'teste').length ?? 0;
  const c = s.credentials;
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast('ok', 'Copiado');
    } catch {
      toast('error', 'Não foi possível copiar');
    }
  };
  const runNow = async () => {
    setRunning(true);
    try {
      const r = await api.post<{ plan?: { created: number }; dispatch?: { processed: number } ; skipped?: boolean; error?: string }>('/api/whatsapp/run-now');
      if (r.error) toast('error', r.error);
      else if (r.skipped) toast('info', 'O agendador já estava em execução.');
      else toast('ok', `Agendador executado: ${r.plan?.created ?? 0} aviso(s) novo(s), ${r.dispatch?.processed ?? 0} processado(s).`);
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setRunning(false);
    }
  };
  const order: NotificationStatus[] = ['pendente', 'enviado', 'entregue', 'lido', 'falhou', 'incerto', 'demonstracao', 'cancelado'];
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <Card>
        <CardHeader title="Configuração da conexão" subtitle="Etapas para enviar mensagens reais. As credenciais ficam somente no servidor." icon={<LuKeyRound className="size-[18px]" />} />
        <ul className="divide-y divide-line px-5 pb-2">
          <Step ok={c.accessToken} title="Token de acesso (WHATSAPP_ACCESS_TOKEN)" text="Token permanente de usuário do sistema, gerado no Meta Business. Cadastrado como variável de ambiente." />
          <Step ok={c.appSecret} title="Chave secreta do app (WHATSAPP_APP_SECRET)" text="Usada para validar a assinatura de cada webhook recebido." />
          <Step ok={c.verifyToken} title="Token de verificação do webhook (WHATSAPP_VERIFY_TOKEN)" text="Texto livre que você também informa no painel da Meta ao registrar o webhook." />
          <Step ok={c.phoneNumberId} title="ID do número remetente (Phone Number ID)" text={s.config.phoneNumberId ? `Configurado: ${s.config.phoneNumberId}` : 'Informe na aba Número remetente ou por variável de ambiente.'} action={!c.phoneNumberId ? <Button size="sm" variant="secondary" onClick={() => goTab('remetente')}>Informar</Button> : undefined} />
          <Step ok={c.businessAccountId} title="ID da conta WhatsApp Business (WABA)" text="Necessário para sincronizar o status de aprovação dos templates." />
          <Step ok={totalTpl > 0 && approved === totalTpl} title="Templates aprovados pela Meta" text={`${approved} de ${totalTpl} aprovados. Mensagens automáticas só podem usar templates aprovados.`} action={<Button size="sm" variant="secondary" onClick={() => goTab('templates')}>Ver</Button>} />
          <Step ok={consented > 0} title="Destinatários com consentimento" text={`${consented} número(s) com consentimento registrado e ativo.`} action={<Button size="sm" variant="secondary" onClick={() => goTab('destinatarios')}>Gerenciar</Button>} />
          <Step
            ok={c.verifyToken && c.appSecret}
            title="Webhook registrado na Meta"
            text={
              <span className="break-all">
                URL de retorno: <span className="num font-medium text-ink-2">{s.webhookUrl}</span> — assine os campos <em>messages</em>.
              </span>
            }
            action={
              <IconButton label="Copiar URL do webhook" onClick={() => void copy(s.webhookUrl)}>
                <LuCopy className="size-4" />
              </IconButton>
            }
          />
        </ul>
      </Card>
      <div className="space-y-5">
        <Card>
          <CardHeader title="Avisos por status" icon={<LuInbox className="size-[18px]" />} action={<Button size="sm" variant="ghost" onClick={() => goTab('fila')}>Abrir fila</Button>} />
          <div className="grid grid-cols-2 gap-2 px-5 pb-5">
            {order.map((k) => (
              <div key={k} className="rounded-xl border border-line px-3 py-2.5">
                <div className="num text-[20px] leading-none font-semibold text-ink">{s.counts[k] ?? 0}</div>
                <div className="mt-1 text-[12px] text-muted">{NOTIFICATION_STATUSES[k].label}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Agendador no servidor" subtitle="Roda a cada minuto, com o navegador fechado." icon={<LuServer className="size-[18px]" />} />
          <div className="space-y-3 px-5 pb-5 text-[13px] text-ink-2">
            {s.lastTick ? (
              <>
                <p>
                  Última execução: <span className="num font-medium text-ink">{fmtDateTime(s.lastTick.at)}</span>
                </p>
                {s.lastTick.error ? (
                  <p className="rounded-lg bg-soft-alert px-3 py-2 text-[#A12828] dark:text-[#F19B9B]">Erro: {s.lastTick.error}</p>
                ) : (
                  <p className="num text-muted">
                    {s.lastTick.plan?.created ?? 0} novo(s) na fila · {s.lastTick.dispatch?.processed ?? 0} processado(s) · {s.lastTick.dispatch?.sent ?? 0} enviado(s) · {s.lastTick.dispatch?.demo ?? 0} demonstração
                  </p>
                )}
              </>
            ) : (
              <p className="text-muted">Ainda não executou desde que o servidor iniciou.</p>
            )}
            <Button variant="secondary" icon={<LuPlay className="size-4" />} loading={running} onClick={() => void runNow()}>
              Executar agora
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ remetente

function SenderTab({ s, reload }: { s: Status; reload: () => void }) {
  const { toast, confirm } = useFeedback();
  const [f, setF] = useState(s.config);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (f.mode === 'live' && s.config.mode !== 'live') {
      const ok = await confirm({
        title: 'Ativar envio real?',
        message: 'A partir de agora os avisos da fila serão enviados pela Cloud API para os destinatários com consentimento. Conversas iniciadas pela empresa podem gerar cobrança da Meta conforme a tabela vigente.',
        confirmLabel: 'Ativar envio real',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await api.patch('/api/whatsapp/config', f);
      toast('ok', 'Configuração salva');
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const c = s.credentials;
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-ink">Número remetente comercial</h2>
        <p className="mt-0.5 text-[13px] text-muted">Os IDs ficam no painel do WhatsApp Manager / Meta for Developers → WhatsApp → Configuração da API.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Modo de operação" hint={!c.readyForLive ? 'Envio real exige token, chave secreta e ID do número no servidor.' : undefined}>
            <Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as 'demo' | 'live' })}>
              <option value="demo">Demonstração (não envia)</option>
              <option value="live" disabled={!c.readyForLive && s.config.mode !== 'live'}>
                Envio real pela Cloud API
              </option>
            </Select>
          </Field>
          <Field label="Nome da empresa">
            <Input value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} />
          </Field>
          <Field label="Número exibido" hint="Só para referência na tela (ex.: +55 66 3000-0000).">
            <Input value={f.displayNumber} onChange={(e) => setF({ ...f, displayNumber: e.target.value })} />
          </Field>
          <Field label="Versão da Graph API" hint="Formato vNN.N">
            <Input value={f.graphVersion} onChange={(e) => setF({ ...f, graphVersion: e.target.value })} />
          </Field>
          <Field label="Phone Number ID">
            <Input inputMode="numeric" value={f.phoneNumberId} onChange={(e) => setF({ ...f, phoneNumberId: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field label="WhatsApp Business Account ID (WABA)">
            <Input inputMode="numeric" value={f.businessAccountId} onChange={(e) => setF({ ...f, businessAccountId: e.target.value.replace(/\D/g, '') })} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={() => void save()} loading={busy}>
            Salvar
          </Button>
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-ink">Credenciais protegidas</h2>
        <p className="mt-0.5 text-[13px] text-muted">Por segurança, token e chave secreta nunca passam pelo navegador: são lidos das variáveis de ambiente do servidor.</p>
        <ul className="mt-3 space-y-2 text-[13px]">
          {(
            [
              ['WHATSAPP_ACCESS_TOKEN', c.accessToken],
              ['WHATSAPP_APP_SECRET', c.appSecret],
              ['WHATSAPP_VERIFY_TOKEN', c.verifyToken],
            ] as Array<[string, boolean]>
          ).map(([k, ok]) => (
            <li key={k} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
              <span className="num truncate text-ink-2">{k}</span>
              <Badge tone={ok ? 'ok' : 'muted'}>{ok ? 'configurado' : 'ausente'}</Badge>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12.5px] text-muted">Depois de cadastrar as variáveis na hospedagem, reinicie o servidor. O passo a passo completo está em docs/WHATSAPP.md.</p>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ destinatários

function RecipientsTab({ s }: { s: Status }) {
  const { data, error, loading, reload } = useApi<{ recipients: Rec[]; users: Array<{ id: number; name: string; role: string }> }>('/api/whatsapp/recipients');
  const { toast, confirm } = useFeedback();
  const [adding, setAdding] = useState(false);
  const [prefsFor, setPrefsFor] = useState<Rec | null>(null);
  const [consentFor, setConsentFor] = useState<Rec | null>(null);
  const [busyTest, setBusyTest] = useState<number | null>(null);
  if (loading && !data) return <Skeleton className="h-80 w-full rounded-card" />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  const test = async (r: Rec) => {
    setBusyTest(r.id);
    try {
      const res = await api.post<{ notification: Notif }>('/api/whatsapp/test', { recipientId: r.id });
      const st = res.notification.status;
      if (st === 'demonstracao') toast('info', 'Modo demonstração: a mensagem de teste foi montada e registrada, mas NÃO foi enviada.');
      else if (st === 'enviado') toast('ok', 'Mensagem aceita pela Meta. Acompanhe a entrega na fila.');
      else toast('error', `Teste não enviado: ${res.notification.last_error ?? NOTIFICATION_STATUSES[st].label}`);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusyTest(null);
    }
  };
  const toggleActive = async (r: Rec) => {
    try {
      await api.patch(`/api/whatsapp/recipients/${r.id}`, { active: !r.active });
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const revoke = async (r: Rec) => {
    if (!(await confirm({ title: 'Revogar consentimento?', message: `${r.name} deixará de receber avisos. Avisos na fila para este número serão cancelados.`, confirmLabel: 'Revogar', tone: 'danger' }))) return;
    try {
      await api.post(`/api/whatsapp/recipients/${r.id}/consent`, { status: 'revogado', method: 'Revogado pelo administrador no sistema' });
      toast('ok', 'Consentimento revogado');
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const remove = async (r: Rec) => {
    if (!(await confirm({ title: 'Remover destinatário?', message: `O número de ${r.name} e o histórico de avisos dele serão removidos.`, confirmLabel: 'Remover', tone: 'danger' }))) return;
    try {
      await api.del(`/api/whatsapp/recipients/${r.id}`);
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">Só recebem avisos os números com consentimento registrado. Cada pessoa escolhe quais avisos recebe.</p>
        <Button icon={<LuPlus className="size-4" />} onClick={() => setAdding(true)}>
          Cadastrar número
        </Button>
      </div>
      {data.recipients.length === 0 ? (
        <Card>
          <EmptyState icon={<LuPhone className="size-5" />} title="Nenhum número cadastrado" text="Cadastre o WhatsApp do Supervisor Técnico e do Coordenador de Operações para receberem os avisos." action={<Button onClick={() => setAdding(true)}>Cadastrar número</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.recipients.map((r) => {
            const enabled = s.configurableTypes.filter((t) => r.preferences.types[t] !== false).length;
            return (
              <Card key={r.id} className={cn('p-5', !r.active && 'opacity-70')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold text-ink">{r.name}</div>
                    <div className="num text-[13.5px] text-ink-2">{r.phoneFormatted}</div>
                    <div className="mt-0.5 text-[12.5px] text-muted">{r.user_name ? `Usuário: ${r.user_name}` : 'Sem usuário vinculado'}</div>
                  </div>
                  <Badge tone={r.consent_status === 'concedido' ? 'ok' : r.consent_status === 'revogado' ? 'danger' : 'warn'}>{CONSENT_STATUSES[r.consent_status]}</Badge>
                </div>
                {r.consent_at && (
                  <p className="mt-2 text-[12px] text-muted">
                    {r.consent_status === 'concedido' ? 'Consentimento' : 'Atualizado'} em {fmtDateTime(r.consent_at)}
                    {r.consent_method ? ` — ${r.consent_method}` : ''}
                  </p>
                )}
                <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-[12.5px] text-ink-2">
                  <span className="num">{enabled}</span> de {s.configurableTypes.length} tipos de aviso ligados · {r.preferences.scope === 'todos' ? 'todos os compromissos' : 'só compromissos em que está envolvido'} · véspera às <span className="num">{r.preferences.eveTime}</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {r.consent_status !== 'concedido' ? (
                    <Button size="sm" icon={<LuUserCheck className="size-3.5" />} onClick={() => setConsentFor(r)}>
                      Registrar consentimento
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" icon={<LuSend className="size-3.5" />} loading={busyTest === r.id} disabled={!r.active} onClick={() => void test(r)}>
                      Enviar teste
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" icon={<LuSettings2 className="size-3.5" />} onClick={() => setPrefsFor(r)}>
                    Preferências
                  </Button>
                  {r.consent_status === 'concedido' && (
                    <Button size="sm" variant="ghost" icon={<LuUserX className="size-3.5" />} onClick={() => void revoke(r)}>
                      Revogar
                    </Button>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <Switch checked={r.active} onChange={() => void toggleActive(r)} label={<span className="text-[12.5px] text-muted">{r.active ? 'Ativo' : 'Pausado'}</span>} />
                    <IconButton label="Remover destinatário" onClick={() => void remove(r)}>
                      <LuTrash2 className="size-4" />
                    </IconButton>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <AddRecipient open={adding} onClose={() => setAdding(false)} users={data.users} taken={data.recipients.map((r) => r.user_id).filter(Boolean) as number[]} onDone={reload} />
      {prefsFor && <PrefsModal r={prefsFor} s={s} onClose={() => setPrefsFor(null)} onDone={reload} />}
      {consentFor && <ConsentModal r={consentFor} text={s.consentText} onClose={() => setConsentFor(null)} onDone={reload} />}
    </div>
  );
}

function AddRecipient({ open, onClose, users, taken, onDone }: { open: boolean; onClose: () => void; users: Array<{ id: number; name: string }>; taken: number[]; onDone: () => void }) {
  const { toast } = useFeedback();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [userId, setUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post('/api/whatsapp/recipients', { name: name.trim(), phone, user_id: userId ? Number(userId) : null });
      toast('ok', 'Número cadastrado. Registre o consentimento antes do primeiro aviso.');
      setName('');
      setPhone('');
      setUserId('');
      onClose();
      onDone();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cadastrar número de WhatsApp"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={name.trim().length < 2 || phone.replace(/\D/g, '').length < 10}>
            Cadastrar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Usuário do sistema (recomendado)" hint="Vincular permite avisos só dos compromissos em que a pessoa está envolvida e confirmação de presença pelo WhatsApp.">
          <Select
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              const u = users.find((x) => String(x.id) === e.target.value);
              if (u && !name) setName(u.name);
            }}
          >
            <option value="">Sem vínculo</option>
            {users.map((u) => (
              <option key={u.id} value={u.id} disabled={taken.includes(u.id)}>
                {u.name}
                {taken.includes(u.id) ? ' (já cadastrado)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nome">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="WhatsApp" hint="DDD + número, ex.: (66) 99999-9999. Números de outros países: formato internacional.">
          <Input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(66) 99999-9999" />
        </Field>
      </div>
    </Modal>
  );
}

function ConsentModal({ r, text, onClose, onDone }: { r: Rec; text: string; onClose: () => void; onDone: () => void }) {
  const { toast } = useFeedback();
  const [method, setMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/api/whatsapp/recipients/${r.id}/consent`, { status: 'concedido', method: method.trim() });
      toast('ok', 'Consentimento registrado');
      onClose();
      onDone();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Consentimento de ${r.name}`}
      description="Registro exigido pela política da Meta e pela LGPD antes de enviar mensagens iniciadas pela empresa."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={method.trim().length < 5}>
            Registrar consentimento
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-[13.5px] leading-relaxed text-ink-2">“{text}”</div>
        <Field label="Como o consentimento foi obtido" hint="Ex.: aceite por e-mail em 13/10/2026; termo assinado; aceite verbal registrado em reunião. Fica gravado na trilha de auditoria.">
          <Textarea value={method} onChange={(e) => setMethod(e.target.value)} className="min-h-[72px]" />
        </Field>
        <p className="text-[12.5px] text-muted">Cada pessoa também pode dar ou revogar o próprio consentimento em Configurações → Meu perfil, ou respondendo PARAR no WhatsApp.</p>
      </div>
    </Modal>
  );
}

function PrefsModal({ r, s, onClose, onDone }: { r: Rec; s: Status; onClose: () => void; onDone: () => void }) {
  const { toast } = useFeedback();
  const [p, setP] = useState<RecipientPreferences>(r.preferences);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/whatsapp/recipients/${r.id}`, { preferences: p });
      toast('ok', 'Preferências salvas');
      onClose();
      onDone();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const times: Array<[keyof RecipientPreferences, string]> = [
    ['advanceTime', 'Horário do aviso antecipado'],
    ['eveTime', 'Horário do lembrete na véspera'],
    ['dayOfTime', 'Horário do lembrete no dia'],
    ['weeklyTime', 'Horário do resumo de segunda-feira'],
  ];
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Preferências de ${r.name}`}
      description="Horários no fuso America/Cuiaba."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            Salvar preferências
          </Button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-1 text-[13.5px] font-semibold text-ink">Avisos que recebe</h3>
          <div className="divide-y divide-line">
            {s.configurableTypes.map((t) => (
              <Switch key={t} checked={p.types[t] !== false} onChange={(v) => setP({ ...p, types: { ...p.types, [t]: v } })} label={s.notificationTypes[t].label} description={s.notificationTypes[t].description} />
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <Field label="Quais compromissos" hint="Alterações e cancelamentos seguem esta mesma regra.">
            <Select value={p.scope} onChange={(e) => setP({ ...p, scope: e.target.value as RecipientPreferences['scope'] })}>
              <option value="todos">Todos os compromissos compartilhados</option>
              <option value="envolvidos">Só os que tenho como responsável ou participante</option>
            </Select>
          </Field>
          <Field label="Aviso antecipado">
            <Select value={p.advanceDays} onChange={(e) => setP({ ...p, advanceDays: Number(e.target.value) })}>
              {[2, 3, 4, 5, 7, 10, 14].map((n) => (
                <option key={n} value={n}>
                  {n} dias antes
                </option>
              ))}
            </Select>
          </Field>
          {times.map(([k, label]) => (
            <Field key={k} label={label}>
              <Input type="time" value={String(p[k])} onChange={(e) => setP({ ...p, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ templates

function TemplatesTab() {
  const { data, error, loading, reload } = useApi<{ templates: Template[] }>('/api/whatsapp/templates');
  const { toast } = useFeedback();
  const [syncing, setSyncing] = useState(false);
  const [edit, setEdit] = useState<Template | null>(null);
  if (loading && !data) return <Skeleton className="h-96 w-full rounded-card" />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api.post<{ updated: number; remote: number }>('/api/whatsapp/templates/sync');
      toast('ok', `${r.updated} template(s) atualizados a partir de ${r.remote} encontrados na Meta.`);
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setSyncing(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
        <p className="max-w-3xl text-[13px] text-ink-2">
          Mensagens iniciadas pela empresa só podem usar <strong>templates aprovados</strong>. Crie cada template no WhatsApp Manager com o mesmo nome, idioma <span className="num">pt_BR</span>, categoria <strong>Utilidade</strong> e o texto abaixo; depois sincronize para atualizar o status.
        </p>
        <Button variant="secondary" icon={<LuRefreshCw className="size-4" />} loading={syncing} onClick={() => void sync()}>
          Sincronizar com a Meta
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.templates.map((t) => {
          const st = TPL_STATUS[t.status] ?? TPL_STATUS.nao_submetido;
          return (
            <Card key={t.type} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[14.5px] font-semibold text-ink">{t.label}</div>
                  <div className="num mt-0.5 truncate text-[12.5px] text-muted">
                    {t.name} · {t.language} · {t.category}
                  </div>
                </div>
                <Badge tone={st.tone}>{st.label}</Badge>
              </div>
              <pre className="mt-3 flex-1 rounded-xl bg-surface-2 p-3 font-sans text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-2">{t.body}</pre>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[12px] text-muted">
                {t.variables.map((v, i) => (
                  <span key={v} className="num rounded-md border border-line px-1.5 py-0.5">
                    {`{{${i + 1}}}`} {v}
                  </span>
                ))}
              </div>
              {t.buttons.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {t.buttons.map((b) => (
                    <span key={b.text} className="rounded-lg bg-soft-emerald px-2 py-1 text-[12px] font-medium text-forest dark:text-mint">
                      {b.type === 'URL' ? '🔗' : '↩'} {b.text}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-3 flex justify-end">
                <Button size="sm" variant="ghost" onClick={() => setEdit(t)}>
                  Editar nome ou status
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
      {edit && <TemplateModal t={edit} onClose={() => setEdit(null)} onDone={reload} />}
    </div>
  );
}

function TemplateModal({ t, onClose, onDone }: { t: Template; onClose: () => void; onDone: () => void }) {
  const { toast } = useFeedback();
  const [name, setName] = useState(t.name);
  const [language, setLanguage] = useState(t.language);
  const [status, setStatus] = useState(t.status);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/whatsapp/templates/${t.type}`, { name, language, status });
      toast('ok', 'Template atualizado');
      onClose();
      onDone();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t.label}
      description="Use o mesmo nome e idioma cadastrados no WhatsApp Manager. O ideal é atualizar o status pela sincronização."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome do template" className="sm:col-span-2">
          <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} />
        </Field>
        <Field label="Idioma">
          <Input value={language} onChange={(e) => setLanguage(e.target.value)} />
        </Field>
        <Field label="Status de aprovação">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(TPL_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ fila

function QueueTab({ reloadStatus }: { reloadStatus: () => void }) {
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useApi<{ notifications: Notif[] }>(`/api/whatsapp/notifications?limit=200${status ? `&status=${status}` : ''}`);
  const { toast } = useFeedback();
  const [logFor, setLogFor] = useState<Notif | null>(null);
  const act = async (n: Notif, kind: 'retry' | 'cancel') => {
    try {
      await api.post(`/api/whatsapp/notifications/${n.id}/${kind}`);
      toast('ok', kind === 'retry' ? 'Aviso devolvido para a fila' : 'Aviso cancelado');
      reload();
      reloadStatus();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-auto min-w-[200px] text-[13px]" aria-label="Filtrar por status">
          <option value="">Todos os status</option>
          {(Object.keys(NOTIFICATION_STATUSES) as NotificationStatus[]).map((k) => (
            <option key={k} value={k}>
              {NOTIFICATION_STATUSES[k].label}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="ghost" icon={<LuRefreshCw className="size-3.5" />} onClick={reload}>
          Atualizar
        </Button>
      </div>
      {loading && !data ? (
        <div className="space-y-2 p-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error && !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data?.notifications.length ? (
        <EmptyState icon={<LuInbox className="size-5" />} title="Nenhum aviso" text="Os avisos entram na fila automaticamente quando há destinatários com consentimento e compromissos próximos." />
      ) : (
        <ul className="divide-y divide-line">
          {data.notifications.map((n) => {
            const st = NOTIFICATION_STATUSES[n.status];
            return (
              <li key={n.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-medium text-ink">{labelOf(n.type)}</span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {n.mode === 'demo' && n.status !== 'demonstracao' && <Badge tone="warn">demo</Badge>}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-muted">
                    Para {n.recipient_name} · {n.event_title ?? (n.type === 'resumo_semanal' ? 'Resumo semanal' : '—')} · <span className="num">{fmtDateTime(n.scheduled_for)}</span> · tentativa(s) <span className="num">{n.attempts}</span>
                  </div>
                  {n.last_error && <div className="mt-0.5 text-[12.5px] text-[#A12828] dark:text-[#F19B9B]">{n.last_error}</div>}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setLogFor(n)}>
                    Detalhes
                  </Button>
                  {['falhou', 'incerto', 'demonstracao', 'cancelado'].includes(n.status) && (
                    <IconButton label="Reenviar (autorizar novamente)" onClick={() => void act(n, 'retry')}>
                      <LuRotateCcw className="size-4" />
                    </IconButton>
                  )}
                  {n.status === 'pendente' && (
                    <IconButton label="Cancelar aviso" onClick={() => void act(n, 'cancel')}>
                      <LuBan className="size-4" />
                    </IconButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {logFor && <NotificationLog n={logFor} onClose={() => setLogFor(null)} />}
    </Card>
  );
}

const TYPE_LABELS: Record<string, string> = {
  aviso_antecipado: 'Aviso antecipado',
  lembrete_vespera: 'Lembrete na véspera',
  lembrete_dia: 'Lembrete no dia',
  alteracao: 'Alteração / cancelamento',
  reuniao_nao_confirmada: 'Reunião não confirmada',
  pendencia_vencimento: 'Pendência perto do prazo',
  resumo_semanal: 'Resumo semanal',
  confirmacao_presenca: 'Confirmação de presença',
  teste: 'Mensagem de teste',
};
function labelOf(t: string) {
  return TYPE_LABELS[t] ?? t;
}

function NotificationLog({ n, onClose }: { n: Notif; onClose: () => void }) {
  const { data } = useApi<{ log: Array<{ id: number; direction: string; status: string; detail: string; created_at: string }> }>(`/api/whatsapp/notifications/${n.id}/log`);
  return (
    <Modal open onClose={onClose} size="lg" title={labelOf(n.type)} description={`Para ${n.recipient_name} (${n.recipient_phone ?? ''})`}>
      <div className="space-y-4">
        {n.status === 'demonstracao' && (
          <p className="rounded-xl bg-soft-amber px-3 py-2 text-[13px] text-[#7A4A00] dark:text-amber">Modo demonstração: esta mensagem foi montada com os dados atuais, mas NÃO foi enviada ao WhatsApp.</p>
        )}
        <div>
          <div className="mb-1 text-[12.5px] font-medium text-muted">Mensagem</div>
          <pre className="rounded-xl bg-[#E7F7EF] p-3.5 font-sans text-[13.5px] leading-relaxed whitespace-pre-wrap text-[#10231D] dark:bg-[#10382B] dark:text-[#E5EFEA]">{n.payload?.preview || 'A mensagem é montada no momento do envio, com os dados mais atuais.'}</pre>
        </div>
        <div className="grid gap-2 text-[12.5px] text-ink-2 sm:grid-cols-2">
          <div>Agendado para: <span className="num">{fmtDateTime(n.scheduled_for)}</span></div>
          <div>ID na Meta: <span className="num break-all">{n.provider_message_id ?? '—'}</span></div>
          <div>Enviado: <span className="num">{fmtDateTime(n.sent_at)}</span></div>
          <div>Entregue: <span className="num">{fmtDateTime(n.delivered_at)}</span></div>
          <div>Lido: <span className="num">{fmtDateTime(n.read_at)}</span></div>
          <div className="num">Chave de deduplicação: <span className="break-all">{n.dedupe_key}</span></div>
        </div>
        <div>
          <div className="mb-1 text-[12.5px] font-medium text-muted">Registro</div>
          <ol className="space-y-1.5 border-l border-line pl-4">
            {data?.log.map((l) => (
              <li key={l.id} className="text-[13px]">
                <span className="num text-muted">{fmtDateTime(l.created_at)}</span> · <span className="font-medium text-ink">{l.status}</span> — <span className="text-ink-2">{l.detail}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ logs e webhooks

function LogsTab() {
  const { data, error, loading, reload } = useApi<{ log: Array<{ id: number; direction: string; status: string; detail: string; created_at: string; type: string | null; recipient_name: string | null }>; webhooks: Array<{ id: number; received_at: string; signature_valid: number; processed: number; error: string | null }> }>('/api/whatsapp/log');
  if (loading && !data) return <Skeleton className="h-96 w-full rounded-card" />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <Card>
        <CardHeader title="Registro de mensagens" subtitle="Saídas, entradas e eventos do sistema (últimos 300)" icon={<LuScrollText className="size-[18px]" />} action={<Button size="sm" variant="ghost" icon={<LuRefreshCw className="size-3.5" />} onClick={reload}>Atualizar</Button>} />
        {data.log.length === 0 ? (
          <EmptyState compact title="Nada registrado ainda" />
        ) : (
          <ul className="divide-y divide-line">
            {data.log.map((l) => (
              <li key={l.id} className="px-5 py-2.5 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={l.direction === 'entrada' ? 'info' : l.direction === 'sistema' ? 'muted' : 'neutral'}>{l.direction}</Badge>
                  <span className="font-medium text-ink">{l.status}</span>
                  <span className="num text-muted">{fmtDateTime(l.created_at)}</span>
                  {l.recipient_name && <span className="text-muted">· {l.recipient_name}</span>}
                  {l.type && <span className="text-muted">· {labelOf(l.type)}</span>}
                </div>
                <p className="mt-0.5 text-ink-2">{l.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title="Webhooks recebidos" subtitle="Assinatura X-Hub-Signature-256 validada em cada chamada" icon={<LuWebhook className="size-[18px]" />} />
        {data.webhooks.length === 0 ? (
          <EmptyState compact title="Nenhum webhook recebido" text="Aparecem aqui quando a Meta enviar status de entrega ou respostas." />
        ) : (
          <ul className="divide-y divide-line">
            {data.webhooks.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-[13px]">
                <span className="num text-ink-2">{fmtDateTime(w.received_at)}</span>
                <div className="flex gap-1.5">
                  <Badge tone={w.signature_valid ? 'ok' : 'danger'}>{w.signature_valid ? 'assinatura válida' : 'assinatura inválida'}</Badge>
                  {w.error ? <Badge tone="danger">erro</Badge> : w.processed ? <Badge tone="ok">processado</Badge> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
