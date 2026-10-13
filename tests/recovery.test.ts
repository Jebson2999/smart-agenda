// Recuperação de acesso pelo terminal: node dist/server.mjs --redefinir-senha [e-mail] [senha]
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, COORDINATOR, SUPERVISOR, freshDb, startServer } from './helpers.ts';
import { get } from '../src/server/db.ts';
import { parseResetArgs, resetPassword } from '../src/server/recovery.ts';

let srv: { base: string; close: () => Promise<void> };

before(async () => {
  await freshDb({ passwordsChanged: true });
  srv = await startServer();
});
after(async () => {
  await srv.close();
});

test('lê e-mail e senha em qualquer ordem', () => {
  assert.equal(parseResetArgs(['node', 'server.mjs']), null);
  assert.deepEqual(parseResetArgs(['node', 's', '--redefinir-senha']), { email: undefined, password: undefined });
  assert.deepEqual(parseResetArgs(['node', 's', '--redefinir-senha', 'Senha-Nova-2026', 'a@b.com']), { email: 'a@b.com', password: 'Senha-Nova-2026' });
  assert.deepEqual(parseResetArgs(['node', 's', '--reset-password', 'a@b.com', '--outra']), { email: 'a@b.com', password: undefined });
});

test('com senha escolhida: entra direto com ela, libera o bloqueio por tentativas e derruba sessões antigas', async () => {
  const old = new Client(srv.base);
  await old.login(SUPERVISOR);
  const anon = new Client(srv.base);
  for (let i = 0; i < 6; i++) await anon.post('/api/auth/login', { email: SUPERVISOR.email, password: 'errada-123456' });
  assert.equal((await anon.post('/api/auth/login', SUPERVISOR)).status, 429);

  const r = await resetPassword({ email: SUPERVISOR.email.toUpperCase(), password: 'Astral-Nova-2026' });
  assert.equal(r.ok, true);
  assert.equal(r.temporary, false);
  assert.equal((await old.get('/api/auth/me')).status, 401, 'sessão antiga encerrada');
  const me = await anon.login({ email: SUPERVISOR.email, password: 'Astral-Nova-2026' });
  assert.equal(me.user.mustChangePassword, false);
  assert.equal(get<{ c: number }>("SELECT COUNT(*) AS c FROM audit_trail WHERE action = 'senha_redefinida_terminal'")!.c, 1);
});

test('sem e-mail redefine o administrador; sem senha gera uma temporária com troca obrigatória', async () => {
  const r = await resetPassword({});
  assert.equal(r.ok, true);
  assert.equal(r.email, SUPERVISOR.email);
  assert.equal(r.temporary, true);
  const c = new Client(srv.base);
  await c.login({ email: SUPERVISOR.email, password: r.password! });
  assert.equal((await c.get('/api/dashboard')).status, 428, 'pede a troca da senha temporária');
});

test('e-mail inexistente lista os usuários; senha fraca é recusada sem alterar nada', async () => {
  const miss = await resetPassword({ email: 'nao.existe@empresa.com.br' });
  assert.equal(miss.ok, false);
  assert.ok(miss.users?.some((u) => u.email === COORDINATOR.email));
  const before = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE email = ?', COORDINATOR.email)!.password_hash;
  const weak = await resetPassword({ email: COORDINATOR.email, password: 'curta1' });
  assert.equal(weak.ok, false);
  assert.equal(get<{ password_hash: string }>('SELECT password_hash FROM users WHERE email = ?', COORDINATOR.email)!.password_hash, before);
});
