// Painel executivo, motor de análise, auditorias e assistente fundamentado nos dados.
import type { Router } from '../http.ts';
import { HttpError } from '../http.ts';
import { can } from '../auth.ts';
import { all } from '../db.ts';
import { loadContext } from '../repo/events.ts';
import { allHolidays, effectiveWhatsAppMode } from '../repo/settings.ts';
import {
  auditReadiness,
  buildSummary,
  detectConflicts,
  eventDays,
  findPrepEvent,
  holidayAlerts,
  isOpen,
  isOverdue,
  monthExecution,
  overdueItems,
  pendingConfirmations,
  recommendPriorities,
  suggestFreeSlots,
  tasksBefore,
} from '../../shared/intelligence.ts';
import { CATEGORIES, STATUSES } from '../../shared/constants.ts';
import {
  addDays,
  addMonths,
  formatDateBR,
  formatPeriod,
  monthKey,
  monthLabel,
  monthRange,
  MONTHS_PT,
  startOfWeekMonday,
  todayInTz,
} from '../../shared/dates.ts';
import type { SessionUser } from '../../shared/types.ts';

export function analysis(user: SessionUser) {
  const today = todayInTz(user.timezone);
  const ctx = loadContext(user);
  const holidays = allHolidays(addDays(today, -60), addDays(today, 400));
  const upcoming = ctx.events.filter((e) => e.end_date >= today);
  const conflicts = detectConflicts(ctx.events).filter((c) => c.dates[c.dates.length - 1] >= today);
  const holidayWarnings = holidayAlerts(upcoming, holidays);
  const audits = ctx.events.filter((e) => e.category === 'auditoria' && e.status !== 'cancelado');
  const readiness = audits.map((a) => auditReadiness(a, { events: ctx.events, checklist: ctx.checklist, actions: ctx.actions, today }));
  const pending = pendingConfirmations(ctx.events, ctx.participants, today);
  const overdue = overdueItems(ctx.events, ctx.actions, today);
  const recommendations = recommendPriorities(ctx.events, { today, readiness, pending, actions: ctx.actions, checklist: ctx.checklist });
  const freeSlots = suggestFreeSlots(ctx.events, { from: addDays(today, 1), days: 30, holidays, limit: 8 });
  return { today, ctx, holidays, conflicts, holidayWarnings, audits, readiness, pending, overdue, recommendations, freeSlots };
}

function checklistProgress(ctx: ReturnType<typeof loadContext>, id: number) {
  const items = ctx.checklist.filter((c) => c.event_id === id);
  return { total: items.length, done: items.filter((c) => c.done).length };
}

