// Acesso a dados dos compromissos, com regras de visibilidade e histórico de alterações.
import crypto from 'node:crypto';
import { all, get, nowIso, parseJson, run, tx } from '../db.ts';
import { HttpError } from '../http.ts';
import { can } from '../auth.ts';
import { addDays, addMonths, diffDays } from '../../shared/dates.ts';
import { CATEGORIES, STATUSES, PRIORITIES } from '../../shared/constants.ts';
import type { CategoryKey, ChecklistStage, PriorityKey, StatusKey, VisibilityKey, AttendanceKey } from '../../shared/constants.ts';
import type { ActionItem, AgendaEvent, ChecklistItem, Participant, SessionUser } from '../../shared/types.ts';
import { onEventChanged } from '../notifications/queue.ts';

const EVENT_SELECT = `SELECT e.*, un.name AS unit_name, ru.name AS responsible_name
  FROM events e LEFT JOIN units un ON un.id = e.unit_id LEFT JOIN users ru ON ru.id = e.responsible_id`;

type Row = Record<string, unknown>;

export function rowToEvent(r: Row): AgendaEvent {
  return {
    id: r.id as number,
    title: r.title as string,
    description: (r.description as string) ?? null,
    category: r.category as CategoryKey,
    start_date: r.start_date as string,
    end_date: r.end_date as string,
    start_time: (r.start_time as string) ?? null,
    end_time: (r.end_time as string) ?? null,
    client: (r.client as string) ?? null,
    unit_id: (r.unit_id as number) ?? null,
    unit_name: (r.unit_name as string) ?? null,
    municipality: (r.municipality as string) ?? null,
    responsible_id: (r.responsible_id as number) ?? null,
    responsible_name: (r.responsible_name as string) ?? null,
    priority: r.priority as PriorityKey,
    status: r.status as StatusKey,
    visibility: r.visibility as VisibilityKey,
    notes: (r.notes as string) ?? null,
    related_event_id: (r.related_event_id as number) ?? null,
    series_id: (r.series_id as string) ?? null,
    details: parseJson(r.details, {}),
    notification_settings: parseJson(r.notification_settings, { enabled: true }),
    version: r.version as number,
    created_by: (r.created_by as number) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
    completed_at: (r.completed_at as string) ?? null,
  };
}

function rowToChecklist(r: Row): ChecklistItem {
  return {
    id: r.id as number,
    event_id: r.event_id as number,
    stage: r.stage as ChecklistStage,
    text: r.text as string,
    done: !!r.done,
    critical: !!r.critical,
    position: r.position as number,
    notes: (r.notes as string) ?? null,
    done_by: (r.done_by as number) ?? null,
    done_by_name: (r.done_by_name as string) ?? null,
    done_at: (r.done_at as string) ?? null,
  };
}

export function rowToAction(r: Row): ActionItem {
  return {
    id: r.id as number,
    event_id: (r.event_id as number) ?? null,
    event_title: (r.event_title as string) ?? null,
    title: r.title as string,
    description: (r.description as string) ?? null,
    responsible_name: (r.responsible_name as string) ?? null,
    responsible_user_id: (r.responsible_user_id as number) ?? null,
    due_date: (r.due_date as string) ?? null,
    status: r.status as ActionItem['status'],
    progress: r.progress as number,
    severity: r.severity as PriorityKey,
    origin: r.origin as ActionItem['origin'],
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
    completed_at: (r.completed_at as string) ?? null,
  };
}

// ------------------------------------------------------------------ visibilidade

/** Condição SQL que limita os compromissos ao que o usuário pode ver. */
export function visibilityClause(user: SessionUser | null): { sql: string; params: number[] } {
  if (!user || can(user, 'events.view_all')) return { sql: '1=1', params: [] };
  return {
    sql: `(e.visibility = 'compartilhado' OR e.responsible_id = ? OR EXISTS (SELECT 1 FROM event_participants p WHERE p.event_id = e.id AND p.user_id = ?))`,
    params: [user.id, user.id],
  };
}

export interface EventFilters {
  from?: string;
  to?: string;
  unitId?: number;
  category?: string;
  status?: string;
  q?: string;
  municipality?: string;
}

