import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  LuCalendarClock,
  LuCalendarX,
  LuCircleCheck,
  LuClipboardList,
  LuCloudDownload,
  LuFileDown,
  LuFileText,
  LuHistory,
  LuMapPin,
  LuMessageCircle,
  LuPaperclip,
  LuPencil,
  LuPlus,
  LuShieldCheck,
  LuSquare,
  LuSquareCheck,
  LuTrash2,
  LuTriangleAlert,
  LuUpload,
  LuUserCheck,
  LuUsers,
  LuClock,
  LuUser,
  LuFlag,
  LuEye,
  LuLock,
  LuBuilding2,
  LuChevronLeft,
  LuSend,
} from 'react-icons/lu';
import { useApi } from '../lib/hooks.ts';
import { api, download } from '../lib/api.ts';
import { Link, useRouter } from '../lib/router.tsx';
import { useSession } from '../lib/session.tsx';
import { bytes, catColor, cn, fmtDateTime, relDays } from '../lib/util.ts';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, IconButton, Input, Modal, Progress, Ring, Select, Skeleton, Switch, Tabs, Textarea, useFeedback } from '../components/ui.tsx';
import { CategoryTag, DayStrip, PriorityBadge, StatusBadge, placeOf } from '../components/EventBits.tsx';
import { ACTION_ORIGINS, ACTION_STATUSES, ATTENDANCE, CATEGORIES, CHECKLIST_STAGES, NOTIFICATION_STATUSES, NOTIFICATION_TYPES, PRIORITIES, STATUSES, STATUS_KEYS } from '../../shared/constants.ts';
import type { ChecklistStage, StatusKey, ActionOriginKey, PriorityKey } from '../../shared/constants.ts';
import { diffDays, formatDateBR, formatPeriod } from '../../shared/dates.ts';
import type { ActionItem, AgendaEvent, ChecklistItem, NotificationRow, Participant } from '../../shared/types.ts';
import type { Conflict, HolidayAlert, PrepTask, Readiness } from '../../shared/intelligence.ts';

interface Detail {
  event: AgendaEvent;
  checklist: ChecklistItem[];
  participants: Participant[];
  comments: Array<{ id: number; text: string; user_name: string | null; created_at: string }>;
  attachments: Array<{ id: number; filename: string; mime: string; size: number; kind: string; created_at: string; uploaded_by_name: string | null }>;
  history: Array<{ id: number; action: string; summary: string; user_name: string | null; created_at: string; changes: Record<string, { de: string; para: string }> }>;
  actions: ActionItem[];
  notifications: Array<NotificationRow & { recipient_name?: string }>;
  readiness: Readiness | null;
  prepEvent: AgendaEvent | null;
  linkedAudit: AgendaEvent | null;
  tasksBefore: PrepTask[];
  conflicts: Conflict[];
  holidays: HolidayAlert[];
  permissions: { canEdit: boolean; canDelete: boolean; canChecklist: boolean; canComment: boolean; canAttendance: boolean; canUpload: boolean; canManageAudit: boolean; canManageActions: boolean; canSeeNotifications: boolean };
  series: Array<{ id: number; start_date: string }>;
  today: string;
}

type Tab = 'checklist' | 'detalhes' | 'participantes' | 'acoes' | 'anexos' | 'historico' | 'notificacoes';

