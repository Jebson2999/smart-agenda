import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { LuCalendarDays, LuCalendarRange, LuChartGantt, LuChevronLeft, LuChevronRight, LuList, LuFilter, LuPlus, LuSearch, LuTriangleAlert, LuX, LuCalendar } from 'react-icons/lu';
import { useApi, useDebounced, useMedia } from '../lib/hooks.ts';
import { api } from '../lib/api.ts';
import { useRouter, Link } from '../lib/router.tsx';
import { useSession } from '../lib/session.tsx';
import { catColor, cn, tint } from '../lib/util.ts';
import { PageHeader } from '../components/Layout.tsx';
import { Button, Card, EmptyState, ErrorState, IconButton, Input, Select, Skeleton, useFeedback } from '../components/ui.tsx';
import { CategoryTag, EventRow, StatusBadge, placeOf } from '../components/EventBits.tsx';
import { CATEGORIES, CATEGORY_KEYS, STATUSES, STATUS_KEYS } from '../../shared/constants.ts';
import { addDays, addMonths, diffDays, eachDay, formatDateBR, formatLongDate, formatPeriod, monthLabel, MONTHS_PT, nowInTz, WEEKDAYS_SHORT_PT, weekday } from '../../shared/dates.ts';
import type { AgendaEvent } from '../../shared/types.ts';
import type { Conflict } from '../../shared/intelligence.ts';
import type { Holiday } from '../../shared/holidays.ts';

type View = 'mes' | 'semana' | 'dia' | 'lista' | 'linha';
const VIEWS: Array<{ key: View; label: string; icon: ReactNode }> = [
  { key: 'mes', label: 'Mês', icon: <LuCalendarDays className="size-4" /> },
  { key: 'semana', label: 'Semana', icon: <LuCalendarRange className="size-4" /> },
  { key: 'dia', label: 'Dia', icon: <LuCalendar className="size-4" /> },
  { key: 'lista', label: 'Lista', icon: <LuList className="size-4" /> },
  { key: 'linha', label: 'Linha do tempo', icon: <LuChartGantt className="size-4" /> },
];

interface EventsResp {
  events: AgendaEvent[];
  progress: Record<number, { total: number; done: number }>;
  conflicts: Conflict[];
  holidays: Holiday[];
  today: string;
}

function rangeFor(view: View, date: string): { from: string; to: string } {
  if (view === 'mes') {
    const first = `${date.slice(0, 7)}-01`;
    const start = addDays(first, -weekday(first));
    return { from: start, to: addDays(start, 41) };
  }
  if (view === 'semana') {
    const s = addDays(date, -weekday(date));
    return { from: s, to: addDays(s, 6) };
  }
  if (view === 'dia') return { from: date, to: date };
  if (view === 'linha') {
    const first = `${date.slice(0, 7)}-01`;
    return { from: first, to: addDays(addMonths(first, 3), -1) };
  }
  return { from: date, to: addDays(date, 180) };
}

function step(view: View, date: string, dir: 1 | -1): string {
  if (view === 'mes' || view === 'linha') return addMonths(`${date.slice(0, 7)}-01`, dir);
  if (view === 'semana') return addDays(date, 7 * dir);
  if (view === 'dia') return addDays(date, dir);
  return addMonths(date, dir);
}

function titleFor(view: View, date: string, r: { from: string; to: string }) {
  if (view === 'mes') return monthLabel(date.slice(0, 7));
  if (view === 'linha') return `${MONTHS_PT[Number(r.from.slice(5, 7)) - 1]} a ${monthLabel(r.to.slice(0, 7))}`;
  if (view === 'semana') return formatPeriod(r.from, r.to);
  if (view === 'dia') return formatLongDate(date);
  return `A partir de ${formatDateBR(date)}`;
}