/** user = null → contexto do sistema (agendador), sem filtro de visibilidade. */
export function listEvents(user: SessionUser | null, f: EventFilters = {}): AgendaEvent[] {
  const v = visibilityClause(user);
  const where = [v.sql];
  const params: Array<string | number> = [...v.params];
  if (f.from) {
    where.push('e.end_date >= ?');
    params.push(f.from);
  }
  if (f.to) {
    where.push('e.start_date <= ?');
    params.push(f.to);
  }
  if (f.unitId) {
    where.push('e.unit_id = ?');
    params.push(f.unitId);
  }
  if (f.municipality) {
    where.push('e.municipality = ?');
    params.push(f.municipality);
  }
  if (f.category) {
    where.push('e.category = ?');
    params.push(f.category);
  }
  if (f.status) {
    where.push('e.status = ?');
    params.push(f.status);
  }
  if (f.q) {
    where.push(`(e.title LIKE ? OR e.description LIKE ? OR e.notes LIKE ? OR un.name LIKE ? OR e.municipality LIKE ? OR e.client LIKE ?)`);
    const like = `%${f.q.replace(/[%_]/g, '')}%`;
    params.push(like, like, like, like, like, like);
  }
  return all<Row>(`${EVENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY e.start_date, e.start_time, e.id`, ...params).map(rowToEvent);
}

export function findEvent(id: number): AgendaEvent | null {
  const r = get<Row>(`${EVENT_SELECT} WHERE e.id = ?`, id);
  return r ? rowToEvent(r) : null;
}

export function getVisibleEvent(user: SessionUser, id: number): AgendaEvent {
  const v = visibilityClause(user);
  const r = get<Row>(`${EVENT_SELECT} WHERE e.id = ? AND ${v.sql}`, id, ...v.params);
  if (!r) throw new HttpError(404, 'Compromisso não encontrado ou sem permissão de acesso.');
  return rowToEvent(r);
}

export function checklistFor(eventIds: number[]): ChecklistItem[] {
  if (!eventIds.length) return [];
  return all<Row>(
    `SELECT c.*, u.name AS done_by_name FROM checklist_items c LEFT JOIN users u ON u.id = c.done_by WHERE c.event_id IN (${eventIds.map(() => '?').join(',')}) ORDER BY c.event_id, c.stage, c.position, c.id`,
    ...eventIds,
  ).map(rowToChecklist);
}

export function participantsFor(eventIds: number[]): Participant[] {
  if (!eventIds.length) return [];
  return all<Participant>(`SELECT * FROM event_participants WHERE event_id IN (${eventIds.map(() => '?').join(',')}) ORDER BY id`, ...eventIds);
}

export function actionsFor(user: SessionUser | null, eventIds: number[] | null): ActionItem[] {
  const base = `SELECT a.*, e.title AS event_title FROM actions a LEFT JOIN events e ON e.id = a.event_id`;
  if (eventIds === null) return all<Row>(`${base} ORDER BY a.due_date IS NULL, a.due_date, a.id`).map(rowToAction);
  // Ações sem compromisso vinculado são visíveis para quem gerencia ações; as vinculadas seguem o compromisso.
  const ids = eventIds.length ? eventIds : [-1];
  const ownLoose = user && (can(user, 'actions.manage') || can(user, 'events.view_all')) ? 'OR a.event_id IS NULL' : `OR (a.event_id IS NULL AND a.responsible_user_id = ${user ? Number(user.id) : -1})`;
  return all<Row>(`${base} WHERE a.event_id IN (${ids.map(() => '?').join(',')}) ${ownLoose} ORDER BY a.due_date IS NULL, a.due_date, a.id`, ...ids).map(rowToAction);
}

/** Todos os dados necessários para o motor de inteligência, respeitando a visibilidade. */
export function loadContext(user: SessionUser | null) {
  const events = listEvents(user);
  const ids = events.map((e) => e.id);
  return {
    events,
    checklist: checklistFor(ids),
    participants: participantsFor(ids),
    actions: user ? actionsFor(user, ids) : actionsFor(null, null),
  };
}

// ------------------------------------------------------------------ histórico

