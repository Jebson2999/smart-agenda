// Fila persistente de notificações.
// Deduplicação: cada aviso tem uma chave única (dedupe_key) — INSERT OR IGNORE garante
// que o mesmo aviso nunca entra duas vezes na fila, mesmo com vários processos.
import { all, get, nowIso, parseJson, run } from '../db.ts';
import { DEFAULT_TEMPLATES, renderMessage } from './messages.ts';
import type { RenderInput, TemplateDef } from './messages.ts';
import { listRecipients, recipientWants } from './recipients.ts';
import type { NotificationType } from '../../shared/constants.ts';
import type { AgendaEvent, NotificationRow } from '../../shared/types.ts';

type Row = Record<string, unknown>;

export function getTemplate(type: NotificationType): TemplateDef & { status: string } {
  const r = get<Row>('SELECT * FROM wa_templates WHERE notif_type = ?', type);
  const def = DEFAULT_TEMPLATES.find((t) => t.type === type)!;
  if (!r) return { ...def, status: 'nao_submetido' };
  return {
    type,
    name: r.name as string,
    language: r.language as string,
    category: 'UTILITY',
    body: r.body as string,
    variables: parseJson(r.variables, def.variables),
    buttons: parseJson(r.buttons, def.buttons),
    status: r.status as string,
  };
}

export function rowToNotification(r: Row): NotificationRow & { recipient_name?: string; recipient_phone?: string; event_title?: string } {
  return {
    ...(r as unknown as NotificationRow),
    payload: parseJson(r.payload, { params: [], preview: '' }),
    recipient_name: r.recipient_name as string | undefined,
    recipient_phone: r.recipient_phone as string | undefined,
    event_title: r.event_title as string | undefined,
  };
}

export interface EnqueueInput {
  type: NotificationType;
  recipientId: number;
  dedupeKey: string;
  scheduledFor: Date;
  eventId?: number | null;
  actionId?: number | null;
  preview?: RenderInput;
  maxAttempts?: number;
}

/** Retorna true se entrou na fila; false se já existia (deduplicado). */
export function enqueue(n: EnqueueInput): boolean {
  const now = nowIso();
  const when = n.scheduledFor.toISOString();
  let payload = { params: [] as string[], preview: '' };
  if (n.preview) {
    try {
      const t = getTemplate(n.type);
      const r = renderMessage(t, n.preview);
      payload = { params: r.params, preview: r.preview };
    } catch {
      /* a mensagem final é montada no envio */
    }
  }
  const r = run(
    `INSERT OR IGNORE INTO notifications (type, event_id, action_id, recipient_id, dedupe_key, scheduled_for, status, attempts, max_attempts, next_attempt_at, payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pendente', 0, ?, ?, ?, ?, ?)`,
    n.type,
    n.eventId ?? null,
    n.actionId ?? null,
    n.recipientId,
    n.dedupeKey,
    when,
    n.maxAttempts ?? 5,
    when,
    JSON.stringify(payload),
    now,
    now,
  );
  if (r.changes > 0) {
    run('INSERT INTO message_log (notification_id, direction, status, detail, created_at) VALUES (?, ?, ?, ?, ?)', r.lastInsertRowid, 'sistema', 'pendente', `Agendado para ${when}`, now);
  }
  return r.changes > 0;
}

const REMINDER_TYPES: NotificationType[] = ['aviso_antecipado', 'lembrete_vespera', 'lembrete_dia', 'confirmacao_presenca', 'reuniao_nao_confirmada'];

export function cancelPendingForEvent(eventId: number, reason: string, types: NotificationType[] = REMINDER_TYPES): number {
  const r = run(
    `UPDATE notifications SET status = 'cancelado', last_error = ?, updated_at = ? WHERE event_id = ? AND status = 'pendente' AND type IN (${types.map(() => '?').join(',')})`,
    reason,
    nowIso(),
    eventId,
    ...types,
  );
  return r.changes;
}

/**
 * Chamado quando datas, horários, unidade ou status mudam.
 * Cancela lembretes já agendados (o planejador recria com as novas datas)
 * e enfileira imediatamente o aviso de alteração/cancelamento.
 */
export function onEventChanged(event: AgendaEvent, kind: 'alterado' | 'cancelado', changedFields: string[], changedBy = 'Sistema') {
  cancelPendingForEvent(event.id, kind === 'cancelado' ? 'Compromisso cancelado' : 'Compromisso alterado — lembretes serão recriados');
  const involved = all<{ user_id: number }>('SELECT user_id FROM event_participants WHERE event_id = ? AND user_id IS NOT NULL', event.id).map((p) => p.user_id);
  const labels: Record<string, string> = {
    start_date: 'data inicial',
    end_date: 'data final',
    start_time: 'horário inicial',
    end_time: 'horário final',
    unit_id: 'unidade',
    municipality: 'município',
    status: 'status',
  };
  const changes = changedFields.filter((f) => labels[f]).map((f) => labels[f]).join(', ') || 'dados do compromisso';
  for (const r of listRecipients()) {
    if (!recipientWants(r, 'alteracao', event, involved)) continue;
    enqueue({
      type: 'alteracao',
      recipientId: r.id,
      eventId: event.id,
      dedupeKey: `alteracao:${event.id}:v${event.version}:${r.id}`,
      scheduledFor: new Date(),
      preview: { event, recipientName: r.name, changeKind: kind, changes, changedBy },
    });
  }
}

export function notificationsForEvent(eventId: number) {
  return all<Row>(
    `SELECT n.*, r.name AS recipient_name, r.phone AS recipient_phone FROM notifications n JOIN whatsapp_recipients r ON r.id = n.recipient_id WHERE n.event_id = ? ORDER BY n.scheduled_for DESC LIMIT 100`,
    eventId,
  ).map(rowToNotification);
}
