import { z } from 'zod';
import type { Router } from '../http.ts';
import { HttpError, intParam, validate } from '../http.ts';
import { audit, can } from '../auth.ts';
import { get, nowIso, run } from '../db.ts';
import { actionsFor, addHistory, getVisibleEvent, listEvents, rowToAction } from '../repo/events.ts';
import { isISODate } from '../../shared/dates.ts';
import { PRIORITY_KEYS } from '../../shared/constants.ts';
import type { PriorityKey } from '../../shared/constants.ts';

const actionSchema = z.object({
  event_id: z.number().int().positive().nullable().optional(),
  title: z.string().trim().min(3).max(200),
  description: z.union([z.string().max(3000), z.null()]).optional(),
  responsible_name: z.union([z.string().max(120), z.null()]).optional(),
  responsible_user_id: z.number().int().positive().nullable().optional(),
  due_date: z.union([z.string().refine(isISODate, 'Data inválida'), z.null(), z.literal('')]).optional().transform((v) => v || null),
  status: z.enum(['aberta', 'em_andamento', 'concluida', 'cancelada']).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  severity: z.enum(PRIORITY_KEYS as [PriorityKey, ...PriorityKey[]]).optional(),
  origin: z.enum(['auditoria_pre', 'auditoria_durante', 'auditoria_pos', 'visita', 'reuniao', 'manual']).optional(),
});

export function registerActionRoutes(r: Router) {
  r.get('/api/actions', (ctx) => {
    const ids = listEvents(ctx.user).map((e) => e.id);
    let list = actionsFor(ctx.user, ids);
    const status = ctx.url.searchParams.get('status');
    const eventId = ctx.url.searchParams.get('event');
    if (status) list = list.filter((a) => a.status === status);
    if (eventId) list = list.filter((a) => a.event_id === Number(eventId));
    return { actions: list, canManage: can(ctx.user, 'actions.manage') || can(ctx.user, 'audits.manage') };
  }, { perm: ['events.view_all', 'events.view_shared'] });

  r.post('/api/actions', (ctx) => {
    const body = validate(actionSchema, ctx.body);
    if (body.event_id) getVisibleEvent(ctx.user!, body.event_id);
    const now = nowIso();
    const status = body.status ?? 'aberta';
    const res = run(
      `INSERT INTO actions (event_id, title, description, responsible_name, responsible_user_id, due_date, status, progress, severity, origin, created_by, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      body.event_id ?? null,
      body.title,
      body.description ?? null,
      body.responsible_name ?? null,
      body.responsible_user_id ?? null,
      body.due_date,
      status,
      status === 'concluida' ? 100 : body.progress ?? 0,
      body.severity ?? 'media',
      body.origin ?? 'manual',
      ctx.user!.id,
      now,
      now,
      status === 'concluida' ? now : null,
    );
    if (body.event_id) addHistory(body.event_id, ctx.user!.id, 'acao', `Ação registrada: ${body.title}`);
    audit(ctx.user!.id, 'acao_criada', 'action', res.lastInsertRowid, { title: body.title }, ctx.ip);
    return { id: res.lastInsertRowid };
  }, { perm: ['actions.manage', 'audits.manage'] });

  r.patch('/api/actions/:id', (ctx) => {
    const id = intParam(ctx.params.id);
    const cur = get<Record<string, unknown>>('SELECT * FROM actions WHERE id = ?', id);
    if (!cur) throw new HttpError(404, 'Ação não encontrada');
    if (cur.event_id) getVisibleEvent(ctx.user!, cur.event_id as number);
    const body = validate(actionSchema.partial(), ctx.body);
    const merged = { ...rowToAction(cur), ...body };
    if (body.status === 'concluida') merged.progress = 100;
    const completed = merged.status === 'concluida' ? ((cur.completed_at as string) ?? nowIso()) : null;
    run(
      `UPDATE actions SET event_id = ?, title = ?, description = ?, responsible_name = ?, responsible_user_id = ?, due_date = ?, status = ?, progress = ?, severity = ?, origin = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
      merged.event_id ?? null,
      merged.title,
      merged.description ?? null,
      merged.responsible_name ?? null,
      merged.responsible_user_id ?? null,
      merged.due_date ?? null,
      merged.status,
      merged.progress,
      merged.severity,
      merged.origin,
      nowIso(),
      completed,
      id,
    );
    if (merged.event_id && body.status && body.status !== cur.status) addHistory(merged.event_id, ctx.user!.id, 'acao', `Ação "${merged.title}": ${cur.status} → ${body.status}`);
    return { action: rowToAction(get<Record<string, unknown>>('SELECT a.*, e.title AS event_title FROM actions a LEFT JOIN events e ON e.id = a.event_id WHERE a.id = ?', id)!) };
  }, { perm: ['actions.manage', 'audits.manage'] });

  r.delete('/api/actions/:id', (ctx) => {
    const id = intParam(ctx.params.id);
    const cur = get<{ title: string; event_id: number | null }>('SELECT title, event_id FROM actions WHERE id = ?', id);
    if (!cur) throw new HttpError(404, 'Ação não encontrada');
    if (cur.event_id) getVisibleEvent(ctx.user!, cur.event_id);
    run('DELETE FROM actions WHERE id = ?', id);
    if (cur.event_id) addHistory(cur.event_id, ctx.user!.id, 'acao', `Ação removida: ${cur.title}`);
    audit(ctx.user!.id, 'acao_removida', 'action', id, { title: cur.title }, ctx.ip);
    return { ok: true };
  }, { perm: ['actions.manage', 'audits.manage'] });
}
