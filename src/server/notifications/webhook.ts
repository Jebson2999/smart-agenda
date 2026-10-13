// Webhooks da Cloud API: validação da assinatura X-Hub-Signature-256, atualização de
// status (enviado → entregue → lido / falhou), respostas dos botões e descadastro (PARAR).
import crypto from 'node:crypto';
import { get, nowIso, run } from '../db.ts';
import { whatsappEnv } from '../config.ts';
import { setAttendance } from '../repo/events.ts';
import { findRecipientByPhone, samePhone, setConsent } from './recipients.ts';
import { verifyAttendancePayload } from './messages.ts';
import { audit } from '../auth.ts';

export function verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const [algo, received] = header.split('=');
  if (algo !== 'sha256' || !received) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(received, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyChallenge(params: URLSearchParams): string | null {
  const { verifyToken } = whatsappEnv();
  if (!verifyToken) return null;
  if (params.get('hub.mode') !== 'subscribe') return null;
  const token = params.get('hub.verify_token') ?? '';
  const a = Buffer.from(token);
  const b = Buffer.from(verifyToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return params.get('hub.challenge');
}

const ORDER: Record<string, number> = { enviado: 1, entregue: 2, lido: 3 };
const MAP: Record<string, 'enviado' | 'entregue' | 'lido' | 'falhou'> = { sent: 'enviado', delivered: 'entregue', read: 'lido', failed: 'falhou' };

interface StatusUpdate {
  id: string;
  status: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>;
}

interface InboundMessage {
  from: string;
  id: string;
  type: string;
  text?: { body?: string };
  button?: { payload?: string; text?: string };
  interactive?: { button_reply?: { id?: string; title?: string } };
}

function logInbound(notificationId: number | null, status: string, detail: string, raw: unknown) {
  run('INSERT INTO message_log (notification_id, direction, status, detail, raw, created_at) VALUES (?, ?, ?, ?, ?, ?)', notificationId, 'entrada', status, detail, JSON.stringify(raw), nowIso());
}

export function applyStatus(s: StatusUpdate): boolean {
  const mapped = MAP[s.status];
  if (!mapped) return false;
  const n = get<{ id: number; status: string }>('SELECT id, status FROM notifications WHERE provider_message_id = ?', s.id);
  if (!n) return false;
  const when = s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : nowIso();
  if (mapped === 'falhou') {
    const err = s.errors?.[0];
    const reason = [err?.title, err?.message, err?.error_data?.details].filter(Boolean).join(' — ') || 'Falha informada pela Meta';
    run(`UPDATE notifications SET status = 'falhou', failed_at = ?, last_error = ?, updated_at = ? WHERE id = ?`, when, `${reason}${err?.code ? ` (código ${err.code})` : ''}`, nowIso(), n.id);
    logInbound(n.id, 'falhou', `Meta informou falha na entrega: ${reason}`, s);
    return true;
  }
  // Só avança (nunca volta de "lido" para "entregue", p. ex.)
  if ((ORDER[n.status] ?? 0) >= ORDER[mapped]) {
    logInbound(n.id, mapped, `Status repetido/antigo ignorado (${s.status})`, s);
    return false;
  }
  const col = mapped === 'entregue' ? 'delivered_at' : mapped === 'lido' ? 'read_at' : 'sent_at';
  run(`UPDATE notifications SET status = ?, ${col} = ?, updated_at = ? WHERE id = ?`, mapped, when, nowIso(), n.id);
  logInbound(n.id, mapped, `Meta informou: ${s.status}`, s);
  return true;
}

export function applyInbound(m: InboundMessage): string {
  const payload = m.button?.payload ?? m.interactive?.button_reply?.id ?? null;
  const text = (m.text?.body ?? m.button?.text ?? '').trim();
  const recipient = findRecipientByPhone(m.from);
  if (payload) {
    const parsed = verifyAttendancePayload(payload);
    if (!parsed) {
      logInbound(null, 'ignorado', 'Resposta de botão com assinatura inválida', m);
      return 'assinatura_invalida';
    }
    const part = get<{ id: number; user_id: number | null; event_id: number }>('SELECT id, user_id, event_id FROM event_participants WHERE id = ?', parsed.participantId);
    if (!part) return 'participante_inexistente';
    // A resposta precisa vir do número cadastrado para o próprio participante.
    const owner = part.user_id ? get<{ phone: string }>('SELECT phone FROM whatsapp_recipients WHERE user_id = ? AND active = 1', part.user_id) : null;
    if (!owner || !samePhone(owner.phone, m.from)) {
      logInbound(null, 'ignorado', `Resposta de presença recebida de número não vinculado ao participante (${m.from})`, m);
      return 'numero_nao_autorizado';
    }
    setAttendance(part.id, parsed.answer === 'S' ? 'confirmada' : 'recusada', { userId: part.user_id, channel: 'WhatsApp' });
    logInbound(null, 'resposta', `Presença ${parsed.answer === 'S' ? 'confirmada' : 'recusada'} via WhatsApp`, m);
    return parsed.answer === 'S' ? 'presenca_confirmada' : 'presenca_recusada';
  }
  if (recipient && /^(parar|pare|stop|sair|cancelar)$/i.test(text)) {
    setConsent(recipient.id, 'revogado', 'Respondeu PARAR pelo WhatsApp', null);
    audit(null, 'consentimento_revogado', 'whatsapp_recipient', recipient.id, { via: 'whatsapp' });
    logInbound(null, 'descadastro', `${recipient.name} revogou o consentimento respondendo "${text}"`, m);
    return 'consentimento_revogado';
  }
  logInbound(null, 'mensagem', `Mensagem recebida de ${recipient?.name ?? m.from}: ${text.slice(0, 120)}`, m);
  return 'registrada';
}

/** Processa o corpo de um webhook já com assinatura validada. Idempotente. */
export function processWebhook(body: unknown): { statuses: number; messages: string[] } {
  const out = { statuses: 0, messages: [] as string[] };
  const b = body as { entry?: Array<{ changes?: Array<{ value?: { statuses?: StatusUpdate[]; messages?: InboundMessage[] } }> }> };
  for (const entry of b?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const s of change.value?.statuses ?? []) if (applyStatus(s)) out.statuses++;
      for (const m of change.value?.messages ?? []) {
        if (!m.id) continue;
        const fresh = run('INSERT OR IGNORE INTO inbound_messages (wa_message_id, received_at) VALUES (?, ?)', m.id, nowIso());
        if (!fresh.changes) continue; // já processada (a Meta pode reenviar o mesmo webhook)
        out.messages.push(applyInbound(m));
      }
    }
  }
  return out;
}