export function CalendarPage() {
  const { loc, navigate } = useRouter();
  const { can, user } = useSession();
  const { confirm, toast } = useFeedback();
  const view = (VIEWS.some((v) => v.key === loc.search.get('view')) ? loc.search.get('view') : 'mes') as View;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [unit, setUnit] = useState(loc.search.get('unit') ?? '');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const opts = useApi<{ units: Array<{ id: number; name: string }> }>('/api/options');
  const todayGuess = nowInTz(user?.timezone ?? 'America/Cuiaba').date;
  const date = loc.search.get('date') ?? todayGuess;
  const r = rangeFor(view, date);
  const params = new URLSearchParams({ from: r.from, to: r.to });
  if (unit) params.set('unit', unit);
  if (category) params.set('category', category);
  if (status) params.set('status', status);
  if (dq.length >= 2) params.set('q', dq);
  const { data, error, loading, reload } = useApi<EventsResp>(`/api/events?${params}`);
  const today = data?.today ?? todayGuess;
  const canEdit = can('events.edit');
  const activeFilters = [unit, category, status, dq].filter(Boolean).length;
  const touch = useMedia('(pointer: coarse)');

  const go = (next: { view?: View; date?: string }) => {
    const p = new URLSearchParams(loc.search);
    if (next.view) p.set('view', next.view);
    if (next.date) p.set('date', next.date);
    navigate(`/agenda?${p}`, { replace: true });
  };

  const reschedule = async (e: AgendaEvent, delta: number) => {
    if (!delta) return;
    const ns = addDays(e.start_date, delta);
    const ne = addDays(e.end_date, delta);
    const ok = await confirm({
      title: 'Reagendar compromisso?',
      message: (
        <>
          <strong>{e.title}</strong> passa de <span className="num">{formatPeriod(e.start_date, e.end_date)}</span> para <span className="num font-semibold">{formatPeriod(ns, ne)}</span>. A alteração fica no histórico e os envolvidos são avisados.
        </>
      ),
      confirmLabel: 'Reagendar',
    });
    if (!ok) return;
    try {
      await api.post(`/api/events/${e.id}/reschedule`, { start_date: ns, end_date: ne, keepTimes: true, version: e.version });
      toast('ok', 'Compromisso reagendado');
      void reload();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  return (
    <div>
      <PageHeader
        title="Agenda"
        subtitle={
          canEdit
            ? touch
              ? 'Toque em um compromisso para ver detalhes, reagendar ou concluir.'
              : 'Arraste um compromisso para outro dia para reagendar — a mudança só é feita depois da sua confirmação.'
            : 'Compromissos compartilhados com você.'
        }
        actions={
          can('events.create') && (
            <Button icon={<LuPlus className="size-4" />} onClick={() => navigate(`/eventos/novo${view === 'dia' ? `?date=${date}` : ''}`)}>
              Novo compromisso
            </Button>
          )
        }
      />
      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <IconButton label="Anterior" onClick={() => go({ date: step(view, date, -1) })}>
              <LuChevronLeft className="size-4" />
            </IconButton>
            <Button variant="secondary" size="sm" onClick={() => go({ date: today })}>
              Hoje
            </Button>
            <IconButton label="Próximo" onClick={() => go({ date: step(view, date, 1) })}>
              <LuChevronRight className="size-4" />
            </IconButton>
          </div>
          <h2 className="num min-w-0 flex-1 truncate px-1 text-[16px] font-semibold text-ink first-letter:uppercase">{titleFor(view, date, r)}</h2>
          <div className="flex rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Visualização">
            {VIEWS.map((v) => (
              <button key={v.key} role="tab" aria-selected={view === v.key} onClick={() => go({ view: v.key })} className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors', view === v.key ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>
                {v.icon}
                <span className={cn(view === v.key ? 'inline' : 'hidden md:inline')}>{v.label}</span>
              </button>
            ))}
          </div>
          <Button variant={activeFilters ? 'subtle' : 'secondary'} size="sm" icon={<LuFilter className="size-3.5" />} onClick={() => setFiltersOpen(!filtersOpen)}>
            Filtros{activeFilters ? ` (${activeFilters})` : ''}
          </Button>
        </div>
        {filtersOpen && (
          <div className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-4 animate-pop">
            <div className="relative">
              <LuSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar" className="pl-9" aria-label="Pesquisar compromissos" />
            </div>
            <Select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unidade">
              <option value="">Todas as unidades</option>
              {opts.data?.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoria">
              <option value="">Todas as categorias</option>
              {CATEGORY_KEYS.map((c) => (
                <option key={c} value={c}>
                  {CATEGORIES[c].label}
                </option>
              ))}
            </Select>
            <div className="flex gap-2">
              <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
                <option value="">Todos os status</option>
                {STATUS_KEYS.map((s) => (
                  <option key={s} value={s}>
                    {STATUSES[s].label}
                  </option>
                ))}
              </Select>
              {activeFilters > 0 && (
                <IconButton
                  label="Limpar filtros"
                  onClick={() => {
                    setUnit('');
                    setCategory('');
                    setStatus('');
                    setQ('');
                  }}
                >
                  <LuX className="size-4" />
                </IconButton>
              )}
            </div>
          </div>
        )}
      </Card>

      {error && !data ? (
        <Card>
          <ErrorState error={error} onRetry={reload} />
        </Card>
      ) : !data ? (
        <Skeleton className="h-[560px] w-full rounded-card" />
      ) : (
        <div className={cn('transition-opacity', loading && 'opacity-60')}>
          {view === 'mes' && <MonthView data={data} range={r} month={date.slice(0, 7)} canEdit={canEdit} onDrop={reschedule} onDay={(d) => go({ view: 'dia', date: d })} />}
          {view === 'semana' && <WeekView data={data} range={r} canEdit={canEdit} onDrop={reschedule} onDay={(d) => go({ view: 'dia', date: d })} />}
          {view === 'dia' && <DayView data={data} date={date} />}
          {view === 'lista' && <ListView data={data} />}
          {view === 'linha' && <TimelineView data={data} range={r} />}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ utilidades das visões

function eventsOn(events: AgendaEvent[], d: string) {
  return events.filter((e) => e.start_date <= d && e.end_date >= d).sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? '') || diffDays(b.start_date, b.end_date) - diffDays(a.start_date, a.end_date));
}

function conflictOn(conflicts: Conflict[], id: number, d: string) {
  return conflicts.some((c) => (c.a.id === id || c.b.id === id) && c.dates.includes(d));
}

function Chip({ e, day, canEdit, conflicts, onDragStart }: { e: AgendaEvent; day: string; canEdit: boolean; conflicts: Conflict[]; onDragStart: (ev: DragEvent, e: AgendaEvent, from: string) => void }) {
  const color = catColor(e.category);
  const starts = e.start_date === day;
  const cancelled = e.status === 'cancelado';
  const done = e.status === 'concluido';
  return (
    <Link
      to={`/eventos/${e.id}`}
      draggable={canEdit && !cancelled}
      onDragStart={(ev) => onDragStart(ev as unknown as DragEvent, e, day)}
      title={`${e.title} — ${placeOf(e)} (${formatPeriod(e.start_date, e.end_date)})`}
      className={cn('group flex items-center gap-1.5 rounded-md px-1.5 py-[3px] text-[11.5px] leading-tight font-medium transition-[filter] hover:brightness-95', canEdit && 'cursor-grab active:cursor-grabbing', cancelled && 'line-through opacity-55', e.status === 'a_confirmar' && 'border border-dashed')}
      style={{ background: tint(color, done ? 0.08 : 0.15), color, borderColor: color }}
    >
      {starts ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} /> : <span className="shrink-0 text-[10px] opacity-70">↳</span>}
      <span className="truncate text-ink">{starts ? e.title : placeOf(e)}</span>
      {conflictOn(conflicts, e.id, day) && <LuTriangleAlert className="ml-auto size-3 shrink-0 text-amber" aria-label="Possível conflito" />}
    </Link>
  );
}

function useDrag(onDrop: (e: AgendaEvent, delta: number) => void) {
  const [over, setOver] = useState<string | null>(null);
  const start = (ev: DragEvent, e: AgendaEvent, from: string) => {
    ev.dataTransfer.setData('text/plain', JSON.stringify({ id: e.id, from }));
    ev.dataTransfer.effectAllowed = 'move';
  };
  const bind = (day: string, events: AgendaEvent[]) => ({
    onDragOver: (ev: DragEvent) => {
      ev.preventDefault();
      setOver(day);
    },
    onDragLeave: () => setOver((o) => (o === day ? null : o)),
    onDrop: (ev: DragEvent) => {
      ev.preventDefault();
      setOver(null);
      try {
        const { id, from } = JSON.parse(ev.dataTransfer.getData('text/plain')) as { id: number; from: string };
        const e = events.find((x) => x.id === id);
        if (e) onDrop(e, diffDays(from, day));
      } catch {
        /* arrasto externo ignorado */
      }
    },
  });
  return { over, start, bind };
}

function MonthView({ data, range, month, canEdit, onDrop, onDay }: { data: EventsResp; range: { from: string; to: string }; month: string; canEdit: boolean; onDrop: (e: AgendaEvent, delta: number) => void; onDay: (d: string) => void }) {
  const days = eachDay(range.from, range.to);
  const hol = new Map(data.holidays.map((h) => [h.date, h]));
  const drag = useDrag(onDrop);
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line bg-surface-2">
        {WEEKDAYS_SHORT_PT.map((w, i) => (
          <div key={w} className={cn('px-2 py-2 text-center text-[12px] font-medium text-muted', (i === 0 || i === 6) && 'text-muted/70')}>
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const evs = eventsOn(data.events, d);
          const inMonth = d.startsWith(month);
          const h = hol.get(d);
          const isToday = d === data.today;
          return (
            <div key={d} {...drag.bind(d, data.events)} className={cn('min-h-[92px] border-r border-b border-line p-1 sm:min-h-[118px] sm:p-1.5 [&:nth-child(7n)]:border-r-0', !inMonth && 'bg-surface-2/60', (weekday(d) === 0 || weekday(d) === 6) && inMonth && 'bg-surface-2/30', drag.over === d && 'bg-soft-emerald ring-2 ring-emerald ring-inset')}>
              <div className="mb-1 flex items-center justify-between gap-1">
                <button onClick={() => onDay(d)} className={cn('num flex size-6 items-center justify-center rounded-lg text-[12.5px] font-semibold', isToday ? 'bg-emerald text-white' : inMonth ? (h && h.scope !== 'facultativo' ? 'text-alert' : 'text-ink') : 'text-muted/60')} aria-label={`Ver ${formatDateBR(d)}`}>
                  {Number(d.slice(8))}
                </button>
                {h && <span className="hidden truncate text-[10px] font-medium text-alert sm:block" title={h.name}>{h.name}</span>}
              </div>
              <div className="space-y-0.5">
                {evs.slice(0, 3).map((e) => (
                  <Chip key={e.id} e={e} day={d} canEdit={canEdit} conflicts={data.conflicts} onDragStart={drag.start} />
                ))}
                {evs.length > 3 && (
                  <button onClick={() => onDay(d)} className="px-1.5 text-[11px] font-medium text-muted hover:text-ink">
                    + {evs.length - 3} mais
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <Legend />
    </Card>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line px-4 py-3">
      {CATEGORY_KEYS.filter((c) => c !== 'outro').map((c) => (
        <span key={c} className="inline-flex items-center gap-1.5 text-[12px] text-muted">
          <span className="size-2.5 rounded-sm" style={{ background: CATEGORIES[c].color }} />
          {CATEGORIES[c].short}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
        <span className="h-2.5 w-4 rounded-sm border border-dashed border-muted" />A confirmar
      </span>
      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
        <LuTriangleAlert className="size-3 text-amber" />
        Possível conflito
      </span>
    </div>
  );
}

function WeekView({ data, range, canEdit, onDrop, onDay }: { data: EventsResp; range: { from: string; to: string }; canEdit: boolean; onDrop: (e: AgendaEvent, delta: number) => void; onDay: (d: string) => void }) {
  const days = eachDay(range.from, range.to);
  const hol = new Map(data.holidays.map((h) => [h.date, h]));
  const drag = useDrag(onDrop);
  return (
    <Card className="overflow-x-auto">
      <div className="grid min-w-[760px] grid-cols-7">
        {days.map((d) => {
          const evs = eventsOn(data.events, d);
          const untimed = evs.filter((e) => !e.start_time);
          const timed = evs.filter((e) => e.start_time);
          const h = hol.get(d);
          return (
            <div key={d} {...drag.bind(d, data.events)} className={cn('min-h-[420px] border-r border-line last:border-r-0', drag.over === d && 'bg-soft-emerald')}>
              <button onClick={() => onDay(d)} className={cn('flex w-full flex-col items-center border-b border-line py-2.5', d === data.today && 'bg-soft-emerald')}>
                <span className="text-[12px] text-muted">{WEEKDAYS_SHORT_PT[weekday(d)]}</span>
                <span className={cn('num text-[20px] font-semibold', d === data.today ? 'text-emerald' : 'text-ink')}>{Number(d.slice(8))}</span>
                {h ? <span className="max-w-full truncate px-1 text-[10.5px] text-alert">{h.name}</span> : <span className="text-[10.5px]">&nbsp;</span>}
              </button>
              <div className="space-y-1 p-1.5">
                {untimed.length > 0 && <div className="px-1 text-[10.5px] text-muted">Dia inteiro / sem horário</div>}
                {untimed.map((e) => (
                  <Chip key={e.id} e={e} day={d} canEdit={canEdit} conflicts={data.conflicts} onDragStart={drag.start} />
                ))}
                {timed.length > 0 && <div className="px-1 pt-1 text-[10.5px] text-muted">Com horário</div>}
                {timed.map((e) => (
                  <div key={e.id}>
                    <div className="num px-1 text-[10.5px] font-medium text-ink-2">
                      {e.start_time}
                      {e.end_time ? `–${e.end_time}` : ''}
                    </div>
                    <Chip e={e} day={d} canEdit={canEdit} conflicts={data.conflicts} onDragStart={drag.start} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <Legend />
    </Card>
  );
}

function DayView({ data, date }: { data: EventsResp; date: string }) {
  const evs = eventsOn(data.events, date);
  const hol = data.holidays.filter((h) => h.date === date);
  return (
    <Card>
      {hol.map((h) => (
        <div key={h.name} className="flex items-center gap-2 border-b border-line bg-soft-alert px-5 py-3 text-[13px] text-[#A12828] dark:text-[#F19B9B]">
          <LuTriangleAlert className="size-4" />
          {h.scope === 'facultativo' ? 'Ponto facultativo' : 'Feriado'}: {h.name}
        </div>
      ))}
      {evs.length === 0 ? (
        <EmptyState icon={<LuCalendarDays className="size-5" />} title="Dia livre" text="Nenhum compromisso cadastrado para este dia." />
      ) : (
        <div className="divide-y divide-line">
          {evs.map((e) => {
            const p = data.progress[e.id];
            const dayN = diffDays(e.start_date, date) + 1;
            const total = diffDays(e.start_date, e.end_date) + 1;
            return (
              <Link key={e.id} to={`/eventos/${e.id}`} className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-surface-2 sm:flex-row sm:items-center">
                <div className="num w-36 shrink-0 text-[13px] text-muted">{e.start_time ? `${e.start_time}${e.end_time ? `–${e.end_time}` : ''}` : 'Sem horário informado'}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-ink">{e.title}</span>
                    <StatusBadge status={e.status} overdue={e.end_date < data.today && e.status !== 'concluido' && e.status !== 'cancelado'} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                    <CategoryTag category={e.category} short />
                    <span>{placeOf(e)}</span>
                    {total > 1 && <span className="num">dia {dayN} de {total}</span>}
                    {p?.total ? <span className="num">checklist {p.done}/{p.total}</span> : null}
                  </div>
                  {data.conflicts
                    .filter((c) => (c.a.id === e.id || c.b.id === e.id) && c.dates.includes(date))
                    .map((c) => (
                      <p key={c.id} className="mt-1.5 flex items-start gap-1.5 text-[12.5px] text-[#A76200] dark:text-amber">
                        <LuTriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                        {c.message}
                      </p>
                    ))}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function ListView({ data }: { data: EventsResp }) {
  const byMonth = useMemo(() => {
    const m = new Map<string, AgendaEvent[]>();
    for (const e of data.events) m.set(e.start_date.slice(0, 7), [...(m.get(e.start_date.slice(0, 7)) ?? []), e]);
    return [...m.entries()];
  }, [data.events]);
  if (!data.events.length)
    return (
      <Card>
        <EmptyState icon={<LuList className="size-5" />} title="Nenhum compromisso encontrado" text="Ajuste os filtros ou avance o período." />
      </Card>
    );
  return (
    <div className="space-y-4">
      {byMonth.map(([m, evs]) => (
        <Card key={m}>
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h3 className="text-[15px] font-semibold text-ink first-letter:uppercase">{monthLabel(m)}</h3>
            <span className="num text-[12.5px] text-muted">{evs.length} compromisso(s)</span>
          </div>
          <div className="px-3 py-2">
            {evs.map((e) => {
              const p = data.progress[e.id];
              const conflict = data.conflicts.find((c) => c.a.id === e.id || c.b.id === e.id);
              const hol = data.holidays.find((h) => h.scope !== 'facultativo' && h.date >= e.start_date && h.date <= e.end_date);
              return (
                <EventRow
                  key={e.id}
                  e={e}
                  alert={conflict ? 'Possível conflito de datas' : hol ? `Feriado: ${hol.name}` : null}
                  right={
                    <div className="flex items-center gap-3">
                      {p?.total ? <span className="num hidden text-[12px] text-muted sm:block">{p.done}/{p.total}</span> : null}
                      <StatusBadge status={e.status} overdue={e.end_date < data.today && e.status !== 'concluido' && e.status !== 'cancelado'} />
                    </div>
                  }
                />
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}

function TimelineView({ data, range }: { data: EventsResp; range: { from: string; to: string } }) {
  const days = eachDay(range.from, range.to);
  const W = 26;
  const scroller = useRef<HTMLDivElement>(null);
  const months = useMemo(() => {
    const out: Array<{ key: string; start: number; len: number }> = [];
    days.forEach((d, i) => {
      const k = d.slice(0, 7);
      const last = out[out.length - 1];
      if (last && last.key === k) last.len++;
      else out.push({ key: k, start: i, len: 1 });
    });
    return out;
  }, [range.from, range.to]);
  const events = data.events.filter((e) => e.status !== 'cancelado');
  const todayIdx = diffDays(range.from, data.today);
  // Abre a linha do tempo já posicionada alguns dias antes de hoje.
  useEffect(() => {
    if (scroller.current && todayIdx > 3 && todayIdx < days.length) scroller.current.scrollLeft = (todayIdx - 3) * W;
  }, [range.from, todayIdx]);
  if (!events.length)
    return (
      <Card>
        <EmptyState icon={<LuChartGantt className="size-5" />} title="Nenhum compromisso no período" />
      </Card>
    );
  return (
    <Card className="overflow-hidden">
      <div className="flex">
        <div className="w-[132px] shrink-0 border-r border-line sm:w-64">
          <div className="h-[52px] border-b border-line" />
          {events.map((e) => (
            <Link key={e.id} to={`/eventos/${e.id}`} className="flex h-11 flex-col justify-center border-b border-line px-3 hover:bg-surface-2">
              <span className="truncate text-[13px] font-medium text-ink">{e.title}</span>
              <span className="truncate text-[11.5px] text-muted">{placeOf(e)}</span>
            </Link>
          ))}
        </div>
        <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto scroll-thin">
          <div className="relative" style={{ width: days.length * W }}>
            <div className="flex h-6 border-b border-line">
              {months.map((m) => (
                <div key={m.key} className="truncate border-r border-line px-2 text-[12px] leading-6 font-medium text-ink-2 first-letter:uppercase" style={{ width: m.len * W }}>
                  {monthLabel(m.key)}
                </div>
              ))}
            </div>
            <div className="flex h-[26px] border-b border-line">
              {days.map((d) => (
                <div key={d} className={cn('num shrink-0 text-center text-[10.5px] leading-[26px]', d === data.today ? 'font-bold text-emerald' : weekday(d) === 0 || weekday(d) === 6 ? 'text-muted/60' : 'text-muted')} style={{ width: W }}>
                  {Number(d.slice(8))}
                </div>
              ))}
            </div>
            {todayIdx >= 0 && todayIdx < days.length && <div className="absolute top-6 bottom-0 w-0.5 bg-emerald/70" style={{ left: todayIdx * W + W / 2 }} aria-hidden />}
            {events.map((e) => {
              const s = Math.max(0, diffDays(range.from, e.start_date));
              const en = Math.min(days.length - 1, diffDays(range.from, e.end_date));
              const color = catColor(e.category);
              const conflict = data.conflicts.some((c) => c.a.id === e.id || c.b.id === e.id);
              return (
                <div key={e.id} className="relative h-11 border-b border-line">
                  {days.map((d, i) => (weekday(d) === 0 || weekday(d) === 6 ? <div key={d} className="absolute top-0 bottom-0 bg-surface-2/60" style={{ left: i * W, width: W }} /> : null))}
                  {en >= s &&
                    (() => {
                      const left = s * W + 2;
                      const width = (en - s + 1) * W - 4;
                      const label = `${CATEGORIES[e.category].short} · ${placeOf(e)}`;
                      const narrow = width < 110;
                      return (
                        <>
                          <Link to={`/eventos/${e.id}`} title={`${e.title} (${formatPeriod(e.start_date, e.end_date)})`} className={cn('absolute top-2 flex h-7 items-center rounded-lg px-1.5 text-[11px] font-semibold text-white shadow-sm transition-[filter] hover:brightness-110', e.status === 'a_confirmar' && 'ring-2 ring-white/70 ring-inset')} style={{ left, width, background: e.status === 'a_confirmar' ? `repeating-linear-gradient(135deg, ${color}, ${color} 6px, ${tint(color, 0.75)} 6px, ${tint(color, 0.75)} 12px)` : color }}>
                            {conflict && <LuTriangleAlert className="mr-1 size-3 shrink-0" />}
                            {!narrow && <span className="truncate">{label}</span>}
                          </Link>
                          {narrow && (
                            <span className="pointer-events-none absolute top-2 flex h-7 items-center truncate text-[11.5px] font-medium text-ink-2" style={{ left: left + width + 6, maxWidth: 200 }}>
                              {label}
                            </span>
                          )}
                        </>
                      );
                    })()}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <Legend />
    </Card>
  );
}
