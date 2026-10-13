import { CATEGORIES } from '../../shared/constants.ts';
import type { CategoryKey } from '../../shared/constants.ts';
import { formatPeriod, nowInTz } from '../../shared/dates.ts';

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function catColor(c: CategoryKey): string {
  return CATEGORIES[c]?.color ?? '#475569';
}

/** Cor com transparência (hex + alfa). */
export function tint(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

export function firstName(name: string): string {
  return name.split(' ')[0] ?? name;
}

export function greeting(tz: string, now = new Date()): string {
  const h = Number(nowInTz(tz, now).time.slice(0, 2));
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function periodWithTime(e: { start_date: string; end_date: string; start_time: string | null; end_time: string | null }): string {
  const p = formatPeriod(e.start_date, e.end_date);
  return e.start_time ? `${p}, ${e.start_time}${e.end_time ? `–${e.end_time}` : ''}` : p;
}

export function relDays(n: number): string {
  if (n === 0) return 'hoje';
  if (n === 1) return 'amanhã';
  if (n === -1) return 'ontem';
  if (n > 1) return `em ${n} dias`;
  return `há ${-n} dias`;
}

export function fmtDateTime(iso: string | null | undefined, tz = 'America/Cuiaba'): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
