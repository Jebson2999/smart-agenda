// APIs de ponta a ponta: login, troca de senha, permissões, criação, edição, conclusão,
// reagendamento com histórico, concorrência, checklists persistidos e proteções.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, COORDINATOR, SUPERVISOR, freshDb, startServer } from './helpers.ts';
import { get, run } from '../src/server/db.ts';
import { createRecipient, setConsent } from '../src/server/notifications/recipients.ts';

let srv: { base: string; close: () => Promise<void> };
let sup: Client;
let coord: Client;

before(async () => {
  await freshDb();
  srv = await startServer();
  sup = new Client(srv.base);
  coord = new Client(srv.base);
});
after(async () => {
  await srv.close();
});

test('sem sessão a API responde 401; credencial errada responde 401 com mensagem em português', async () => {
  const anon = new Client(srv.base);
  assert.equal((await anon.get('/api/dashboard')).status, 401);
  const bad = await anon.post('/api/auth/login', { email: SUPERVISOR.email, password: 'errada-123456' });
  assert.equal(bad.status, 401);
  assert.equal(bad.data.error, 'E-mail ou senha incorretos.');
});

test('primeiro acesso exige troca da senha temporária (428) e valida a força da nova senha', async () => {
  await sup.login(SUPERVISOR);
  assert.equal((await sup.get('/api/dashboard')).status, 428);
  const weak = await sup.post('/api/auth/change-password', { current: SUPERVISOR.password, next: 'curta' });
  assert.equal(weak.status, 422);
  const ok = await sup.post('/api/auth/change-password', { current: SUPERVISOR.password, next: 'Supervisor-Novo-2026' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.mustChangePassword, false);
  const dash = await sup.get('/api/dashboard');
  assert.equal(dash.status, 200);
  assert.ok(dash.data.stats);
  // coordenador
  await coord.login(COORDINATOR);
  await coord.post('/api/auth/change-password', { current: COORDINATOR.password, next: 'Coordenador-Novo-2026' });
});

test('requisições que alteram dados sem o cabeçalho anti-CSRF ou de outra origem são bloqueadas', async () => {
  const r1 = await sup.req('POST', '/api/events', { title: 'x' }, { 'x-asa-request': '' });
  assert.equal(r1.status, 403);
  const r2 = await sup.req('POST', '/api/events', { title: 'x' }, { origin: 'https://site-malicioso.example' });
  assert.equal(r2.status, 403);
});

test('dashboard reflete a base: 10 compromissos, conflito de 21/10 e confirmações pendentes', async () => {
  const d = (await sup.get('/api/dashboard')).data;
  const all = (await sup.get('/api/events')).data;
  assert.equal(all.events.length, 10);
  assert.equal(all.conflicts.length, 1);
  assert.deepEqual(all.conflicts[0].dates, ['2026-10-21']);
  if (d.today <= '2026-10-21') assert.equal(d.conflicts.length, 1); // o painel mostra só conflitos ainda por vir
  const pend = (await sup.get('/api/insights')).data.pending.map((p: { date: string }) => p.date);
  for (const date of ['2026-10-27', '2026-12-09']) if (date >= d.today) assert.ok(pend.includes(date));
});

test('coordenador vê os compromissos compartilhados mas não cria, edita nem acessa a administração', async () => {
  assert.equal((await coord.get('/api/events')).data.events.length, 10);
  const create = await coord.post('/api/events', { title: 'Tentativa', category: 'reuniao', start_date: '2026-11-03', end_date: '2026-11-03' });
  assert.equal(create.status, 403);
  const ev = (await coord.get('/api/events')).data.events[0];
  assert.equal((await coord.patch(`/api/events/${ev.id}`, { title: 'Alterado' })).status, 403);
  assert.equal((await coord.get('/api/users')).status, 403);
  assert.equal((await coord.get('/api/whatsapp/status')).status, 403);
  // pode incluir observações
  const c = await coord.post(`/api/events/${ev.id}/comments`, { text: 'Confirmado com a unidade.' });
  assert.equal(c.status, 200);
});

test('o administrador libera "editar compromissos" para o coordenador e a permissão passa a valer', async () => {
  const users = (await sup.get('/api/users')).data.users;
  const co = users.find((u: { email: string }) => u.email === COORDINATOR.email);
  const r = await sup.patch(`/api/users/${co.id}`, { extra_permissions: ['events.edit'] });
  assert.equal(r.status, 200);
  const ev = (await coord.get('/api/events')).data.events[3];
  const ok = await coord.patch(`/api/events/${ev.id}`, { notes: 'Observação do coordenador', version: ev.version });
  assert.equal(ok.status, 200);
  await sup.patch(`/api/users/${co.id}`, { extra_permissions: [] });
  assert.equal((await coord.patch(`/api/events/${ev.id}`, { notes: 'de novo' })).status, 403);
});

test('compromisso privado não aparece para o coordenador', async () => {
  const r = await sup.post('/api/events', { title: 'Reunião interna privada', category: 'reuniao', start_date: '2026-11-25', end_date: '2026-11-25', visibility: 'privado' });
  assert.equal(r.status, 200);
  const ids = (await coord.get('/api/events')).data.events.map((e: { id: number }) => e.id);
  assert.ok(!ids.includes(r.data.id));
  assert.equal((await coord.get(`/api/events/${r.data.id}`)).status, 404);
  await sup.del(`/api/events/${r.data.id}`);
});

test('criação valida dados e não presume horário quando só a data é informada', async () => {
  const bad = await sup.post('/api/events', { title: 'Visita', category: 'visita_tecnica', start_date: '2026-11-10', end_date: '2026-11-09' });
  assert.equal(bad.status, 422);
  const r = await sup.post('/api/events', { title: 'Visita técnica extra — Sorriso', category: 'visita_tecnica', start_date: '2026-11-24', end_date: '2026-11-24', unit_id: 2 });
  assert.equal(r.status, 200);
  const d = (await sup.get(`/api/events/${r.data.id}`)).data;
  assert.equal(d.event.start_time, null);
  assert.equal(d.event.municipality, 'Sorriso');
  assert.ok(d.checklist.length > 0, 'modelo de checklist da categoria aplicado');
});

test('checklist persiste: marcar item registra quem concluiu e entra no histórico', async () => {
  const prep = (await sup.get('/api/events')).data.events.find((e: { category: string }) => e.category === 'preparacao_auditoria');
  const d = (await sup.get(`/api/events/${prep.id}`)).data;
  const item = d.checklist[0];
  const r = await sup.patch(`/api/checklist/${item.id}`, { done: true });
  assert.equal(r.status, 200);
  assert.equal(r.data.item.done, true);
  assert.equal(r.data.item.done_by_name, 'Supervisor Teste');
  const again = (await sup.get(`/api/events/${prep.id}`)).data;
  assert.equal(again.checklist.find((c: { id: number }) => c.id === item.id).done, true);
  assert.ok(again.history.some((h: { summary: string }) => h.summary === `Concluído: ${item.text}`));
  // a preparação da auditoria de Lucas do Rio Verde passa a refletir o item concluído
  const audits = (await sup.get('/api/audits')).data.audits;
  const lrv = audits.find((a: { event: { unit_name: string } }) => a.event.unit_name === 'Lucas do Rio Verde');
  assert.equal(lrv.readiness.done, 1);
});

test('reagendar guarda a data original no histórico e avisa quem tem consentimento (sem enviar no modo demonstração)', async () => {
  const recId = createRecipient({ name: 'Coordenador Teste', phone: '66999990001', user_id: 2 });
  setConsent(recId, 'concedido', 'Aceite registrado no teste', 1);
  const visit = (await sup.get('/api/events')).data.events.find((e: { start_date: string }) => e.start_date === '2026-12-03');
  const r = await sup.post(`/api/events/${visit.id}/reschedule`, { start_date: '2026-12-07', end_date: '2026-12-08', keepTimes: true, version: visit.version });
  assert.equal(r.status, 200);
  assert.equal(r.data.event.start_date, '2026-12-07');
  const d = (await sup.get(`/api/events/${visit.id}`)).data;
  const h = d.history.find((x: { action: string }) => x.action === 'reagendado');
  assert.match(h.summary, /03\/12\/2026 → 07\/12\/2026/);
  const n = get<{ type: string; status: string }>("SELECT type, status FROM notifications WHERE event_id = ? AND type = 'alteracao'", visit.id);
  assert.equal(n?.status, 'pendente');
});

test('edição concorrente com versão antiga é recusada (409) em vez de sobrescrever', async () => {
  const ev = (await sup.get('/api/events')).data.events.find((e: { start_date: string }) => e.start_date === '2026-11-12');
  assert.equal((await sup.patch(`/api/events/${ev.id}`, { notes: 'primeira', version: ev.version })).status, 200);
  const stale = await sup.patch(`/api/events/${ev.id}`, { notes: 'segunda', version: ev.version });
  assert.equal(stale.status, 409);
});

test('concluir compromisso registra data de conclusão e atualiza a execução do mês', async () => {
  const ev = (await sup.get('/api/events')).data.events.find((e: { start_date: string }) => e.start_date === '2026-11-11');
  const r = await sup.post(`/api/events/${ev.id}/status`, { status: 'concluido', version: ev.version });
  assert.equal(r.status, 200);
  assert.ok(r.data.event.completed_at);
});

test('participante confirma a própria presença; outro usuário sem permissão não responde por ele', async () => {
  const ev = (await sup.get('/api/events')).data.events.find((e: { start_date: string }) => e.start_date === '2026-11-19');
  const add = await sup.post(`/api/events/${ev.id}/participants`, { name: 'Coordenador Teste', user_id: 2, requestConfirmation: true });
  assert.equal(add.status, 200);
  const other = await sup.post(`/api/events/${ev.id}/participants`, { name: 'Técnico externo', requestConfirmation: true });
  assert.equal((await coord.patch(`/api/participants/${other.data.id}`, { attendance: 'confirmada' })).status, 403);
  const mine = await coord.patch(`/api/participants/${add.data.id}`, { attendance: 'confirmada' });
  assert.equal(mine.status, 200);
  assert.equal(mine.data.participant.attendance, 'confirmada');
});

test('ações: criação com prazo, vínculo ao compromisso e permissão de gestão', async () => {
  const audit = (await sup.get('/api/events')).data.events.find((e: { category: string; unit_name: string }) => e.category === 'auditoria' && e.unit_name === 'Sorriso');
  const r = await sup.post('/api/actions', { event_id: audit.id, title: 'Corrigir registro de calibração', due_date: '2026-10-20', severity: 'critica', origin: 'auditoria_pre', responsible_name: 'Equipe da unidade' });
  assert.equal(r.status, 200);
  assert.equal((await coord.post('/api/actions', { title: 'Sem permissão' })).status, 403);
  const list = (await coord.get('/api/actions')).data.actions;
  assert.ok(list.some((a: { id: number }) => a.id === r.data.id), 'coordenador acompanha as ações dos compromissos que vê');
  const readiness = (await sup.get('/api/audits')).data.audits.find((a: { event: { id: number } }) => a.event.id === audit.id).readiness;
  assert.equal(readiness.criticalPending, 1);
});

test('assistente responde apenas com dados cadastrados', async () => {
  const r = (await sup.get(`/api/assistant?q=${encodeURIComponent('Quais reuniões ainda preciso confirmar?')}`)).data;
  assert.equal(r.intent, 'confirmacoes');
  const unk = (await sup.get(`/api/assistant?q=${encodeURIComponent('Qual a previsão do tempo?')}`)).data;
  assert.equal(unk.intent, 'desconhecido');
  const nov = (await sup.get(`/api/assistant?q=${encodeURIComponent('Faça um resumo de novembro para meu coordenador.')}`)).data;
  assert.equal(nov.intent, 'resumo');
  assert.match(nov.text, /novembro de 2026/);
});

test('senha errada repetida bloqueia o login temporariamente', async () => {
  const c = new Client(srv.base);
  for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { email: 'coordenador@teste.local', password: 'errada-000000' });
  const locked = await c.post('/api/auth/login', { email: 'coordenador@teste.local', password: 'Coordenador-Novo-2026' });
  assert.equal(locked.status, 429);
  run('DELETE FROM login_attempts');
});

