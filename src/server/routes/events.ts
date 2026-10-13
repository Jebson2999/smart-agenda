import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Router, Ctx } from '../http.ts';
import { HttpError, intParam, sendFile, validate } from '../http.ts';
import { audit, can, requirePerm } from '../auth.ts';
import { all, get, nowIso, run } from '../db.ts';
import { config } from '../config.ts';
import {
  addChecklistItem,
  addComment,
  addHistory,
  addParticipant,
  applyTemplate,
  attachmentsFor,
  checklistFor,
  commentsFor,
  createEvent,
  deleteChecklistItem,
  deleteEvent,
  getVisibleEvent,
  historyFor,
  listEvents,
  loadContext,
  participantsFor,
  removeParticipant,
  setAttendance,
  updateChecklistItem,
  updateEvent,
  actionsFor,
} from '../repo/events.ts';
import { allHolidays } from '../repo/settings.ts';
import { notificationsForEvent } from '../notifications/queue.ts';
import { auditReadiness, detectConflicts, findPrepEvent, holidayAlerts, tasksBefore } from '../../shared/intelligence.ts';
import { CATEGORY_KEYS, PRIORITY_KEYS, STATUS_KEYS } from '../../shared/constants.ts';
import type { CategoryKey, PriorityKey, StatusKey, AttendanceKey } from '../../shared/constants.ts';
import { addDays, isISODate, isTime, todayInTz } from '../../shared/dates.ts';
import { eventsToIcs } from '../reports/ics.ts';

const dateStr = z.string().refine(isISODate, 'Data inválida (use AAAA-MM-DD)');
const timeStr = z.string().refine(isTime, 'Horário inválido (use HH:MM)');
const optTime = z.union([timeStr, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));
const optText = (max: number) => z.union([z.string().max(max), z.null()]).optional();

const eventSchema = z.object({
  title: z.string().trim().min(3, 'Informe um título').max(160),
  description: optText(4000),
  category: z.enum(CATEGORY_KEYS as [CategoryKey, ...CategoryKey[]]),
  start_date: dateStr,
  end_date: dateStr,
  start_time: optTime,
  end_time: optTime,
  client: optText(120),
  unit_id: z.number().int().positive().nullable().optional(),
  municipality: optText(120),
  responsible_id: z.number().int().positive().nullable().optional(),
  priority: z.enum(PRIORITY_KEYS as [PriorityKey, ...PriorityKey[]]).optional(),
  status: z.enum(STATUS_KEYS as [StatusKey, ...StatusKey[]]).optional(),
  visibility: z.enum(['compartilhado', 'privado']).optional(),
  notes: optText(4000),
  details: z.record(z.unknown()).optional(),
  notification_settings: z.object({ enabled: z.boolean(), advanceDays: z.number().int().min(2).max(30).nullable().optional() }).optional(),
  related_event_id: z.number().int().positive().nullable().optional(),
});

const createSchema = eventSchema.extend({
  recurrence: z.object({ freq: z.enum(['semanal', 'mensal']), interval: z.number().int().min(1).max(12), count: z.number().int().min(2).max(24) }).nullable().optional(),
  applyTemplates: z.boolean().optional(),
  participants: z.array(z.object({ user_id: z.number().int().positive().nullable().optional(), name: z.string().trim().min(1).max(120), role_label: optText(80) })).max(30).optional(),
});

const ALLOWED_UPLOADS: Record<string, string> = {
  'image/jpeg': 'foto',
  'image/png': 'foto',
  'image/webp': 'foto',
  'image/heic': 'foto',
  'application/pdf': 'documento',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'documento',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'documento',
  'application/msword': 'documento',
  'application/vnd.ms-excel': 'documento',
  'text/plain': 'documento',
};

function eventPermissions(ctx: Ctx) {
  const u = ctx.user!;
  return {
    canEdit: can(u, 'events.edit'),
    canDelete: can(u, 'events.delete'),
    canChecklist: can(u, 'checklist.edit') || can(u, 'events.edit'),
    canComment: can(u, 'events.comment'),
    canAttendance: can(u, 'events.confirm_attendance'),
    canUpload: can(u, 'attachments.upload') || can(u, 'events.edit'),
    canManageAudit: can(u, 'audits.manage'),
    canManageActions: can(u, 'actions.manage'),
    canSeeNotifications: can(u, 'whatsapp.manage'),
  };
}

