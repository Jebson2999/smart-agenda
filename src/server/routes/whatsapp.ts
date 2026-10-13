// Módulo de administração do WhatsApp + webhook público + gatilho do agendador.
import crypto from 'node:crypto';
import { z } from 'zod';
import type { Router } from '../http.ts';
import { HttpError, intParam, validate } from '../http.ts';
import { audit } from '../auth.ts';
import { all, get, nowIso, parseJson, run } from '../db.ts';
import { config, whatsappEnv } from '../config.ts';
import { setSetting, whatsappConfig, whatsappCredentialStatus } from '../repo/settings.ts';
import { createRecipient, deleteRecipient, formatPhone, getRecipient, listRecipients, setConsent, updateRecipient } from '../notifications/recipients.ts';
import { enqueue, getTemplate, rowToNotification } from '../notifications/queue.ts';
import { cancelNotification, dispatchDue, requeueNotification } from '../notifications/dispatcher.ts';
import { fetchTemplateStatuses } from '../notifications/provider.ts';
import { processWebhook, verifyChallenge, verifySignature } from '../notifications/webhook.ts';
import { lastTick, tick } from '../notifications/scheduler.ts';
import { DEFAULT_TEMPLATES } from '../notifications/messages.ts';
import { CONFIGURABLE_NOTIFICATION_TYPES, CONSENT_TEXT, NOTIFICATION_TYPES } from '../../shared/constants.ts';
import type { NotificationType } from '../../shared/constants.ts';
import { isTime } from '../../shared/dates.ts';

const prefsSchema = z.object({
  types: z.record(z.boolean()).optional(),
  scope: z.enum(['todos', 'envolvidos']).optional(),
  advanceDays: z.number().int().min(2).max(14).optional(),
  advanceTime: z.string().refine(isTime).optional(),
  eveTime: z.string().refine(isTime).optional(),
  dayOfTime: z.string().refine(isTime).optional(),
  weeklyTime: z.string().refine(isTime).optional(),
});

function publicRecipient(r: ReturnType<typeof listRecipients>[number]) {
  return { ...r, phoneFormatted: formatPhone(r.phone) };
}

