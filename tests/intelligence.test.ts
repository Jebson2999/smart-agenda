// Regras de negócio do motor de inteligência (funções puras).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditReadiness, buildSummary, detectConflicts, holidayAlerts, overdueItems, pendingConfirmations, recommendPriorities, suggestFreeSlots, tasksBefore } from '../src/shared/intelligence.ts';
import { easterSunday, holidaysBetween, nationalHolidays } from '../src/shared/holidays.ts';
import { addMonths, formatPeriod, zonedToUtc, nowInTz, startOfWeekMonday } from '../src/shared/dates.ts';
import type { ActionItem, AgendaEvent, ChecklistItem, Participant } from '../src/shared/types.ts';

let seq = 0;
function ev(p: Partial<AgendaEvent>): AgendaEvent {
  seq++;
  return {
    id: p.id ?? seq,
    title: p.title ?? `Evento ${seq}`,
    description: null,
    category: p.category ?? 'visita_tecnica',
    start_date: p.start_date ?? '2026-10-19',
    end_date: p.end_date ?? p.start_date ?? '2026-10-19',
    start_time: p.start_time ?? null,
    end_time: p.end_time ?? null,
    client: null,
    unit_id: p.unit_id ?? null,
    unit_name: p.unit_name ?? null,
    municipality: p.municipality ?? null,
    responsible_id: 1,
    responsible_name: 'Supervisor',
    priority: p.priority ?? 'media',
    status: p.status ?? 'programado',
    visibility: 'compartilhado',
    notes: null,
    related_event_id: p.related_event_id ?? null,
    series_id: null,
    details: {},
    notification_settings: { enabled: true },
    version: 1,
    created_by: 1,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    completed_at: null,
  };
}

function item(eventId: number, p: Partial<ChecklistItem> = {}): ChecklistItem {
  seq++;
  return { id: seq, event_id: eventId, stage: p.stage ?? 'geral', text: p.text ?? `Item ${seq}`, done: p.done ?? false, critical: p.critical ?? false, position: 0, notes: null, done_by: null, done_at: null };
}

test('datas sem horário que se cruzam geram "possível conflito", com aviso de municípios diferentes', () => {
  const lrv = ev({ id: 1, title: 'Auditoria LRV', category: 'auditoria', start_date: '2026-10-19', end_date: '2026-10-21', municipality: 'Lucas do Rio Verde', unit_name: 'Lucas do Rio Verde' });
  const sor = ev({ id: 2, title: 'Auditoria Sorriso', category: 'auditoria', start_date: '2026-10-21', end_date: '2026-10-22', municipality: 'Sorriso', unit_name: 'Sorriso' });
  const c = detectConflicts([lrv, sor]);
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, 'possivel');
  assert.deepEqual(c[0].dates, ['2026-10-21']);
  assert.equal(c[0].differentMunicipality, true);
  assert.match(c[0].message, /Possível conflito em 21\/10/);
  assert.match(c[0].message, /Horários não informados/);
});

test('horários informados que se sobrepõem geram "conflito confirmado"; horários separados não conflitam', () => {
  const a = ev({ id: 10, start_date: '2026-11-05', start_time: '08:00', end_time: '10:00' });
  const b = ev({ id: 11, start_date: '2026-11-05', start_time: '09:30', end_time: '11:00' });
  const c = ev({ id: 12, start_date: '2026-11-05', start_time: '14:00', end_time: '15:00' });
  const res = detectConflicts([a, b, c]);
  assert.equal(res.length, 1);
  assert.equal(res[0].kind, 'confirmado');
  assert.equal(res[0].a.id, 10);
  assert.equal(res[0].b.id, 11);
});

test('compromisso cancelado ou que não ocupa agenda (confirmação) não entra em conflito', () => {
  const a = ev({ id: 20, start_date: '2026-12-09' });
  const b = ev({ id: 21, start_date: '2026-12-09', category: 'confirmacao' });
  const c = ev({ id: 22, start_date: '2026-12-09', status: 'cancelado' });
  assert.equal(detectConflicts([a, b, c]).length, 0);
});

test('feriados nacionais 2026: Páscoa em 5/4, Consciência Negra em 20/11 e alerta no compromisso', () => {
  assert.equal(easterSunday(2026), '2026-04-05');
  const h = nationalHolidays(2026);
  assert.ok(h.find((x) => x.date === '2026-04-03' && x.name === 'Sexta-feira Santa'));
  assert.ok(h.find((x) => x.date === '2026-11-20'));
  const visita = ev({ id: 30, start_date: '2026-11-19', end_date: '2026-11-20', title: 'Visita e reunião' });
  const alerts = holidayAlerts([visita], holidaysBetween('2026-11-01', '2026-11-30'));
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].date, '2026-11-20');
});