export function eventDetail(ctx: Ctx, id: number) {
  const u = ctx.user!;
  const event = getVisibleEvent(u, id);
  const today = todayInTz(u.timezone);
  const all = loadContext(u);
  const prepForAudit = event.category === 'auditoria' ? findPrepEvent(event, all.events) ?? null : null;
  // Inclui os itens da preparação vinculada (exibidos como resumo na auditoria).
  const checklist = checklistFor(prepForAudit ? [id, prepForAudit.id] : [id]);
  const participants = participantsFor([id]);
  const holidays = allHolidays(addDays(event.start_date, -1), addDays(event.end_date, 1));
  const conflicts = detectConflicts(all.events).filter((c) => c.a.id === id || c.b.id === id);
  const readiness =
    event.category === 'auditoria'
      ? auditReadiness(event, { events: all.events, checklist: all.checklist, actions: all.actions, today })
      : null;
  const linkedAudit = event.category === 'preparacao_auditoria' ? all.events.find((e) => e.category === 'auditoria' && findPrepEvent(e, all.events)?.id === id) ?? null : null;
  const prepEvent = prepForAudit;
  return {
    event,
    checklist,
    participants,
    comments: commentsFor(id),
    attachments: attachmentsFor(id),
    history: historyFor(id),
    actions: actionsFor(u, [id]).filter((a) => a.event_id === id),
    notifications: can(u, 'whatsapp.manage') ? notificationsForEvent(id) : [],
    readiness,
    prepEvent,
    linkedAudit,
    tasksBefore: tasksBefore(event, { events: all.events, checklist: all.checklist, participants: all.participants, actions: all.actions }),
    conflicts,
    holidays: holidayAlerts([event], holidays),
    permissions: eventPermissions(ctx),
    series: event.series_id ? all.events.filter((e) => e.series_id === event.series_id).map((e) => ({ id: e.id, start_date: e.start_date })) : [],
    today,
  };
}