export function EventDetailPage({ id }: { id: number }) {
  const { data, error, loading, reload } = useApi<Detail>(`/api/events/${id}`);
  const [tab, setTab] = useState<Tab>('checklist');
  const [reschedOpen, setReschedOpen] = useState(false);
  const { navigate } = useRouter();
  const { confirm, toast } = useFeedback();
  const { can } = useSession();

  if (loading && !data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-56 w-full rounded-hero" />
        <Skeleton className="h-96 w-full rounded-card" />
      </div>
    );
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const d = data;
  const e = d.event;
  const p = d.permissions;
  const color = catColor(e.category);
  const overdue = e.end_date < d.today && e.status !== 'concluido' && e.status !== 'cancelado';
  const until = diffDays(d.today, e.start_date);
  const ownItems = d.checklist.filter((c) => c.event_id === e.id);
  const total = ownItems.length;
  const done = ownItems.filter((c) => c.done).length;

  const setStatus = async (status: StatusKey) => {
    if (status === 'cancelado' && !(await confirm({ title: 'Cancelar compromisso?', message: 'Os lembretes agendados serão cancelados e os envolvidos recebem o aviso de cancelamento.', confirmLabel: 'Cancelar compromisso', tone: 'danger' }))) return;
    try {
      await api.post(`/api/events/${e.id}/status`, { status, version: e.version });
      toast('ok', `Status alterado para ${STATUSES[status].label}`);
      void reload();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Excluir compromisso?', message: 'O compromisso, seu checklist, anexos e histórico serão apagados. Esta ação não pode ser desfeita — para manter o registro, prefira cancelar.', confirmLabel: 'Excluir definitivamente', tone: 'danger' }))) return;
    try {
      await api.del(`/api/events/${e.id}`);
      toast('ok', 'Compromisso excluído');
      navigate('/agenda');
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  const tabs: Array<{ key: Tab; label: string; count?: number; icon?: ReactNode }> = [
    { key: 'checklist', label: 'Checklist', count: total, icon: <LuClipboardList className="size-4" /> },
    { key: 'detalhes', label: 'Detalhes', icon: <LuFileText className="size-4" /> },
    { key: 'participantes', label: 'Participantes', count: d.participants.length, icon: <LuUsers className="size-4" /> },
    { key: 'acoes', label: e.category === 'auditoria' ? 'Apontamentos' : 'Ações', count: d.actions.length, icon: <LuFlag className="size-4" /> },
    { key: 'anexos', label: 'Anexos', count: d.attachments.length, icon: <LuPaperclip className="size-4" /> },
    { key: 'historico', label: 'Histórico', count: d.history.length, icon: <LuHistory className="size-4" /> },
    ...(p.canSeeNotifications ? [{ key: 'notificacoes' as Tab, label: 'Notificações', count: d.notifications.length, icon: <LuMessageCircle className="size-4" /> }] : []),
  ];

  return (
    <div className="space-y-5">
      <Link to="/agenda" className="inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink">
        <LuChevronLeft className="size-4" /> Agenda
      </Link>

      <Card className="overflow-hidden">
        <div className="h-1.5" style={{ background: color }} />
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <CategoryTag category={e.category} />
            <StatusBadge status={e.status} overdue={overdue} />
            <PriorityBadge priority={e.priority} />
            {e.visibility === 'privado' && (
              <Badge tone="muted" icon={<LuLock className="size-3" />}>
                Privado
              </Badge>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-[24px] leading-tight font-bold tracking-[-0.025em] text-ink sm:text-[28px]">{e.title}</h1>
              <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-[14px] text-ink-2">
                <span className="num inline-flex items-center gap-1.5">
                  <LuCalendarClock className="size-4 text-muted" />
                  {formatPeriod(e.start_date, e.end_date)}
                  <span className="text-muted">({e.status === 'concluido' ? 'concluído' : until > 0 ? relDays(until) : e.end_date >= d.today ? 'em andamento' : 'encerrado'})</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <LuClock className="size-4 text-muted" />
                  {e.start_time ? `${e.start_time}${e.end_time ? ` às ${e.end_time}` : ''}` : 'Horário não informado'}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <LuMapPin className="size-4 text-muted" />
                  {placeOf(e)}
                  {e.municipality && e.unit_name && e.municipality !== e.unit_name ? ` — ${e.municipality}` : ''}
                </span>
                {e.client && (
                  <span className="inline-flex items-center gap-1.5">
                    <LuBuilding2 className="size-4 text-muted" />
                    {e.client}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <LuUser className="size-4 text-muted" />
                  {e.responsible_name ?? 'Responsável a definir'}
                </span>
              </div>
            </div>
            {total > 0 && (
              <Ring value={total ? (done / total) * 100 : 0} size={72} stroke={7} color={color}>
                <div className="text-center leading-none">
                  <div className="num text-[15px] font-semibold text-ink">
                    {done}/{total}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted">checklist</div>
                </div>
              </Ring>
            )}
          </div>
          <div className="mt-4 overflow-x-auto pb-1">
            <DayStrip start={e.start_date} end={e.end_date} today={d.today} />
          </div>
          <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
            {p.canEdit && e.status !== 'concluido' && e.status !== 'cancelado' && (
              <Button icon={<LuCircleCheck className="size-4" />} onClick={() => void setStatus('concluido')}>
                Concluir
              </Button>
            )}
            {p.canEdit && e.status === 'a_confirmar' && (
              <Button variant="subtle" icon={<LuUserCheck className="size-4" />} onClick={() => void setStatus('confirmado')}>
                Marcar como confirmado
              </Button>
            )}
            {p.canEdit && (
              <Button variant="secondary" icon={<LuCalendarClock className="size-4" />} onClick={() => setReschedOpen(true)}>
                Reagendar
              </Button>
            )}
            {p.canEdit && (
              <Button variant="secondary" icon={<LuPencil className="size-4" />} onClick={() => navigate(`/eventos/${e.id}/editar`)}>
                Editar
              </Button>
            )}
            {p.canEdit && (
              <div className="w-full sm:w-56">
                <Select value={e.status} onChange={(ev) => void setStatus(ev.target.value as StatusKey)} aria-label="Alterar status">
                  {STATUS_KEYS.map((s) => (
                    <option key={s} value={s}>
                      Status: {STATUSES[s].label}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <Button variant="ghost" icon={<LuCloudDownload className="size-4" />} onClick={() => void download(`/api/events/${e.id}/ics`, 'compromisso.ics').catch((er) => toast('error', er.message))}>
              Adicionar ao calendário
            </Button>
            {e.category === 'auditoria' && can('reports.view') && (
              <Button variant="ghost" icon={<LuFileDown className="size-4" />} onClick={() => void download(`/api/reports/auditoria/${e.id}`, 'relatorio-auditoria.pdf').catch((er) => toast('error', er.message))}>
                Relatório da auditoria
              </Button>
            )}
            {p.canDelete && (
              <Button variant="ghost" className="text-alert" icon={<LuTrash2 className="size-4" />} onClick={() => void remove()}>
                Excluir
              </Button>
            )}
          </div>
        </div>
      </Card>

      {(d.conflicts.length > 0 || d.holidays.length > 0 || overdue || (d.readiness && d.readiness.reasons.length > 0)) && (
        <div className="space-y-2">
          {d.conflicts.map((c) => (
            <Alert key={c.id} tone={c.kind === 'confirmado' ? 'danger' : 'warn'} title={c.kind === 'confirmado' ? 'Conflito de horário confirmado' : 'Possível conflito de agenda'}>
              {c.message}{' '}
              <Link className="font-medium underline" to={`/eventos/${c.a.id === e.id ? c.b.id : c.a.id}`}>
                Ver o outro compromisso
              </Link>
            </Alert>
          ))}
          {d.holidays.map((h) => (
            <Alert key={h.date} tone="warn" title="Feriado no período">
              {h.message}
            </Alert>
          ))}
          {overdue && (
            <Alert tone="danger" title="Atividade vencida">
              O período terminou em {formatDateBR(e.end_date)} e o compromisso ainda não foi concluído.
            </Alert>
          )}
          {d.readiness?.reasons.map((r) => (
            <Alert key={r} tone={d.readiness!.level === 'insuficiente' ? 'danger' : 'warn'} title="Preparação da auditoria">
              {r}
            </Alert>
          ))}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <Card>
          <div className="border-b border-line px-3 py-2.5">
            <Tabs tabs={tabs} value={tab} onChange={setTab} />
          </div>
          <div className="p-4 sm:p-5">
            {tab === 'checklist' && <ChecklistTab d={d} reload={reload} />}
            {tab === 'detalhes' && <DetailsTab d={d} reload={reload} />}
            {tab === 'participantes' && <ParticipantsTab d={d} reload={reload} />}
            {tab === 'acoes' && <ActionsTab d={d} reload={reload} />}
            {tab === 'anexos' && <AttachmentsTab d={d} reload={reload} />}
            {tab === 'historico' && <HistoryTab d={d} />}
            {tab === 'notificacoes' && <NotificationsTab d={d} />}
          </div>
        </Card>
        <div className="min-w-0 space-y-5">
          {d.readiness && <ReadinessCard r={d.readiness} prep={d.prepEvent} />}
          {d.linkedAudit && (
            <Card className="p-5">
              <div className="flex items-center gap-2 text-[13px] text-muted">
                <LuShieldCheck className="size-4 text-emerald" /> Preparação para
              </div>
              <Link to={`/eventos/${d.linkedAudit.id}`} className="mt-1 block text-[15px] font-semibold text-ink hover:underline">
                {d.linkedAudit.title}
              </Link>
              <p className="num text-[13px] text-muted">{formatPeriod(d.linkedAudit.start_date, d.linkedAudit.end_date)}</p>
            </Card>
          )}
          <Card>
            <CardHeader title="Antes do compromisso" subtitle="O que ainda falta, segundo os dados cadastrados" />
            <ul className="space-y-1.5 px-5 pb-5">
              {d.tasksBefore.length === 0 && <li className="text-[13px] text-muted">Nada pendente.</li>}
              {d.tasksBefore.slice(0, 10).map((t, i) => (
                <li key={i} className="flex gap-2.5 text-[13.5px]">
                  <span className={cn('mt-[7px] size-1.5 shrink-0 rounded-full', t.critical ? 'bg-alert' : 'bg-amber')} />
                  <span className="min-w-0">
                    <span className="text-ink">{t.text}</span>
                    <span className="block text-[12px] text-muted">{t.source}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          {d.series.length > 1 && (
            <Card className="p-5">
              <div className="text-[13px] font-medium text-ink">Série recorrente</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {d.series.map((s) => (
                  <Link key={s.id} to={`/eventos/${s.id}`} className={cn('num rounded-lg border px-2 py-1 text-[12px]', s.id === e.id ? 'border-emerald bg-soft-emerald text-forest dark:text-mint' : 'border-line text-ink-2 hover:bg-surface-2')}>
                    {formatDateBR(s.start_date)}
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
      <RescheduleModal open={reschedOpen} onClose={() => setReschedOpen(false)} e={e} onDone={reload} />
    </div>
  );
}

function Alert({ tone, title, children }: { tone: 'warn' | 'danger'; title: string; children: ReactNode }) {
  return (
    <div className={cn('flex gap-3 rounded-2xl border px-4 py-3', tone === 'danger' ? 'border-[#F6C9C9] bg-soft-alert dark:border-[#5C2323]' : 'border-[#F7DDA0] bg-soft-amber dark:border-[#5A4413]')} role="status">
      <LuTriangleAlert className={cn('mt-0.5 size-4 shrink-0', tone === 'danger' ? 'text-alert' : 'text-amber')} />
      <div className="text-[13.5px] leading-snug text-ink-2">
        <span className={cn('font-semibold', tone === 'danger' ? 'text-[#A12828] dark:text-[#F19B9B]' : 'text-[#8A5300] dark:text-amber')}>{title}. </span>
        {children}
      </div>
    </div>
  );
}

function ReadinessCard({ r, prep }: { r: Readiness; prep: AgendaEvent | null }) {
  const tone = r.level === 'insuficiente' ? '#DC4444' : r.percent >= 90 ? '#198A5D' : '#F59E0B';
  return (
    <Card className="p-5">
      <div className="flex items-center gap-4">
        <Ring value={r.percent} size={78} stroke={8} color={tone}>
          <span className="num text-[17px] font-semibold text-ink">{r.percent}%</span>
        </Ring>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-ink">Preparação da auditoria</div>
          <div className="num mt-0.5 text-[13px] text-muted">
            {r.done} de {r.total} itens — {r.phase === 'pre' ? `faltam ${r.daysRemaining} dia(s)` : r.phase === 'durante' ? 'auditoria em andamento' : 'auditoria realizada'}
          </div>
          {r.criticalPending > 0 && (
            <Badge tone="danger" className="mt-2">
              {r.criticalPending} pendência(s) crítica(s)
            </Badge>
          )}
        </div>
      </div>
      {prep && (
        <p className="mt-4 text-[13px] text-muted">
          Inclui o checklist de{' '}
          <Link to={`/eventos/${prep.id}`} className="font-medium text-emerald hover:underline">
            {prep.title} ({formatPeriod(prep.start_date, prep.end_date)})
          </Link>
          .
        </p>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ checklist

function ChecklistTab({ d, reload }: { d: Detail; reload: () => void }) {
  const { toast } = useFeedback();
  const [text, setText] = useState('');
  const [stage, setStage] = useState<ChecklistStage>(d.event.category === 'auditoria' ? 'pre' : 'geral');
  const [critical, setCritical] = useState(false);
  const [busy, setBusy] = useState<number | 'add' | null>(null);
  const tpl = useApi<{ templates: Array<{ key: string; name: string }> }>(d.permissions.canChecklist ? '/api/options' : null);
  const can = d.permissions.canChecklist;
  const isAudit = d.event.category === 'auditoria';
  const stages: ChecklistStage[] = isAudit ? ['pre', 'durante', 'pos', 'geral'] : ['geral', 'pre', 'durante', 'pos'];
  const own = d.checklist.filter((c) => c.event_id === d.event.id);

  const toggle = async (i: ChecklistItem) => {
    setBusy(i.id);
    try {
      await api.patch(`/api/checklist/${i.id}`, { done: !i.done });
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const add = async () => {
    if (text.trim().length < 2) return;
    setBusy('add');
    try {
      await api.post(`/api/events/${d.event.id}/checklist`, { text, stage, critical });
      setText('');
      setCritical(false);
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const del = async (i: ChecklistItem) => {
    try {
      await api.del(`/api/checklist/${i.id}`);
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const flag = async (i: ChecklistItem) => {
    try {
      await api.patch(`/api/checklist/${i.id}`, { critical: !i.critical });
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const applyTemplate = async (key: string) => {
    try {
      const r = await api.post<{ added: number }>(`/api/events/${d.event.id}/checklist/template`, { key });
      toast('ok', `${r.added} itens adicionados do modelo`);
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      {stages.map((s) => {
        const items = own.filter((c) => c.stage === s);
        if (!items.length && !(isAudit && s !== 'geral')) return null;
        const dn = items.filter((c) => c.done).length;
        return (
          <div key={s}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-[14px] font-semibold text-ink">{CHECKLIST_STAGES[s]}</h3>
              <span className="num text-[12.5px] text-muted">
                {dn}/{items.length}
              </span>
            </div>
            <Progress value={items.length ? (dn / items.length) * 100 : 0} className="mb-2" />
            {items.length === 0 ? (
              <p className="py-2 text-[13px] text-muted">Nenhum item nesta etapa.</p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {items.map((i) => (
                  <li key={i.id} className="group flex items-start gap-3 px-3 py-2.5">
                    <button disabled={!can || busy === i.id} onClick={() => void toggle(i)} aria-label={i.done ? 'Reabrir item' : 'Concluir item'} className="mt-0.5 shrink-0 disabled:cursor-default">
                      {i.done ? <LuSquareCheck className="size-5 text-emerald" /> : <LuSquare className="size-5 text-muted" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className={cn('text-[14px]', i.done ? 'text-muted line-through' : 'text-ink')}>{i.text}</div>
                      {(i.critical || i.done_at) && (
                        <div className="mt-0.5 flex flex-wrap gap-2 text-[12px] text-muted">
                          {i.critical && <span className="font-medium text-alert">Crítico</span>}
                          {i.done && i.done_at && (
                            <span>
                              Concluído por {i.done_by_name ?? '—'} em {fmtDateTime(i.done_at)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {d.permissions.canEdit && (
                      <div className="flex shrink-0 gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                        <IconButton label={i.critical ? 'Remover marcação de crítico' : 'Marcar como crítico'} onClick={() => void flag(i)} className="size-8">
                          <LuFlag className={cn('size-3.5', i.critical && 'text-alert')} />
                        </IconButton>
                        <IconButton label="Remover item" onClick={() => void del(i)} className="size-8">
                          <LuTrash2 className="size-3.5" />
                        </IconButton>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {own.length === 0 && !isAudit && <EmptyState compact icon={<LuClipboardList className="size-5" />} title="Checklist vazio" text={can ? 'Adicione itens ou aplique um modelo.' : 'Nenhum item cadastrado.'} />}
      {d.prepEvent && (
        <div className="rounded-xl bg-surface-2 p-3 text-[13px] text-ink-2">
          Checklist de preparação da planta:{' '}
          <Link to={`/eventos/${d.prepEvent.id}`} className="font-medium text-emerald hover:underline">
            {d.prepEvent.title}
          </Link>{' '}
          ({d.checklist.filter((c) => c.event_id === d.prepEvent!.id && c.done).length}/{d.checklist.filter((c) => c.event_id === d.prepEvent!.id).length} concluídos)
        </div>
      )}
      {can && (
        <div className="rounded-2xl border border-dashed border-line-strong p-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder="Novo item do checklist" aria-label="Novo item" />
            <Select value={stage} onChange={(e) => setStage(e.target.value as ChecklistStage)} className="sm:w-48" aria-label="Etapa">
              {(Object.keys(CHECKLIST_STAGES) as ChecklistStage[]).map((s) => (
                <option key={s} value={s}>
                  {CHECKLIST_STAGES[s]}
                </option>
              ))}
            </Select>
            <Button onClick={() => void add()} loading={busy === 'add'} icon={<LuPlus className="size-4" />}>
              Adicionar
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} className="size-4 accent-[#DC4444]" /> Item crítico
            </label>
            {tpl.data && (
              <Select defaultValue="" onChange={(e) => e.target.value && void applyTemplate(e.target.value)} className="h-9 w-auto text-[13px]" aria-label="Aplicar modelo">
                <option value="">Aplicar modelo de checklist…</option>
                {tpl.data.templates.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ detalhes por categoria

const DETAIL_FIELDS: Record<string, Array<{ key: string; label: string }>> = {
  visita: [
    { key: 'objective', label: 'Objetivo da visita' },
    { key: 'plannedActivities', label: 'Atividades planejadas' },
    { key: 'findings', label: 'Pendências identificadas' },
    { key: 'referrals', label: 'Encaminhamentos' },
    { key: 'result', label: 'Resultado da visita' },
  ],
  reuniao: [
    { key: 'agenda', label: 'Pauta' },
    { key: 'minutes', label: 'Ata' },
    { key: 'decisions', label: 'Decisões' },
  ],
  auditoria: [
    { key: 'auditor', label: 'Auditor / certificadora' },
    { key: 'requests', label: 'Solicitações acompanhadas' },
    { key: 'auditorObservations', label: 'Observações do auditor' },
    { key: 'immediateActions', label: 'Ações imediatas' },
    { key: 'followUp', label: 'Relatório de acompanhamento' },
  ],
};

function fieldsFor(e: AgendaEvent) {
  if (e.category === 'visita_reuniao') return [...DETAIL_FIELDS.visita, ...DETAIL_FIELDS.reuniao];
  if (e.category === 'visita_tecnica') return DETAIL_FIELDS.visita;
  if (e.category === 'reuniao' || e.category === 'confirmacao') return DETAIL_FIELDS.reuniao;
  if (e.category === 'auditoria') return DETAIL_FIELDS.auditoria;
  return [];
}

function DetailsTab({ d, reload }: { d: Detail; reload: () => void }) {
  const e = d.event;
  const fields = fieldsFor(e);
  const { toast } = useFeedback();
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, String((e.details as Record<string, unknown>)[f.key] ?? '')])));
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState('');
  const dirty = fields.some((f) => (draft[f.key] ?? '') !== String((e.details as Record<string, unknown>)[f.key] ?? ''));
  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/events/${e.id}`, { details: { ...e.details, ...draft }, version: e.version });
      toast('ok', 'Detalhes salvos');
      reload();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const addComment = async () => {
    if (!comment.trim()) return;
    try {
      await api.post(`/api/events/${e.id}/comments`, { text: comment });
      setComment('');
      toast('ok', 'Observação registrada');
      reload();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  return (
    <div className="space-y-6">
      <dl className="grid gap-4 sm:grid-cols-2">
        <Info label="Descrição" value={e.description} wide />
        <Info label="Observações" value={e.notes} wide />
        <Info label="Categoria" value={CATEGORIES[e.category].label} />
        <Info label="Prioridade" value={PRIORITIES[e.priority].label} />
        <Info label="Cliente" value={e.client} />
        <Info label="Visibilidade" value={e.visibility === 'privado' ? 'Privado (só responsável, participantes e administração)' : 'Compartilhado com a coordenação'} />
        <Info label="Avisos no WhatsApp" value={e.notification_settings?.enabled === false ? 'Desligados para este compromisso' : `Ligados${e.notification_settings?.advanceDays ? ` — aviso ${e.notification_settings.advanceDays} dias antes` : ''}`} />
        <Info label="Criado em" value={fmtDateTime(e.created_at)} />
      </dl>
      {fields.length > 0 && (
        <div className="space-y-3 border-t border-line pt-5">
          <h3 className="text-[14px] font-semibold text-ink">{e.category === 'auditoria' ? 'Registro da auditoria' : CATEGORIES[e.category].group === 'visita' ? 'Registro da visita técnica' : 'Registro da reunião'}</h3>
          {fields.map((f) => (
            <Field key={f.key} label={f.label}>
              <Textarea value={draft[f.key] ?? ''} disabled={!d.permissions.canEdit} onChange={(ev) => setDraft({ ...draft, [f.key]: ev.target.value })} placeholder={d.permissions.canEdit ? 'Ainda não registrado' : '—'} />
            </Field>
          ))}
          {d.permissions.canEdit && (
            <div className="flex justify-end">
              <Button onClick={() => void save()} loading={saving} disabled={!dirty}>
                Salvar registro
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="space-y-3 border-t border-line pt-5">
        <h3 className="text-[14px] font-semibold text-ink">Observações da equipe</h3>
        {d.permissions.canComment && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Textarea value={comment} onChange={(ev) => setComment(ev.target.value)} placeholder="Escreva uma observação para o supervisor e a coordenação" className="min-h-[64px]" />
            <Button className="sm:self-end" onClick={() => void addComment()} disabled={!comment.trim()} icon={<LuSend className="size-4" />}>
              Registrar
            </Button>
          </div>
        )}
        {d.comments.length === 0 ? (
          <p className="text-[13px] text-muted">Nenhuma observação registrada.</p>
        ) : (
          <ul className="space-y-2">
            {d.comments.map((c) => (
              <li key={c.id} className="rounded-xl bg-surface-2 px-3.5 py-2.5">
                <div className="text-[12px] text-muted">
                  {c.user_name ?? 'Sistema'} — {fmtDateTime(c.created_at)}
                </div>
                <p className="mt-0.5 text-[14px] whitespace-pre-wrap text-ink">{c.text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Info({ label, value, wide }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="mt-0.5 text-[14px] whitespace-pre-wrap text-ink">{value || <span className="text-muted">—</span>}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ participantes

function ParticipantsTab({ d, reload }: { d: Detail; reload: () => void }) {
  const { user } = useSession();
  const { toast } = useFeedback();
  const opts = useApi<{ users: Array<{ id: number; name: string }> }>(d.permissions.canEdit ? '/api/options' : null);
  const [name, setName] = useState('');
  const [userId, setUserId] = useState('');
  const [request, setRequest] = useState(true);
  const respond = async (pid: number, attendance: string) => {
    try {
      await api.patch(`/api/participants/${pid}`, { attendance });
      toast('ok', attendance === 'confirmada' ? 'Presença confirmada' : attendance === 'recusada' ? 'Ausência registrada' : 'Confirmação solicitada');
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const add = async () => {
    const u = opts.data?.users.find((x) => String(x.id) === userId);
    const n = u?.name ?? name.trim();
    if (!n) return;
    try {
      await api.post(`/api/events/${d.event.id}/participants`, { name: n, user_id: u ? u.id : null, requestConfirmation: request });
      setName('');
      setUserId('');
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const remove = async (pid: number) => {
    try {
      await api.del(`/api/participants/${pid}`);
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  return (
    <div className="space-y-4">
      {d.participants.length === 0 ? (
        <EmptyState compact icon={<LuUsers className="size-5" />} title="Nenhum participante" text="Inclua quem participa para controlar a confirmação de presença." />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {d.participants.map((p) => {
            const self = p.user_id === user?.id;
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                <div className="flex size-9 items-center justify-center rounded-full bg-surface-2 text-[13px] font-semibold text-ink-2">{p.name.slice(0, 2).toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-ink">
                    {p.name} {self && <span className="text-muted">(você)</span>}
                  </div>
                  <div className="text-[12.5px] text-muted">
                    {p.role_label ?? (p.user_id ? 'Usuário do sistema' : 'Participante externo')}
                    {p.responded_at && ` — respondeu em ${fmtDateTime(p.responded_at)}${p.response_channel ? ` via ${p.response_channel}` : ''}`}
                  </div>
                </div>
                <Badge tone={p.attendance === 'confirmada' ? 'ok' : p.attendance === 'recusada' ? 'danger' : p.attendance === 'pendente' ? 'warn' : 'muted'}>{ATTENDANCE[p.attendance]}</Badge>
                {(self || d.permissions.canEdit) && d.permissions.canAttendance && (
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="subtle" onClick={() => void respond(p.id, 'confirmada')} disabled={p.attendance === 'confirmada'}>
                      Confirmar
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => void respond(p.id, 'recusada')} disabled={p.attendance === 'recusada'}>
                      Não irá
                    </Button>
                  </div>
                )}
                {d.permissions.canEdit && p.attendance === 'nao_solicitada' && (
                  <Button size="sm" variant="secondary" onClick={() => void respond(p.id, 'pendente')}>
                    Solicitar confirmação
                  </Button>
                )}
                {d.permissions.canEdit && (
                  <IconButton label="Remover participante" onClick={() => void remove(p.id)} className="size-8">
                    <LuTrash2 className="size-3.5" />
                  </IconButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {d.permissions.canEdit && (
        <div className="rounded-2xl border border-dashed border-line-strong p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Usuário">
              <option value="">Participante externo (digite o nome)</option>
              {opts.data?.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do participante" disabled={!!userId} aria-label="Nome" />
            <Button onClick={() => void add()} icon={<LuPlus className="size-4" />}>
              Incluir
            </Button>
          </div>
          <label className="mt-2 inline-flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={request} onChange={(e) => setRequest(e.target.checked)} className="size-4 accent-[#198A5D]" />
            Solicitar confirmação de presença (envia pelo WhatsApp quando o participante tiver número com consentimento)
          </label>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ações / apontamentos

export function ActionForm({ eventId, isAudit, initial, onDone, onCancel }: { eventId: number | null; isAudit?: boolean; initial?: Partial<ActionItem>; onDone: () => void; onCancel: () => void }) {
  const { toast } = useFeedback();
  const [f, setF] = useState({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    responsible_name: initial?.responsible_name ?? '',
    due_date: initial?.due_date ?? '',
    severity: (initial?.severity ?? 'media') as PriorityKey,
    origin: (initial?.origin ?? (isAudit ? 'auditoria_pre' : 'manual')) as ActionOriginKey,
    progress: initial?.progress ?? 0,
    status: initial?.status ?? 'aberta',
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f, event_id: eventId, description: f.description || null, responsible_name: f.responsible_name || null };
      if (initial?.id) await api.patch(`/api/actions/${initial.id}`, body);
      else await api.post('/api/actions', body);
      toast('ok', initial?.id ? 'Ação atualizada' : 'Ação registrada');
      onDone();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <Field label={isAudit ? 'Apontamento / ação corretiva' : 'Ação ou tarefa'}>
        <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </Field>
      <Field label="Descrição">
        <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-[64px]" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Responsável pela correção">
          <Input value={f.responsible_name} onChange={(e) => setF({ ...f, responsible_name: e.target.value })} />
        </Field>
        <Field label="Prazo">
          <Input type="date" value={f.due_date ?? ''} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
        </Field>
        <Field label="Prioridade">
          <Select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value as PriorityKey })}>
            {(Object.keys(PRIORITIES) as PriorityKey[]).map((k) => (
              <option key={k} value={k}>
                {PRIORITIES[k].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Origem">
          <Select value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value as ActionOriginKey })}>
            {(Object.keys(ACTION_ORIGINS) as ActionOriginKey[]).map((k) => (
              <option key={k} value={k}>
                {ACTION_ORIGINS[k]}
              </option>
            ))}
          </Select>
        </Field>
        {initial?.id && (
          <>
            <Field label="Status">
              <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ActionItem['status'] })}>
                {Object.entries(ACTION_STATUSES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`Progresso: ${f.progress}%`}>
              <input type="range" min={0} max={100} step={5} value={f.progress} onChange={(e) => setF({ ...f, progress: Number(e.target.value) })} className="h-10 w-full accent-[#198A5D]" />
            </Field>
          </>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel}>
          Voltar
        </Button>
        <Button onClick={() => void save()} loading={busy} disabled={f.title.trim().length < 3}>
          {initial?.id ? 'Salvar ação' : 'Registrar ação'}
        </Button>
      </div>
    </div>
  );
}

function ActionsTab({ d, reload }: { d: Detail; reload: () => void }) {
  const [editing, setEditing] = useState<Partial<ActionItem> | null>(null);
  const isAudit = d.event.category === 'auditoria';
  const canManage = d.permissions.canManageActions || d.permissions.canManageAudit;
  if (editing) return <ActionForm eventId={d.event.id} isAudit={isAudit} initial={editing} onDone={() => (setEditing(null), reload())} onCancel={() => setEditing(null)} />;
  return (
    <div className="space-y-3">
      {d.actions.length === 0 ? (
        <EmptyState compact icon={<LuFlag className="size-5" />} title={isAudit ? 'Nenhum apontamento registrado' : 'Nenhuma ação registrada'} text={isAudit ? 'Registre não conformidades, pendências e correções com responsáveis e prazos.' : 'Registre encaminhamentos e tarefas derivadas.'} />
      ) : (
        <ul className="space-y-2">
          {d.actions.map((a) => {
            const late = a.due_date && a.due_date < d.today && (a.status === 'aberta' || a.status === 'em_andamento');
            return (
              <li key={a.id}>
                <button disabled={!canManage} onClick={() => setEditing(a)} className="w-full rounded-xl border border-line p-3.5 text-left transition-colors enabled:hover:bg-surface-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[14px] font-medium text-ink">{a.title}</span>
                    <div className="flex gap-1.5">
                      {late && <Badge tone="danger">Vencida</Badge>}
                      <Badge tone={a.status === 'concluida' ? 'ok' : a.status === 'cancelada' ? 'muted' : 'warn'}>{ACTION_STATUSES[a.status]}</Badge>
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 text-[12.5px] text-muted">
                    <span>{ACTION_ORIGINS[a.origin]}</span>
                    <span>Responsável: {a.responsible_name ?? '—'}</span>
                    <span className="num">Prazo: {a.due_date ? formatDateBR(a.due_date) : '—'}</span>
                    <span>Prioridade {PRIORITIES[a.severity].label.toLowerCase()}</span>
                  </div>
                  <Progress value={a.progress} className="mt-2.5" tone={a.status === 'concluida' ? 'emerald' : late ? 'alert' : 'amber'} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {canManage && (
        <Button variant="secondary" icon={<LuPlus className="size-4" />} onClick={() => setEditing({})}>
          {isAudit ? 'Registrar apontamento' : 'Registrar ação'}
        </Button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ anexos

function AttachmentsTab({ d, reload }: { d: Detail; reload: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { toast, confirm } = useFeedback();
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        if (f.size > 10 * 1024 * 1024) {
          toast('error', `${f.name}: o limite é 10 MB por arquivo.`);
          continue;
        }
        await api.upload(`/api/events/${d.event.id}/attachments`, f);
      }
      toast('ok', 'Anexo enviado');
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const remove = async (id: number, name: string) => {
    if (!(await confirm({ title: 'Remover anexo?', message: `"${name}" será apagado do compromisso.`, confirmLabel: 'Remover', tone: 'danger' }))) return;
    try {
      await api.del(`/api/attachments/${id}`);
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const photos = d.attachments.filter((a) => a.mime.startsWith('image/') && a.mime !== 'image/heic');
  return (
    <div className="space-y-4">
      {d.permissions.canUpload && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-line-strong p-4">
          <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,application/pdf,.doc,.docx,.xls,.xlsx,.txt" className="hidden" onChange={(e) => void upload(e.target.files)} />
          <Button variant="secondary" icon={<LuUpload className="size-4" />} loading={busy} onClick={() => input.current?.click()}>
            Enviar fotos ou documentos
          </Button>
          <span className="text-[12.5px] text-muted">Evidências fotográficas, relatórios e registros — até 10 MB por arquivo.</span>
        </div>
      )}
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {photos.map((a) => (
            <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-xl border border-line bg-surface-2">
              <img src={`/api/attachments/${a.id}`} alt={a.filename} loading="lazy" className="size-full object-cover" />
            </a>
          ))}
        </div>
      )}
      {d.attachments.length === 0 ? (
        <EmptyState compact icon={<LuPaperclip className="size-5" />} title="Nenhum anexo" />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {d.attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <LuPaperclip className="size-4 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <a href={`/api/attachments/${a.id}?download=1`} className="block truncate text-[14px] font-medium text-ink hover:underline">
                  {a.filename}
                </a>
                <div className="text-[12px] text-muted">
                  {bytes(a.size)} — {a.uploaded_by_name ?? '—'}, {fmtDateTime(a.created_at)}
                </div>
              </div>
              <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Abrir">
                <LuEye className="size-4" />
              </a>
              {d.permissions.canEdit && (
                <IconButton label="Remover anexo" onClick={() => void remove(a.id, a.filename)}>
                  <LuTrash2 className="size-4" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ histórico e notificações

function HistoryTab({ d }: { d: Detail }) {
  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {d.history.map((h) => (
        <li key={h.id} className="relative">
          <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface bg-emerald" />
          <div className="text-[12.5px] text-muted">
            {fmtDateTime(h.created_at)} — {h.user_name ?? 'Sistema'}
          </div>
          <div className="text-[14px] text-ink">{h.summary}</div>
          {h.changes && Object.keys(h.changes).length > 0 && !('original' in h.changes) && (
            <dl className="mt-1.5 space-y-0.5 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px]">
              {Object.entries(h.changes).map(([k, v]) => (
                <div key={k} className="flex flex-wrap gap-1">
                  <dt className="text-muted">{k}:</dt>
                  <dd className="text-ink-2">
                    <span className="line-through opacity-70">{v.de}</span> <span className="text-muted">para</span> <span className="font-medium text-ink">{v.para}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ol>
  );
}

function NotificationsTab({ d }: { d: Detail }) {
  if (!d.notifications.length) return <EmptyState compact icon={<LuMessageCircle className="size-5" />} title="Nenhum aviso para este compromisso" text="Os avisos aparecem aqui quando há destinatários com consentimento registrado." />;
  return (
    <ul className="divide-y divide-line rounded-xl border border-line">
      {d.notifications.map((n) => {
        const st = NOTIFICATION_STATUSES[n.status];
        return (
          <li key={n.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium text-ink">{NOTIFICATION_TYPES[n.type]?.label}</div>
              <div className="text-[12.5px] text-muted">
                Para {n.recipient_name} — {fmtDateTime(n.scheduled_for)}
                {n.last_error ? ` — ${n.last_error}` : ''}
              </div>
            </div>
            <Badge tone={st.tone}>{st.label}</Badge>
          </li>
        );
      })}
    </ul>
  );
}

function RescheduleModal({ open, onClose, e, onDone }: { open: boolean; onClose: () => void; e: AgendaEvent; onDone: () => void }) {
  const [start, setStart] = useState(e.start_date);
  const [end, setEnd] = useState(e.end_date);
  const [st, setSt] = useState(e.start_time ?? '');
  const [et, setEt] = useState(e.end_time ?? '');
  const [withTime, setWithTime] = useState(!!e.start_time);
  const [busy, setBusy] = useState(false);
  const { toast } = useFeedback();
  const span = diffDays(e.start_date, e.end_date);
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/api/events/${e.id}/reschedule`, { start_date: start, end_date: end, start_time: withTime ? st || null : null, end_time: withTime ? et || null : null, version: e.version });
      toast('ok', 'Compromisso reagendado');
      onClose();
      onDone();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reagendar compromisso"
      description="A data original fica registrada no histórico e os envolvidos recebem o aviso de alteração."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={() => void save()} loading={busy} icon={<LuCalendarX className="size-4" />}>
            Reagendar
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nova data inicial">
          <Input
            type="date"
            value={start}
            onChange={(ev) => {
              setStart(ev.target.value);
              if (ev.target.value) {
                const dt = new Date(`${ev.target.value}T12:00:00Z`);
                dt.setUTCDate(dt.getUTCDate() + span);
                setEnd(dt.toISOString().slice(0, 10));
              }
            }}
          />
        </Field>
        <Field label="Nova data final">
          <Input type="date" value={end} min={start} onChange={(ev) => setEnd(ev.target.value)} />
        </Field>
      </div>
      <div className="mt-3">
        <Switch checked={withTime} onChange={setWithTime} label="Informar horário" description="Sem horário, o compromisso ocupa o dia inteiro e não presumimos hora." />
      </div>
      {withTime && (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Field label="Início">
            <Input type="time" value={st} onChange={(ev) => setSt(ev.target.value)} />
          </Field>
          <Field label="Término">
            <Input type="time" value={et} onChange={(ev) => setEt(ev.target.value)} />
          </Field>
        </div>
      )}
      <p className="mt-3 text-[12.5px] text-muted">
        Período atual: <span className="num">{formatPeriod(e.start_date, e.end_date)}</span>
      </p>
    </Modal>
  );
}
