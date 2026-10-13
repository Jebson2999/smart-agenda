// Motor de inteligência operacional.
// Funções puras: recebem os dados do sistema e devolvem análises.
// Nenhuma função aqui altera compromissos — apenas sugere e alerta.
import { CATEGORIES, CLOSED_STATUSES, PRIORITIES, STATUSES, ACTION_STATUSES } from './constants.ts';
import type { CategoryKey } from './constants.ts';
import {
  addDays,
  diffDays,
  eachDay,
  formatDateBR,
  formatDayMonth,
  formatPeriod,
  isWeekend,
  maxDate,
  minDate,
  minutesToTime,
  timeToMinutes,
  WEEKDAYS_SHORT_PT,
  weekday,
} from './dates.ts';
import type { Holiday } from './holidays.ts';
import type { ActionItem, AgendaEvent, ChecklistItem, Participant } from './types.ts';

type Ev = Pick<
  AgendaEvent,
  'id' | 'title' | 'category' | 'start_date' | 'end_date' | 'start_time' | 'end_time' | 'status' | 'municipality' | 'unit_name' | 'priority' | 'related_event_id' | 'unit_id'
>;

export function isOpen(e: Pick<AgendaEvent, 'status'>): boolean {
  return !CLOSED_STATUSES.includes(e.status);
}

export function isBlocking(e: Pick<AgendaEvent, 'category'>): boolean {
  return CATEGORIES[e.category as CategoryKey]?.blocking ?? true;
}

export function place(e: Pick<AgendaEvent, 'unit_name' | 'municipality'>): string {
  return e.unit_name || e.municipality || 'Unidade a definir';
}

export function eventDays(e: Pick<AgendaEvent, 'start_date' | 'end_date'>): number {
  return diffDays(e.start_date, e.end_date) + 1;
}

/** Atrasado = já terminou e não foi concluído nem cancelado. */
export function isOverdue(e: Pick<AgendaEvent, 'end_date' | 'status'>, today: string): boolean {
  return e.end_date < today && isOpen(e);
}

export function isActionOpen(a: Pick<ActionItem, 'status'>): boolean {
  return a.status === 'aberta' || a.status === 'em_andamento';
}

// ------------------------------------------------------------------ conflitos

export interface Conflict {
  id: string;
  kind: 'confirmado' | 'possivel';
  dates: string[];
  a: { id: number; title: string; place: string; period: string };
  b: { id: number; title: string; place: string; period: string };
  differentMunicipality: boolean;
  message: string;
}

function timeWindow(e: Ev): [number, number] | null {
  if (!e.start_time) return null;
  const s = timeToMinutes(e.start_time);
  const end = e.end_time ? timeToMinutes(e.end_time) : s + 1; // sem término: trata como instante
  return [s, Math.max(end, s + 1)];
}

/**
 * Detecta sobreposição de compromissos que ocupam a agenda.
 * - "confirmado": os dois têm horário informado e os horários se cruzam.
 * - "possivel": as datas se cruzam, mas pelo menos um não tem horário (não presumimos horário).
 */