test('usuário desativado perde a sessão imediatamente', async () => {
  const created = await sup.post('/api/users', { name: 'Técnico Temporário', email: 'tecnico@teste.local', role: 'tecnico' });
  assert.equal(created.status, 200);
  const tec = new Client(srv.base);
  await tec.login({ email: 'tecnico@teste.local', password: created.data.temporaryPassword });
  assert.equal((await tec.get('/api/auth/me')).status, 200);
  await sup.patch(`/api/users/${created.data.id}`, { active: false });
  assert.equal((await tec.get('/api/auth/me')).status, 401);
});

test('o administrador troca o e-mail de login de um usuário; e-mail repetido é recusado', async () => {
  const created = await sup.post('/api/users', { name: 'Técnico de Campo', email: 'campo@teste.local', role: 'tecnico' });
  assert.equal(created.status, 200);
  const dup = await sup.patch(`/api/users/${created.data.id}`, { email: SUPERVISOR.email.toUpperCase() });
  assert.equal(dup.status, 409);
  assert.equal((await sup.patch(`/api/users/${created.data.id}`, { email: 'invalido' })).status, 422);
  const ok = await sup.patch(`/api/users/${created.data.id}`, { email: ' Campo.Novo@Teste.Local ' });
  assert.equal(ok.status, 200);
  const u = (await sup.get('/api/users')).data.users.find((x: { id: number }) => x.id === created.data.id);
  assert.equal(u.email, 'campo.novo@teste.local');
  const tec = new Client(srv.base);
  const old = await tec.post('/api/auth/login', { email: 'campo@teste.local', password: created.data.temporaryPassword });
  assert.equal(old.status, 401);
  await tec.login({ email: 'campo.novo@teste.local', password: created.data.temporaryPassword });
  run('DELETE FROM login_attempts');
  await sup.patch(`/api/users/${created.data.id}`, { active: false });
});