export function dashboardData(user: SessionUser) {
  const a = analysis(user);
  const { today, ctx } = a;
  const open = ctx.events.filter((e) => isOpen(e));
  const sorted = [...open].filter((e) => e.end_date >= today).sort((x, y) => x.start_date.localeCompare(y.start_date) || (x.start_time ?? '').localeCompare(y.start_time ?? ''));
  const next = sorted[0] ?? null;
  const missionReadiness = next
    ? a.readiness.find((r) => r.auditId === next.id || r.prepEventId === next.id) ?? null
    : null;
  const nextMission = next
    ? {
        event: next,
        checklist: ctx.checklist.filter((c) => c.event_id === next.id),
        progress: checklistProgress(ctx, next.id),
        readiness: missionReadiness,
        tasksBefore: tasksBefore(next, ctx).slice(0, 6),
        inProgress: next.start_date <= today,
        days: eventDays(next),
      }
    : null;
  const todayEvents = ctx.events.filter((e) => e.status !== 'cancelado' && e.start_date <= today && e.end_date >= today);
  const next7 = ctx.events.filter((e) => e.status !== 'cancelado' && e.start_date > today && e.start_date <= addDays(today, 7));
  const auditsActive = a.audits
    .filter((e) => e.end_date >= today && e.start_date <= addDays(today, 60))
    .map((e) => {
      const r = a.readiness.find((x) => x.auditId === e.id)!;
      const prep = findPrepEvent(e, ctx.events);
      return { event: e, readiness: r, prep: prep ? { id: prep.id, title: prep.title, period: formatPeriod(prep.start_date, prep.end_date) } : null };
    });
  const visits = ctx.events.filter((e) => CATEGORIES[e.category].group === 'visita' && isOpen(e) && e.end_date >= today).slice(0, 6);
  const month = monthKey(today);
  const mr = monthRange(month);
  const exec = monthExecution(ctx.events, mr.start, mr.end);
  const concluded = ctx.events.filter((e) => e.status === 'concluido');
  const overdueEvents = ctx.events.filter((e) => isOverdue(e, today));
  const timeline = sorted.slice(0, 8).map((e) => ({ ...e, progress: checklistProgress(ctx, e.id) }));

  // Gráfico: compromissos por mês (mês atual + 2 seguintes, e o anterior) por grupo de categoria.
  const months = [-1, 0, 1, 2].map((k) => monthKey(addMonths(`${month}-01`, k)));
  const groups = ['auditoria', 'visita', 'reuniao', 'confirmacao', 'administrativo', 'outro'] as const;
  const chart = months.map((m) => {
    const r = monthRange(m);
    const inM = ctx.events.filter((e) => e.status !== 'cancelado' && e.start_date <= r.end && e.end_date >= r.start);
    const counts = Object.fromEntries(groups.map((g) => [g, inM.filter((e) => CATEGORIES[e.category].group === g).length]));
    return { month: m, label: `${MONTHS_PT[Number(m.slice(5)) - 1].slice(0, 3)}/${m.slice(2, 4)}`, ...counts, concluded: inM.filter((e) => e.status === 'concluido').length, total: inM.length };
  });

  let notifications: null | { mode: string; counts: Record<string, number>; queued: number } = null;
  if (can(user, 'whatsapp.manage')) {
    const rows = all<{ status: string; c: number }>('SELECT status, COUNT(*) AS c FROM notifications GROUP BY status');
    const counts = Object.fromEntries(rows.map((r) => [r.status, r.c]));
    notifications = { mode: effectiveWhatsAppMode(), counts, queued: counts.pendente ?? 0 };
  }

  return {
    today,
    nextMission,
    todayEvents,
    next7,
    auditsActive,
    pending: a.pending,
    visits,
    stats: {
      monthLabel: monthLabel(month),
      monthTotal: exec.total,
      monthConcluded: exec.concluded,
      executionPercent: exec.percent,
      concludedTotal: concluded.length,
      overdueTotal: a.overdue.length,
      overdueEvents: overdueEvents.length,
      upcomingTotal: sorted.length,
      pendingTotal: a.pending.length,
      conflictsTotal: a.conflicts.length,
    },
    timeline,
    conflicts: a.conflicts,
    holidayWarnings: a.holidayWarnings,
    overdue: a.overdue,
    recommendations: a.recommendations,
    freeSlots: a.freeSlots,
    chart,
    notifications,
  };
}

function summaryFor(user: SessionUser, kind: 'semana' | 'mes', ref?: string) {
  const a = analysis(user);
  const base = ref ?? a.today;
  if (kind === 'semana') {
    const s = startOfWeekMonday(base);
    const e = addDays(s, 6);
    return buildSummary(`semana de ${formatPeriod(s, e)}`, s, e, { ...a.ctx, holidays: a.holidays, today: a.today });
  }
  const m = monthKey(base);
  const r = monthRange(m);
  return buildSummary(monthLabel(m), r.start, r.end, { ...a.ctx, holidays: allHolidays(r.start, r.end), today: a.today });
}

