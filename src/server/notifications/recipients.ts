// Destinatários do WhatsApp, consentimento e preferências individuais.
import { all, get, nowIso, parseJson, run } from '../db.ts';
import { HttpError } from '../http.ts';
import { CONFIGURABLE_NOTIFICATION_TYPES, CONSENT_TEXT_VERSION, ROLE_DEFAULTS } from '../../shared/constants.ts';
import type { ConsentStatus, NotificationType, RoleKey } from '../../shared/constants.ts';
import type { AgendaEvent, Recipient, RecipientPreferences } from '../../shared/types.ts';

export function defaultPreferences(): RecipientPreferences {
  return {
    types: Object.fromEntries(CONFIGURABLE_NOTIFICATION_TYPES.map((t) => [t, true])) as RecipientPreferences['types'],
    scope: 'todos',
    advanceDays: 3,
    advanceTime: '08:00',
    eveTime: '18:00',
    dayOfTime: '07:00',
    weeklyTime: '07:30',
  };
}

type Row = Record<string, unknown>;

function toRecipient(r: Row): Recipient {
  const prefs = { ...defaultPreferences(), ...parseJson<Partial<RecipientPreferences>>(r.preferences, {}) };
  prefs.types = { ...defaultPreferences().types, ...(prefs.types ?? {}) };
  return {
    id: r.id as number,
    user_id: (r.user_id as number) ?? null,
    user_name: (r.user_name as string) ?? null,
    name: r.name as string,
    phone: r.phone as string,
    consent_status: r.consent_status as ConsentStatus,
    consent_at: (r.consent_at as string) ?? null,
    consent_method: (r.consent_method as string) ?? null,
    preferences: prefs,
    active: !!r.active,
  };
}

/** Normaliza telefone para dígitos E.164 sem "+" (ex.: 5566999999999). */
export function normalizePhone(input: string): string {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = '55' + d; // número nacional brasileiro
  if (d.length < 12 || d.length > 15) throw new HttpError(422, 'Telefone inválido. Use DDD + número (ex.: 66 99999-9999) ou formato internacional.');
  return d;
}

/** Compara números considerando o 9º dígito de celulares brasileiros (o WhatsApp às vezes o omite no wa_id). */
export function samePhone(a: string, b: string): boolean {
  const x = a.replace(/\D/g, '');
  const y = b.replace(/\D/g, '');
  if (x === y) return true;
  const strip9 = (s: string) => (s.startsWith('55') && s.length === 13 && s[4] === '9' ? s.slice(0, 4) + s.slice(5) : s);
  return strip9(x) === strip9(y);
}

export function formatPhone(d: string): string {
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const num = d.slice(4);
    return `+55 (${ddd}) ${num.length === 9 ? `${num.slice(0, 5)}-${num.slice(5)}` : `${num.slice(0, 4)}-${num.slice(4)}`}`;
  }
  return `+${d}`;
}

export function listRecipients(): Recipient[] {
  return all<Row>('SELECT r.*, u.name AS user_name FROM whatsapp_recipients r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.name').map(toRecipient);
}

export function getRecipient(id: number): Recipient | null {
  const r = get<Row>('SELECT r.*, u.name AS user_name FROM whatsapp_recipients r LEFT JOIN users u ON u.id = r.user_id WHERE r.id = ?', id);
  return r ? toRecipient(r) : null;
}

export function findRecipientByPhone(phone: string): Recipient | null {
  return listRecipients().find((r) => samePhone(r.phone, phone)) ?? null;
}

export function createRecipient(data: { name: string; phone: string; user_id?: number | null; preferences?: Partial<RecipientPreferences> }) {
  const phone = normalizePhone(data.phone);
  if (get('SELECT id FROM whatsapp_recipients WHERE phone = ?', phone)) throw new HttpError(409, 'Este número já está cadastrado.');
  const now = nowIso();
  const prefs = { ...defaultPreferences(), ...(data.preferences ?? {}) };
  const r = run(
    'INSERT INTO whatsapp_recipients (user_id, name, phone, consent_status, preferences, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
    data.user_id ?? null,
    data.name.trim(),
    phone,
    'pendente',
    JSON.stringify(prefs),
    now,
    now,
  );
  return r.lastInsertRowid;
}