export function registerWhatsAppRoutes(r: Router) {
  r.get('/api/whatsapp/status', () => {
    const cfg = whatsappConfig();
    const creds = whatsappCredentialStatus();
    const counts = Object.fromEntries(all<{ status: string; c: number }>('SELECT status, COUNT(*) AS c FROM notifications GROUP BY status').map((x) => [x.status, x.c]));
    return {
      config: cfg,
      credentials: creds,
      webhookUrl: `${config.appUrl}/api/whatsapp/webhook`,
      counts,
      lastTick,
      consentText: CONSENT_TEXT,
      notificationTypes: NOTIFICATION_TYPES,
      configurableTypes: CONFIGURABLE_NOTIFICATION_TYPES,
    };
  }, { perm: 'whatsapp.manage' });

  r.patch('/api/whatsapp/config', (ctx) => {
    const b = validate(
      z.object({
        mode: z.enum(['demo', 'live']).optional(),
        displayNumber: z.string().max(30).optional(),
        phoneNumberId: z.string().regex(/^\d{0,30}$/, 'Somente números').optional(),
        businessAccountId: z.string().regex(/^\d{0,30}$/, 'Somente números').optional(),
        graphVersion: z.string().regex(/^v\d{2}\.\d$/, 'Formato vNN.N').optional(),
        businessName: z.string().max(120).optional(),
      }),
      ctx.body,
    );
    const cur = whatsappConfig();
    const next = { ...cur, ...b };
    if (next.mode === 'live') {
      const env = whatsappEnv();
      if (!env.accessToken || !env.appSecret || !next.phoneNumberId) {
        throw new HttpError(422, 'Para ativar o envio real, configure no servidor WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET e o ID do número (Phone Number ID).');
      }
    }
    setSetting('whatsapp.config', next);
    audit(ctx.user!.id, 'whatsapp_config', 'settings', null, { ...b }, ctx.ip);
    return { config: whatsappConfig(), credentials: whatsappCredentialStatus() };
  }, { perm: 'whatsapp.manage' });

  // ---------------- destinatários
  r.get('/api/whatsapp/recipients', () => ({ recipients: listRecipients().map(publicRecipient), users: all('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name') }), { perm: 'whatsapp.manage' });

  r.post('/api/whatsapp/recipients', (ctx) => {
    const b = validate(z.object({ name: z.string().trim().min(2).max(80), phone: z.string().min(8).max(30), user_id: z.number().int().positive().nullable().optional(), preferences: prefsSchema.optional() }), ctx.body);
    if (b.user_id && get('SELECT 1 FROM whatsapp_recipients WHERE user_id = ?', b.user_id)) throw new HttpError(409, 'Este usuário já tem um número cadastrado.');
    const id = createRecipient(b as Parameters<typeof createRecipient>[0]);
    audit(ctx.user!.id, 'destinatario_criado', 'whatsapp_recipient', id, { name: b.name }, ctx.ip);
    return { recipient: publicRecipient(getRecipient(id)!) };
  }, { perm: 'whatsapp.manage' });

  r.patch('/api/whatsapp/recipients/:id', (ctx) => {
    const id = intParam(ctx.params.id);
    const b = validate(z.object({ name: z.string().trim().min(2).max(80).optional(), phone: z.string().min(8).max(30).optional(), user_id: z.number().int().positive().nullable().optional(), preferences: prefsSchema.optional(), active: z.boolean().optional() }), ctx.body);
    const rec = updateRecipient(id, b as Parameters<typeof updateRecipient>[1]);
    audit(ctx.user!.id, 'destinatario_alterado', 'whatsapp_recipient', id, b, ctx.ip);
    return { recipient: publicRecipient(rec) };
  }, { perm: 'whatsapp.manage' });

  r.post('/api/whatsapp/recipients/:id/consent', (ctx) => {
    const id = intParam(ctx.params.id);
    const b = validate(z.object({ status: z.enum(['concedido', 'revogado', 'pendente']), method: z.string().trim().min(5, 'Descreva como o consentimento foi obtido').max(200) }), ctx.body);
    const rec = setConsent(id, b.status, b.method, ctx.user!.id);
    audit(ctx.user!.id, `consentimento_${b.status}`, 'whatsapp_recipient', id, { method: b.method }, ctx.ip);
    return { recipient: publicRecipient(rec) };
  }, { perm: 'whatsapp.manage' });

  r.delete('/api/whatsapp/recipients/:id', (ctx) => {
    const id = intParam(ctx.params.id);
    deleteRecipient(id);
    audit(ctx.user!.id, 'destinatario_removido', 'whatsapp_recipient', id, {}, ctx.ip);
    return { ok: true };
  }, { perm: 'whatsapp.manage' });

  // ---------------- templates
  r.get('/api/whatsapp/templates', () => ({
    templates: (Object.keys(NOTIFICATION_TYPES) as NotificationType[]).map((t) => ({ ...getTemplate(t), label: NOTIFICATION_TYPES[t].label })),
    defaults: DEFAULT_TEMPLATES,
  }), { perm: 'whatsapp.manage' });

  r.patch('/api/whatsapp/templates/:type', (ctx) => {
    const type = ctx.params.type as NotificationType;
    if (!NOTIFICATION_TYPES[type]) throw new HttpError(404, 'Tipo de notificação desconhecido');
    const b = validate(z.object({ name: z.string().regex(/^[a-z0-9_]{1,512}$/, 'Use letras minúsculas, números e _').optional(), language: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/).optional(), status: z.enum(['nao_submetido', 'pendente', 'aprovado', 'rejeitado', 'pausado']).optional() }), ctx.body);
    const cur = getTemplate(type);
    run('UPDATE wa_templates SET name = ?, language = ?, status = ?, updated_at = ? WHERE notif_type = ?', b.name ?? cur.name, b.language ?? cur.language, b.status ?? cur.status, nowIso(), type);
    audit(ctx.user!.id, 'template_alterado', 'wa_template', null, { type, ...b }, ctx.ip);
    return { template: getTemplate(type) };
  }, { perm: 'whatsapp.manage' });

  r.post('/api/whatsapp/templates/sync', async (ctx) => {
    const remote = await fetchTemplateStatuses().catch((e: Error) => {
      throw new HttpError(422, `Não foi possível consultar a Meta: ${e.message}`);
    });
    const map: Record<string, string> = { APPROVED: 'aprovado', PENDING: 'pendente', REJECTED: 'rejeitado', PAUSED: 'pausado', DISABLED: 'rejeitado', IN_APPEAL: 'pendente' };
    let updated = 0;
    for (const t of all<{ notif_type: string; name: string; language: string }>('SELECT notif_type, name, language FROM wa_templates')) {
      const found = remote.find((x) => x.name === t.name && x.language === t.language);
      if (!found) continue;
      run('UPDATE wa_templates SET status = ?, status_checked_at = ?, updated_at = ? WHERE notif_type = ?', map[found.status] ?? 'pendente', nowIso(), nowIso(), t.notif_type);
      updated++;
    }
    audit(ctx.user!.id, 'templates_sincronizados', 'wa_template', null, { updated }, ctx.ip);
    return { updated, remote: remote.length };
  }, { perm: 'whatsapp.manage' });

  // ---------------- envio de teste
  r.post('/api/whatsapp/test', async (ctx) => {
    const b = validate(z.object({ recipientId: z.number().int().positive() }), ctx.body);
    const rec = getRecipient(b.recipientId);
    if (!rec) throw new HttpError(404, 'Destinatário não encontrado');
    if (rec.consent_status !== 'concedido') throw new HttpError(422, 'Registre o consentimento deste destinatário antes de enviar mensagens.');
    const sentAt = new Intl.DateTimeFormat('pt-BR', { timeZone: config.timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date());
    const key = `teste:${rec.id}:${crypto.randomUUID()}`;
    enqueue({ type: 'teste', recipientId: rec.id, dedupeKey: key, scheduledFor: new Date(), preview: { recipientName: rec.name, sentAt }, maxAttempts: 1 });
    const n = get<{ id: number }>('SELECT id FROM notifications WHERE dedupe_key = ?', key)!;
    await dispatchDue(new Date(), { onlyId: n.id });
    audit(ctx.user!.id, 'whatsapp_teste', 'notification', n.id, { recipient: rec.name }, ctx.ip);
    const row = get<Record<string, unknown>>('SELECT * FROM notifications WHERE id = ?', n.id)!;
    return { notification: rowToNotification(row) };
  }, { perm: 'whatsapp.manage' });

  // ---------------- fila e logs
  r.get('/api/whatsapp/notifications', (ctx) => {
    const status = ctx.url.searchParams.get('status');
    const limit = Math.min(Number(ctx.url.searchParams.get('limit') ?? 100) || 100, 500);
    const where = status ? 'WHERE n.status = ?' : '';
    const rows = all<Record<string, unknown>>(
      `SELECT n.*, r.name AS recipient_name, r.phone AS recipient_phone, e.title AS event_title FROM notifications n JOIN whatsapp_recipients r ON r.id = n.recipient_id LEFT JOIN events e ON e.id = n.event_id ${where} ORDER BY n.scheduled_for DESC, n.id DESC LIMIT ?`,
      ...(status ? [status, limit] : [limit]),
    );
    return { notifications: rows.map(rowToNotification) };
  }, { perm: 'whatsapp.manage' });

  r.get('/api/whatsapp/notifications/:id/log', (ctx) => ({
    log: all<Record<string, unknown>>('SELECT * FROM message_log WHERE notification_id = ? ORDER BY id', intParam(ctx.params.id)).map((l) => ({ ...l, raw: parseJson(l.raw, null) })),
  }), { perm: 'whatsapp.manage' });

  r.post('/api/whatsapp/notifications/:id/retry', (ctx) => {
    const ok = requeueNotification(intParam(ctx.params.id), ctx.user!.name);
    if (!ok) throw new HttpError(422, 'Só é possível reenviar avisos com falha, resultado incerto, cancelados ou de demonstração.');
    audit(ctx.user!.id, 'notificacao_reenviada', 'notification', intParam(ctx.params.id), {}, ctx.ip);
    return { ok: true };
  }, { perm: 'whatsapp.manage' });

  r.post('/api/whatsapp/notifications/:id/cancel', (ctx) => {
    const ok = cancelNotification(intParam(ctx.params.id), ctx.user!.name);
    if (!ok) throw new HttpError(422, 'Só é possível cancelar avisos que ainda estão na fila.');
    return { ok: true };
  }, { perm: 'whatsapp.manage' });

  r.get('/api/whatsapp/log', () => ({
    log: all<Record<string, unknown>>('SELECT l.*, n.type, r.name AS recipient_name FROM message_log l LEFT JOIN notifications n ON n.id = l.notification_id LEFT JOIN whatsapp_recipients r ON r.id = n.recipient_id ORDER BY l.id DESC LIMIT 300'),
    webhooks: all<Record<string, unknown>>('SELECT id, received_at, signature_valid, processed, error FROM webhook_events ORDER BY id DESC LIMIT 50'),
  }), { perm: 'whatsapp.manage' });

  r.post('/api/whatsapp/run-now', async (ctx) => {
    const res = await tick();
    audit(ctx.user!.id, 'agendador_manual', 'settings', null, res, ctx.ip);
    return res;
  }, { perm: 'whatsapp.manage' });

  // ---------------- webhook público (Meta)
  r.get('/api/whatsapp/webhook', (ctx) => {
    const challenge = verifyChallenge(ctx.url.searchParams);
    if (!challenge) throw new HttpError(403, 'Token de verificação inválido');
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', 'text/plain');
    ctx.res.end(challenge);
  }, { auth: false });

  r.post('/api/whatsapp/webhook', (ctx) => {
    const raw = ctx.rawBody ?? Buffer.alloc(0);
    const valid = verifySignature(raw, ctx.req.headers['x-hub-signature-256'] as string | undefined, whatsappEnv().appSecret);
    const ins = run('INSERT INTO webhook_events (received_at, signature_valid, payload, processed) VALUES (?, ?, ?, 0)', nowIso(), valid, raw.toString('utf8').slice(0, 100_000));
    if (!valid) throw new HttpError(401, 'Assinatura inválida');
    try {
      const result = processWebhook(JSON.parse(raw.toString('utf8') || '{}'));
      run('UPDATE webhook_events SET processed = 1 WHERE id = ?', ins.lastInsertRowid);
      return { ok: true, ...result };
    } catch (err) {
      run('UPDATE webhook_events SET error = ? WHERE id = ?', (err as Error).message, ins.lastInsertRowid);
      return { ok: false }; // 200 para a Meta não reenviar indefinidamente; erro fica registrado
    }
  }, { auth: false, csrf: false, raw: 'buffer', maxBytes: 2 * 1024 * 1024 });

  // ---------------- gatilho externo do agendador (cron)
  r.post('/api/cron/tick', async (ctx) => {
    const auth = String(ctx.req.headers.authorization ?? '');
    const expected = `Bearer ${config.cronSecret}`;
    if (!config.cronSecret || auth.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) throw new HttpError(401, 'Não autorizado');
    return tick();
  }, { auth: false, csrf: false });
}
