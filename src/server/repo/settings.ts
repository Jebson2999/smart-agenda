import { get, nowIso, parseJson, run, all } from '../db.ts';
import { whatsappEnv } from '../config.ts';
import { holidaysBetween } from '../../shared/holidays.ts';
import type { Holiday } from '../../shared/holidays.ts';

export function getSetting<T>(key: string, fallback: T): T {
  const r = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return r ? parseJson<T>(r.value, fallback) : fallback;
}

export function setSetting(key: string, value: unknown) {
  run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', key, JSON.stringify(value), nowIso());
}

export interface WhatsAppConfig {
  mode: 'demo' | 'live';
  displayNumber: string;
  phoneNumberId: string;
  businessAccountId: string;
  graphVersion: string;
  businessName: string;
}

export function whatsappConfig(): WhatsAppConfig {
  const env = whatsappEnv();
  const saved = getSetting<Partial<WhatsAppConfig>>('whatsapp.config', {});
  return {
    mode: saved.mode === 'live' ? 'live' : 'demo',
    displayNumber: saved.displayNumber ?? '',
    phoneNumberId: saved.phoneNumberId || env.phoneNumberId,
    businessAccountId: saved.businessAccountId || env.businessAccountId,
    graphVersion: saved.graphVersion || env.graphVersion,
    businessName: saved.businessName ?? 'Astral Saúde Ambiental',
  };
}

/** Estado das credenciais — devolve só se existem, nunca os valores. */
export function whatsappCredentialStatus() {
  const env = whatsappEnv();
  const cfg = whatsappConfig();
  const status = {
    accessToken: !!env.accessToken,
    appSecret: !!env.appSecret,
    verifyToken: !!env.verifyToken,
    phoneNumberId: !!cfg.phoneNumberId,
    businessAccountId: !!cfg.businessAccountId,
  };
  const readyForLive = status.accessToken && status.appSecret && status.phoneNumberId;
  return { ...status, readyForLive, effectiveMode: (cfg.mode === 'live' && readyForLive ? 'live' : 'demo') as 'live' | 'demo' };
}

export function effectiveWhatsAppMode(): 'live' | 'demo' {
  return whatsappCredentialStatus().effectiveMode;
}

export function customHolidays(): Holiday[] {
  return all<Holiday & { id: number }>('SELECT id, date, name, scope, municipality FROM custom_holidays ORDER BY date');
}

export function allHolidays(start: string, end: string): Holiday[] {
  return holidaysBetween(start, end, customHolidays());
}