export function updateRecipient(id: number, patch: { name?: string; phone?: string; user_id?: number | null; preferences?: Partial<RecipientPreferences>; active?: boolean }) {
  const cur = getRecipient(id);
  if (!cur) throw new HttpError(404, 'Destinatário não encontrado');
  const phone = patch.phone ? normalizePhone(patch.phone) : cur.phone;
  if (phone !== cur.phone && get('SELECT id FROM whatsapp_recipients WHERE phone = ? AND id <> ?', phone, id)) throw new HttpError(409, 'Este número já está cadastrado.');
  const prefs = patch.preferences ? { ...cur.preferences, ...patch.preferences, types: { ...cur.preferences.types, ...(patch.preferences.types ?? {}) } } : cur.preferences;
  // Trocar o número exige novo consentimento.
  const consent = phone !== cur.phone ? 'pendente' : cur.consent_status;
  run(
    'UPDATE whatsapp_recipients SET name = ?, phone = ?, user_id = ?, preferences = ?, active = ?, consent_status = ?, consent_at = CASE WHEN ? THEN NULL ELSE consent_at END, updated_at = ? WHERE id = ?',
    patch.name?.trim() || cur.name,
    phone,
    patch.user_id === undefined ? cur.user_id : patch.user_id,
    JSON.stringify(prefs),
    patch.active === undefined ? cur.active : patch.active,
    consent,
    phone !== cur.phone,
    nowIso(),
    id,
  );
  return getRecipient(id)!;
}

export function setConsent(id: number, status: ConsentStatus, method: string, recordedBy: number | null) {
  const cur = getRecipient(id);
  if (!cur) throw new HttpError(404, 'Destinatário não encontrado');
  run(
    'UPDATE whatsapp_recipients SET consent_status = ?, consent_at = ?, consent_method = ?, consent_text_version = ?, consent_recorded_by = ?, updated_at = ? WHERE id = ?',
    status,
    nowIso(),
    method,
    CONSENT_TEXT_VERSION,
    recordedBy,
    nowIso(),
    id,
  );
  if (status !== 'concedido') {
    run(`UPDATE notifications SET status = 'cancelado', last_error = 'Consentimento não concedido/revogado', updated_at = ? WHERE recipient_id = ? AND status = 'pendente'`, nowIso(), id);
  }
  return getRecipient(id)!;
}

export function deleteRecipient(id: number) {
  run('DELETE FROM whatsapp_recipients WHERE id = ?', id);
}

interface UserLite {
  id: number;
  role: RoleKey;
  extra_permissions: string;
}

/**
 * Decide se o destinatário deve receber avisos deste compromisso.
 * - Precisa de consentimento registrado e cadastro ativo.
 * - O tipo de aviso precisa estar ligado nas preferências.
 * - Escopo "envolvidos": só se for responsável ou participante.
 * - Compromissos privados só vão para responsável/participantes ou quem vê tudo.
 */
export function recipientWants(r: Recipient, type: NotificationType, event: AgendaEvent | null, involvedUserIds: number[]): boolean {
  if (!r.active || r.consent_status !== 'concedido') return false;
  if (type !== 'teste' && r.preferences.types[type] === false) return false;
  if (!event) return true;
  if (event.notification_settings?.enabled === false && type !== 'alteracao') return false;
  const involved = r.user_id != null && (event.responsible_id === r.user_id || involvedUserIds.includes(r.user_id));
  if (r.preferences.scope === 'envolvidos' && !involved) return false;
  if (event.visibility === 'privado' && !involved) {
    if (!r.user_id) return false;
    const u = get<UserLite>('SELECT id, role, extra_permissions FROM users WHERE id = ? AND active = 1', r.user_id);
    if (!u) return false;
    const canAll = u.role === 'admin' || (ROLE_DEFAULTS[u.role] ?? []).includes('events.view_all');
    if (!canAll) return false;
  }
  return true;
}