/** Assistente: responde apenas com dados autorizados do sistema; nunca inventa. */
export function assistantAnswer(user: SessionUser, question: string) {
  const q = question.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const a = analysis(user);
  const monthIdx = MONTHS_PT.findIndex((m) => q.includes(m.normalize('NFD').replace(/[̀-ͯ]/g, '')));
  const sources: Array<{ id: number; title: string }> = [];
  if (/(proxima semana|semana que vem)/.test(q) || (/agenda/.test(q) && /semana/.test(q))) {
    const s = addDays(startOfWeekMonday(a.today), 7);
    const sum = buildSummary(`próxima semana (${formatPeriod(s, addDays(s, 6))})`, s, addDays(s, 6), { ...a.ctx, holidays: a.holidays, today: a.today });
    a.ctx.events.filter((e) => e.start_date <= addDays(s, 6) && e.end_date >= s).forEach((e) => sources.push({ id: e.id, title: e.title }));
    return { intent: 'agenda_semana', title: 'Sua agenda da próxima semana', text: sum.text, sources };
  }
  if (/(preparar|preparo|preparacao).*(auditoria)|auditoria.*(preparar|preparacao)|gmp/.test(q)) {
    const nextAudit = a.audits.filter((e) => e.end_date >= a.today && isOpen(e)).sort((x, y) => x.start_date.localeCompare(y.start_date))[0];
    if (!nextAudit) return { intent: 'auditoria', title: 'Preparação para auditoria', text: 'Não há auditoria futura cadastrada no sistema.', sources };
    const r = a.readiness.find((x) => x.auditId === nextAudit.id)!;
    const tasks = tasksBefore(nextAudit, a.ctx);
    sources.push({ id: nextAudit.id, title: nextAudit.title });
    if (r.prepEventId) sources.push({ id: r.prepEventId, title: a.ctx.events.find((e) => e.id === r.prepEventId)?.title ?? 'Preparação' });
    const lines = [
      `Próxima auditoria: ${nextAudit.title} (${formatPeriod(nextAudit.start_date, nextAudit.end_date)}).`,
      `Preparação registrada: ${r.percent}% (${r.done} de ${r.total} itens) · faltam ${r.daysRemaining} dia(s).`,
      ...(r.reasons.length ? [`Atenção: ${r.reasons.join(' ')}`] : []),
      tasks.length ? 'Itens pendentes cadastrados:' : 'Nenhum item pendente cadastrado.',
      ...tasks.map((t) => `• ${t.text} — ${t.source}${t.critical ? ' (crítico)' : ''}`),
      'Observação: a lista reflete os checklists cadastrados no sistema; requisitos específicos da certificação devem ser validados com a norma GMP+ vigente.',
    ];
    return { intent: 'auditoria', title: 'O que preparar para a auditoria GMP+', text: lines.join('\n'), sources };
  }
  if (/(confirmar|confirmacao|pendente).*(reuni|agenda)|reuni.*(confirmar|confirmacao|pendente)/.test(q)) {
    a.pending.forEach((p) => sources.push({ id: p.eventId, title: p.title }));
    const text = a.pending.length
      ? ['Compromissos aguardando confirmação:', ...a.pending.map((p) => `• ${p.period} — ${p.title} (${p.place}): ${p.reason}`)].join('\n')
      : 'Nenhuma reunião ou agenda aguardando confirmação no momento.';
    return { intent: 'confirmacoes', title: 'Reuniões e agendas a confirmar', text, sources };
  }
  if (/(resumo|resuma|relatorio)/.test(q)) {
    const year = Number(a.today.slice(0, 4));
    let ref = a.today;
    if (monthIdx >= 0) {
      // "novembro" = o próximo novembro (ou o atual); meses bem anteriores ao atual referem-se ao ano seguinte.
      const current = Number(a.today.slice(5, 7));
      const y = monthIdx + 1 < current - 3 ? year + 1 : year;
      ref = `${y}-${String(monthIdx + 1).padStart(2, '0')}-01`;
    }
    const sum = /semana/.test(q) ? summaryFor(user, 'semana', ref) : summaryFor(user, 'mes', ref);
    a.ctx.events.filter((e) => e.start_date <= sum.end && e.end_date >= sum.start).forEach((e) => sources.push({ id: e.id, title: e.title }));
    const forCoord = /coordenador/.test(q);
    return { intent: 'resumo', title: `Resumo ${sum.label}${forCoord ? ' para o coordenador' : ''}`, text: sum.text, sources };
  }
  return {
    intent: 'desconhecido',
    title: 'Ainda não sei responder isso',
    text: 'Posso responder com base nos dados cadastrados sobre: agenda da próxima semana, preparação para auditoria GMP+, reuniões a confirmar e resumos mensais ou semanais (ex.: "Faça um resumo de novembro").',
    sources,
  };
}

