// Planejador: varre a agenda e coloca na fila os avisos devidos.
// É idempotente — pode rodar a cada minuto; a chave de deduplicação impede repetição.
import { config } from '../config.ts';
import { loadContext } from '../repo/events.ts';
import { allHolidays } from '../repo/settings.ts';
import { enqueue } from './queue.ts';
import { listRecipients, recipientWants } from './recipients.ts';
import { addDays, diffDays, isoWeekKey, nowInTz, startOfWeekMonday, zonedToUtc, formatDayMonth } from '../../shared/dates.ts';
import { detectConflicts, holidayAlerts, isActionOpen, isOpen, pendingConfirmations } from '../../shared/intelligence.ts';
import type { AgendaEvent, Recipient } from '../../shared/types.ts';
import type { NotificationType } from '../../shared/constants.ts';

const LATE_TOLERANCE_MS = 2 * 60 * 60 * 1000; // lembrete atrasado até 2 h ainda é enviado

export interface PlanResult {
  created: number;
  byType: Partial<Record<NotificationType, number>>;
}

export function planNotifications(now: Date = new Date()): PlanResult {
  const tz = config.timezone;
  const { date: today, weekday } = nowInTz(tz, now);
  const ctx = loadContext(null);
  const recipients = listRecipients().filter((r) => r.active && r.consent_status === 'concedido');
  const result: PlanResult = { created: 0, byType: {} };
  if (!recipients.length) return result;

  const push = (type: NotificationType, ok: boolean) => {
    if (ok) {
      result.created++;
      result.byType[type] = (result.byType[type] ?? 0) + 1;
    }
  };
  const involvedOf = (e: AgendaEvent) => ctx.participants.filter((p) => p.event_id === e.id && p.user_id).map((p) => p.user_id as number);
  const pendingCount = (e: AgendaEvent) => ctx.checklist.filter((i) => i.event_id === e.id && !i.done).length;

  /** Agenda no horário local do destinatário; se já passou, decide pela tolerância. */
  const at = (date: string, time: string, opts: { allowLateUntil?: Date } = {}): Date | null => {
    const when = zonedToUtc(date, time, tz);
    if (when.getTime() >= now.getTime()) return when;
    if (opts.allowLateUntil && now.getTime() <= opts.allowLateUntil.getTime()) return now;
    return null;
  };

  const upcoming = ctx.events.filter((e) => isOpen(e) && e.end_date >= today);
  const pend = pendingConfirmations(upcoming, ctx.participants, today);

  for (const r of recipients) {
    const p = r.preferences;
    for (const e of upcoming) {
      const involved = involvedOf(e);
      const startsIn = diffDays(today, e.start_date);
      const key = (t: string) => `${t}:${e.id}:${r.id}:${e.start_date}`;
      const base = { recipientId: r.id, eventId: e.id };

      // 1. Aviso antecipado
      if (startsIn >= 1 && recipientWants(r, 'aviso_antecipado', e, involved)) {
        const adv = e.notification_settings?.advanceDays ?? p.advanceDays;
        const sendDate = addDays(e.start_date, -adv);
        // Se o dia do aviso já passou mas ainda faltam 2+ dias, avisa agora (a véspera cobre o resto).
        const when = at(sendDate, p.advanceTime) ?? (startsIn >= 2 && sendDate <= today ? now : null);
        if (when && adv >= 2) push('aviso_antecipado', enqueue({ ...base, type: 'aviso_antecipado', dedupeKey: key('aviso'), scheduledFor: when, preview: { event: e, recipientName: r.name } }));
      }
      // 2. Véspera
      if (startsIn >= 1 && recipientWants(r, 'lembrete_vespera', e, involved)) {
        const target = zonedToUtc(addDays(e.start_date, -1), p.eveTime, tz);
        const when = at(addDays(e.start_date, -1), p.eveTime, { allowLateUntil: new Date(target.getTime() + LATE_TOLERANCE_MS) });
        if (when) push('lembrete_vespera', enqueue({ ...base, type: 'lembrete_vespera', dedupeKey: key('vespera'), scheduledFor: when, preview: { event: e, recipientName: r.name, pendingCount: pendingCount(e) } }));
      }
      // 3. No dia
      if (startsIn >= 0 && recipientWants(r, 'lembrete_dia', e, involved)) {
        const target = zonedToUtc(e.start_date, p.dayOfTime, tz);
        const when = at(e.start_date, p.dayOfTime, { allowLateUntil: new Date(target.getTime() + LATE_TOLERANCE_MS) });
        if (when) push('lembrete_dia', enqueue({ ...base, type: 'lembrete_dia', dedupeKey: key('dia'), scheduledFor: when, preview: { event: e, recipientName: r.name, pendingCount: pendingCount(e) } }));
      }
      // 8. Confirmação de presença (só para o próprio participante)
      if (startsIn >= 0 && r.user_id && recipientWants(r, 'confirmacao_presenca', e, involved)) {
        for (const part of ctx.participants.filter((x) => x.event_id === e.id && x.user_id === r.user_id && x.attendance === 'pendente')) {
          push(
            'confirmacao_presenca',
            enqueue({ ...base, type: 'confirmacao_presenca', dedupeKey: `presenca:${e.id}:${part.id}:${r.id}:${e.start_date}`, scheduledFor: now, preview: { event: e, recipientName: r.name, participantId: part.id } }),
          );
        }
      }
    }

    // 5. Reunião/agenda ainda não confirmada — diariamente às 09:00 nos 7 dias anteriores
    for (const pc of pend) {
      if (pc.daysUntil > 7 || pc.daysUntil < 0) continue;
      const e = upcoming.find((x) => x.id === pc.eventId)!;
      if (!recipientWants(r, 'reuniao_nao_confirmada', e, involvedOf(e))) continue;
      const when = at(today, '09:00') ?? now;
      push(
        'reuniao_nao_confirmada',
        enqueue({ type: 'reuniao_nao_confirmada', recipientId: r.id, eventId: e.id, dedupeKey: `naoconf:${e.id}:${r.id}:${today}`, scheduledFor: when, preview: { event: e, recipientName: r.name, pendingReason: pc.reason } }),
      );
    }

    // 6. Pendências (ações) com prazo em até 2 dias
    if (p.types.pendencia_vencimento !== false) {
      for (const a of ctx.actions) {
        if (!isActionOpen(a) || !a.due_date) continue;
        const d = diffDays(today, a.due_date);
        if (d < 0 || d > 2) continue;
        const ev = a.event_id ? ctx.events.find((x) => x.id === a.event_id) ?? null : null;
        const involvedAction = a.responsible_user_id != null && a.responsible_user_id === r.user_id;
        const generalOk = recipientWants(r, 'pendencia_vencimento', null, []);
        const wants = ev
          ? recipientWants(r, 'pendencia_vencimento', ev, involvedOf(ev)) || (involvedAction && generalOk)
          : generalOk && (p.scope === 'todos' || involvedAction);
        if (!wants) continue;
        const when = at(today, '08:00') ?? now;
        push('pendencia_vencimento', enqueue({ type: 'pendencia_vencimento', recipientId: r.id, actionId: a.id, eventId: a.event_id, dedupeKey: `pendencia:${a.id}:${r.id}:${today}`, scheduledFor: when, preview: { action: a, recipientName: r.name } }));
      }
    }

    // 7. Resumo semanal — segunda-feira no horário escolhido
    if (p.types.resumo_semanal !== false && recipientWants(r, 'resumo_semanal', null, [])) {
      const monday = weekday === 1 ? today : addDays(startOfWeekMonday(today), 7);
      const target = zonedToUtc(monday, p.weeklyTime, tz);
      const when = at(monday, p.weeklyTime, { allowLateUntil: new Date(target.getTime() + 10 * 60 * 60 * 1000) });
      if (when) {
        push('resumo_semanal', enqueue({ type: 'resumo_semanal', recipientId: r.id, dedupeKey: `semanal:${r.id}:${isoWeekKey(monday)}`, scheduledFor: when, preview: { recipientName: r.name, week: weeklyDigest(r, monday, ctx) } }));
      }
    }
  }
  return result;
}

