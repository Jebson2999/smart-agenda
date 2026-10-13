// Webhooks da Cloud API: assinatura, verificação, status de entrega, respostas dos botões e PARAR.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { freshDb, startServer, Client } from './helpers.ts';
import { get, run } from '../src/server/db.ts';
import { verifySignature } from '../src/server/notifications/webhook.ts';
import { enqueue } from '../src/server/notifications/queue.ts';
import { createRecipient, getRecipient, setConsent, samePhone, normalizePhone } from '../src/server/notifications/recipients.ts';
import { attendancePayload } from '../src/server/notifications/messages.ts';
import { addParticipant, listEvents } from '../src/server/repo/events.ts';
import { getUserById } from '../src/server/auth.ts';

const SECRET = 'segredo-do-app-meta';
let srv: { base: string; close: () => Promise<void> };
let recId = 0;
let notifId = 0;
let participantId = 0;

const sign = (raw: string) => `sha256=${crypto.createHmac('sha256', SECRET).update(raw).digest('hex')}`;

async function hook(body: unknown, signature?: string) {
  const raw = JSON.stringify(body);
  return fetch(`${srv.base}/api/whatsapp/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature ?? sign(raw) }, body: raw });
}

const statusBody = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', statuses: [{ id, status, timestamp: '1792000000', recipient_id: '5566999990001', ...extra }] } }] }],
});

const inbound = (msg: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', messages: [{ timestamp: '1792000000', ...msg }] } }] }],
});

before(async () => {
  process.env.WHATSAPP_APP_SECRET = SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = 'token-verificacao';
  await freshDb({ passwordsChanged: true });
  srv = await startServer();
  recId = createRecipient({ name: 'Coordenador Teste', phone: '+55 66 99999-0001', user_id: 2 });
  setConsent(recId, 'concedido', 'teste', 1);
  enqueue({ type: 'teste', recipientId: recId, dedupeKey: 'wh-1', scheduledFor: new Date() });
  notifId = get<{ id: number }>("SELECT id FROM notifications WHERE dedupe_key = 'wh-1'")!.id;
  run("UPDATE notifications SET status = 'enviado', provider_message_id = 'wamid.TESTE1', mode = 'live' WHERE id = ?", notifId);
  const ev = listEvents(null).find((e) => e.start_date === '2026-11-19')!;
  participantId = addParticipant(getUserById(1)!, ev.id, { user_id: 2, name: 'Coordenador Teste', attendance: 'pendente' });
});
after(async () => {
  await srv.close();
});

test('assinatura X-Hub-Signature-256 é validada com a chave secreta do app', () => {
  const raw = Buffer.from('{"a":1}');
  assert.equal(verifySignature(raw, sign('{"a":1}'), SECRET), true);
  assert.equal(verifySignature(raw, sign('{"a":2}'), SECRET), false);
  assert.equal(verifySignature(raw, undefined, SECRET), false);
  assert.equal(verifySignature(raw, sign('{"a":1}'), ''), false);
});

test('verificação do webhook (GET) devolve o challenge só com o token correto', async () => {
  const ok = await fetch(`${srv.base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=token-verificacao&hub.challenge=12345`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '12345');
  const bad = await fetch(`${srv.base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=12345`);
  assert.equal(bad.status, 403);
});

test('webhook com assinatura inválida é recusado e registrado', async () => {
  const r = await hook(statusBody('wamid.TESTE1', 'delivered'), 'sha256=' + '0'.repeat(64));
  assert.equal(r.status, 401);
  assert.equal(get<{ status: string }>('SELECT status FROM notifications WHERE id = ?', notifId)!.status, 'enviado');
  assert.equal(get<{ c: number }>('SELECT COUNT(*) AS c FROM webhook_events WHERE signature_valid = 0')!.c, 1);
});

test('status avançam (enviado → entregue → lido) e nunca regridem', async () => {
  assert.equal((await hook(statusBody('wamid.TESTE1', 'delivered'))).status, 200);
  assert.equal(get<{ status: string }>('SELECT status FROM notifications WHERE id = ?', notifId)!.status, 'entregue');
  await hook(statusBody('wamid.TESTE1', 'read'));
  assert.equal(get<{ status: string }>('SELECT status FROM notifications WHERE id = ?', notifId)!.status, 'lido');
  await hook(statusBody('wamid.TESTE1', 'delivered')); // chega atrasado
  const n = get<{ status: string; read_at: string | null; delivered_at: string | null }>('SELECT status, read_at, delivered_at FROM notifications WHERE id = ?', notifId)!;
  assert.equal(n.status, 'lido');
  assert.ok(n.read_at && n.delivered_at);
});

test('falha informada pela Meta é registrada com o motivo', async () => {
  enqueue({ type: 'teste', recipientId: recId, dedupeKey: 'wh-2', scheduledFor: new Date() });
  run("UPDATE notifications SET status = 'enviado', provider_message_id = 'wamid.TESTE2' WHERE dedupe_key = 'wh-2'");
  await hook(statusBody('wamid.TESTE2', 'failed', { errors: [{ code: 131047, title: 'Re-engagement message', message: 'More than 24 hours have passed' }] }));
  const n = get<{ status: string; last_error: string }>("SELECT status, last_error FROM notifications WHERE dedupe_key = 'wh-2'")!;
  assert.equal(n.status, 'falhou');
  assert.match(n.last_error, /131047/);
});

test('botão "Confirmar presença" do próprio participante confirma; mesmo webhook repetido é ignorado', async () => {
  const msg = { from: '5566999990001', id: 'wamid.IN1', type: 'button', button: { payload: attendancePayload(participantId, 'S'), text: 'Confirmar presença' } };
  await hook(inbound(msg));
  assert.equal(get<{ attendance: string; response_channel: string }>('SELECT attendance, response_channel FROM event_participants WHERE id = ?', participantId)!.attendance, 'confirmada');
  run("UPDATE event_participants SET attendance = 'pendente' WHERE id = ?", participantId);
  await hook(inbound(msg)); // reenvio da Meta com o mesmo ID
  assert.equal(get<{ attendance: string }>('SELECT attendance FROM event_participants WHERE id = ?', participantId)!.attendance, 'pendente');
});

test('resposta de botão vinda de outro número ou com assinatura adulterada não altera a presença', async () => {
  await hook(inbound({ from: '5566988887777', id: 'wamid.IN2', type: 'button', button: { payload: attendancePayload(participantId, 'S'), text: 'Confirmar presença' } }));
  assert.equal(get<{ attendance: string }>('SELECT attendance FROM event_participants WHERE id = ?', participantId)!.attendance, 'pendente');
  const forged = `PRES|${participantId}|S|aaaaaaaaaaaaaaaa`;
  await hook(inbound({ from: '5566999990001', id: 'wamid.IN3', type: 'button', button: { payload: forged, text: 'Confirmar presença' } }));
  assert.equal(get<{ attendance: string }>('SELECT attendance FROM event_participants WHERE id = ?', participantId)!.attendance, 'pendente');
});

test('o 9º dígito omitido no número do WhatsApp continua reconhecido', async () => {
  assert.equal(samePhone('5566999990001', '556699990001'), true);
  assert.equal(normalizePhone('(66) 99999-0001'), '5566999990001');
  await hook(inbound({ from: '556699990001', id: 'wamid.IN4', type: 'button', button: { payload: attendancePayload(participantId, 'N'), text: 'Não poderei ir' } }));
  assert.equal(get<{ attendance: string }>('SELECT attendance FROM event_participants WHERE id = ?', participantId)!.attendance, 'recusada');
});

test('responder PARAR revoga o consentimento e cancela avisos pendentes', async () => {
  enqueue({ type: 'teste', recipientId: recId, dedupeKey: 'wh-3', scheduledFor: new Date(Date.now() + 86_400_000) });
  await hook(inbound({ from: '5566999990001', id: 'wamid.IN5', type: 'text', text: { body: 'PARAR' } }));
  assert.equal(getRecipient(recId)!.consent_status, 'revogado');
  assert.equal(get<{ status: string }>("SELECT status FROM notifications WHERE dedupe_key = 'wh-3'")!.status, 'cancelado');
});

test('o gatilho externo do agendador exige o segredo', async () => {
  const anon = await fetch(`${srv.base}/api/cron/tick`, { method: 'POST' });
  assert.equal(anon.status, 401);
  const ok = await fetch(`${srv.base}/api/cron/tick`, { method: 'POST', headers: { authorization: 'Bearer segredo-cron-de-teste' } });
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { skipped: boolean };
  assert.equal(body.skipped, false);
  assert.ok(new Client(srv.base));
});
