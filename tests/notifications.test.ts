// Fila persistente de notificações: planejamento idempotente, deduplicação, modo demonstração,
// envio real simulado (fetch substituído), retentativas seguras e resultado incerto.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers.ts';
import { all, get, nowIso, run } from '../src/server/db.ts';
import { planNotifications } from '../src/server/notifications/planner.ts';
import { dispatchDue, recoverStaleLocks, requeueNotification } from '../src/server/notifications/dispatcher.ts';
import { enqueue } from '../src/server/notifications/queue.ts';
import { createRecipient, setConsent, updateRecipient } from '../src/server/notifications/recipients.ts';
import { setFetchForTests, buildTemplatePayload } from '../src/server/notifications/provider.ts';
import type { FetchLike } from '../src/server/notifications/provider.ts';
import { setSetting } from '../src/server/repo/settings.ts';
import { attendancePayload, renderMessage, DEFAULT_TEMPLATES, cleanParam } from '../src/server/notifications/messages.ts';
import { findEvent, listEvents } from '../src/server/repo/events.ts';

const NOW = new Date('2026-10-13T12:00:00Z'); // 08:00 em Cuiabá

let supervisorRec = 0;

beforeEach(async () => {
  await freshDb({ passwordsChanged: true });
  setFetchForTests(null);
  process.env.WHATSAPP_ACCESS_TOKEN = '';
  process.env.WHATSAPP_APP_SECRET = '';
  supervisorRec = createRecipient({ name: 'Supervisor Teste', phone: '(66) 99999-0000', user_id: 1 });
  setConsent(supervisorRec, 'concedido', 'Aceite no teste', 1);
});

function goLive() {
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  process.env.WHATSAPP_APP_SECRET = 'segredo-app';
  setSetting('whatsapp.config', { mode: 'live', phoneNumberId: '1234567890', graphVersion: 'v23.0' });
  run("UPDATE wa_templates SET status = 'aprovado'");
}

function mockFetch(impl: (body: any) => { status: number; json: unknown } | Error) {
  const calls: any[] = [];
  const f: FetchLike = async (_url, init) => {
    const body = JSON.parse(init.body ?? '{}');
    calls.push(body);
    const r = impl(body);
    if (r instanceof Error) throw r;
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.json, text: async () => JSON.stringify(r.json) };
  };
  setFetchForTests(f);
  return calls;
}

test('sem consentimento nada entra na fila', () => {
  setConsent(supervisorRec, 'revogado', 'teste', 1);
  assert.equal(planNotifications(NOW).created, 0);
});

test('planejamento é idempotente: rodar várias vezes não duplica avisos', () => {
  const first = planNotifications(NOW);
  assert.ok(first.created > 0);
  assert.ok((first.byType.lembrete_vespera ?? 0) >= 1, 'lembrete de véspera da preparação (14/10)');
  const second = planNotifications(NOW);
  const third = planNotifications(new Date(NOW.getTime() + 60_000));
  assert.equal(second.created, 0);
  assert.equal(third.created, 0);
  const dup = get<{ c: number }>('SELECT COUNT(*) - COUNT(DISTINCT dedupe_key) AS c FROM notifications')!.c;
  assert.equal(dup, 0);
});

test('lembretes usam o horário local de Cuiabá (véspera às 18:00 = 22:00 UTC)', () => {
  planNotifications(NOW);
  const prep = listEvents(null).find((e) => e.category === 'preparacao_auditoria')!;
  const n = get<{ scheduled_for: string }>("SELECT scheduled_for FROM notifications WHERE type = 'lembrete_vespera' AND event_id = ?", prep.id)!;
  assert.equal(n.scheduled_for, '2026-10-13T22:00:00.000Z');
});

test('o mesmo aviso nunca entra duas vezes (chave de deduplicação única)', () => {
  const key = 'teste-dedupe:1';
  assert.equal(enqueue({ type: 'teste', recipientId: supervisorRec, dedupeKey: key, scheduledFor: NOW }), true);
  assert.equal(enqueue({ type: 'teste', recipientId: supervisorRec, dedupeKey: key, scheduledFor: NOW }), false);
});

test('modo demonstração: a mensagem é montada e registrada como "demonstracao", nunca como enviada', async () => {
  const calls = mockFetch(() => ({ status: 200, json: { messages: [{ id: 'wamid.X' }] } }));
  planNotifications(NOW);
  const stats = await dispatchDue(new Date('2026-10-13T22:05:00Z'));
  assert.ok(stats.demo >= 1);
  assert.equal(stats.sent, 0);
  assert.equal(calls.length, 0, 'nenhuma chamada à Meta em modo demonstração');
  const sentRows = get<{ c: number }>("SELECT COUNT(*) AS c FROM notifications WHERE status IN ('enviado','entregue','lido')")!.c;
  assert.equal(sentRows, 0);
  const demo = get<{ payload: string; mode: string }>("SELECT payload, mode FROM notifications WHERE status = 'demonstracao' LIMIT 1")!;
  assert.equal(demo.mode, 'demo');
  assert.match(JSON.parse(demo.payload).preview, /ASTRAL SMART AGENDA/);
});