const FIELD_LABELS: Record<string, string> = {
  title: 'Título',
  description: 'Descrição',
  category: 'Categoria',
  start_date: 'Data inicial',
  end_date: 'Data final',
  start_time: 'Horário inicial',
  end_time: 'Horário final',
  client: 'Cliente',
  unit_id: 'Unidade',
  municipality: 'Município',
  responsible_id: 'Responsável',
  priority: 'Prioridade',
  status: 'Status',
  visibility: 'Visibilidade',
  notes: 'Observações',
  details: 'Detalhes',
  notification_settings: 'Notificações',
  related_event_id: 'Compromisso vinculado',
};

export function addHistory(eventId: number, userId: number | null, action: string, summary: string, changes: unknown = {}) {
  run(
    'INSERT INTO event_history (event_id, user_id, action, summary, changes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    eventId,
    userId,
    action,
    summary,
    JSON.stringify(changes),
    nowIso(),
  );
}

export function historyFor(eventId: number) {
  return all<Row>(
    `SELECT h.*, u.name AS user_name FROM event_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.event_id = ? ORDER BY h.id DESC`,
    eventId,
  ).map((h) => ({ ...h, changes: parseJson(h.changes, {}) }));
}

function displayValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'category') return CATEGORIES[value as CategoryKey]?.label ?? String(value);
  if (field === 'status') return STATUSES[value as StatusKey]?.label ?? String(value);
  if (field === 'priority') return PRIORITIES[value as PriorityKey]?.label ?? String(value);
  if (field === 'unit_id') return (get<{ name: string }>('SELECT name FROM units WHERE id = ?', value as number)?.name ?? `#${value}`);
  if (field === 'responsible_id') return (get<{ name: string }>('SELECT name FROM users WHERE id = ?', value as number)?.name ?? `#${value}`);
  if (field === 'related_event_id') return (get<{ title: string }>('SELECT title FROM events WHERE id = ?', value as number)?.title ?? `#${value}`);
  if (field === 'start_date' || field === 'end_date') {
    const [y, m, d] = String(value).split('-');
    return `${d}/${m}/${y}`;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// ------------------------------------------------------------------ criação e edição

export interface EventInput {
  title: string;
  description?: string | null;
  category: CategoryKey;
  start_date: string;
  end_date: string;
  start_time?: string | null;
  end_time?: string | null;
  client?: string | null;
  unit_id?: number | null;
  municipality?: string | null;
  responsible_id?: number | null;
  priority?: PriorityKey;
  status?: StatusKey;
  visibility?: VisibilityKey;
  notes?: string | null;
  details?: Record<string, unknown>;
  notification_settings?: { enabled: boolean; advanceDays?: number | null };
  related_event_id?: number | null;
}

export interface RecurrenceInput {
  freq: 'semanal' | 'mensal';
  interval: number;
  count: number;
}

function assertDates(i: { start_date: string; end_date: string; start_time?: string | null; end_time?: string | null }) {
  if (i.end_date < i.start_date) throw new HttpError(422, 'A data final não pode ser anterior à data inicial.');
  if (i.end_time && !i.start_time) throw new HttpError(422, 'Informe o horário inicial antes do horário final.');
  if (i.start_time && i.end_time && i.start_date === i.end_date && i.end_time <= i.start_time) throw new HttpError(422, 'O horário final precisa ser depois do horário inicial.');
  if (diffDays(i.start_date, i.end_date) > 366) throw new HttpError(422, 'Período muito longo (máximo 1 ano).');
}

function municipalityFor(unitId: number | null | undefined, explicit?: string | null): string | null {
  if (explicit) return explicit;
  if (!unitId) return null;
  return get<{ municipality: string | null }>('SELECT municipality FROM units WHERE id = ?', unitId)?.municipality ?? null;
}

export function applyTemplate(eventId: number, templateKey: string, userId: number | null): number {
  const t = get<{ items: string; stage: string; name: string }>('SELECT items, stage, name FROM checklist_templates WHERE key = ?', templateKey);
  if (!t) throw new HttpError(404, 'Modelo de checklist não encontrado');
  const items = parseJson<Array<{ text: string; critical?: boolean }>>(t.items, []);
  const start = get<{ m: number | null }>('SELECT MAX(position) AS m FROM checklist_items WHERE event_id = ? AND stage = ?', eventId, t.stage)?.m ?? 0;
  items.forEach((it, idx) => {
    run(
      'INSERT INTO checklist_items (event_id, stage, text, critical, position, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      eventId,
      t.stage,
      it.text,
      !!it.critical,
      (start ?? 0) + idx + 1,
      nowIso(),
    );
  });
  if (items.length) addHistory(eventId, userId, 'checklist', `Modelo "${t.name}" aplicado (${items.length} itens)`);
  return items.length;
}

export function defaultTemplatesFor(category: CategoryKey): string[] {
  switch (category) {
    case 'auditoria':
      return ['auditoria_pre', 'auditoria_durante', 'auditoria_pos'];
    case 'preparacao_auditoria':
      return ['preparacao_auditoria'];
    case 'visita_tecnica':
      return ['visita_tecnica'];
    case 'visita_reuniao':
      return ['visita_tecnica', 'reuniao_mensal'];
    case 'reuniao':
      return ['reuniao_mensal'];
    default:
      return [];
  }
}

export function createEvent(
  user: SessionUser | null,
  input: EventInput,
  opts: { recurrence?: RecurrenceInput | null; applyTemplates?: boolean; checklist?: Array<{ text: string; stage?: ChecklistStage; critical?: boolean }>; participants?: Array<{ user_id?: number | null; name: string; role_label?: string | null; attendance?: AttendanceKey }>; historySummary?: string } = {},
): number[] {
  assertDates(input);
  const occurrences: Array<{ start: string; end: string }> = [{ start: input.start_date, end: input.end_date }];
  const span = diffDays(input.start_date, input.end_date);
  if (opts.recurrence) {
    const { freq, interval, count } = opts.recurrence;
    for (let k = 1; k < Math.min(count, 52); k++) {
      const start = freq === 'semanal' ? addDays(input.start_date, 7 * interval * k) : addMonths(input.start_date, interval * k);
      occurrences.push({ start, end: addDays(start, span) });
    }
  }
  const seriesId = occurrences.length > 1 ? crypto.randomUUID() : null;
  return tx(() => {
    const ids: number[] = [];
    for (const occ of occurrences) {
      const now = nowIso();
      const r = run(
        `INSERT INTO events (title, description, category, start_date, end_date, start_time, end_time, client, unit_id, municipality, responsible_id, priority, status, visibility, notes, details, notification_settings, related_event_id, series_id, version, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        input.title.trim(),
        input.description ?? null,
        input.category,
        occ.start,
        occ.end,
        input.start_time || null,
        input.end_time || null,
        input.client ?? null,
        input.unit_id ?? null,
        municipalityFor(input.unit_id, input.municipality),
        input.responsible_id ?? user?.id ?? null,
        input.priority ?? 'media',
        input.status ?? 'programado',
        input.visibility ?? 'compartilhado',
        input.notes ?? null,
        JSON.stringify(input.details ?? {}),
        JSON.stringify(input.notification_settings ?? { enabled: true }),
        input.related_event_id ?? null,
        seriesId,
        user?.id ?? null,
        now,
        now,
      );
      const id = r.lastInsertRowid;
      ids.push(id);
      addHistory(id, user?.id ?? null, 'criado', opts.historySummary ?? (seriesId ? `Compromisso criado (série recorrente, ${occurrences.length} ocorrências)` : 'Compromisso criado'), {
        original: { ...input, start_date: occ.start, end_date: occ.end },
      });
      if (opts.checklist?.length) {
        opts.checklist.forEach((c, idx) =>
          run('INSERT INTO checklist_items (event_id, stage, text, critical, position, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, c.stage ?? 'geral', c.text, !!c.critical, idx + 1, now),
        );
      }
      if (opts.applyTemplates) for (const key of defaultTemplatesFor(input.category)) applyTemplate(id, key, user?.id ?? null);
      for (const p of opts.participants ?? []) {
        run(
          'INSERT INTO event_participants (event_id, user_id, name, role_label, attendance, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          id,
          p.user_id ?? null,
          p.name,
          p.role_label ?? null,
          p.attendance ?? 'nao_solicitada',
          now,
        );
      }
    }
    return ids;
  });
}

const EDITABLE: Array<keyof EventInput> = [
  'title',
  'description',
  'category',
  'start_date',
  'end_date',
  'start_time',
  'end_time',
  'client',
  'unit_id',
  'municipality',
  'responsible_id',
  'priority',
  'status',
  'visibility',
  'notes',
  'details',
  'notification_settings',
  'related_event_id',
];

const SCHEDULE_FIELDS = new Set(['start_date', 'end_date', 'start_time', 'end_time', 'unit_id', 'municipality', 'status']);

export function updateEvent(user: SessionUser, id: number, patch: Partial<EventInput>, expectedVersion?: number, action = 'editado') {
  return tx(() => {
    const current = getVisibleEvent(user, id);
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw new HttpError(409, 'Este compromisso foi alterado por outra pessoa. Recarregue a página para ver a versão atual.');
    }
    if (patch.unit_id !== undefined && patch.municipality === undefined) patch.municipality = municipalityFor(patch.unit_id, null);
    const next = { ...current, ...patch } as AgendaEvent;
    assertDates(next);
    const changes: Record<string, { de: string; para: string; raw: [unknown, unknown] }> = {};
    const sets: string[] = [];
    const values: Array<string | number | null> = [];
    for (const key of EDITABLE) {
      if (!(key in patch)) continue;
      const before = (current as unknown as Record<string, unknown>)[key];
      let after = (patch as Record<string, unknown>)[key];
      if (after === '') after = null;
      const same = JSON.stringify(before ?? null) === JSON.stringify(after ?? null);
      if (same) continue;
      changes[key] = { de: displayValue(key, before), para: displayValue(key, after), raw: [before ?? null, after ?? null] };
      sets.push(`${key} = ?`);
      values.push(typeof after === 'object' && after !== null ? JSON.stringify(after) : (after as string | number | null) ?? null);
    }
    if (!sets.length) return current;
    if (changes.status) {
      sets.push('completed_at = ?');
      values.push(patch.status === 'concluido' ? nowIso() : null);
    }
    sets.push('version = version + 1', 'updated_at = ?');
    values.push(nowIso());
    run(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`, ...values, id);
    const keys = Object.keys(changes);
    const summary =
      action === 'reagendado'
        ? `Reagendado: ${changes.start_date?.de ?? displayValue('start_date', current.start_date)} → ${changes.start_date?.para ?? displayValue('start_date', current.start_date)}`
        : action === 'status'
          ? `Status alterado: ${changes.status?.de} → ${changes.status?.para}`
          : `Alterado: ${keys.map((k) => FIELD_LABELS[k] ?? k).join(', ')}`;
    addHistory(id, user.id, action, summary, Object.fromEntries(keys.map((k) => [FIELD_LABELS[k] ?? k, { de: changes[k].de, para: changes[k].para }])));
    const updated = findEvent(id)!;
    if (keys.some((k) => SCHEDULE_FIELDS.has(k))) {
      onEventChanged(updated, patch.status === 'cancelado' ? 'cancelado' : 'alterado', keys, user.name);
    }
    return updated;
  });
}

export function deleteEvent(user: SessionUser, id: number) {
  const ev = getVisibleEvent(user, id);
  tx(() => {
    run('DELETE FROM events WHERE id = ?', id);
  });
  return ev;
}

// ------------------------------------------------------------------ checklist, participantes, observações

export function addChecklistItem(user: SessionUser, eventId: number, item: { text: string; stage: ChecklistStage; critical?: boolean }) {
  getVisibleEvent(user, eventId);
  const pos = (get<{ m: number | null }>('SELECT MAX(position) AS m FROM checklist_items WHERE event_id = ? AND stage = ?', eventId, item.stage)?.m ?? 0) + 1;
  const r = run('INSERT INTO checklist_items (event_id, stage, text, critical, position, created_at) VALUES (?, ?, ?, ?, ?, ?)', eventId, item.stage, item.text.trim(), !!item.critical, pos, nowIso());
  addHistory(eventId, user.id, 'checklist', `Item adicionado: ${item.text.trim()}`);
  return r.lastInsertRowid;
}

export function updateChecklistItem(user: SessionUser, itemId: number, patch: { done?: boolean; text?: string; critical?: boolean; notes?: string | null }) {
  const item = get<Row>('SELECT * FROM checklist_items WHERE id = ?', itemId);
  if (!item) throw new HttpError(404, 'Item não encontrado');
  getVisibleEvent(user, item.event_id as number);
  return tx(() => {
    if (patch.done !== undefined && !!item.done !== patch.done) {
      run('UPDATE checklist_items SET done = ?, done_by = ?, done_at = ? WHERE id = ?', patch.done, patch.done ? user.id : null, patch.done ? nowIso() : null, itemId);
      addHistory(item.event_id as number, user.id, 'checklist', `${patch.done ? 'Concluído' : 'Reaberto'}: ${item.text}`);
    }
    if (patch.text !== undefined && patch.text.trim() && patch.text.trim() !== item.text) {
      run('UPDATE checklist_items SET text = ? WHERE id = ?', patch.text.trim(), itemId);
      addHistory(item.event_id as number, user.id, 'checklist', `Item editado: "${item.text}" → "${patch.text.trim()}"`);
    }
    if (patch.critical !== undefined) run('UPDATE checklist_items SET critical = ? WHERE id = ?', patch.critical, itemId);
    if (patch.notes !== undefined) run('UPDATE checklist_items SET notes = ? WHERE id = ?', patch.notes, itemId);
    return rowToChecklist(get<Row>('SELECT c.*, u.name AS done_by_name FROM checklist_items c LEFT JOIN users u ON u.id = c.done_by WHERE c.id = ?', itemId)!);
  });
}

export function deleteChecklistItem(user: SessionUser, itemId: number) {
  const item = get<Row>('SELECT * FROM checklist_items WHERE id = ?', itemId);
  if (!item) throw new HttpError(404, 'Item não encontrado');
  getVisibleEvent(user, item.event_id as number);
  run('DELETE FROM checklist_items WHERE id = ?', itemId);
  addHistory(item.event_id as number, user.id, 'checklist', `Item removido: ${item.text}`);
}

export function addParticipant(user: SessionUser, eventId: number, p: { user_id?: number | null; name: string; role_label?: string | null; attendance?: AttendanceKey }) {
  getVisibleEvent(user, eventId);
  const r = run(
    'INSERT INTO event_participants (event_id, user_id, name, role_label, attendance, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    eventId,
    p.user_id ?? null,
    p.name.trim(),
    p.role_label ?? null,
    p.attendance ?? 'pendente',
    nowIso(),
  );
  addHistory(eventId, user.id, 'participante', `Participante incluído: ${p.name.trim()}`);
  return r.lastInsertRowid;
}

export function setAttendance(participantId: number, attendance: AttendanceKey, by: { userId: number | null; channel: string }) {
  const p = get<Participant>('SELECT * FROM event_participants WHERE id = ?', participantId);
  if (!p) throw new HttpError(404, 'Participante não encontrado');
  if (p.attendance === attendance) return p;
  run('UPDATE event_participants SET attendance = ?, responded_at = ?, response_channel = ? WHERE id = ?', attendance, nowIso(), by.channel, participantId);
  const labels: Record<string, string> = { confirmada: 'confirmou presença', recusada: 'informou que não comparecerá', pendente: 'teve a presença solicitada', nao_solicitada: 'teve a solicitação retirada' };
  addHistory(p.event_id, by.userId, 'participante', `${p.name} ${labels[attendance]} (${by.channel})`);
  return get<Participant>('SELECT * FROM event_participants WHERE id = ?', participantId)!;
}

export function removeParticipant(user: SessionUser, participantId: number) {
  const p = get<Participant>('SELECT * FROM event_participants WHERE id = ?', participantId);
  if (!p) throw new HttpError(404, 'Participante não encontrado');
  getVisibleEvent(user, p.event_id);
  run('DELETE FROM event_participants WHERE id = ?', participantId);
  addHistory(p.event_id, user.id, 'participante', `Participante removido: ${p.name}`);
}

export function addComment(user: SessionUser, eventId: number, text: string) {
  getVisibleEvent(user, eventId);
  const r = run('INSERT INTO event_comments (event_id, user_id, text, created_at) VALUES (?, ?, ?, ?)', eventId, user.id, text.trim(), nowIso());
  addHistory(eventId, user.id, 'observacao', `Observação registrada por ${user.name}`);
  return r.lastInsertRowid;
}

export function commentsFor(eventId: number) {
  return all<Row>('SELECT c.*, u.name AS user_name FROM event_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.event_id = ? ORDER BY c.id DESC', eventId);
}

export function attachmentsFor(eventId: number) {
  return all<Row>('SELECT a.id, a.event_id, a.filename, a.mime, a.size, a.kind, a.created_at, u.name AS uploaded_by_name FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by WHERE a.event_id = ? ORDER BY a.id DESC', eventId);
}