export function registerEventRoutes(r: Router) {
  r.get('/api/events', (ctx) => {
    const q = ctx.url.searchParams;
    const from = q.get('from') ?? undefined;
    const to = q.get('to') ?? undefined;
    if ((from && !isISODate(from)) || (to && !isISODate(to))) throw new HttpError(400, 'Período inválido');
    const events = listEvents(ctx.user, {
      from,
      to,
      unitId: q.get('unit') ? Number(q.get('unit')) : undefined,
      category: q.get('category') ?? undefined,
      status: q.get('status') ?? undefined,
      q: q.get('q')?.slice(0, 80) ?? undefined,
    });
    const ids = events.map((e) => e.id);
    const checklist = checklistFor(ids);
    const progress = Object.fromEntries(ids.map((id) => {
      const items = checklist.filter((c) => c.event_id === id);
      return [id, { total: items.length, done: items.filter((c) => c.done).length }];
    }));
    const ctxAll = loadContext(ctx.user);
    const conflicts = detectConflicts(ctxAll.events);
    const fromH = from ?? (events[0]?.start_date ?? todayInTz(ctx.user!.timezone));
    const toH = to ?? (events.at(-1)?.end_date ?? addDays(fromH, 365));
    const holidays = allHolidays(fromH, toH);
    return { events, progress, conflicts, holidays, today: todayInTz(ctx.user!.timezone) };
  }, { perm: ['events.view_all', 'events.view_shared'] });

  r.get('/api/events/:id', (ctx) => eventDetail(ctx, intParam(ctx.params.id)), { perm: ['events.view_all', 'events.view_shared'] });

  r.post('/api/events', (ctx) => {
    const body = validate(createSchema, ctx.body);
    const { recurrence, applyTemplates, participants, ...input } = body;
    if (input.unit_id && !get('SELECT 1 FROM units WHERE id = ?', input.unit_id)) throw new HttpError(422, 'Unidade inválida');
    const ids = createEvent(ctx.user, input, { recurrence: recurrence ?? null, applyTemplates: applyTemplates ?? true, participants: participants?.map((p) => ({ ...p, attendance: 'nao_solicitada' as AttendanceKey })) });
    audit(ctx.user!.id, 'evento_criado', 'event', ids[0], { ids, title: input.title }, ctx.ip);
    return { ids, id: ids[0] };
  }, { perm: 'events.create' });

  r.patch('/api/events/:id', (ctx) => {
    const id = intParam(ctx.params.id);
    const body = validate(eventSchema.partial().extend({ version: z.number().int().optional() }), ctx.body);
    const { version, ...patch } = body;
    const updated = updateEvent(ctx.user!, id, patch, version);
    return { event: updated };
  }, { perm: 'events.edit' });

  r.post('/api/events/:id/reschedule', (ctx) => {
    const id = intParam(ctx.params.id);
    const body = validate(z.object({ start_date: dateStr, end_date: dateStr, start_time: optTime, end_time: optTime, version: z.number().int().optional(), keepTimes: z.boolean().optional() }), ctx.body);
    const patch: Record<string, unknown> = { start_date: body.start_date, end_date: body.end_date };
    if (!body.keepTimes) {
      patch.start_time = body.start_time ?? null;
      patch.end_time = body.end_time ?? null;
    }
    const updated = updateEvent(ctx.user!, id, patch, body.version, 'reagendado');
    return { event: updated };
  }, { perm: 'events.edit' });

  r.post('/api/events/:id/status', (ctx) => {
    const id = intParam(ctx.params.id);
    const body = validate(z.object({ status: z.enum(STATUS_KEYS as [StatusKey, ...StatusKey[]]), version: z.number().int().optional() }), ctx.body);
    return { event: updateEvent(ctx.user!, id, { status: body.status }, body.version, 'status') };
  }, { perm: 'events.edit' });

  r.delete('/api/events/:id', (ctx) => {
    const id = intParam(ctx.params.id);
    const ev = deleteEvent(ctx.user!, id);
    audit(ctx.user!.id, 'evento_excluido', 'event', id, { title: ev.title, start_date: ev.start_date, end_date: ev.end_date }, ctx.ip);
    return { ok: true };
  }, { perm: 'events.delete' });

  r.get('/api/events/:id/ics', (ctx) => {
    const ev = getVisibleEvent(ctx.user!, intParam(ctx.params.id));
    sendFile(ctx.res, eventsToIcs([ev]), 'text/calendar; charset=utf-8', `compromisso-${ev.id}.ics`);
  }, { perm: ['events.view_all', 'events.view_shared'] });

  // -------- checklist
  r.post('/api/events/:id/checklist', (ctx) => {
    const id = intParam(ctx.params.id);
    const body = validate(z.object({ text: z.string().trim().min(2).max(300), stage: z.enum(['geral', 'pre', 'durante', 'pos']).default('geral'), critical: z.boolean().optional() }), ctx.body);
    return { id: addChecklistItem(ctx.user!, id, { ...body, stage: body.stage ?? 'geral' }) };
  }, { perm: ['checklist.edit', 'events.edit'] });

  r.post('/api/events/:id/checklist/template', (ctx) => {
    const id = intParam(ctx.params.id);
    getVisibleEvent(ctx.user!, id);
    const body = validate(z.object({ key: z.string().min(2).max(60) }), ctx.body);
    return { added: applyTemplate(id, body.key, ctx.user!.id) };
  }, { perm: ['checklist.edit', 'events.edit'] });

  r.patch('/api/checklist/:itemId', (ctx) => {
    const body = validate(z.object({ done: z.boolean().optional(), text: z.string().trim().min(2).max(300).optional(), critical: z.boolean().optional(), notes: optText(1000) }), ctx.body);
    const isMarkOnly = Object.keys(body).every((k) => k === 'done' || k === 'notes');
    if (!isMarkOnly) requirePerm(ctx.user, ['events.edit', 'checklist.edit']);
    return { item: updateChecklistItem(ctx.user!, intParam(ctx.params.itemId), body) };
  }, { perm: ['checklist.edit', 'events.edit'] });

  r.delete('/api/checklist/:itemId', (ctx) => {
    deleteChecklistItem(ctx.user!, intParam(ctx.params.itemId));
    return { ok: true };
  }, { perm: ['checklist.edit', 'events.edit'] });

  // -------- participantes
  r.post('/api/events/:id/participants', (ctx) => {
    const id = intParam(ctx.params.id);
    const body = validate(z.object({ user_id: z.number().int().positive().nullable().optional(), name: z.string().trim().min(1).max(120), role_label: optText(80), requestConfirmation: z.boolean().optional() }), ctx.body);
    return { id: addParticipant(ctx.user!, id, { ...body, attendance: body.requestConfirmation === false ? 'nao_solicitada' : 'pendente' }) };
  }, { perm: 'events.edit' });

  r.patch('/api/participants/:pid', (ctx) => {
    const pid = intParam(ctx.params.pid);
    const body = validate(z.object({ attendance: z.enum(['nao_solicitada', 'pendente', 'confirmada', 'recusada']) }), ctx.body);
    const p = get<{ event_id: number; user_id: number | null; name: string }>('SELECT event_id, user_id, name FROM event_participants WHERE id = ?', pid);
    if (!p) throw new HttpError(404, 'Participante não encontrado');
    getVisibleEvent(ctx.user!, p.event_id);
    const self = p.user_id === ctx.user!.id;
    // Quem não edita a agenda só pode responder a própria presença.
    if (!can(ctx.user, 'events.edit') && !(self && can(ctx.user, 'events.confirm_attendance') && (body.attendance === 'confirmada' || body.attendance === 'recusada'))) {
      throw new HttpError(403, 'Você só pode responder a sua própria presença.');
    }
    return { participant: setAttendance(pid, body.attendance as AttendanceKey, { userId: ctx.user!.id, channel: self ? 'aplicativo (próprio participante)' : `aplicativo (${ctx.user!.name})` }) };
  }, { perm: ['events.edit', 'events.confirm_attendance'] });

  r.delete('/api/participants/:pid', (ctx) => {
    removeParticipant(ctx.user!, intParam(ctx.params.pid));
    return { ok: true };
  }, { perm: 'events.edit' });

  // -------- observações
  r.post('/api/events/:id/comments', (ctx) => {
    const body = validate(z.object({ text: z.string().trim().min(1).max(2000) }), ctx.body);
    return { id: addComment(ctx.user!, intParam(ctx.params.id), body.text) };
  }, { perm: 'events.comment' });

  // -------- anexos (arquivo enviado como corpo binário; nome em X-Filename)
  r.post('/api/events/:id/attachments', (ctx) => {
    const id = intParam(ctx.params.id);
    getVisibleEvent(ctx.user!, id);
    const mime = String(ctx.req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_UPLOADS[mime]) throw new HttpError(415, 'Tipo de arquivo não permitido. Envie fotos (JPG, PNG, WEBP, HEIC), PDF, Word, Excel ou TXT.');
    const data = ctx.rawBody ?? Buffer.alloc(0);
    if (!data.length) throw new HttpError(400, 'Arquivo vazio');
    const filename = decodeURIComponent(String(ctx.req.headers['x-filename'] ?? 'arquivo')).replace(/[\\/\0]/g, '_').slice(0, 160);
    const sha = crypto.createHash('sha256').update(data).digest('hex');
    const storage = `${crypto.randomUUID()}.bin`;
    const dir = path.resolve(config.attachmentsDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, storage), data, { mode: 0o600 });
    const res = run(
      'INSERT INTO attachments (event_id, filename, mime, size, sha256, storage_name, kind, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      filename,
      mime,
      data.length,
      sha,
      storage,
      ALLOWED_UPLOADS[mime],
      ctx.user!.id,
      nowIso(),
    );
    addHistory(id, ctx.user!.id, 'anexo', `Anexo enviado: ${filename}`);
    return { id: res.lastInsertRowid };
  }, { perm: ['attachments.upload', 'events.edit'], raw: 'buffer', maxBytes: 10 * 1024 * 1024 });

  r.get('/api/attachments/:aid', (ctx) => {
    const a = get<{ event_id: number; filename: string; mime: string; storage_name: string }>('SELECT * FROM attachments WHERE id = ?', intParam(ctx.params.aid));
    if (!a) throw new HttpError(404, 'Anexo não encontrado');
    getVisibleEvent(ctx.user!, a.event_id);
    const file = path.join(path.resolve(config.attachmentsDir), path.basename(a.storage_name));
    if (!fs.existsSync(file)) throw new HttpError(410, 'Arquivo não está mais disponível');
    const inline = a.mime.startsWith('image/') || a.mime === 'application/pdf';
    sendFile(ctx.res, fs.readFileSync(file), a.mime, a.filename, inline && ctx.url.searchParams.get('download') !== '1');
  }, { perm: ['events.view_all', 'events.view_shared'] });

  r.delete('/api/attachments/:aid', (ctx) => {
    const a = get<{ id: number; event_id: number; filename: string; storage_name: string }>('SELECT * FROM attachments WHERE id = ?', intParam(ctx.params.aid));
    if (!a) throw new HttpError(404, 'Anexo não encontrado');
    getVisibleEvent(ctx.user!, a.event_id);
    run('DELETE FROM attachments WHERE id = ?', a.id);
    try {
      fs.unlinkSync(path.join(path.resolve(config.attachmentsDir), path.basename(a.storage_name)));
    } catch {
      /* já removido */
    }
    addHistory(a.event_id, ctx.user!.id, 'anexo', `Anexo removido: ${a.filename}`);
    return { ok: true };
  }, { perm: 'events.edit' });

  // -------- opções para formulários
  r.get('/api/options', (ctx) => ({
    units: all('SELECT id, name, municipality, client FROM units WHERE active = 1 ORDER BY name'),
    users: all("SELECT id, name, role FROM users WHERE active = 1 ORDER BY name"),
    templates: all('SELECT key, name, category, stage FROM checklist_templates ORDER BY name'),
    auditsAndPreps: listEvents(ctx.user)
      .filter((e) => e.category === 'auditoria' || e.category === 'preparacao_auditoria')
      .map((e) => ({ id: e.id, title: e.title, category: e.category, start_date: e.start_date })),
  }));
}