test('envio real: aceito pela Meta guarda o ID da mensagem; o payload segue o formato da Cloud API', async () => {
  goLive();
  const calls = mockFetch(() => ({ status: 200, json: { messaging_product: 'whatsapp', messages: [{ id: 'wamid.ABC123' }] } }));
  enqueue({ type: 'aviso_antecipado', recipientId: supervisorRec, eventId: listEvents(null)[1].id, dedupeKey: 'aviso-real', scheduledFor: NOW });
  const stats = await dispatchDue(NOW);
  assert.equal(stats.sent, 1);
  const n = get<{ status: string; provider_message_id: string; mode: string }>("SELECT status, provider_message_id, mode FROM notifications WHERE dedupe_key = 'aviso-real'")!;
  assert.deepEqual([n.status, n.provider_message_id, n.mode], ['enviado', 'wamid.ABC123', 'live']);
  const body = calls[0];
  assert.equal(body.messaging_product, 'whatsapp');
  assert.equal(body.to, '5566999990000');
  assert.equal(body.type, 'template');
  assert.equal(body.template.name, 'astral_compromisso_programado');
  assert.equal(body.template.language.code, 'pt_BR');
  const bodyParams = body.template.components.find((c: { type: string }) => c.type === 'body').parameters;
  assert.equal(bodyParams.length, 5);
  assert.equal(bodyParams[0].text, 'Auditoria GMP+ — Lucas do Rio Verde');
  assert.equal(bodyParams[2].text, '19 a 21/10/2026');
  const btn = body.template.components.find((c: { type: string }) => c.type === 'button');
  assert.equal(btn.sub_type, 'url');
});

test('limite temporário da Meta (429) volta para a fila com espera; erro definitivo (400) falha sem repetir', async () => {
  goLive();
  let mode: 'rate' | 'bad' = 'rate';
  const calls = mockFetch(() => (mode === 'rate' ? { status: 429, json: { error: { code: 130429, message: 'Rate limit hit' } } } : { status: 400, json: { error: { code: 131026, message: 'Message undeliverable' } } }));
  const ev = listEvents(null)[0].id;
  enqueue({ type: 'lembrete_dia', recipientId: supervisorRec, eventId: ev, dedupeKey: 'retry-1', scheduledFor: NOW });
  let s = await dispatchDue(NOW);
  assert.equal(s.retried, 1);
  let n = get<{ status: string; attempts: number; next_attempt_at: string }>("SELECT status, attempts, next_attempt_at FROM notifications WHERE dedupe_key = 'retry-1'")!;
  assert.equal(n.status, 'pendente');
  assert.equal(n.attempts, 1);
  assert.equal(n.next_attempt_at, new Date(NOW.getTime() + 60_000).toISOString());
  // antes do horário da nova tentativa nada é enviado
  s = await dispatchDue(new Date(NOW.getTime() + 30_000));
  assert.equal(s.processed, 0);
  mode = 'bad';
  s = await dispatchDue(new Date(NOW.getTime() + 61_000));
  assert.equal(s.failed, 1);
  n = get<{ status: string; attempts: number; next_attempt_at: string }>("SELECT status, attempts, next_attempt_at FROM notifications WHERE dedupe_key = 'retry-1'")!;
  assert.equal(n.status, 'falhou');
  assert.equal(calls.length, 2);
  s = await dispatchDue(new Date(NOW.getTime() + 3_600_000));
  assert.equal(s.processed, 0, 'falha definitiva não é repetida automaticamente');
});

test('tempo esgotado depois de enviar fica "incerto" e NÃO é reenviado automaticamente', async () => {
  goLive();
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const calls = mockFetch(() => abort);
  enqueue({ type: 'lembrete_dia', recipientId: supervisorRec, eventId: listEvents(null)[0].id, dedupeKey: 'incerto-1', scheduledFor: NOW });
  const s = await dispatchDue(NOW);
  assert.equal(s.uncertain, 1);
  assert.equal(get<{ status: string }>("SELECT status FROM notifications WHERE dedupe_key = 'incerto-1'")!.status, 'incerto');
  await dispatchDue(new Date(NOW.getTime() + 86_400_000));
  assert.equal(calls.length, 1);
  // o administrador pode autorizar o reenvio depois de verificar
  const id = get<{ id: number }>("SELECT id FROM notifications WHERE dedupe_key = 'incerto-1'")!.id;
  assert.equal(requeueNotification(id, 'Admin'), true);
  assert.equal(get<{ status: string }>('SELECT status FROM notifications WHERE id = ?', id)!.status, 'pendente');
});

