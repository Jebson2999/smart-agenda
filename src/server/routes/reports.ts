import type { Router } from '../http.ts';
import { HttpError, intParam, sendFile } from '../http.ts';
import { listEvents, loadContext, getVisibleEvent, checklistFor, participantsFor, actionsFor, historyFor, commentsFor } from '../repo/events.ts';
import { allHolidays } from '../repo/settings.ts';
import { analysis } from './insights.ts';
import { auditReadiness, buildSummary, detectConflicts, findPrepEvent, holidayAlerts } from '../../shared/intelligence.ts';
import { addDays, formatPeriod, isISODate, monthKey, monthLabel, monthRange, startOfWeekMonday, todayInTz } from '../../shared/dates.ts';
import { CATEGORIES, STATUSES, PRIORITIES, ACTION_STATUSES, ACTION_ORIGINS, CHECKLIST_STAGES } from '../../shared/constants.ts';
import { auditReportPdf, executiveSummaryPdf, monthlyAgendaPdf, visitsMeetingsPdf } from '../reports/pdf.ts';
import { buildXlsx } from '../reports/xlsx.ts';
import { eventsToIcs } from '../reports/ics.ts';

function parseMonth(v: string | null, today: string): string {
  if (!v) return monthKey(today);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new HttpError(400, 'Mês inválido (use AAAA-MM)');
  return v;
}

function parseRange(q: URLSearchParams, today: string) {
  const from = q.get('from');
  const to = q.get('to');
  if (from && !isISODate(from)) throw new HttpError(400, 'Data inicial inválida');
  if (to && !isISODate(to)) throw new HttpError(400, 'Data final inválida');
  const start = from ?? monthRange(monthKey(today)).start;
  const end = to ?? addDays(start, 120);
  if (end < start) throw new HttpError(400, 'Período inválido');
  return { start, end };
}

