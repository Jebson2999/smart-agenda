import { z } from 'zod';
import type { Router } from '../http.ts';
import { HttpError, parseCookies, validate } from '../http.ts';
import {
  audit,
  clearSessionCookie,
  getUserById,
  hashPassword,
  login,
  logout,
  passwordProblems,
  revokeUserSessions,
  SESSION_COOKIE,
  sessionCookie,
  verifyPassword,
} from '../auth.ts';
import { get, nowIso, run } from '../db.ts';
import { config } from '../config.ts';
import { listRecipients, createRecipient, setConsent, updateRecipient, normalizePhone } from '../notifications/recipients.ts';
import { CONSENT_TEXT } from '../../shared/constants.ts';

function isSecure(req: import('node:http').IncomingMessage) {
  return config.production || req.headers['x-forwarded-proto'] === 'https';
}

export function registerAuthRoutes(r: Router) {
  r.post(
    '/api/auth/login',
    async (ctx) => {
      const body = validate(z.object({ email: z.string().email('E-mail inválido'), password: z.string().min(1, 'Informe a senha') }), ctx.body);
      const { token, user } = await login(body.email, body.password, ctx.ip, String(ctx.req.headers['user-agent'] ?? ''));
      ctx.res.setHeader('Set-Cookie', sessionCookie(token, isSecure(ctx.req)));
      return { user };
    },
    { auth: false },
  );

  r.post('/api/auth/logout', (ctx) => {
    logout(parseCookies(ctx.req.headers.cookie)[SESSION_COOKIE]);
    ctx.res.setHeader('Set-Cookie', clearSessionCookie());
    return { ok: true };
  }, { auth: false });

  r.get('/api/auth/me', (ctx) => {
    const myRecipient = listRecipients().find((x) => x.user_id === ctx.user!.id) ?? null;
    return { user: ctx.user, whatsapp: myRecipient, consentText: CONSENT_TEXT };
  });

  r.post('/api/auth/change-password', async (ctx) => {
    const body = validate(z.object({ current: z.string().min(1), next: z.string().min(1) }), ctx.body);
    const row = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', ctx.user!.id)!;
    if (!(await verifyPassword(body.current, row.password_hash))) throw new HttpError(400, 'Senha atual incorreta.');
    const problem = passwordProblems(body.next);
    if (problem) throw new HttpError(422, problem);
    if (body.next === body.current) throw new HttpError(422, 'A nova senha precisa ser diferente da atual.');
    run('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?', await hashPassword(body.next), nowIso(), ctx.user!.id);
    revokeUserSessions(ctx.user!.id, parseCookies(ctx.req.headers.cookie)[SESSION_COOKIE]);
    audit(ctx.user!.id, 'senha_alterada', 'user', ctx.user!.id, {}, ctx.ip);
    return { user: getUserById(ctx.user!.id) };
  });

  /** Perfil do próprio usuário: nome, telefone e consentimento do WhatsApp. */
  r.patch('/api/me', (ctx) => {
    const body = validate(
      z.object({
        name: z.string().trim().min(2).max(80).optional(),
        timezone: z.string().min(3).max(60).optional(),
        phone: z.string().max(30).nullable().optional(),
        whatsappConsent: z.boolean().optional(),
      }),
      ctx.body,
    );
    const u = ctx.user!;
    if (body.timezone) {
      try {
        new Intl.DateTimeFormat('pt-BR', { timeZone: body.timezone });
      } catch {
        throw new HttpError(422, 'Fuso horário inválido');
      }
    }
    let phone = u.phone;
    if (body.phone !== undefined) phone = body.phone ? normalizePhone(body.phone) : null;
    run('UPDATE users SET name = ?, timezone = ?, phone = ?, updated_at = ? WHERE id = ?', body.name ?? u.name, body.timezone ?? u.timezone, phone, nowIso(), u.id);
    let rec = listRecipients().find((x) => x.user_id === u.id) ?? null;
    if (phone && !rec) {
      createRecipient({ name: body.name ?? u.name, phone, user_id: u.id });
      rec = listRecipients().find((x) => x.user_id === u.id) ?? null;
    } else if (phone && rec && rec.phone !== phone) {
      rec = updateRecipient(rec.id, { phone, name: body.name ?? u.name });
    }
    if (rec && body.whatsappConsent !== undefined) {
      const status = body.whatsappConsent ? 'concedido' : 'revogado';
      if (rec.consent_status !== status) {
        setConsent(rec.id, status, body.whatsappConsent ? 'Aceite do próprio usuário no aplicativo' : 'Revogado pelo próprio usuário no aplicativo', u.id);
        audit(u.id, body.whatsappConsent ? 'consentimento_concedido' : 'consentimento_revogado', 'whatsapp_recipient', rec.id, { via: 'app' }, ctx.ip);
      }
    }
    return { user: getUserById(u.id), whatsapp: listRecipients().find((x) => x.user_id === u.id) ?? null };
  });
}
