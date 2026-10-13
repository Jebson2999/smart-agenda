// Despachante: retira avisos vencidos da fila e envia pela Cloud API.
// Garantias:
//  • Reserva atômica (BEGIN IMMEDIATE) — dois processos nunca enviam o mesmo aviso.
//  • Retentativa só quando a falha comprovadamente ocorreu antes de a Meta aceitar a mensagem.
//  • Resultado incerto (timeout após o envio) NÃO é reenviado automaticamente.
//  • Em modo demonstração nada é enviado e o status fica "demonstracao" — nunca "enviado".
import crypto from 'node:crypto';
import { all, get, nowIso, run, tx } from '../db.ts';
import { config } from '../config.ts';
import { findEvent, checklistFor, rowToAction } from '../repo/events.ts';
import { effectiveWhatsAppMode } from '../repo/settings.ts';
import { getRecipient, recipientWants } from './recipients.ts';
import { getTemplate, rowToNotification } from './queue.ts';
import { renderMessage } from './messages.ts';
import type { RenderedMessage } from './messages.ts';
import { sendTemplateMessage } from './provider.ts';
import { weeklyDigest } from './planner.ts';
import { isOpen } from '../../shared/intelligence.ts';
import { nowInTz, startOfWeekMonday, formatDateBR } from '../../shared/dates.ts';
import type { NotificationRow } from '../../shared/types.ts';

const BACKOFF_MIN = [1, 5, 15, 60, 180];
const STALE_LOCK_MIN = 10;

export interface DispatchStats {
  processed: number;
  sent: number;
  demo: number;
  failed: number;
  retried: number;
  uncertain: number;
  cancelled: number;
}

function log(notificationId: number, direction: string, status: string, detail: string, raw?: unknown) {
  run('INSERT INTO message_log (notification_id, direction, status, detail, raw, created_at) VALUES (?, ?, ?, ?, ?, ?)', notificationId, direction, status, detail, raw === undefined ? null : JSON.stringify(raw), nowIso());
}

function finish(n: NotificationRow, status: string, fields: Record<string, string | number | null>, detail: string, raw?: unknown) {
  const sets = ['status = ?', 'lock_id = NULL', 'locked_at = NULL', 'updated_at = ?'];
  const vals: Array<string | number | null> = [status, nowIso()];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  run(`UPDATE notifications SET ${sets.join(', ')} WHERE id = ?`, ...vals, n.id);
  log(n.id, 'saida', status, detail, raw);
}

/** Marca como "incerto" reservas abandonadas (processo caiu durante o envio). */
export function recoverStaleLocks(now = new Date()) {
  const limit = new Date(now.getTime() - STALE_LOCK_MIN * 60_000).toISOString();
  const stale = all<{ id: number }>(`SELECT id FROM notifications WHERE status = 'processando' AND locked_at < ?`, limit);
  for (const s of stale) {
    run(`UPDATE notifications SET status = 'incerto', lock_id = NULL, locked_at = NULL, last_error = ?, updated_at = ? WHERE id = ?`, 'Processo interrompido durante o envio — verifique antes de reenviar.', nowIso(), s.id);
    log(s.id, 'sistema', 'incerto', 'Reserva expirada: processo interrompido durante o envio.');
  }
  return stale.length;
}

function claim(now: Date, limit: number, onlyId?: number): NotificationRow[] {
  const lockId = crypto.randomUUID();
  return tx(() => {
    const ids = onlyId
      ? all<{ id: number }>(`SELECT id FROM notifications WHERE id = ? AND status = 'pendente'`, onlyId)
      : all<{ id: number }>(`SELECT id FROM notifications WHERE status = 'pendente' AND next_attempt_at <= ? ORDER BY next_attempt_at, id LIMIT ?`, now.toISOString(), limit);
    if (!ids.length) return [];
    run(
      `UPDATE notifications SET status = 'processando', lock_id = ?, locked_at = ?, attempts = attempts + 1, updated_at = ? WHERE status = 'pendente' AND id IN (${ids.map(() => '?').join(',')})`,
      lockId,
      nowIso(),
      nowIso(),
      ...ids.map((i) => i.id),
    );
    return all<Record<string, unknown>>(`SELECT * FROM notifications WHERE lock_id = ?`, lockId).map(rowToNotification);
  });
}