test('feriado municipal só alerta compromissos do mesmo município', () => {
  const custom = [{ date: '2026-08-05', name: 'Aniversário do município', scope: 'municipal' as const, municipality: 'Lucas do Rio Verde' }];
  const a = ev({ id: 31, start_date: '2026-08-05', municipality: 'Lucas do Rio Verde' });
  const b = ev({ id: 32, start_date: '2026-08-05', municipality: 'Sorriso' });
  const alerts = holidayAlerts([a, b], custom);
  assert.deepEqual(alerts.map((x) => x.eventId), [31]);
});

test('preparação de auditoria: percentual, pendências críticas e nível', () => {
  const prep = ev({ id: 40, category: 'preparacao_auditoria', start_date: '2026-10-14', end_date: '2026-10-16', unit_id: 1 });
  const audit = ev({ id: 41, category: 'auditoria', start_date: '2026-10-19', end_date: '2026-10-21', unit_id: 1, related_event_id: 40 });
  const checklist = [item(40, { done: true }), item(40, { done: true }), item(40, { done: false, critical: true }), item(41, { stage: 'pre', done: true }), item(41, { stage: 'durante' })];
  const r = auditReadiness(audit, { events: [prep, audit], checklist, actions: [], today: '2026-10-13' });
  assert.equal(r.prepEventId, 40);
  assert.equal(r.total, 4); // 3 da preparação + 1 da pré-auditoria (o item "durante" não conta)
  assert.equal(r.done, 3);
  assert.equal(r.percent, 75);
  assert.equal(r.criticalPending, 1);
  assert.equal(r.daysRemaining, 6);
  assert.equal(r.level, 'em_preparacao');
  const late = auditReadiness(audit, { events: [prep, audit], checklist, actions: [], today: '2026-10-17' });
  assert.equal(late.level, 'em_preparacao'); // 75% com 2 dias: ainda acima do limite de 70%
  const empty = auditReadiness(audit, { events: [audit], checklist: [], actions: [], today: '2026-10-13' });
  assert.equal(empty.level, 'insuficiente');
  assert.ok(empty.reasons.some((x) => /Sem compromisso de preparação/.test(x)));
});

test('auditoria sem compromisso de preparação é sinalizada como preparação insuficiente', () => {
  const audit = ev({ id: 50, category: 'auditoria', start_date: '2026-10-21', end_date: '2026-10-22', municipality: 'Sorriso' });
  const r = auditReadiness(audit, { events: [audit], checklist: [item(50, { stage: 'pre' })], actions: [], today: '2026-10-19' });
  assert.equal(r.level, 'insuficiente');
});

test('reuniões aguardando confirmação e presença pendente', () => {
  const conf = ev({ id: 60, category: 'administrativo', status: 'a_confirmar', start_date: '2026-10-27' });
  const reuniao = ev({ id: 61, category: 'reuniao', start_date: '2026-11-11' });
  const parts: Participant[] = [{ id: 1, event_id: 61, user_id: 2, name: 'André', role_label: null, attendance: 'pendente', responded_at: null, response_channel: null }];
  const p = pendingConfirmations([conf, reuniao], parts, '2026-10-13');
  assert.deepEqual(p.map((x) => x.eventId), [60, 61]);
  assert.equal(p[0].daysUntil, 14);
  assert.match(p[1].reason, /André/);
});

test('atividades vencidas: compromisso terminado e não concluído; ação com prazo vencido', () => {
  const old = ev({ id: 70, start_date: '2026-10-01', end_date: '2026-10-02' });
  const done = ev({ id: 71, start_date: '2026-10-01', status: 'concluido' });
  const act: ActionItem = { id: 1, event_id: null, title: 'Corrigir registro', description: null, responsible_name: 'X', responsible_user_id: null, due_date: '2026-10-10', status: 'aberta', progress: 20, severity: 'alta', origin: 'manual', created_at: '', updated_at: '', completed_at: null };
  const o = overdueItems([old, done], [act], '2026-10-13');
  assert.deepEqual(o.map((x) => `${x.kind}:${x.id}`), ['evento:70', 'acao:1']);
});

