import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  LuCalendarCheck,
  LuCalendarClock,
  LuChartColumn,
  LuCircleCheck,
  LuClock,
  LuHourglass,
  LuMapPin,
  LuMessageCircle,
  LuRoute,
  LuShieldCheck,
  LuSparkles,
  LuTriangleAlert,
  LuCalendarRange,
  LuSquare,
  LuSquareCheck,
  LuFlag,
} from 'react-icons/lu';
import { useApi } from '../lib/hooks.ts';
import { api } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { Link, useRouter } from '../lib/router.tsx';
import { cn, firstName, greeting, relDays } from '../lib/util.ts';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Progress, Ring, Skeleton, useFeedback } from '../components/ui.tsx';
import { DayStrip, EventRow, placeOf } from '../components/EventBits.tsx';
import { CATEGORIES, PRIORITIES } from '../../shared/constants.ts';
import { diffDays, formatLongDate, formatPeriod, MONTHS_PT, WEEKDAYS_SHORT_PT, weekday } from '../../shared/dates.ts';
import type { AgendaEvent, ChecklistItem } from '../../shared/types.ts';
import type { Conflict, HolidayAlert, OverdueItem, PendingConfirmation, PrepTask, Readiness, Recommendation, FreeSlot } from '../../shared/intelligence.ts';

interface Dash {
  today: string;
  nextMission: null | { event: AgendaEvent; checklist: ChecklistItem[]; progress: { total: number; done: number }; readiness: Readiness | null; tasksBefore: PrepTask[]; inProgress: boolean; days: number };
  todayEvents: AgendaEvent[];
  next7: AgendaEvent[];
  auditsActive: Array<{ event: AgendaEvent; readiness: Readiness; prep: { id: number; title: string; period: string } | null }>;
  pending: PendingConfirmation[];
  visits: AgendaEvent[];
  stats: { monthLabel: string; monthTotal: number; monthConcluded: number; executionPercent: number; concludedTotal: number; overdueTotal: number; upcomingTotal: number; pendingTotal: number; conflictsTotal: number };
  timeline: Array<AgendaEvent & { progress: { total: number; done: number } }>;
  conflicts: Conflict[];
  holidayWarnings: HolidayAlert[];
  overdue: OverdueItem[];
  recommendations: Recommendation[];
  freeSlots: FreeSlot[];
  chart: Array<{ month: string; label: string; total: number; concluded: number } & Record<string, number | string>>;
  notifications: null | { mode: string; counts: Record<string, number>; queued: number };
}

const LEVEL: Record<Readiness['level'], { label: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'done' }> = {
  pronta: { label: 'Preparação concluída', tone: 'ok' },
  em_preparacao: { label: 'Em preparação', tone: 'warn' },
  insuficiente: { label: 'Preparação insuficiente', tone: 'danger' },
  em_andamento: { label: 'Auditoria em andamento', tone: 'info' },
  pos_auditoria: { label: 'Pós-auditoria', tone: 'info' },
  concluida: { label: 'Concluída', tone: 'done' },
};