export function detectConflicts(events: Ev[]): Conflict[] {
  const active = events.filter((e) => isOpen(e) && isBlocking(e)).sort((x, y) => x.start_date.localeCompare(y.start_date) || x.id - y.id);
  const out: Conflict[] = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      if (b.start_date > a.end_date) continue;
      const s = maxDate(a.start_date, b.start_date);
      const e = minDate(a.end_date, b.end_date);
      if (s > e) continue;
      const days = eachDay(s, e);
      const wa = timeWindow(a);
      const wb = timeWindow(b);
      let kind: Conflict['kind'];
      if (wa && wb) {
        if (!(wa[0] < wb[1] && wb[0] < wa[1])) continue; // mesmo dia, horários diferentes
        kind = 'confirmado';
      } else {
        kind = 'possivel';
      }
      const differentMunicipality = !!(a.municipality && b.municipality && a.municipality !== b.municipality);
      const when = days.length === 1 ? formatDayMonth(days[0]) : `${formatDayMonth(days[0])} a ${formatDayMonth(days[days.length - 1])}`;
      const where = differentMunicipality ? ` em municípios diferentes (${a.municipality} e ${b.municipality})` : '';
      const message =
        kind === 'confirmado'
          ? `Conflito confirmado em ${when}: "${a.title}" (${a.start_time}–${a.end_time ?? '?'}) e "${b.title}" (${b.start_time}–${b.end_time ?? '?'}) têm horários sobrepostos${where}.`
          : `Possível conflito em ${when}: "${a.title}" e "${b.title}" ocupam a mesma data${where}. Horários não informados — confirme antes de qualquer reagendamento.`;
      out.push({
        id: `${Math.min(a.id, b.id)}-${Math.max(a.id, b.id)}-${days[0]}`,
        kind,
        dates: days,
        a: { id: a.id, title: a.title, place: place(a), period: formatPeriod(a.start_date, a.end_date) },
        b: { id: b.id, title: b.title, place: place(b), period: formatPeriod(b.start_date, b.end_date) },
        differentMunicipality,
        message,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ feriados

export interface HolidayAlert {
  eventId: number;
  title: string;
  date: string;
  holiday: string;
  scope: Holiday['scope'];
  message: string;
}

export function holidayAlerts(events: Ev[], holidays: Holiday[]): HolidayAlert[] {
  const out: HolidayAlert[] = [];
  for (const e of events) {
    if (!isOpen(e)) continue;
    for (const h of holidays) {
      if (h.date < e.start_date || h.date > e.end_date) continue;
      if (h.scope === 'municipal' && h.municipality && e.municipality && h.municipality !== e.municipality) continue;
      out.push({
        eventId: e.id,
        title: e.title,
        date: h.date,
        holiday: h.name,
        scope: h.scope,
        message: `${formatDateBR(h.date)} é ${h.scope === 'facultativo' ? 'ponto facultativo' : `feriado ${h.scope}`} (${h.name}) — confirme se a unidade opera e se "${e.title}" se mantém.`,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ auditorias

export interface Readiness {
  auditId: number;
  prepEventId: number | null;
  percent: number;
  total: number;
  done: number;
  criticalPending: number;
  daysRemaining: number;
  phase: 'pre' | 'durante' | 'pos';
  level: 'pronta' | 'em_preparacao' | 'insuficiente' | 'em_andamento' | 'pos_auditoria' | 'concluida';
  reasons: string[];
  pendingItems: Array<{ id: number; text: string; critical: boolean; eventId: number }>;
}

export function findPrepEvent<T extends Ev>(audit: Ev, events: T[]): T | undefined {
  if (audit.related_event_id) {
    const linked = events.find((e) => e.id === audit.related_event_id);
    if (linked) return linked;
  }
  return events.find(
    (e) =>
      e.category === 'preparacao_auditoria' &&
      e.status !== 'cancelado' &&
      e.end_date < audit.start_date &&
      diffDays(e.end_date, audit.start_date) <= 30 &&
      ((e.unit_id && e.unit_id === audit.unit_id) || (e.municipality && e.municipality === audit.municipality)),
  );
}

export function auditReadiness(
  audit: Ev,
  ctx: { events: Ev[]; checklist: ChecklistItem[]; actions: ActionItem[]; today: string },
): Readiness {
  const prep = findPrepEvent(audit, ctx.events);
  const items = ctx.checklist.filter(
    (i) => (prep && i.event_id === prep.id) || (i.event_id === audit.id && i.stage === 'pre'),
  );
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const relatedIds = new Set([audit.id, prep?.id].filter(Boolean) as number[]);
  const criticalActions = ctx.actions.filter(
    (a) => a.event_id != null && relatedIds.has(a.event_id) && isActionOpen(a) && (a.severity === 'alta' || a.severity === 'critica'),
  );
  const criticalPending = items.filter((i) => i.critical && !i.done).length + criticalActions.length;
  const daysRemaining = diffDays(ctx.today, audit.start_date);
  const phase: Readiness['phase'] = ctx.today < audit.start_date ? 'pre' : ctx.today <= audit.end_date ? 'durante' : 'pos';
  const reasons: string[] = [];
  let level: Readiness['level'];
  if (audit.status === 'concluido') level = 'concluida';
  else if (phase === 'durante') level = 'em_andamento';
  else if (phase === 'pos') level = 'pos_auditoria';
  else {
    if (total === 0) reasons.push('Nenhum item de preparação cadastrado.');
    if (daysRemaining <= 3 && percent < 70) reasons.push(`Faltam ${daysRemaining} dia(s) e a preparação está em ${percent}%.`);
    if (criticalPending > 0) reasons.push(`${criticalPending} pendência(s) crítica(s) em aberto.`);
    if (!prep) reasons.push('Sem compromisso de preparação vinculado.');
    if (total === 0 || (daysRemaining <= 3 && percent < 70) || (daysRemaining <= 1 && criticalPending > 0)) level = 'insuficiente';
    else if (percent >= 90 && criticalPending === 0) level = 'pronta';
    else level = 'em_preparacao';
  }
  return {
    auditId: audit.id,
    prepEventId: prep?.id ?? null,
    percent,
    total,
    done,
    criticalPending,
    daysRemaining,
    phase,
    level,
    reasons,
    pendingItems: items.filter((i) => !i.done).map((i) => ({ id: i.id, text: i.text, critical: i.critical, eventId: i.event_id })),
  };
}

// ------------------------------------------------------------------ confirmações e atrasos

export interface PendingConfirmation {
  eventId: number;
  title: string;
  date: string;
  period: string;
  place: string;
  reason: string;
  daysUntil: number;
}

export function pendingConfirmations(events: Ev[], participants: Participant[], today: string): PendingConfirmation[] {
  const out: PendingConfirmation[] = [];
  for (const e of events) {
    if (!isOpen(e) || e.end_date < today) continue;
    const reasons: string[] = [];
    if (e.status === 'a_confirmar') reasons.push('Agenda aguardando confirmação');
    const waiting = participants.filter((p) => p.event_id === e.id && p.attendance === 'pendente');
    if (waiting.length) reasons.push(`Presença pendente: ${waiting.map((p) => p.name).join(', ')}`);
    if (!reasons.length) continue;
    out.push({
      eventId: e.id,
      title: e.title,
      date: e.start_date,
      period: formatPeriod(e.start_date, e.end_date),
      place: place(e),
      reason: reasons.join(' · '),
      daysUntil: diffDays(today, e.start_date),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface OverdueItem {
  kind: 'evento' | 'acao';
  id: number;
  title: string;
  due: string;
  daysLate: number;
  message: string;
}

export function overdueItems(events: Ev[], actions: ActionItem[], today: string): OverdueItem[] {
  const out: OverdueItem[] = [];
  for (const e of events) {
    if (isOverdue(e, today)) {
      const late = diffDays(e.end_date, today);
      out.push({ kind: 'evento', id: e.id, title: e.title, due: e.end_date, daysLate: late, message: `Terminou em ${formatDateBR(e.end_date)} e ainda está "${STATUSES[e.status].label}".` });
    }
  }
  for (const a of actions) {
    if (a.due_date && a.due_date < today && isActionOpen(a)) {
      const late = diffDays(a.due_date, today);
      out.push({ kind: 'acao', id: a.id, title: a.title, due: a.due_date, daysLate: late, message: `Prazo ${formatDateBR(a.due_date)} vencido há ${late} dia(s) — ${ACTION_STATUSES[a.status]}.` });
    }
  }
  return out.sort((x, y) => x.due.localeCompare(y.due));
}

// ------------------------------------------------------------------ horários livres

export interface FreeSlot {
  date: string;
  label: string;
  kind: 'dia_livre' | 'janelas';
  windows: Array<{ start: string; end: string }>;
}

export function suggestFreeSlots(
  events: Ev[],
  opts: { from: string; days: number; holidays: Holiday[]; workStart?: string; workEnd?: string; minMinutes?: number; limit?: number },
): FreeSlot[] {
  const workStart = timeToMinutes(opts.workStart ?? '08:00');
  const workEnd = timeToMinutes(opts.workEnd ?? '18:00');
  const minMinutes = opts.minMinutes ?? 60;
  const holidaySet = new Set(opts.holidays.filter((h) => h.scope !== 'facultativo').map((h) => h.date));
  const busy = events.filter((e) => isOpen(e) && isBlocking(e));
  const out: FreeSlot[] = [];
  for (let i = 0; i < opts.days; i++) {
    const date = addDays(opts.from, i);
    if (isWeekend(date) || holidaySet.has(date)) continue;
    const dayEvents = busy.filter((e) => e.start_date <= date && e.end_date >= date);
    const label = `${WEEKDAYS_SHORT_PT[weekday(date)]} ${formatDayMonth(date)}`;
    if (!dayEvents.length) {
      out.push({ date, label, kind: 'dia_livre', windows: [{ start: minutesToTime(workStart), end: minutesToTime(workEnd) }] });
    } else if (dayEvents.every((e) => e.start_time)) {
      const intervals = dayEvents.map((e) => timeWindow(e)!).sort((x, y) => x[0] - y[0]);
      const windows: FreeSlot['windows'] = [];
      let cursor = workStart;
      for (const [s, e] of intervals) {
        if (s - cursor >= minMinutes) windows.push({ start: minutesToTime(cursor), end: minutesToTime(Math.min(s, workEnd)) });
        cursor = Math.max(cursor, e);
      }
      if (workEnd - cursor >= minMinutes) windows.push({ start: minutesToTime(cursor), end: minutesToTime(workEnd) });
      if (windows.length) out.push({ date, label, kind: 'janelas', windows });
    }
    // Dia com compromisso sem horário: ocupado (não presumimos horário livre).
    if (opts.limit && out.length >= opts.limit) break;
  }
  return out;
}

// ------------------------------------------------------------------ prioridades e preparação

export interface Recommendation {
  kind: 'evento' | 'acao';
  id: number;
  title: string;
  score: number;
  when: string;
  reasons: string[];
}

export function recommendPriorities(
  events: Ev[],
  ctx: { today: string; readiness: Readiness[]; pending: PendingConfirmation[]; actions: ActionItem[]; checklist: ChecklistItem[] },
  limit = 6,
): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const e of events) {
    if (!isOpen(e) || e.end_date < ctx.today) continue;
    const until = diffDays(ctx.today, e.start_date);
    if (until > 30) continue;
    const reasons: string[] = [];
    let score = PRIORITIES[e.priority].weight;
    if (until <= 0) {
      score += 35;
      reasons.push('Em andamento hoje');
    } else {
      score += Math.max(0, 30 - until);
      reasons.push(until === 1 ? 'Começa amanhã' : `Começa em ${until} dias`);
    }
    if (e.priority === 'alta' || e.priority === 'critica') reasons.push(`Prioridade ${PRIORITIES[e.priority].label.toLowerCase()}`);
    const r = ctx.readiness.find((x) => x.auditId === e.id || x.prepEventId === e.id);
    if (r && r.level === 'insuficiente') {
      score += 25;
      reasons.push(`Preparação insuficiente (${r.percent}%)`);
    } else if (r && r.phase === 'pre' && r.percent < 100) {
      score += 8;
      reasons.push(`Preparação em ${r.percent}%`);
    }
    if (ctx.pending.some((p) => p.eventId === e.id)) {
      score += 15;
      reasons.push('Aguardando confirmação');
    }
    const openItems = ctx.checklist.filter((i) => i.event_id === e.id && !i.done);
    const crit = openItems.filter((i) => i.critical).length;
    if (crit) {
      score += crit * 5;
      reasons.push(`${crit} item(ns) crítico(s) no checklist`);
    }
    recs.push({ kind: 'evento', id: e.id, title: e.title, score, when: formatPeriod(e.start_date, e.end_date), reasons });
  }
  for (const a of ctx.actions) {
    if (!isActionOpen(a) || !a.due_date) continue;
    const until = diffDays(ctx.today, a.due_date);
    if (until > 14) continue;
    const reasons = [until < 0 ? `Vencida há ${-until} dia(s)` : until === 0 ? 'Vence hoje' : `Vence em ${until} dia(s)`];
    let score = PRIORITIES[a.severity].weight + Math.max(0, 25 - until * 2);
    if (until < 0) score += 30;
    if (a.progress < 50) reasons.push(`Progresso ${a.progress}%`);
    recs.push({ kind: 'acao', id: a.id, title: a.title, score, when: formatDateBR(a.due_date), reasons });
  }
  return recs.sort((x, y) => y.score - x.score).slice(0, limit);
}

export interface PrepTask {
  text: string;
  source: string;
  critical: boolean;
  done: boolean;
}

/** O que precisa estar feito antes do compromisso. */
export function tasksBefore(
  event: Ev,
  ctx: { events: Ev[]; checklist: ChecklistItem[]; participants: Participant[]; actions: ActionItem[] },
): PrepTask[] {
  const out: PrepTask[] = [];
  if (event.status === 'a_confirmar') out.push({ text: 'Confirmar a agenda deste compromisso', source: 'Status', critical: true, done: false });
  for (const p of ctx.participants.filter((x) => x.event_id === event.id && x.attendance === 'pendente')) {
    out.push({ text: `Obter confirmação de presença de ${p.name}`, source: 'Participantes', critical: false, done: false });
  }
  if (event.category === 'auditoria') {
    const prep = findPrepEvent(event, ctx.events);
    if (prep) {
      for (const i of ctx.checklist.filter((x) => x.event_id === prep.id && !x.done)) {
        out.push({ text: i.text, source: `Preparação (${formatPeriod(prep.start_date, prep.end_date)})`, critical: i.critical, done: false });
      }
    }
  }
  for (const i of ctx.checklist.filter((x) => x.event_id === event.id && !x.done && (x.stage === 'pre' || x.stage === 'geral'))) {
    out.push({ text: i.text, source: i.stage === 'pre' ? 'Pré-auditoria' : 'Checklist', critical: i.critical, done: false });
  }
  for (const a of ctx.actions.filter((x) => x.event_id === event.id && isActionOpen(x))) {
    out.push({ text: a.title, source: `Ação${a.due_date ? ` · prazo ${formatDateBR(a.due_date)}` : ''}`, critical: a.severity === 'alta' || a.severity === 'critica', done: false });
  }
  return out;
}

// ------------------------------------------------------------------ indicadores e resumos

/** "Auditoria GMP+" → "auditoria GMP+" (preserva siglas). */
export function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

export function monthExecution(events: Ev[], start: string, end: string) {
  const inMonth = events.filter((e) => e.status !== 'cancelado' && e.start_date <= end && e.end_date >= start);
  const concluded = inMonth.filter((e) => e.status === 'concluido').length;
  return { total: inMonth.length, concluded, percent: inMonth.length ? Math.round((concluded / inMonth.length) * 100) : 0 };
}

export interface Summary {
  label: string;
  start: string;
  end: string;
  total: number;
  agendaDays: number;
  byCategory: Array<{ category: CategoryKey; label: string; count: number }>;
  byPlace: Array<{ place: string; days: number }>;
  concluded: number;
  open: number;
  overdue: number;
  cancelled: number;
  conflicts: Conflict[];
  holidays: HolidayAlert[];
  pending: PendingConfirmation[];
  lines: string[];
  text: string;
}

/** Resumo executivo fundamentado exclusivamente nos dados cadastrados. */
export function buildSummary(
  label: string,
  start: string,
  end: string,
  ctx: { events: Ev[]; actions: ActionItem[]; participants: Participant[]; holidays: Holiday[]; today: string },
): Summary {
  const inRange = ctx.events.filter((e) => e.start_date <= end && e.end_date >= start).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const valid = inRange.filter((e) => e.status !== 'cancelado');
  const byCatMap = new Map<CategoryKey, number>();
  for (const e of valid) byCatMap.set(e.category, (byCatMap.get(e.category) ?? 0) + 1);
  const byCategory = [...byCatMap.entries()].map(([category, count]) => ({ category, label: CATEGORIES[category].label, count })).sort((a, b) => b.count - a.count);
  const placeDays = new Map<string, number>();
  let agendaDays = 0;
  const daySet = new Set<string>();
  for (const e of valid) {
    const s = maxDate(e.start_date, start);
    const f = minDate(e.end_date, end);
    const days = eachDay(s, f);
    if (isBlocking(e)) {
      placeDays.set(place(e), (placeDays.get(place(e)) ?? 0) + days.length);
      days.forEach((d) => daySet.add(d));
    }
  }
  agendaDays = daySet.size;
  const byPlace = [...placeDays.entries()].map(([p, days]) => ({ place: p, days })).sort((a, b) => b.days - a.days);
  const conflicts = detectConflicts(valid).filter((c) => c.dates.some((d) => d >= start && d <= end));
  const holidays = holidayAlerts(valid, ctx.holidays.filter((h) => h.date >= start && h.date <= end));
  const pending = pendingConfirmations(valid, ctx.participants, ctx.today < start ? start : ctx.today).filter((p) => p.date <= end);
  const concluded = valid.filter((e) => e.status === 'concluido').length;
  const overdue = valid.filter((e) => isOverdue(e, ctx.today)).length;
  const cancelled = inRange.length - valid.length;
  const open = valid.length - concluded;
  const actionsDue = ctx.actions.filter((a) => isActionOpen(a) && a.due_date && a.due_date >= start && a.due_date <= end);

  const lines: string[] = [];
  if (!valid.length) {
    lines.push('Nenhum compromisso cadastrado neste período.');
  } else {
    lines.push(
      `${valid.length} compromisso(s) no período, somando ${agendaDays} dia(s) de agenda em campo: ` +
        byCategory.map((c) => `${c.count} ${lowerFirst(c.label)}`).join(', ') +
        '.',
    );
    if (byPlace.length) lines.push(`Distribuição por local: ${byPlace.map((p) => `${p.place} (${p.days} dia${p.days > 1 ? 's' : ''})`).join(', ')}.`);
    lines.push(`Situação: ${concluded} concluído(s), ${open} em aberto${overdue ? `, ${overdue} atrasado(s)` : ''}${cancelled ? `, ${cancelled} cancelado(s)` : ''}.`);
    for (const e of valid) {
      lines.push(`• ${formatPeriod(e.start_date, e.end_date)} — ${e.title}${e.title.includes(place(e)) ? '' : ` · ${place(e)}`} · ${STATUSES[e.status].label}`);
    }
  }
  for (const c of conflicts) lines.push(`Atenção: ${c.message}`);
  for (const h of holidays) lines.push(`Atenção: ${h.message}`);
  for (const p of pending) lines.push(`Pendente: ${p.title} (${p.period}) — ${p.reason}.`);
  if (actionsDue.length) lines.push(`${actionsDue.length} ação(ões) com prazo no período: ${actionsDue.map((a) => `${a.title} (${formatDateBR(a.due_date!)})`).join('; ')}.`);

  return {
    label,
    start,
    end,
    total: valid.length,
    agendaDays,
    byCategory,
    byPlace,
    concluded,
    open,
    overdue,
    cancelled,
    conflicts,
    holidays,
    pending,
    lines,
    text: [`Resumo — ${label}`, ...lines].join('\n'),
  };
}