test('reserva abandonada (processo caiu no meio do envio) vira "incerto", sem envio duplicado', () => {
  enqueue({ type: 'teste', recipientId: supervisorRec, dedupeKey: 'stale-1', scheduledFor: NOW });
  run("UPDATE notifications SET status = 'processando', locked_at = ? WHERE dedupe_key = 'stale-1'", new Date(NOW.getTime() - 20 * 60_000).toISOString());
  assert.equal(recoverStaleLocks(NOW), 1);
  assert.equal(get<{ status: string }>("SELECT status FROM notifications WHERE dedupe_key = 'stale-1'")!.status, 'incerto');
});

test('template não aprovado impede o envio real e explica o motivo', async () => {
  goLive();
  run("UPDATE wa_templates SET status = 'pendente' WHERE notif_type = 'lembrete_dia'");
  const calls = mockFetch(() => ({ status: 200, json: { messages: [{ id: 'x' }] } }));
  enqueue({ type: 'lembrete_dia', recipientId: supervisorRec, eventId: listEvents(null)[0].id, dedupeKey: 'tpl-1', scheduledFor: NOW });
  await dispatchDue(NOW);
  const n = get<{ status: string; last_error: string }>("SELECT status, last_error FROM notifications WHERE dedupe_key = 'tpl-1'")!;
  assert.equal(n.status, 'falhou');
  assert.match(n.last_error, /não está aprovado/);
  assert.equal(calls.length, 0);
});

test('aviso de compromisso cancelado ou concluído é cancelado antes do envio', async () => {
  goLive();
  const calls = mockFetch(() => ({ status: 200, json: { messages: [{ id: 'x' }] } }));
  const ev = listEvents(null)[5];
  run("UPDATE events SET status = 'cancelado' WHERE id = ?", ev.id);
  enqueue({ type: 'lembrete_dia', recipientId: supervisorRec, eventId: ev.id, dedupeKey: `dia:${ev.id}:${supervisorRec}:${ev.start_date}`, scheduledFor: NOW });
  const s = await dispatchDue(NOW);
  assert.equal(s.cancelled, 1);
  assert.equal(calls.length, 0);
});

test('preferência "só os envolvidos" filtra os compromissos de outra pessoa', () => {
  const co = createRecipient({ name: 'Coordenador', phone: '66988887777', user_id: 2 });
  setConsent(co, 'concedido', 'teste', 1);
  updateRecipient(co, { preferences: { scope: 'envolvidos' } });
  planNotifications(NOW);
  assert.equal(get<{ c: number }>('SELECT COUNT(*) AS c FROM notifications WHERE recipient_id = ? AND event_id IS NOT NULL', co)!.c, 0);
  assert.ok(get<{ c: number }>('SELECT COUNT(*) AS c FROM notifications WHERE recipient_id = ?', supervisorRec)!.c > 0);
});

test('aviso desligado na preferência não é agendado', () => {
  updateRecipient(supervisorRec, { preferences: { types: { lembrete_vespera: false } } });
  planNotifications(NOW);
  assert.equal(get<{ c: number }>("SELECT COUNT(*) AS c FROM notifications WHERE type = 'lembrete_vespera'")!.c, 0);
});

test('mensagens: texto do exemplo da especificação, parâmetros sem quebra de linha e botões de presença assinados', () => {
  const ev = findEvent(listEvents(null)[1].id)!;
  const tpl = DEFAULT_TEMPLATES.find((t) => t.type === 'aviso_antecipado')!;
  const m = renderMessage(tpl, { event: ev, recipientName: 'Supervisor' });
  assert.match(m.preview, /🟢 ASTRAL SMART AGENDA/);
  assert.match(m.preview, /📅 COMPROMISSO PROGRAMADO/);
  assert.match(m.preview, /Atividade: Auditoria GMP\+ — Lucas do Rio Verde/);
  assert.match(m.preview, /Unidade: Lucas do Rio Verde/);
  assert.match(m.preview, /Período: 19 a 21\/10\/2026/);
  assert.match(m.preview, /⚠️ Prepare a documentação, revise as pendências e confirme as condições da unidade\./);
  assert.equal(cleanParam('linha 1\nlinha   2\t'), 'linha 1 linha 2');
  const conf = DEFAULT_TEMPLATES.find((t) => t.type === 'confirmacao_presenca')!;
  const c = renderMessage(conf, { event: ev, recipientName: 'Coordenador Teste', participantId: 7 });
  assert.equal(c.buttons.length, 2);
  assert.equal((c.buttons[0] as { payload: string }).payload, attendancePayload(7, 'S'));
  const payload = buildTemplatePayload('5566999990000', { name: conf.name, language: 'pt_BR' }, c);
  const qr = payload.template.components.filter((x: any) => x.sub_type === 'quick_reply');
  assert.equal(qr.length, 2);
});

test('agendador registra cada passo no log de mensagens', async () => {
  planNotifications(NOW);
  await dispatchDue(new Date('2026-10-13T22:05:00Z'));
  const rows = all<{ status: string }>('SELECT status FROM message_log');
  assert.ok(rows.some((r) => r.status === 'pendente'));
  assert.ok(rows.some((r) => r.status === 'demonstracao'));
  assert.ok(nowIso());
});