function Mission({ m, today, onToggle, canCheck }: { m: NonNullable<Dash['nextMission']>; today: string; onToggle: (i: ChecklistItem) => void; canCheck: boolean }) {
  const e = m.event;
  const until = diffDays(today, e.start_date);
  const pct = m.progress.total ? Math.round((m.progress.done / m.progress.total) * 100) : 0;
  const color = CATEGORIES[e.category].color;
  return (
    <section className="contours relative overflow-hidden rounded-hero bg-forest p-5 text-white shadow-pop sm:p-7 animate-rise" aria-label="Minha próxima missão">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] text-white/70">
          <LuRoute className="size-4 text-[#3ED19A]" />
          Minha próxima missão
        </div>
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-[12px] font-medium text-white/90">
          <span className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ background: color }} />
          {CATEGORIES[e.category].label}
        </span>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <h2 className="text-[24px] leading-tight font-semibold tracking-[-0.025em] sm:text-[30px]">{e.title}</h2>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[14px] text-white/80">
            <span className="inline-flex items-center gap-1.5">
              <LuMapPin className="size-4 text-[#3ED19A]" />
              {placeOf(e)}
            </span>
            <span className="num inline-flex items-center gap-1.5">
              <LuCalendarRange className="size-4 text-[#3ED19A]" />
              {formatPeriod(e.start_date, e.end_date)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <LuClock className="size-4 text-[#3ED19A]" />
              {e.start_time ? `${e.start_time}${e.end_time ? `–${e.end_time}` : ''}` : 'Horário não informado'}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <LuFlag className="size-4 text-[#3ED19A]" />
              Prioridade {PRIORITIES[e.priority].label.toLowerCase()}
            </span>
          </div>
          <div className="mt-5 overflow-x-auto pb-1">
            <DayStrip start={e.start_date} end={e.end_date} today={today} dark />
          </div>
        </div>
        <div className="flex items-end gap-6 lg:flex-col lg:items-end lg:justify-between">
          <div className="text-right">
            <div className="num text-[56px] leading-none font-semibold tracking-[-0.04em] text-white">{m.inProgress ? 'Hoje' : until}</div>
            <div className="mt-1 text-[13px] text-white/65">{m.inProgress ? 'em andamento' : until === 1 ? 'dia para começar' : 'dias para começar'}</div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-5 border-t border-white/10 pt-5 md:grid-cols-[1fr_1fr]">
        <div>
          <div className="mb-2 flex items-center justify-between text-[13px]">
            <span className="text-white/75">Checklist</span>
            <span className="num font-medium">
              {m.progress.done} de {m.progress.total}
            </span>
          </div>
          <div className="flex gap-1" aria-label={`Checklist ${pct}%`}>
            {m.checklist.length ? m.checklist.slice(0, 24).map((i) => <span key={i.id} className={cn('h-1.5 flex-1 rounded-full', i.done ? 'bg-[#3ED19A]' : 'bg-white/15')} />) : <span className="h-1.5 flex-1 rounded-full bg-white/15" />}
          </div>
          <ul className="mt-3 space-y-1">
            {m.checklist.slice(0, 5).map((i) => (
              <li key={i.id}>
                <button disabled={!canCheck} onClick={() => onToggle(i)} className={cn('flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left text-[14px] transition-colors', canCheck && 'hover:bg-white/8', i.done && 'text-white/50 line-through')}>
                  {i.done ? <LuSquareCheck className="size-[18px] shrink-0 text-[#3ED19A]" /> : <LuSquare className="size-[18px] shrink-0 text-white/50" />}
                  {i.text}
                </button>
              </li>
            ))}
            {m.checklist.length > 5 && <li className="px-1.5 text-[12.5px] text-white/55">+ {m.checklist.length - 5} itens no checklist completo</li>}
          </ul>
        </div>
        <div className="flex flex-col justify-between gap-4">
          {m.readiness ? (
            <div className="rounded-2xl bg-white/7 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] text-white/70">Preparação da auditoria</div>
                  <div className="num mt-0.5 text-[22px] font-semibold">{m.readiness.percent}%</div>
                </div>
                <Ring value={m.readiness.percent} size={54} stroke={6} color="#3ED19A" track="rgba(255,255,255,.12)">
                  <LuShieldCheck className="size-5 text-white/80" />
                </Ring>
              </div>
              {m.readiness.reasons[0] && <p className="mt-2 text-[12.5px] text-[#FCD58A]">{m.readiness.reasons[0]}</p>}
            </div>
          ) : m.tasksBefore.length ? (
            <div className="rounded-2xl bg-white/7 p-4">
              <div className="text-[13px] text-white/70">Antes de começar</div>
              <ul className="mt-1.5 space-y-1 text-[13.5px]">
                {m.tasksBefore.slice(0, 3).map((t, k) => (
                  <li key={k} className="flex gap-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-[#3ED19A]" />
                    {t.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div />
          )}
          <Link to={`/eventos/${e.id}`} className="inline-flex h-11 items-center justify-center rounded-xl bg-white px-5 text-[14px] font-semibold text-forest transition hover:bg-mint">
            Abrir detalhes
          </Link>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, icon, tone, to }: { label: string; value: ReactNode; icon: ReactNode; tone?: 'warn' | 'danger' | 'ok'; to?: string }) {
  const body = (
    <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', tone === 'danger' ? 'bg-soft-alert text-alert' : tone === 'warn' ? 'bg-soft-amber text-[#B26B00] dark:text-amber' : 'bg-soft-emerald text-emerald dark:text-[#4CC28F]')}>{icon}</span>
      <div className="min-w-0">
        <div className="num text-[22px] leading-none font-semibold tracking-[-0.02em] text-ink">{value}</div>
        <div className="mt-1 truncate text-[12.5px] text-muted">{label}</div>
      </div>
    </div>
  );
  return to ? (
    <Link to={to} className="block transition-colors hover:bg-surface-2">
      {body}
    </Link>
  ) : (
    body
  );
}

const GROUP_COLORS: Array<[string, string, string]> = [
  ['auditoria', 'Auditorias e preparação', '#7C3AED'],
  ['visita', 'Visitas técnicas', '#198A5D'],
  ['reuniao', 'Reuniões', '#2563EB'],
  ['confirmacao', 'Confirmações', '#64748B'],
  ['administrativo', 'Administrativo', '#DB2777'],
];

function MonthChart({ data }: { data: Dash['chart'] }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  const H = 150;
  return (
    <div>
      <div className="flex items-end gap-4 sm:gap-8">
        {data.map((d) => {
          let acc = 0;
          return (
            <div key={d.month} className="flex flex-1 flex-col items-center justify-end">
              <div className="num mb-1.5 text-[13px] font-semibold text-ink">{d.total}</div>
              <div className="flex w-full max-w-[64px] flex-col-reverse overflow-hidden rounded-xl bg-surface-2" style={{ height: H }}>
                {GROUP_COLORS.map(([k, , c]) => {
                  const v = Number(d[k] ?? 0);
                  if (!v) return null;
                  acc += v;
                  return <div key={k} title={`${v}`} style={{ height: `${(v / max) * 100}%`, background: c }} className="border-t border-surface first:border-t-0" />;
                })}
              </div>
              <div className="mt-2 text-[12.5px] text-muted">{d.label}</div>
              <div className="num text-[11.5px] text-muted/80">{d.concluded} concl.</div>
              <span className="sr-only">{acc}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
        {GROUP_COLORS.map(([k, l, c]) => (
          <span key={k} className="inline-flex items-center gap-1.5 text-[12px] text-muted">
            <span className="size-2.5 rounded-sm" style={{ background: c }} />
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

function DashSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-[340px] w-full rounded-hero" />
      <Skeleton className="h-24 w-full rounded-card" />
      <div className="grid gap-5 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2 rounded-card" />
        <Skeleton className="h-72 rounded-card" />
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { user, can } = useSession();
  const { navigate } = useRouter();
  const { toast } = useFeedback();
  const { data, error, loading, reload, setData } = useApi<Dash>('/api/dashboard');
  const [busyItem, setBusyItem] = useState<number | null>(null);
  if (loading && !data) return <DashSkeleton />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const d = data;
  const tz = user?.timezone ?? 'America/Cuiaba';

  const toggle = async (i: ChecklistItem) => {
    if (busyItem) return;
    setBusyItem(i.id);
    // atualização otimista
    setData({ ...d, nextMission: d.nextMission && { ...d.nextMission, checklist: d.nextMission.checklist.map((x) => (x.id === i.id ? { ...x, done: !x.done } : x)), progress: { ...d.nextMission.progress, done: d.nextMission.progress.done + (i.done ? -1 : 1) } } });
    try {
      await api.patch(`/api/checklist/${i.id}`, { done: !i.done });
      toast('ok', i.done ? 'Item reaberto' : 'Item concluído');
      void reload();
    } catch (e) {
      toast('error', (e as Error).message);
      void reload();
    } finally {
      setBusyItem(null);
    }
  };

  const alerts: Array<{ key: string; tone: 'warn' | 'danger'; title: string; text: string; to: string }> = [
    ...d.conflicts.map((c) => ({ key: c.id, tone: (c.kind === 'confirmado' ? 'danger' : 'warn') as 'warn' | 'danger', title: c.kind === 'confirmado' ? 'Conflito de horário' : 'Possível conflito de agenda', text: c.message, to: `/eventos/${c.b.id}` })),
    ...d.holidayWarnings.map((h) => ({ key: `h${h.eventId}${h.date}`, tone: 'warn' as const, title: `Feriado em ${h.date.slice(8)}/${h.date.slice(5, 7)}`, text: h.message, to: `/eventos/${h.eventId}` })),
    ...d.overdue.map((o) => ({ key: `o${o.kind}${o.id}`, tone: 'danger' as const, title: o.kind === 'evento' ? 'Atividade vencida' : 'Ação vencida', text: `${o.title} — ${o.message}`, to: o.kind === 'evento' ? `/eventos/${o.id}` : '/acoes' })),
  ];

  // Linha do tempo agrupada por data de início
  const groups = new Map<string, Dash['timeline']>();
  for (const e of d.timeline) {
    const k = e.start_date < d.today ? d.today : e.start_date;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.03em] text-ink sm:text-[30px]">
            {greeting(tz)}, {firstName(user?.name ?? '')}
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            {formatLongDate(d.today)}. {d.next7.length ? `${d.next7.length} compromisso${d.next7.length > 1 ? 's' : ''} nos próximos 7 dias.` : 'Nenhum compromisso nos próximos 7 dias.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<LuCalendarRange className="size-4" />} onClick={() => navigate('/agenda')}>
            Ver agenda
          </Button>
          {can('dashboard.view') && (
            <Button variant="secondary" icon={<LuSparkles className="size-4" />} onClick={() => navigate('/assistente')}>
              Perguntar ao assistente
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          {d.nextMission ? (
            <Mission m={d.nextMission} today={d.today} onToggle={toggle} canCheck={can('checklist.edit') || can('events.edit')} />
          ) : (
            <Card>
              <EmptyState icon={<LuCalendarCheck className="size-5" />} title="Nenhuma missão pela frente" text="Quando houver um compromisso programado, ele aparece aqui com checklist e preparação." action={can('events.create') ? <Button onClick={() => navigate('/eventos/novo')}>Criar compromisso</Button> : undefined} />
            </Card>
          )}
        </div>
        <Card className="flex flex-col">
          <CardHeader title="Atenção" subtitle={alerts.length || d.pending.length ? 'O motor de análise encontrou pontos para confirmar.' : 'Nenhum alerta no momento.'} icon={<LuTriangleAlert className="size-[18px]" />} />
          <div className="flex-1 space-y-2 px-4 pb-4">
            {alerts.map((a) => (
              <Link key={a.key} to={a.to} className={cn('block rounded-xl border p-3 transition-colors hover:brightness-[0.98]', a.tone === 'danger' ? 'border-[#F6C9C9] bg-soft-alert dark:border-[#5C2323]' : 'border-[#F7DDA0] bg-soft-amber dark:border-[#5A4413]')}>
                <div className={cn('text-[13px] font-semibold', a.tone === 'danger' ? 'text-[#A12828] dark:text-[#F19B9B]' : 'text-[#8A5300] dark:text-amber')}>{a.title}</div>
                <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{a.text}</p>
              </Link>
            ))}
            {d.pending.map((p) => (
              <Link key={`p${p.eventId}`} to={`/eventos/${p.eventId}`} className="flex items-start gap-3 rounded-xl border border-line p-3 transition-colors hover:bg-surface-2">
                <LuHourglass className="mt-0.5 size-4 shrink-0 text-amber" />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-ink">Aguardando confirmação</div>
                  <p className="text-[13px] text-ink-2">{p.title}</p>
                  <p className="num text-[12px] text-muted">
                    {p.period} — {relDays(p.daysUntil)}
                  </p>
                </div>
              </Link>
            ))}
            {!alerts.length && !d.pending.length && <EmptyState compact icon={<LuCircleCheck className="size-5" />} title="Agenda sem conflitos" text="Sem sobreposições, feriados ou confirmações pendentes." />}
          </div>
          {d.notifications && (
            <Link to="/whatsapp" className="flex items-center gap-2 border-t border-line px-5 py-3 text-[12.5px] text-muted hover:text-ink">
              <LuMessageCircle className="size-4 text-emerald" />
              WhatsApp {d.notifications.mode === 'live' ? 'conectado' : 'em modo demonstração'} — {d.notifications.queued} aviso(s) na fila
            </Link>
          )}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-6 [&>*]:border-line [&>*:nth-child(n)]:border-b lg:[&>*]:border-b-0 lg:[&>*:not(:last-child)]:border-r">
          <Stat label="Hoje" value={d.todayEvents.length} icon={<LuCalendarClock className="size-[18px]" />} to="/agenda?view=dia" />
          <Stat label="Próximos 7 dias" value={d.next7.length} icon={<LuCalendarRange className="size-[18px]" />} to="/agenda?view=semana" />
          <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <Ring value={d.stats.executionPercent} size={46} stroke={5}>
              <span className="num text-[11px] font-semibold text-ink">{d.stats.executionPercent}%</span>
            </Ring>
            <div className="min-w-0">
              <div className="num text-[14px] font-semibold text-ink">
                {d.stats.monthConcluded}/{d.stats.monthTotal}
              </div>
              <div className="truncate text-[12.5px] text-muted" title={`Execução de ${d.stats.monthLabel}`}>Execução do mês</div>
            </div>
          </div>
          <Stat label="A confirmar" value={d.stats.pendingTotal} icon={<LuHourglass className="size-[18px]" />} tone={d.stats.pendingTotal ? 'warn' : undefined} />
          <Stat label="Atrasadas" value={d.stats.overdueTotal} icon={<LuTriangleAlert className="size-[18px]" />} tone={d.stats.overdueTotal ? 'danger' : 'ok'} />
          <Stat label="Concluídas" value={d.stats.concludedTotal} icon={<LuCircleCheck className="size-[18px]" />} tone="ok" />
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Linha do tempo" subtitle="Próximos compromissos em ordem cronológica" icon={<LuRoute className="size-[18px]" />} action={<Link to="/agenda?view=linha" className="text-[13px] font-medium text-emerald hover:underline">Ver tudo</Link>} />
          <div className="px-5 pb-5">
            {groups.size === 0 ? (
              <EmptyState compact title="Nada programado" text="Os próximos compromissos aparecem aqui." />
            ) : (
              <ol className="relative">
                {[...groups.entries()].map(([date, evs], gi) => (
                  <li key={date} className="relative grid grid-cols-[56px_minmax(0,1fr)] gap-3 pb-4 last:pb-0">
                    {gi < groups.size - 1 && <span className="absolute top-12 bottom-0 left-[27px] w-px bg-line" aria-hidden />}
                    <div className={cn('num flex h-12 w-14 flex-col items-center justify-center rounded-xl border', date === d.today ? 'border-emerald bg-soft-emerald' : 'border-line bg-surface')}>
                      <span className="text-[10.5px] text-muted">{date === d.today ? 'hoje' : WEEKDAYS_SHORT_PT[weekday(date)]}</span>
                      <span className="text-[17px] leading-none font-semibold text-ink">{date.slice(8)}</span>
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="text-[12px] text-muted">
                        {MONTHS_PT[Number(date.slice(5, 7)) - 1]} — {relDays(diffDays(d.today, date))}
                      </div>
                      {evs.map((e) => {
                        const conflict = d.conflicts.find((c) => c.a.id === e.id || c.b.id === e.id);
                        const hol = d.holidayWarnings.find((h) => h.eventId === e.id);
                        return (
                          <EventRow
                            key={e.id}
                            e={e}
                            compact
                            alert={conflict ? `Possível conflito em ${conflict.dates.map((x) => x.slice(8)).join(', ')}/${conflict.dates[0].slice(5, 7)}` : hol ? `Feriado: ${hol.holiday}` : null}
                            right={
                              e.progress.total ? (
                                <span className="num hidden text-[12px] text-muted sm:block">
                                  {e.progress.done}/{e.progress.total}
                                </span>
                              ) : null
                            }
                          />
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Auditorias" subtitle="Preparação registrada nos checklists" icon={<LuShieldCheck className="size-[18px]" />} action={<Link to="/auditorias" className="text-[13px] font-medium text-emerald hover:underline">Abrir</Link>} />
          <div className="space-y-3 px-5 pb-5">
            {d.auditsActive.length === 0 && <EmptyState compact title="Sem auditorias nos próximos 60 dias" />}
            {d.auditsActive.map((a) => {
              const lv = LEVEL[a.readiness.level];
              return (
                <Link key={a.event.id} to={`/eventos/${a.event.id}`} className="block rounded-2xl border border-line p-4 transition-colors hover:bg-surface-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-semibold text-ink">{placeOf(a.event)}</div>
                      <div className="num text-[12.5px] text-muted">
                        {formatPeriod(a.event.start_date, a.event.end_date)} — {a.readiness.phase === 'pre' ? relDays(a.readiness.daysRemaining) : lv.label.toLowerCase()}
                      </div>
                    </div>
                    <div className="num text-[20px] font-semibold text-ink">{a.readiness.percent}%</div>
                  </div>
                  <Progress className="mt-3" value={a.readiness.percent} tone={a.readiness.level === 'insuficiente' ? 'alert' : a.readiness.percent >= 90 ? 'emerald' : 'amber'} />
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <Badge tone={lv.tone}>{lv.label}</Badge>
                    {a.readiness.criticalPending > 0 && <Badge tone="danger">{a.readiness.criticalPending} crítica(s)</Badge>}
                    <span className="num text-[12px] text-muted">
                      {a.readiness.done}/{a.readiness.total} itens
                    </span>
                  </div>
                  {a.prep && <p className="mt-2 text-[12px] text-muted">Preparação: {a.prep.period}</p>}
                </Link>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Compromissos por mês" subtitle="Dados da agenda cadastrada, por tipo" icon={<LuChartColumn className="size-[18px]" />} />
          <div className="px-5 pb-5">
            <MonthChart data={d.chart} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Visitas técnicas programadas" icon={<LuMapPin className="size-[18px]" />} />
          <div className="px-3 pb-4">
            {d.visits.length === 0 ? <EmptyState compact title="Nenhuma visita programada" /> : d.visits.map((v) => <EventRow key={v.id} e={v} compact />)}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Prioridades recomendadas" subtitle="Ordenadas por prazo, prioridade e preparação" icon={<LuSparkles className="size-[18px]" />} />
          <ol className="space-y-1 px-3 pb-4">
            {d.recommendations.length === 0 && <EmptyState compact title="Nenhuma prioridade urgente" />}
            {d.recommendations.map((r, i) => (
              <li key={`${r.kind}${r.id}`}>
                <Link to={r.kind === 'evento' ? `/eventos/${r.id}` : '/acoes'} className="flex items-start gap-3 rounded-xl px-2 py-2.5 hover:bg-surface-2">
                  <span className="num mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-[12px] font-semibold text-ink-2">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-ink">{r.title}</div>
                    <div className="mt-0.5 text-[12.5px] text-muted">
                      <span className="num">{r.when}</span> — {r.reasons.join(', ').toLowerCase()}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        </Card>
        <Card>
          <CardHeader title="Dias livres sugeridos" subtitle="Dias úteis sem compromissos que ocupem a agenda (feriados excluídos)" icon={<LuCalendarCheck className="size-[18px]" />} />
          <div className="flex flex-wrap gap-2 px-5 pb-5">
            {d.freeSlots.length === 0 && <p className="text-[13px] text-muted">Nenhum dia livre nos próximos 30 dias.</p>}
            {d.freeSlots.map((f) => (
              <button
                key={f.date}
                onClick={() => (can('events.create') ? navigate(`/eventos/novo?date=${f.date}`) : navigate(`/agenda?view=dia&date=${f.date}`))}
                className="num rounded-xl border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-emerald hover:bg-soft-emerald"
                title={can('events.create') ? 'Criar compromisso neste dia' : 'Ver o dia'}
              >
                <div className="text-[13.5px] font-medium text-ink">{f.label}</div>
                <div className="text-[11.5px] text-muted">{f.kind === 'dia_livre' ? 'dia inteiro' : f.windows.map((w) => `${w.start}–${w.end}`).join(', ')}</div>
              </button>
            ))}
          </div>
          <p className="px-5 pb-4 text-[12px] text-muted">Dias com compromisso sem horário informado são considerados ocupados.</p>
        </Card>
      </div>
    </div>
  );
}