test('o sistema nunca fica sem administrador ativo', async () => {
  const me = (await sup.get('/api/auth/me')).data.user;
  const r = await sup.patch(`/api/users/${me.id}`, { role: 'coordenador' });
  assert.equal(r.status, 422);
});

test('anexos: tipo não permitido é recusado; imagem é aceita e só baixa com sessão', async () => {
  const ev = (await sup.get('/api/events')).data.events[0];
  const bad = await fetch(`${srv.base}/api/events/${ev.id}/attachments`, { method: 'POST', headers: { cookie: sup.cookie, 'x-asa-request': '1', origin: srv.base, 'content-type': 'image/svg+xml', 'x-filename': 'x.svg' }, body: '<svg/>' });
  assert.equal(bad.status, 415);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5af0000000049454e44ae426082', 'hex');
  const ok = await fetch(`${srv.base}/api/events/${ev.id}/attachments`, { method: 'POST', headers: { cookie: sup.cookie, 'x-asa-request': '1', origin: srv.base, 'content-type': 'image/png', 'x-filename': encodeURIComponent('evidência.png') }, body: png });
  assert.equal(ok.status, 200);
  const { id } = (await ok.json()) as { id: number };
  const anon = await fetch(`${srv.base}/api/attachments/${id}`);
  assert.equal(anon.status, 401);
  const dl = await fetch(`${srv.base}/api/attachments/${id}`, { headers: { cookie: sup.cookie } });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
});