/** Conteúdo do resumo semanal, montado com os compromissos que o destinatário pode receber. */
export function weeklyDigest(r: Recipient, monday: string, ctx = loadContext(null)) {
  const sunday = addDays(monday, 6);
  const events = ctx.events
    .filter((e) => e.status !== 'cancelado' && e.start_date <= sunday && e.end_date >= monday)
    .filter((e) => recipientWants({ ...r, preferences: { ...r.preferences, types: { ...r.preferences.types, resumo_semanal: true } } }, 'resumo_semanal', e, ctx.participants.filter((p) => p.event_id === e.id && p.user_id).map((p) => p.user_id as number)));
  const conflicts = detectConflicts(events).filter((c) => c.dates.some((d) => d >= monday && d <= sunday));
  const holidays = holidayAlerts(events, allHolidays(monday, sunday));
  const pend = pendingConfirmations(events, ctx.participants, monday);
  const alerts = [
    ...conflicts.map((c) => `possível conflito em ${c.dates.map(formatDayMonth).join(', ')}`),
    ...holidays.map((h) => `feriado em ${formatDayMonth(h.date)} (${h.holiday})`),
    ...pend.map((p) => `${p.title} a confirmar`),
  ];
  return {
    label: `${formatDayMonth(monday)} a ${formatDayMonth(sunday)}`,
    total: events.length ? `${events.length} compromisso(s)` : 'nenhum compromisso',
    list: events.length ? events.map((e) => `${formatDayMonth(e.start_date)} ${e.title} (${e.unit_name || e.municipality || 'a definir'})`).join(' | ') : 'semana livre',
    alerts: alerts.length ? alerts.join('; ') : 'nenhum alerta',
  };
}
