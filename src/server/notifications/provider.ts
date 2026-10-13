// Cliente da WhatsApp Business Platform — Cloud API oficial da Meta.
// Classifica falhas para permitir retentativas seguras (sem duplicar mensagens).
import { whatsappEnv } from '../config.ts';
import { whatsappConfig } from '../repo/settings.ts';
import type { RenderedMessage } from './messages.ts';

export type SendResult =
  | { ok: true; messageId: string; raw: unknown }
  | { ok: false; retryable: boolean; uncertain: boolean; error: string; code?: number | string; httpStatus?: number; raw?: unknown };

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

let fetchImpl: FetchLike = (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>;

/** Permite substituir o fetch em testes automatizados. */
export function setFetchForTests(f: FetchLike | null) {
  fetchImpl = f ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
}

export function buildTemplatePayload(to: string, template: { name: string; language: string }, msg: RenderedMessage) {
  const components: unknown[] = [];
  if (msg.params.length) components.push({ type: 'body', parameters: msg.params.map((text) => ({ type: 'text', text })) });
  for (const b of msg.buttons) {
    if (b.type === 'url') components.push({ type: 'button', sub_type: 'url', index: String(b.index), parameters: [{ type: 'text', text: b.url_suffix }] });
    else components.push({ type: 'button', sub_type: 'quick_reply', index: String(b.index), parameters: [{ type: 'payload', payload: b.payload }] });
  }
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: { name: template.name, language: { code: template.language }, components },
  };
}

// Códigos de erro da Cloud API que indicam limite de taxa / indisponibilidade temporária.
const RETRYABLE_CODES = new Set([4, 80007, 130429, 131016, 131056, 133004]);
// Erros de rede em que a requisição comprovadamente não chegou à Meta.
const PRE_SEND_NET_ERRORS = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UND_ERR_CONNECT_TIMEOUT']);

function netCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.cause?.code ?? e?.code;
}

export async function sendTemplateMessage(to: string, template: { name: string; language: string }, msg: RenderedMessage, timeoutMs = 15_000): Promise<SendResult> {
  const env = whatsappEnv();
  const cfg = whatsappConfig();
  if (!env.accessToken || !cfg.phoneNumberId) return { ok: false, retryable: false, uncertain: false, error: 'Credenciais da Cloud API não configuradas' };
  const url = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`;
  const body = JSON.stringify(buildTemplatePayload(to, template, msg));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.accessToken}`, 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const code = netCode(err);
    if ((err as Error)?.name === 'AbortError') {
      return { ok: false, retryable: false, uncertain: true, error: 'Tempo de resposta esgotado — a Meta pode ter recebido a mensagem. Verifique antes de reenviar.' };
    }
    if (code && PRE_SEND_NET_ERRORS.has(code)) {
      return { ok: false, retryable: true, uncertain: false, error: `Falha de conexão antes do envio (${code})`, code };
    }
    return { ok: false, retryable: false, uncertain: true, error: `Conexão interrompida (${code ?? (err as Error)?.message ?? 'erro desconhecido'}) — resultado incerto.`, code };
  }
  clearTimeout(timer);
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  const d = data as { messages?: Array<{ id: string }>; error?: { code?: number; message?: string; error_data?: { details?: string }; error_subcode?: number } };
  if (res.ok && d?.messages?.[0]?.id) return { ok: true, messageId: d.messages[0].id, raw: data };
  const apiCode = d?.error?.code;
  const message = [d?.error?.message, d?.error?.error_data?.details].filter(Boolean).join(' — ') || `HTTP ${res.status}`;
  if (res.status === 429 || (apiCode !== undefined && RETRYABLE_CODES.has(apiCode))) {
    return { ok: false, retryable: true, uncertain: false, error: `Limite temporário da Meta: ${message}`, code: apiCode, httpStatus: res.status, raw: data };
  }
  if (res.status >= 500) {
    return { ok: false, retryable: true, uncertain: false, error: `Instabilidade na Meta (HTTP ${res.status}): ${message}`, code: apiCode, httpStatus: res.status, raw: data };
  }
  if (res.ok) {
    // 2xx sem ID de mensagem — não sabemos se foi aceito.
    return { ok: false, retryable: false, uncertain: true, error: 'Resposta da Meta sem identificador da mensagem.', httpStatus: res.status, raw: data };
  }
  return { ok: false, retryable: false, uncertain: false, error: message, code: apiCode, httpStatus: res.status, raw: data };
}

export async function fetchTemplateStatuses(): Promise<Array<{ name: string; status: string; language: string }>> {
  const env = whatsappEnv();
  const cfg = whatsappConfig();
  if (!env.accessToken || !cfg.businessAccountId) throw new Error('Informe o token e o ID da conta do WhatsApp Business (WABA) para sincronizar.');
  const url = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.businessAccountId}/message_templates?fields=name,status,language&limit=200`;
  const res = await fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${env.accessToken}` } });
  const data = (await res.json()) as { data?: Array<{ name: string; status: string; language: string }>; error?: { message?: string } };
  if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
  return data.data ?? [];
}
