// Painel de acompanhamento de ações: responsáveis, prazos e progresso (auditorias, visitas e reuniões).
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { LuCalendarClock, LuCircleCheck, LuClipboardList, LuHourglass, LuPlus, LuTriangleAlert, LuUser, LuLink } from 'react-icons/lu';
import { useApi } from '../lib/hooks.ts';
import { Link } from '../lib/router.tsx';
import { cn } from '../lib/util.ts';
import { PageHeader } from '../components/Layout.tsx';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Modal, Progress, Ring, Select, Skeleton, Tabs } from '../components/ui.tsx';
import { ActionForm } from './EventDetail.tsx';
import { ACTION_ORIGINS, ACTION_STATUSES, PRIORITIES } from '../../shared/constants.ts';
import { diffDays, formatDateBR, todayInTz } from '../../shared/dates.ts';
import { useSession } from '../lib/session.tsx';
import type { ActionItem, AgendaEvent } from '../../shared/types.ts';

type Filter = 'abertas' | 'vencidas' | 'concluidas' | 'todas';

function isOpen(a: ActionItem) {
  return a.status === 'aberta' || a.status === 'em_andamento';
}

export function ActionsPage() {
  const { user } = useSession();
  const today = todayInTz(user?.timezone ?? 'America/Cuiaba');
  const { data, error, loading, reload } = useApi<{ actions: ActionItem[]; canManage: boolean }>('/api/actions');
  const [filter, setFilter] = useState<Filter>('abertas');
  const [editing, setEditing] = useState<Partial<ActionItem> | null>(null);
  const [linkEvent, setLinkEvent] = useState<string>('');
  const events = useApi<{ events: AgendaEvent[] }>(editing && !editing.id ? '/api/events' : null);

  const list = data?.actions ?? [];
  const late = (a: ActionItem) => !!a.due_date && a.due_date < today && isOpen(a);
  const counts = useMemo(
    () => ({
      abertas: list.filter(isOpen).length,
      vencidas: list.filter(late).length,
      concluidas: list.filter((a) => a.status === 'concluida').length,
      todas: list.length,
    }),
    [list, today],
  );
  if (loading && !data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full rounded-card" />
        <Skeleton className="h-96 w-full rounded-card" />
      </div>
    );
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  const shown = list
    .filter((a) => (filter === 'abertas' ? isOpen(a) : filter === 'vencidas' ? late(a) : filter === 'concluidas' ? a.status === 'concluida' : true))
    .sort((x, y) => Number(late(y)) - Number(late(x)) || (x.due_date ?? '9999').localeCompare(y.due_date ?? '9999'));
  const openList = list.filter(isOpen);
  const avg = openList.length ? Math.round(openList.reduce((s, a) => s + a.progress, 0) / openList.length) : null;
  const columns: Array<{ key: string; label: string; items: ActionItem[] }> = [
    { key: 'aberta', label: 'Abertas', items: shown.filter((a) => a.status === 'aberta') },
    { key: 'em_andamento', label: 'Em andamento', items: shown.filter((a) => a.status === 'em_andamento') },
    { key: 'fim', label: 'Concluídas / canceladas', items: shown.filter((a) => a.status === 'concluida' || a.status === 'cancelada') },
  ].filter((c) => c.items.length || filter === 'todas');

  return (
    <div>
      <PageHeader
        title="Ações e pendências"
        subtitle="Apontamentos de auditoria, encaminhamentos de visitas e tarefas derivadas das reuniões."
        actions={
          data.canManage && (
            <Button
              icon={<LuPlus className="size-4" />}
              onClick={() => {
                setLinkEvent('');
                setEditing({});
              }}
            >
              Nova ação
            </Button>
          )
        }
      />
      <Card className="mb-5 overflow-hidden">
        <div className="grid grid-cols-2 lg:grid-cols-4 [&>*]:border-line [&>*:nth-child(-n+2)]:border-b lg:[&>*]:border-b-0 lg:[&>*:not(:last-child)]:border-r">
          <Kpi label="Em aberto" value={counts.abertas} icon={<LuHourglass className="size-[18px]" />} tone={counts.abertas ? 'warn' : 'ok'} />
          <Kpi label="Vencidas" value={counts.vencidas} icon={<LuTriangleAlert className="size-[18px]" />} tone={counts.vencidas ? 'danger' : 'ok'} />
          <Kpi label="Concluídas" value={counts.concluidas} icon={<LuCircleCheck className="size-[18px]" />} tone="ok" />
          <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <Ring value={avg ?? 0} size={46} stroke={5}>
              <span className="num text-[11px] font-semibold text-ink">{avg === null ? '—' : `${avg}%`}</span>
            </Ring>
            <div className="text-[12.5px] leading-tight text-muted">
              Progresso médio
              <br />
              das ações em aberto
            </div>
          </div>
        </div>
      </Card>

      <div className="mb-4">
        <Tabs<Filter>
          value={filter}
          onChange={setFilter}
          tabs={[
            { key: 'abertas', label: 'Em aberto', count: counts.abertas },
            { key: 'vencidas', label: 'Vencidas', count: counts.vencidas },
            { key: 'concluidas', label: 'Concluídas', count: counts.concluidas },
            { key: 'todas', label: 'Todas', count: counts.todas },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={<LuClipboardList className="size-5" />}
            title={filter === 'vencidas' ? 'Nenhuma ação vencida' : filter === 'abertas' ? 'Nenhuma ação em aberto' : 'Nenhuma ação registrada'}
            text="As ações nascem dos apontamentos de auditoria, das visitas técnicas e das reuniões — ou podem ser criadas aqui."
          />
        </Card>
      ) : (
        <div className={cn('grid gap-4', columns.length > 1 && 'lg:grid-cols-3')}>
          {columns.map((col) => (
            <div key={col.key} className="min-w-0">
              {columns.length > 1 && (
                <div className="mb-2 flex items-center justify-between px-1">
                  <h2 className="text-[13.5px] font-semibold text-ink">{col.label}</h2>
                  <span className="num text-[12px] text-muted">{col.items.length}</span>
                </div>
              )}
              <ul className="space-y-2.5">
                {col.items.map((a) => (
                  <li key={a.id}>
                    <ActionCard a={a} late={late(a)} today={today} canManage={data.canManage} onEdit={() => setEditing(a)} />
                  </li>
                ))}
                {col.items.length === 0 && <li className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">Nenhuma</li>}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Editar ação' : 'Nova ação'} size="lg">
        {editing && (
          <div className="space-y-3">
            {!editing.id && (
              <Field label="Vincular a um compromisso (opcional)" hint="Ações vinculadas aparecem no compromisso e entram no cálculo de preparação de auditorias.">
                <Select value={linkEvent} onChange={(e) => setLinkEvent(e.target.value)}>
                  <option value="">Sem vínculo</option>
                  {events.data?.events.map((e) => (
                    <option key={e.id} value={e.id}>
                      {formatDateBR(e.start_date)} — {e.title}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <ActionForm
              eventId={editing.id ? (editing.event_id ?? null) : linkEvent ? Number(linkEvent) : null}
              isAudit={!!events.data?.events.find((e) => String(e.id) === linkEvent && e.category === 'auditoria')}
              initial={editing}
              onDone={() => {
                setEditing(null);
                void reload();
              }}
              onCancel={() => setEditing(null)}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

function ActionCard({ a, late, today, canManage, onEdit }: { a: ActionItem; late: boolean; today: string; canManage: boolean; onEdit: () => void }) {
  const until = a.due_date ? diffDays(today, a.due_date) : null;
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={cn('text-[14px] font-medium', a.status === 'cancelada' ? 'text-muted line-through' : 'text-ink')}>{a.title}</span>
        {(a.severity === 'alta' || a.severity === 'critica') && <Badge tone={a.severity === 'critica' ? 'danger' : 'warn'}>{PRIORITIES[a.severity].label}</Badge>}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-muted">
        <span className="inline-flex items-center gap-1">
          <LuUser className="size-3.5" />
          {a.responsible_name ?? 'Sem responsável'}
        </span>
        <span className={cn('num inline-flex items-center gap-1', late && 'font-medium text-alert')}>
          <LuCalendarClock className="size-3.5" />
          {a.due_date ? `${formatDateBR(a.due_date)}${until !== null && a.status !== 'concluida' && a.status !== 'cancelada' ? (until < 0 ? ` · vencida há ${-until}d` : until === 0 ? ' · vence hoje' : ` · ${until}d`) : ''}` : 'Sem prazo'}
        </span>
        <span>{ACTION_ORIGINS[a.origin]}</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Progress value={a.progress} tone={a.status === 'concluida' ? 'emerald' : late ? 'alert' : 'amber'} className="flex-1" label={`Progresso ${a.progress}%`} />
        <span className="num w-9 text-right text-[12px] font-medium text-ink-2">{a.progress}%</span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <Badge tone={a.status === 'concluida' ? 'ok' : a.status === 'cancelada' ? 'muted' : late ? 'danger' : 'warn'}>{late ? 'Vencida' : ACTION_STATUSES[a.status]}</Badge>
        {a.event_id && a.event_title && (
          <span className="inline-flex max-w-[60%] items-center gap-1 truncate text-[12px] text-muted">
            <LuLink className="size-3 shrink-0" />
            <span className="truncate">{a.event_title}</span>
          </span>
        )}
      </div>
    </>
  );
  return (
    <div className={cn('rounded-2xl border bg-surface p-4 shadow-card transition-colors', late ? 'border-[#F6C9C9] dark:border-[#5C2323]' : 'border-line')}>
      {canManage ? (
        <button onClick={onEdit} className="block w-full text-left" aria-label={`Editar ação ${a.title}`}>
          {body}
        </button>
      ) : (
        body
      )}
      {a.event_id && (
        <Link to={`/eventos/${a.event_id}`} className="mt-2 inline-block text-[12px] font-medium text-emerald hover:underline">
          Abrir compromisso
        </Link>
      )}
    </div>
  );
}

function Kpi({ label, value, icon, tone }: { label: string; value: ReactNode; icon: ReactNode; tone?: 'ok' | 'warn' | 'danger' }) {
  return (
    <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', tone === 'danger' ? 'bg-soft-alert text-alert' : tone === 'warn' ? 'bg-soft-amber text-[#B26B00] dark:text-amber' : 'bg-soft-emerald text-emerald dark:text-[#4CC28F]')}>{icon}</span>
      <div className="min-w-0">
        <div className="num text-[22px] leading-none font-semibold text-ink">{value}</div>
        <div className="mt-1 truncate text-[12.5px] text-muted">{label}</div>
      </div>
    </div>
  );
}