function involvedUsers(eventId: number): number[] {
  return all<{ user_id: number }>('SELECT user_id FROM event_participants WHERE event_id = ? AND user_id IS NOT NULL', eventId).map((r) => r.user_id);
}

/** Monta a mensagem com os dados atuais (não com os do momento em que entrou na fila). */
function buildMessage(n: NotificationRow): { msg: RenderedMessage; cancel?: string } {
  const t = getTemplate(n.type);
  const r = getRecipient(n.recipient_id)!;
  if (n.type === 'alteracao' || n.type === 'teste') {
    const e = n.event_id ? findEvent(n.event_id) : null;
    const buttons: RenderedMessage['buttons'] = e && n.type === 'alteracao' ? [{ type: 'url', index: 0, url_suffix: String(e.id) }] : [];
    return { msg: { params: n.payload.params, preview: n.payload.preview, buttons } };
  }
  if (n.type === 'resumo_semanal') {
    const monday = startOfWeekMonday(nowInTz(config.timezone).date);
    return { msg: renderMessage(t, { recipientName: r.name, week: weeklyDigest(r, monday) }) };
  }
  if (n.type === 'pendencia_vencimento') {
    const a = n.action_id ? get<Record<string, unknown>>('SELECT a.*, e.title AS event_title FROM actions a LEFT JOIN events e ON e.id = a.event_id WHERE a.id = ?', n.action_id) : null;
    if (!a) return { msg: { params: [], preview: '', buttons: [] }, cancel: 'Ação removida' };
    const action = rowToAction(a);
    if (action.status === 'concluida' || action.status === 'cancelada') return { msg: { params: [], preview: '', buttons: [] }, cancel: 'Ação já concluída/cancelada' };
    return { msg: renderMessage(t, { action, recipientName: r.name }) };
  }
  const e = n.event_id ? findEvent(n.event_id) : null;
  if (!e) return { msg: { params: [], preview: '', buttons: [] }, cancel: 'Compromisso removido' };
  if (!isOpen(e)) return { msg: { params: [], preview: '', buttons: [] }, cancel: 'Compromisso concluído ou cancelado' };
  if (n.dedupe_key.split(':').pop() !== e.start_date && n.dedupe_key.match(/:\d{4}-\d{2}-\d{2}$/) && n.type !== 'reuniao_nao_confirmada') {
    return { msg: { params: [], preview: '', buttons: [] }, cancel: 'A data do compromisso mudou' };
  }
  const pendingCount = checklistFor([e.id]).filter((i) => !i.done).length;
  let participantId: number | undefined;
  if (n.type === 'confirmacao_presenca') {
    participantId = Number(n.dedupe_key.split(':')[2]);
    const p = get<{ attendance: string }>('SELECT attendance FROM event_participants WHERE id = ?', participantId);
    if (!p || p.attendance !== 'pendente') return { msg: { params: [], preview: '', buttons: [] }, cancel: 'Presença já respondida' };
  }
  if (n.type === 'reuniao_nao_confirmada') {
    const stillPending = e.status === 'a_confirmar' || !!get('SELECT 1 FROM event_participants WHERE event_id = ? AND attendance = ?', e.id, 'pendente');
    if (!stillPending) return { msg: { params: [], preview: '', buttons: [] }, cancel: 'Já confirmado' };
  }
  return { msg: renderMessage(t, { event: e, recipientName: r.name, pendingCount, participantId, pendingReason: n.payload.params[3] }) };
}

