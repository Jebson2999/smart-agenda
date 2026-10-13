// Os 10 compromissos reais da agenda 2026 (seção 8 da especificação).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers.ts';
import { all, get } from '../src/server/db.ts';
import { seedAll } from '../src/server/seed.ts';
import { checklistFor, listEvents, loadContext, participantsFor } from '../src/server/repo/events.ts';
import { auditReadiness, detectConflicts, pendingConfirmations } from '../src/shared/intelligence.ts';

before(async () => {
  await freshDb();
});

test('cadastra exatamente os 10 compromissos com datas, categorias, unidades e status corretos', () => {
  const events = listEvents(null);
  assert.equal(events.length, 10);
  const rows = events.map((e) => [e.start_date, e.end_date, e.category, e.unit_name ?? 'A definir', e.status, e.priority]);
  assert.deepEqual(rows, [
    ['2026-10-14', '2026-10-16', 'preparacao_auditoria', 'Lucas do Rio Verde', 'programado', 'alta'],
    ['2026-10-19', '2026-10-21', 'auditoria', 'Lucas do Rio Verde', 'programado', 'alta'],
    ['2026-10-21', '2026-10-22', 'auditoria', 'Sorriso', 'programado', 'alta'],
    ['2026-10-27', '2026-10-27', 'administrativo', 'A definir', 'a_confirmar', 'media'],
    ['2026-11-11', '2026-11-11', 'reuniao', 'Nova Ubiratã', 'programado', 'media'],
    ['2026-11-12', '2026-11-13', 'visita_tecnica', 'Lucas do Rio Verde', 'programado', 'media'],
    ['2026-11-19', '2026-11-20', 'visita_reuniao', 'Lucas do Rio Verde', 'programado', 'media'],
    ['2026-12-03', '2026-12-04', 'visita_tecnica', 'Lucas do Rio Verde', 'programado', 'media'],
    ['2026-12-09', '2026-12-09', 'confirmacao', 'Nova Ubiratã', 'a_confirmar', 'media'],
    ['2026-12-17', '2026-12-18', 'visita_reuniao', 'Lucas do Rio Verde', 'programado', 'media'],
  ]);
  // Nenhum horário presumido: todos foram informados só com datas.
  assert.ok(events.every((e) => e.start_time === null && e.end_time === null));
});

test('a preparação de 14 a 16/10 tem o checklist informado e está vinculada à auditoria de Lucas do Rio Verde', () => {
  const events = listEvents(null);
  const prep = events.find((e) => e.category === 'preparacao_auditoria')!;
  const items = checklistFor([prep.id]).map((i) => i.text);
  assert.deepEqual(items, ['Inspecionar setores', 'Identificar pendências', 'Verificar dispositivos', 'Preparar evidências']);
  const lrv = events.find((e) => e.category === 'auditoria' && e.unit_name === 'Lucas do Rio Verde')!;
  assert.equal(lrv.related_event_id, prep.id);
  // Auditorias recebem os modelos de checklist por etapa.
  const stages = new Set(checklistFor([lrv.id]).map((i) => i.stage));
  assert.deepEqual([...stages].sort(), ['durante', 'pos', 'pre']);
});

test('detecta o possível conflito de 21/10 entre as auditorias de Lucas do Rio Verde e Sorriso, sem reagendar', () => {
  const ctx = loadContext(null);
  const conflicts = detectConflicts(ctx.events);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'possivel');
  assert.deepEqual(conflicts[0].dates, ['2026-10-21']);
  const sorriso = ctx.events.find((e) => e.unit_name === 'Sorriso')!;
  assert.match(sorriso.notes ?? '', /Não reagendar sem confirmação/);
  assert.equal(sorriso.start_date, '2026-10-21'); // datas preservadas
});

test('as confirmações de 27/10 e 09/12 ficam "a confirmar" e aparecem como pendentes', () => {
  const ctx = loadContext(null);
  const p = pendingConfirmations(ctx.events, ctx.participants, '2026-10-13');
  assert.deepEqual(p.map((x) => x.date), ['2026-10-27', '2026-12-09']);
  const conf27 = ctx.events.find((e) => e.start_date === '2026-10-27')!;
  assert.equal(conf27.status, 'a_confirmar');
  assert.equal(conf27.unit_id, null, 'unidade a definir');
  assert.ok(participantsFor([conf27.id]).some((x) => x.name === 'André'));
});

test('a auditoria de Sorriso aparece sem compromisso de preparação vinculado', () => {
  const ctx = loadContext(null);
  const sorriso = ctx.events.find((e) => e.category === 'auditoria' && e.unit_name === 'Sorriso')!;
  const r = auditReadiness(sorriso, { events: ctx.events, checklist: ctx.checklist, actions: ctx.actions, today: '2026-10-13' });
  assert.equal(r.prepEventId, null);
  assert.ok(r.reasons.some((x) => /Sem compromisso de preparação vinculado/.test(x)));
});

test('cada compromisso guarda o cadastro original no histórico', () => {
  const rows = all<{ event_id: number; action: string; changes: string }>("SELECT event_id, action, changes FROM event_history WHERE action = 'criado'");
  assert.equal(rows.length, 10);
  assert.ok(rows.every((r) => JSON.parse(r.changes).original?.start_date));
});

test('a carga inicial é idempotente (reiniciar o servidor não duplica nada)', async () => {
  await seedAll();
  await seedAll();
  assert.equal(get<{ c: number }>('SELECT COUNT(*) AS c FROM events')!.c, 10);
  assert.equal(get<{ c: number }>('SELECT COUNT(*) AS c FROM users')!.c, 2);
});

test('instalação antiga: o administrador com o e-mail de fábrica passa para o novo e-mail, sem criar outra conta', async () => {
  const { run } = await import('../src/server/db.ts');
  const { LEGACY_SUPERVISOR_EMAIL } = await import('../src/server/seed.ts');
  const { config } = await import('../src/server/config.ts');
  const admin = get<{ id: number; password_hash: string }>("SELECT id, password_hash FROM users WHERE role = 'admin'")!;
  run('UPDATE users SET email = ? WHERE id = ?', LEGACY_SUPERVISOR_EMAIL, admin.id);
  await seedAll();
  const after = get<{ email: string; password_hash: string }>('SELECT email, password_hash FROM users WHERE id = ?', admin.id)!;
  assert.equal(after.email, config.seed.supervisorEmail.toLowerCase());
  assert.equal(after.password_hash, admin.password_hash, 'a senha continua a mesma');
  assert.equal(get<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'")!.c, 1);
  // Administrador com e-mail próprio (não o de fábrica) não é alterado nem duplicado.
  run('UPDATE users SET email = ? WHERE id = ?', 'outro@empresa.com.br', admin.id);
  await seedAll();
  assert.equal(get<{ email: string }>('SELECT email FROM users WHERE id = ?', admin.id)!.email, 'outro@empresa.com.br');
  assert.equal(get<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'")!.c, 1);
  run('UPDATE users SET email = ? WHERE id = ?', config.seed.supervisorEmail, admin.id);
});

test('backup: gera uma cópia consistente do banco com VACUUM INTO', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { DatabaseSync } = await import('node:sqlite');
  const { backupNow } = await import('../src/server/backup.ts');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'asa-bkp-')), 'copia.db');
  backupNow(file);
  const copy = new DatabaseSync(file);
  const n = (copy.prepare('SELECT COUNT(*) AS c FROM events').get() as { c: number }).c;
  copy.close();
  assert.equal(n, 10);
});