test('horários livres: pula fim de semana e feriado; dia com compromisso sem horário fica ocupado', () => {
  const busy = ev({ id: 80, start_date: '2026-11-19', end_date: '2026-11-19' });
  const timed = ev({ id: 81, start_date: '2026-11-18', start_time: '08:00', end_time: '12:00' });
  const slots = suggestFreeSlots([busy, timed], { from: '2026-11-16', days: 7, holidays: holidaysBetween('2026-11-01', '2026-11-30') });
  const dates = slots.map((s) => s.date);
  assert.ok(!dates.includes('2026-11-19'), 'dia sem horário informado não é sugerido');
  assert.ok(!dates.includes('2026-11-20'), 'feriado não é sugerido');
  assert.ok(!dates.includes('2026-11-21') && !dates.includes('2026-11-22'), 'fim de semana não é sugerido');
  const wed = slots.find((s) => s.date === '2026-11-18')!;
  assert.equal(wed.kind, 'janelas');
  assert.deepEqual(wed.windows, [{ start: '12:00', end: '18:00' }]);
});

test('prioridades: auditoria próxima e com preparação insuficiente vem primeiro', () => {
  const audit = ev({ id: 90, category: 'auditoria', priority: 'alta', start_date: '2026-10-15' });
  const visit = ev({ id: 91, start_date: '2026-11-12' });
  const r = auditReadiness(audit, { events: [audit], checklist: [], actions: [], today: '2026-10-13' });
  const recs = recommendPriorities([audit, visit], { today: '2026-10-13', readiness: [r], pending: [], actions: [], checklist: [] });
  assert.equal(recs[0].id, 90);
  assert.ok(recs[0].reasons.some((x) => /insuficiente/.test(x)));
});

test('tarefas antes do compromisso incluem confirmação, presença e checklist da preparação', () => {
  const prep = ev({ id: 100, category: 'preparacao_auditoria', start_date: '2026-10-14', end_date: '2026-10-16', unit_id: 3 });
  const audit = ev({ id: 101, category: 'auditoria', status: 'a_confirmar', start_date: '2026-10-19', unit_id: 3 });
  const parts: Participant[] = [{ id: 9, event_id: 101, user_id: null, name: 'Auditor', role_label: null, attendance: 'pendente', responded_at: null, response_channel: null }];
  const t = tasksBefore(audit, { events: [prep, audit], checklist: [item(100, { text: 'Verificar dispositivos' })], participants: parts, actions: [] });
  const texts = t.map((x) => x.text);
  assert.ok(texts.includes('Confirmar a agenda deste compromisso'));
  assert.ok(texts.includes('Obter confirmação de presença de Auditor'));
  assert.ok(texts.includes('Verificar dispositivos'));
});

test('resumo executivo usa só os dados do período e lista alertas', () => {
  const a = ev({ id: 110, category: 'auditoria', title: 'Auditoria GMP+ — Sorriso', unit_name: 'Sorriso', municipality: 'Sorriso', start_date: '2026-10-21', end_date: '2026-10-22' });
  const b = ev({ id: 111, category: 'auditoria', title: 'Auditoria GMP+ — Lucas do Rio Verde', unit_name: 'Lucas do Rio Verde', municipality: 'Lucas do Rio Verde', start_date: '2026-10-19', end_date: '2026-10-21' });
  const fora = ev({ id: 112, start_date: '2026-12-03' });
  const s = buildSummary('outubro de 2026', '2026-10-01', '2026-10-31', { events: [a, b, fora], actions: [], participants: [], holidays: [], today: '2026-10-13' });
  assert.equal(s.total, 2);
  assert.equal(s.agendaDays, 4);
  assert.match(s.text, /2 auditoria GMP\+/);
  assert.ok(s.lines.some((l) => l.startsWith('Atenção: Possível conflito em 21/10')));
  assert.ok(!s.text.includes('Evento 112'));
});

test('datas: período por extenso, mês com 31 dias e fuso de Cuiabá (UTC−4)', () => {
  assert.equal(formatPeriod('2026-10-19', '2026-10-21'), '19 a 21/10/2026');
  assert.equal(formatPeriod('2026-10-30', '2026-11-02'), '30/10 a 02/11/2026');
  assert.equal(formatPeriod('2026-10-27', '2026-10-27'), '27/10/2026');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(zonedToUtc('2026-10-14', '08:00', 'America/Cuiaba').toISOString(), '2026-10-14T12:00:00.000Z');
  assert.deepEqual(nowInTz('America/Cuiaba', new Date('2026-10-14T02:30:00Z')).date, '2026-10-13');
  assert.equal(startOfWeekMonday('2026-10-18'), '2026-10-12');
});