test('relatórios: PDF, Excel e ICS são gerados', async () => {
  const pdf = await fetch(`${srv.base}/api/reports/agenda-mensal.pdf?month=2026-10`, { headers: { cookie: sup.cookie } });
  assert.equal(pdf.status, 200);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  const xlsx = await fetch(`${srv.base}/api/reports/agenda.xlsx?from=2026-10-01&to=2026-12-31`, { headers: { cookie: sup.cookie } });
  assert.equal(xlsx.status, 200);
  assert.equal(Buffer.from(await xlsx.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  const ics = await fetch(`${srv.base}/api/reports/agenda.ics?from=2026-10-01&to=2026-12-31`, { headers: { cookie: sup.cookie } });
  const text = await ics.text();
  assert.match(text, /BEGIN:VCALENDAR/);
  assert.match(text, /DTSTART;VALUE=DATE:20261014\r\nDTEND;VALUE=DATE:20261017/);
  const audit = (await sup.get('/api/audits')).data.audits[0].event.id;
  for (const p of [`/api/reports/auditoria/${audit}`, '/api/reports/resumo-executivo.pdf?kind=mes&ref=2026-11', '/api/reports/resumo-executivo.pdf?kind=semana&ref=2026-10-19', '/api/reports/visitas-reunioes.pdf?from=2026-10-01&to=2026-12-31']) {
    const r = await fetch(srv.base + p, { headers: { cookie: sup.cookie } });
    assert.equal(r.status, 200, p);
    assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 4).toString(), '%PDF', p);
  }
});