export function registerReportRoutes(r: Router) {
  const opts = { perm: 'reports.view' as const };

  r.get('/api/reports/agenda-mensal.pdf', async (ctx) => {
    const today = todayInTz(ctx.user!.timezone);
    const month = parseMonth(ctx.url.searchParams.get('month'), today);
    const { start, end } = monthRange(month);
    const events = listEvents(ctx.user, { from: start, to: end });
    const all = loadContext(ctx.user);
    const pdf = await monthlyAgendaPdf(month, events, allHolidays(addDays(start, -7), addDays(end, 7)), detectConflicts(all.events));
    sendFile(ctx.res, pdf, 'application/pdf', `agenda-${month}.pdf`, ctx.url.searchParams.get('inline') === '1');
  }, opts);

  r.get('/api/reports/resumo-executivo.pdf', async (ctx) => {
    const a = analysis(ctx.user!);
    const kind = ctx.url.searchParams.get('kind') === 'semana' ? 'semana' : 'mes';
    const ref = ctx.url.searchParams.get('ref');
    let start: string;
    let end: string;
    let label: string;
    if (kind === 'semana') {
      start = startOfWeekMonday(ref && isISODate(ref) ? ref : a.today);
      end = addDays(start, 6);
      label = `semana de ${formatPeriod(start, end)}`;
    } else {
      const m = parseMonth(ref, a.today);
      ({ start, end } = monthRange(m));
      label = monthLabel(m);
    }
    const summary = buildSummary(label, start, end, { ...a.ctx, holidays: allHolidays(start, end), today: a.today });
    const readiness = a.readiness
      .map((r) => ({ ...r, ev: a.ctx.events.find((e) => e.id === r.auditId)! }))
      .filter((r) => r.ev.start_date <= end && r.ev.end_date >= start)
      .map((r) => ({ ...r, title: r.ev.title, period: formatPeriod(r.ev.start_date, r.ev.end_date) }));
    const pdf = await executiveSummaryPdf(summary, readiness, a.overdue.filter((o) => o.due >= start && o.due <= end));
    sendFile(ctx.res, pdf, 'application/pdf', `resumo-${kind}-${start}.pdf`, ctx.url.searchParams.get('inline') === '1');
  }, opts);

  r.get('/api/reports/auditoria/:id', async (ctx) => {
    const id = intParam(ctx.params.id);
    const event = getVisibleEvent(ctx.user!, id);
    if (event.category !== 'auditoria') throw new HttpError(422, 'Este compromisso não é uma auditoria.');
    const today = todayInTz(ctx.user!.timezone);
    const all = loadContext(ctx.user);
    const prep = findPrepEvent(event, all.events) ?? null;
    const ids = [id, ...(prep ? [prep.id] : [])];
    const pdf = await auditReportPdf({
      event,
      prep,
      readiness: auditReadiness(event, { events: all.events, checklist: all.checklist, actions: all.actions, today }),
      checklist: checklistFor(ids),
      actions: actionsFor(ctx.user, ids).filter((a) => a.event_id != null && ids.includes(a.event_id)),
      participants: participantsFor([id]),
      conflicts: detectConflicts(all.events).filter((c) => c.a.id === id || c.b.id === id),
      holidays: holidayAlerts([event], allHolidays(event.start_date, event.end_date)),
      history: historyFor(id) as unknown as Array<{ created_at: string; summary: string; user_name?: string | null }>,
      comments: commentsFor(id) as unknown as Array<{ created_at: string; text: string; user_name?: string | null }>,
    });
    sendFile(ctx.res, pdf, 'application/pdf', `relatorio-auditoria-${id}.pdf`, ctx.url.searchParams.get('inline') === '1');
  }, opts);

  r.get('/api/reports/visitas-reunioes.pdf', async (ctx) => {
    const today = todayInTz(ctx.user!.timezone);
    const { start, end } = parseRange(ctx.url.searchParams, today);
    const events = listEvents(ctx.user, { from: start, to: end }).filter((e) => ['visita', 'reuniao'].includes(CATEGORIES[e.category].group) && e.status !== 'cancelado');
    const ids = events.map((e) => e.id);
    const checklist = checklistFor(ids);
    const parts = participantsFor(ids);
    const actions = actionsFor(ctx.user, ids);
    const pdf = await visitsMeetingsPdf(
      formatPeriod(start, end),
      events.map((event) => ({
        event,
        checklist: checklist.filter((c) => c.event_id === event.id),
        participants: parts.filter((p) => p.event_id === event.id),
        actions: actions.filter((a) => a.event_id === event.id),
        comments: commentsFor(event.id) as unknown as Array<{ text: string; user_name?: string | null; created_at: string }>,
      })),
    );
    sendFile(ctx.res, pdf, 'application/pdf', `visitas-reunioes-${start}.pdf`, ctx.url.searchParams.get('inline') === '1');
  }, opts);

  r.get('/api/reports/agenda.xlsx', async (ctx) => {
    const today = todayInTz(ctx.user!.timezone);
    const { start, end } = parseRange(ctx.url.searchParams, today);
    const events = listEvents(ctx.user, { from: start, to: end });
    const ids = events.map((e) => e.id);
    const checklist = checklistFor(ids);
    const actions = actionsFor(ctx.user, ids);
    const conflicts = detectConflicts(loadContext(ctx.user).events);
    const holidays = holidayAlerts(events, allHolidays(start, end));
    const buf = await buildXlsx([
      {
        name: 'Agenda',
        columns: [
          { header: 'Data inicial', width: 12, type: 'date' },
          { header: 'Data final', width: 12, type: 'date' },
          { header: 'Horário', width: 12 },
          { header: 'Compromisso', width: 44 },
          { header: 'Categoria', width: 26 },
          { header: 'Unidade', width: 20 },
          { header: 'Município', width: 18 },
          { header: 'Cliente', width: 16 },
          { header: 'Responsável', width: 22 },
          { header: 'Prioridade', width: 11 },
          { header: 'Status', width: 13 },
          { header: 'Checklist', width: 11, type: 'percent' },
          { header: 'Alertas', width: 50 },
          { header: 'Observações', width: 40 },
        ],
        rows: events.map((e) => {
          const items = checklist.filter((c) => c.event_id === e.id);
          const alerts = [
            ...conflicts.filter((c) => c.a.id === e.id || c.b.id === e.id).map((c) => c.message),
            ...holidays.filter((h) => h.eventId === e.id).map((h) => h.message),
          ].join(' | ');
          return [
            e.start_date,
            e.end_date,
            e.start_time ? `${e.start_time}${e.end_time ? `–${e.end_time}` : ''}` : '',
            e.title,
            CATEGORIES[e.category].label,
            e.unit_name ?? 'A definir',
            e.municipality ?? '',
            e.client ?? '',
            e.responsible_name ?? '',
            PRIORITIES[e.priority].label,
            STATUSES[e.status].label,
            items.length ? items.filter((c) => c.done).length / items.length : null,
            alerts,
            e.notes ?? '',
          ];
        }),
      },
      {
        name: 'Checklists',
        columns: [{ header: 'Compromisso', width: 44 }, { header: 'Data', width: 12, type: 'date' }, { header: 'Etapa', width: 20 }, { header: 'Item', width: 50 }, { header: 'Crítico', width: 9 }, { header: 'Concluído', width: 11 }, { header: 'Concluído em', width: 14, type: 'date' }],
        rows: checklist.map((c) => {
          const e = events.find((x) => x.id === c.event_id)!;
          return [e.title, e.start_date, CHECKLIST_STAGES[c.stage], c.text, c.critical ? 'Sim' : '', c.done ? 'Sim' : 'Não', c.done_at ? c.done_at.slice(0, 10) : ''];
        }),
      },
      {
        name: 'Ações',
        columns: [{ header: 'Ação', width: 44 }, { header: 'Compromisso', width: 40 }, { header: 'Origem', width: 18 }, { header: 'Responsável', width: 22 }, { header: 'Prazo', width: 12, type: 'date' }, { header: 'Status', width: 13 }, { header: 'Progresso', width: 11, type: 'percent' }, { header: 'Prioridade', width: 11 }],
        rows: actions.map((a) => [a.title, a.event_title ?? '', ACTION_ORIGINS[a.origin], a.responsible_name ?? '', a.due_date ?? '', ACTION_STATUSES[a.status], a.progress / 100, PRIORITIES[a.severity].label]),
      },
    ]);
    sendFile(ctx.res, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `agenda-${start}_${end}.xlsx`);
  }, opts);

  r.get('/api/reports/agenda.ics', (ctx) => {
    const today = todayInTz(ctx.user!.timezone);
    const { start, end } = parseRange(ctx.url.searchParams, today);
    const events = listEvents(ctx.user, { from: start, to: end }).filter((e) => e.status !== 'cancelado');
    sendFile(ctx.res, eventsToIcs(events), 'text/calendar; charset=utf-8', `agenda-${start}_${end}.ics`);
  }, opts);
}
