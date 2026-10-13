// Autenticação: senhas com scrypt, sessões por token aleatório (hash no banco),
// bloqueio progressivo de tentativas e trilha de auditoria.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { all, get, nowIso, parseJson, run } from './db.ts';
import { HttpError } from './http.ts';
import { ALL_PERMISSIONS, CONFIGURABLE_PERMISSIONS, ROLE_DEFAULTS } from '../shared/constants.ts';
import type { Permission, RoleKey } from '../shared/constants.ts';
import type { SessionUser } from '../shared/types.ts';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1 };
export const SESSION_COOKIE = 'asa_session';
export const SESSION_DAYS = 30;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function passwordProblems(pw: string): string | null {
  if (pw.length < 10) return 'A senha precisa ter pelo menos 10 caracteres.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use letras e números na senha.';
  return null;
}

export function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(14);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out.slice(0, 4) + '-' + out.slice(4, 9) + '-' + out.slice(9) + '7';
}

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

export function effectivePermissions(role: RoleKey, extra: string[]): Permission[] {
  if (role === 'admin') return [...ALL_PERMISSIONS];
  const set = new Set<Permission>(ROLE_DEFAULTS[role] ?? []);
  for (const p of extra) if ((CONFIGURABLE_PERMISSIONS as string[]).includes(p)) set.add(p as Permission);
  return [...set];
}

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: RoleKey;
  extra_permissions: string;
  phone: string | null;
  timezone: string;
  active: number;
  must_change_password: number;
  password_hash: string;
}

export function toSessionUser(u: UserRow): SessionUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    timezone: u.timezone,
    phone: u.phone,
    permissions: effectivePermissions(u.role, parseJson<string[]>(u.extra_permissions, [])),
    mustChangePassword: !!u.must_change_password,
  };
}

export function getUserById(id: number): SessionUser | null {
  const u = get<UserRow>('SELECT * FROM users WHERE id = ? AND active = 1', id);
  return u ? toSessionUser(u) : null;
}

function attemptKey(email: string, ip: string) {
  return `${email.toLowerCase()}|${ip}`;
}

function checkLocked(key: string) {
  const row = get<{ locked_until: string | null }>('SELECT locked_until FROM login_attempts WHERE key = ?', key);
  if (row?.locked_until && row.locked_until > nowIso()) {
    throw new HttpError(429, 'Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.');
  }
}

function registerFailure(key: string) {
  const now = nowIso();
  const row = get<{ failures: number; first_failure_at: string }>('SELECT failures, first_failure_at FROM login_attempts WHERE key = ?', key);
  const windowStart = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
  if (!row || row.first_failure_at < windowStart) {
    run('INSERT OR REPLACE INTO login_attempts (key, failures, first_failure_at, locked_until) VALUES (?, 1, ?, NULL)', key, now);
    return;
  }
  const failures = row.failures + 1;
  const lockedUntil = failures >= MAX_FAILURES ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
  run('UPDATE login_attempts SET failures = ?, locked_until = ? WHERE key = ?', failures, lockedUntil, key);
}

export async function login(email: string, password: string, ip: string, userAgent: string): Promise<{ token: string; user: SessionUser }> {
  const key = attemptKey(email, ip);
  checkLocked(key);
  const u = get<UserRow>('SELECT * FROM users WHERE email = ? COLLATE NOCASE', email.trim());
  const ok = u && u.active ? await verifyPassword(password, u.password_hash) : (await hashPassword(password), false); // tempo constante aproximado
  if (!u || !ok) {
    registerFailure(key);
    audit(u?.id ?? null, 'login_falhou', 'user', u?.id ?? null, { email }, ip);
    throw new HttpError(401, 'E-mail ou senha incorretos.');
  }
  run('DELETE FROM login_attempts WHERE key = ?', key);
  const token = crypto.randomBytes(32).toString('base64url');
  const now = nowIso();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  run(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
    sha256(token),
    u.id,
    now,
    expires,
    now,
    userAgent.slice(0, 300),
    ip,
  );
  run('UPDATE users SET last_login_at = ? WHERE id = ?', now, u.id);
  audit(u.id, 'login', 'user', u.id, {}, ip);
  return { token, user: toSessionUser(u) };
}

export function sessionUser(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = get<{ id: number; user_id: number; expires_at: string; last_seen_at: string }>(
    'SELECT id, user_id, expires_at, last_seen_at FROM sessions WHERE token_hash = ?',
    sha256(token),
  );
  if (!row) return null;
  if (row.expires_at < nowIso()) {
    run('DELETE FROM sessions WHERE id = ?', row.id);
    return null;
  }
  if (Date.now() - Date.parse(row.last_seen_at) > 5 * 60_000) run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', nowIso(), row.id);
  return getUserById(row.user_id);
}

export function logout(token: string | undefined) {
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

export function revokeUserSessions(userId: number, exceptToken?: string) {
  if (exceptToken) run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', userId, sha256(exceptToken));
  else run('DELETE FROM sessions WHERE user_id = ?', userId);
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function audit(userId: number | null, action: string, entity: string | null, entityId: number | null, detail: unknown, ip?: string) {
  run(
    'INSERT INTO audit_trail (user_id, action, entity, entity_id, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    userId,
    action,
    entity,
    entityId,
    JSON.stringify(detail ?? {}),
    ip ?? null,
    nowIso(),
  );
}

export function requirePerm(user: SessionUser | null, perm: Permission | Permission[]) {
  if (!user) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
  const perms = Array.isArray(perm) ? perm : [perm];
  if (!perms.some((p) => user.permissions.includes(p))) throw new HttpError(403, 'Você não tem permissão para esta ação.');
}

export function can(user: SessionUser | null, perm: Permission): boolean {
  return !!user && user.permissions.includes(perm);
}

export function listUsers() {
  return all<UserRow & { created_at: string; last_login_at: string | null }>('SELECT * FROM users ORDER BY role, name').map((u) => ({
    ...toSessionUser(u),
    active: !!u.active,
    extraPermissions: parseJson<string[]>(u.extra_permissions, []),
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  }));
}
