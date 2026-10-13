// Administração: usuários e permissões, unidades, modelos de checklist, feriados e trilha de auditoria.
import { z } from 'zod';
import type { Router } from '../http.ts';
import { HttpError, intParam, validate } from '../http.ts';
import { audit, generatePassword, hashPassword, listUsers, revokeUserSessions } from '../auth.ts';
import { all, get, nowIso, parseJson, run } from '../db.ts';
import { CONFIGURABLE_PERMISSIONS, PERMISSIONS, ROLE_DEFAULTS, ROLES } from '../../shared/constants.ts';
import type { RoleKey } from '../../shared/constants.ts';
import { isISODate } from '../../shared/dates.ts';
import { customHolidays } from '../repo/settings.ts';
import fs from 'node:fs';
import path from 'node:path';
import { backupDir, backupNow, listBackups } from '../backup.ts';
import { sendFile } from '../http.ts';

const roleEnum = z.enum(['admin', 'coordenador', 'tecnico', 'gestor']);

export function registerAdminRoutes(r: Router) {
  // ---------------- usuários
  r.get('/api/users', () => ({
    users: listUsers(),
    roles: ROLES,
    permissions: PERMISSIONS,
    roleDefaults: ROLE_DEFAULTS,
    configurable: CONFIGURABLE_PERMISSIONS,
  }), { perm: 'users.manage' });

  r.post('/api/users', async (ctx) => {
    const body = validate(
      z.object({ name: z.string().trim().min(2).max(80), email: z.string().email(), role: roleEnum, extra_permissions: z.array(z.string()).optional() }),
      ctx.body,
    );
    if (get('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE', body.email)) throw new HttpError(409, 'Já existe um usuário com este e-mail.');
    const password = generatePassword();
    const extra = (body.extra_permissions ?? []).filter((p) => (CONFIGURABLE_PERMISSIONS as string[]).includes(p));
    const now = nowIso();
    const res = run(
      'INSERT INTO users (name, email, password_hash, role, extra_permissions, timezone, active, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)',
      body.name,
      body.email,
      await hashPassword(password),
      body.role,
      JSON.stringify(extra),
      'America/Cuiaba',
      now,
      now,
    );
    audit(ctx.user!.id, 'usuario_criado', 'user', res.lastInsertRowid, { email: body.email, role: body.role }, ctx.ip);
    return { id: res.lastInsertRowid, temporaryPassword: password };
  }, { perm: 'users.manage' });

  r.patch('/api/users/:id', (ctx) => {
    const id = intParam(ctx.params.id);
    const body = validate(
      z.object({ name: z.string().trim().min(2).max(80).optional(), email: z.string().trim().email('E-mail inválido').max(160).optional(), role: roleEnum.optional(), extra_permissions: z.array(z.string()).optional(), active: z.boolean().optional() }),
      ctx.body,
    );
    const cur = get<{ role: RoleKey; name: string; email: string; extra_permissions: string; active: number }>('SELECT role, name, email, extra_permissions, active FROM users WHERE id = ?', id);
    if (!cur) throw new HttpError(404, 'Usuário não encontrado');
    const email = body.email?.toLowerCase();
    if (email && email !== cur.email.toLowerCase() && get('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE AND id <> ?', email, id)) throw new HttpError(409, 'Já existe um usuário com este e-mail.');
    // Proteção: o sistema nunca fica sem administrador ativo, e ninguém rebaixa a si mesmo.
    if (id === ctx.user!.id && ((body.role && body.role !== 'admin') || body.active === false)) throw new HttpError(422, 'Você não pode remover o seu próprio acesso de administrador.');
    if (cur.role === 'admin' && ((body.role && body.role !== 'admin') || body.active === false)) {
      const admins = get<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1")!.c;
      if (admins <= 1) throw new HttpError(422, 'É necessário manter pelo menos um administrador ativo.');
    }
    const extra = body.extra_permissions ? body.extra_permissions.filter((p) => (CONFIGURABLE_PERMISSIONS as string[]).includes(p)) : parseJson<string[]>(cur.extra_permissions, []);
    run(
      'UPDATE users SET name = ?, email = ?, role = ?, extra_permissions = ?, active = ?, updated_at = ? WHERE id = ?',
      body.name ?? cur.name,
      email ?? cur.email,
      body.role ?? cur.role,
      JSON.stringify(extra),
      body.active === undefined ? cur.active : body.active,
      nowIso(),
      id,
    );
    if (body.active === false) revokeUserSessions(id);
    audit(ctx.user!.id, 'usuario_alterado', 'user', id, { de: { email: cur.email, role: cur.role, extra: parseJson(cur.extra_permissions, []) }, para: { email: email ?? cur.email, role: body.role ?? cur.role, extra, active: body.active } }, ctx.ip);
    return { users: listUsers() };
  }, { perm: 'users.manage' });

  r.post('/api/users/:id/reset-password', async (ctx) => {
    const id = intParam(ctx.params.id);
    if (!get('SELECT 1 FROM users WHERE id = ?', id)) throw new HttpError(404, 'Usuário não encontrado');
    const password = generatePassword();
    run('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?', await hashPassword(password), nowIso(), id);
    revokeUserSessions(id);
    audit(ctx.user!.id, 'senha_redefinida', 'user', id, {}, ctx.ip);
    return { temporaryPassword: password };
  }, { perm: 'users.manage' });

  // ---------------- unidades
  r.get('/api/units', () => ({ units: all('SELECT * FROM units ORDER BY name') }));
  r.post('/api/units', (ctx) => {
    const b = validate(z.object({ name: z.string().trim().min(2).max(120), municipality: z.string().trim().max(120).nullable().optional(), client: z.string().trim().max(120).nullable().optional() }), ctx.body);
    const res = run('INSERT INTO units (name, municipality, client, active, created_at) VALUES (?, ?, ?, 1, ?)', b.name, b.municipality ?? b.name, b.client ?? null, nowIso());
    audit(ctx.user!.id, 'unidade_criada', 'unit', res.lastInsertRowid, b, ctx.ip);
    return { id: res.lastInsertRowid };
  }, { perm: 'settings.manage' });
  r.patch('/api/units/:id', (ctx) => {
    const id = intParam(ctx.params.id);
    const b = validate(z.object({ name: z.string().trim().min(2).max(120).optional(), municipality: z.string().trim().max(120).nullable().optional(), client: z.string().trim().max(120).nullable().optional(), active: z.boolean().optional() }), ctx.body);
    const cur = get<Record<string, unknown>>('SELECT * FROM units WHERE id = ?', id);
    if (!cur) throw new HttpError(404, 'Unidade não encontrada');
    run('UPDATE units SET name = ?, municipality = ?, client = ?, active = ? WHERE id = ?', b.name ?? (cur.name as string), b.municipality === undefined ? (cur.municipality as string) : b.municipality, b.client === undefined ? (cur.client as string) : b.client, b.active === undefined ? (cur.active as number) : b.active, id);
    audit(ctx.user!.id, 'unidade_alterada', 'unit', id, b, ctx.ip);
    return { ok: true };
  }, { perm: 'settings.manage' });

  // ---------------- modelos de checklist (editáveis)
  r.get('/api/checklist-templates', () => ({
    templates: all<Record<string, unknown>>('SELECT * FROM checklist_templates ORDER BY name').map((t) => ({ ...t, items: parseJson(t.items, []) })),
  }));
  r.put('/api/checklist-templates/:key', (ctx) => {
    const key = ctx.params.key;
    const b = validate(
      z.object({
        name: z.string().trim().min(2).max(120),
        category: z.string().max(40).nullable().optional(),
        stage: z.enum(['geral', 'pre', 'durante', 'pos']),
        items: z.array(z.object({ text: z.string().trim().min(2).max(300), critical: z.boolean().optional() })).max(60),
      }),
      ctx.body,
    );
    if (!/^[a-z0-9_]{2,60}$/.test(key)) throw new HttpError(400, 'Chave inválida');
    run(
      'INSERT INTO checklist_templates (key, name, category, stage, items, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET name = excluded.name, category = excluded.category, stage = excluded.stage, items = excluded.items, updated_at = excluded.updated_at',
      key,
      b.name,
      b.category ?? null,
      b.stage,
      JSON.stringify(b.items),
      nowIso(),
    );
    audit(ctx.user!.id, 'modelo_checklist_salvo', 'checklist_template', null, { key, itens: b.items.length }, ctx.ip);
    return { ok: true };
  }, { perm: 'settings.manage' });

  // ---------------- feriados municipais/estaduais
  r.get('/api/holidays/custom', () => ({ holidays: customHolidays() }));
  r.post('/api/holidays/custom', (ctx) => {
    const b = validate(z.object({ date: z.string().refine(isISODate, 'Data inválida'), name: z.string().trim().min(2).max(120), scope: z.enum(['municipal', 'estadual', 'facultativo']), municipality: z.string().trim().max(120).nullable().optional() }), ctx.body);
    const res = run('INSERT INTO custom_holidays (date, name, scope, municipality, created_at) VALUES (?, ?, ?, ?, ?)', b.date, b.name, b.scope, b.municipality ?? null, nowIso());
    return { id: res.lastInsertRowid };
  }, { perm: 'settings.manage' });
  r.delete('/api/holidays/custom/:id', (ctx) => {
    run('DELETE FROM custom_holidays WHERE id = ?', intParam(ctx.params.id));
    return { ok: true };
  }, { perm: 'settings.manage' });

  // ---------------- cópias de segurança
  r.get('/api/admin/backups', () => ({ backups: listBackups(), dir: backupDir() }), { perm: 'users.manage' });
  r.post('/api/admin/backups', (ctx) => {
    const file = backupNow();
    audit(ctx.user!.id, 'backup_gerado', 'settings', null, { arquivo: path.basename(file) }, ctx.ip);
    return { backups: listBackups() };
  }, { perm: 'users.manage' });
  r.get('/api/admin/backups/:name', (ctx) => {
    const name = path.basename(ctx.params.name);
    if (!/^astral-[\w-]+\.db$/.test(name)) throw new HttpError(400, 'Arquivo inválido');
    const file = path.join(backupDir(), name);
    if (!fs.existsSync(file)) throw new HttpError(404, 'Backup não encontrado');
    audit(ctx.user!.id, 'backup_baixado', 'settings', null, { arquivo: name }, ctx.ip);
    sendFile(ctx.res, fs.readFileSync(file), 'application/vnd.sqlite3', name);
  }, { perm: 'users.manage' });

  // ---------------- trilha de auditoria
  r.get('/api/audit-trail', (ctx) => {
    const limit = Math.min(Number(ctx.url.searchParams.get('limit') ?? 200) || 200, 1000);
    return {
      entries: all<Record<string, unknown>>('SELECT a.*, u.name AS user_name FROM audit_trail a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?', limit).map((e) => ({ ...e, detail: parseJson(e.detail, {}) })),
    };
  }, { perm: 'users.manage' });
}