export async function dispatchDue(now: Date = new Date(), opts: { limit?: number; onlyId?: number } = {}): Promise<DispatchStats> {
  const stats: DispatchStats = { processed: 0, sent: 0, demo: 0, failed: 0, retried: 0, uncertain: 0, cancelled: 0 };
  const batch = claim(now, opts.limit ?? 25, opts.onlyId);
  const mode = effectiveWhatsAppMode();
  for (const n of batch) {
    stats.processed++;
    try {
      const r = getRecipient(n.recipient_id);
      const ev = n.event_id ? findEvent(n.event_id) : null;
      if (!r || !recipientWants(r, n.type, n.type === 'pendencia_vencimento' || n.type === 'resumo_semanal' ? null : ev, n.event_id ? involvedUsers(n.event_id) : [])) {
        finish(n, 'cancelado', { last_error: 'Destinatário sem consentimento, inativo ou com este aviso desligado' }, 'Cancelado antes do envio: destinatário não elegível.');
        stats.cancelled++;
        continue;
      }
      const { msg, cancel } = buildMessage(n);
      if (cancel) {
        finish(n, 'cancelado', { last_error: cancel }, `Cancelado antes do envio: ${cancel}.`);
        stats.cancelled++;
        continue;
      }
      const payload = JSON.stringify({ params: msg.params, preview: msg.preview, buttons: msg.buttons });
      const template = getTemplate(n.type);
      if (mode === 'demo') {
        finish(n, 'demonstracao', { mode: 'demo', payload, last_error: null }, 'MODO DEMONSTRAÇÃO — mensagem montada e registrada, mas NÃO enviada ao WhatsApp.');
        stats.demo++;
        continue;
      }
      if (template.status !== 'aprovado') {
        finish(n, 'falhou', { mode: 'live', payload, failed_at: nowIso(), last_error: `Template "${template.name}" não está aprovado pela Meta (status: ${template.status}).` }, 'Falhou: template não aprovado.');
        stats.failed++;
        continue;
      }
      const result = await sendTemplateMessage(r.phone, { name: template.name, language: template.language }, msg);
      if (result.ok) {
        finish(n, 'enviado', { mode: 'live', payload, provider_message_id: result.messageId, sent_at: nowIso(), last_error: null }, `Aceito pela Meta (id ${result.messageId}). Aguardando confirmação de entrega.`, result.raw);
        stats.sent++;
      } else if (result.uncertain) {
        finish(n, 'incerto', { mode: 'live', payload, last_error: result.error }, `Resultado incerto: ${result.error}`, result.raw);
        stats.uncertain++;
      } else if (result.retryable && n.attempts < n.max_attempts) {
        const wait = BACKOFF_MIN[Math.min(n.attempts - 1, BACKOFF_MIN.length - 1)];
        const next = new Date(now.getTime() + wait * 60_000).toISOString();
        finish(n, 'pendente', { mode: 'live', payload, next_attempt_at: next, last_error: result.error }, `Falha temporária (tentativa ${n.attempts}/${n.max_attempts}): ${result.error}. Nova tentativa em ${wait} min.`, result.raw);
        stats.retried++;
      } else {
        finish(n, 'falhou', { mode: 'live', payload, failed_at: nowIso(), last_error: result.error }, `Falhou: ${result.error}`, result.raw);
        stats.failed++;
      }
    } catch (err) {
      finish(n, 'falhou', { failed_at: nowIso(), last_error: `Erro interno: ${(err as Error).message}` }, `Erro interno: ${(err as Error).message}`);
      stats.failed++;
    }
  }
  return stats;
}

/** Reenvio manual autorizado pelo administrador (após verificar um resultado incerto ou falha). */
export function requeueNotification(id: number, userName: string) {
  const n = get<{ status: string; attempts: number }>('SELECT status, attempts FROM notifications WHERE id = ?', id);
  if (!n) return false;
  if (!['falhou', 'incerto', 'demonstracao', 'cancelado'].includes(n.status)) return false;
  run(`UPDATE notifications SET status = 'pendente', next_attempt_at = ?, max_attempts = ?, last_error = NULL, updated_at = ? WHERE id = ?`, nowIso(), n.attempts + 3, nowIso(), id);
  log(id, 'sistema', 'pendente', `Reenvio autorizado manualmente por ${userName} em ${formatDateBR(nowIso().slice(0, 10))}.`);
  return true;
}

export function cancelNotification(id: number, userName: string) {
  const r = run(`UPDATE notifications SET status = 'cancelado', last_error = ?, updated_at = ? WHERE id = ? AND status = 'pendente'`, `Cancelado por ${userName}`, nowIso(), id);
  if (r.changes) log(id, 'sistema', 'cancelado', `Cancelado manualmente por ${userName}.`);
  return r.changes > 0;
}