export function registerInsightRoutes(r: Router) {
  r.get('/api/dashboard', (ctx) => dashboardData(ctx.user!), { perm: 'dashboard.view' });

  r.get('/api/insights', (ctx) => {
    const a = analysis(ctx.user!);
    return {
      today: a.today,
      conflicts: a.conflicts,
      holidayWarnings: a.holidayWarnings,
      readiness: a.readiness,
      pending: a.pending,
      overdue: a.overdue,
      recommendations: a.recommendations,
      freeSlots: a.freeSlots,
      week: summaryFor(ctx.user!, 'semana'),
      month: summaryFor(ctx.user!, 'mes'),
    };
  }, { perm: 'dashboard.view' });

  r.get('/api/summary', (ctx) => {
    const kind = ctx.url.searchParams.get('kind') === 'semana' ? 'semana' : 'mes';
    const ref = ctx.url.searchParams.get('ref') ?? undefined;
    if (ref && !/^\d{4}-\d{2}(-\d{2})?$/.test(ref)) throw new HttpError(400, 'Referência inválida');
    return summaryFor(ctx.user!, kind, ref && ref.length === 7 ? `${ref}-01` : ref);
  }, { perm: 'dashboard.view' });

  r.get('/api/audits', (ctx) => {
    const a = analysis(ctx.user!);
    return {
      today: a.today,
      audits: a.audits
        .sort((x, y) => x.start_date.localeCompare(y.start_date))
        .map((e) => {
          const readiness = a.readiness.find((x) => x.auditId === e.id)!;
          const items = a.ctx.checklist.filter((c) => c.event_id === e.id);
          const stage = (s: string) => {
            const it = items.filter((c) => c.stage === s);
            return { total: it.length, done: it.filter((c) => c.done).length };
          };
          const findings = a.ctx.actions.filter((x) => x.event_id === e.id || (readiness.prepEventId && x.event_id === readiness.prepEventId));
          return {
            event: e,
            readiness,
            stages: { pre: stage('pre'), durante: stage('durante'), pos: stage('pos') },
            findings: { total: findings.length, open: findings.filter((f) => f.status === 'aberta' || f.status === 'em_andamento').length, critical: findings.filter((f) => (f.severity === 'alta' || f.severity === 'critica') && f.status !== 'concluida' && f.status !== 'cancelada').length },
            conflicts: a.conflicts.filter((c) => c.a.id === e.id || c.b.id === e.id),
            statusLabel: STATUSES[e.status].label,
          };
        }),
    };
  }, { perm: ['events.view_all', 'events.view_shared'] });

  r.get('/api/assistant', (ctx) => {
    const q = (ctx.url.searchParams.get('q') ?? '').slice(0, 300);
    if (!q.trim()) throw new HttpError(400, 'Faça uma pergunta.');
    return assistantAnswer(ctx.user!, q);
  }, { perm: 'dashboard.view' });

  r.get('/api/calendar/holidays', (ctx) => {
    const from = ctx.url.searchParams.get('from') ?? todayInTz(ctx.user!.timezone);
    const to = ctx.url.searchParams.get('to') ?? addDays(from, 120);
    return { holidays: allHolidays(from, to).map((h) => ({ ...h, label: `${formatDateBR(h.date)} — ${h.name}` })) };
  });
}
