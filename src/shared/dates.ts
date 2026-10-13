// Utilitários de datas "somente data" (YYYY-MM-DD) e conversões de fuso.
// Regra do sistema: quando só a data é informada, nunca presumimos horário.

export const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const MONTHS_SHORT_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const WEEKDAYS_PT = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const WEEKDAYS_SHORT_PT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isISODate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isTime(v: unknown): v is string {
  return typeof v === 'string' && TIME_RE.test(v);
}

function toUTC(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUTC(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  const dt = toUTC(date);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUTC(dt);
}

export function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return fromUTC(target);
}

/** Diferença em dias corridos: b - a. */
export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86_400_000);
}

/** 0 = domingo … 6 = sábado */
export function weekday(date: string): number {
  return toUTC(date).getUTCDay();
}

export function isWeekend(date: string): boolean {
  const w = weekday(date);
  return w === 0 || w === 6;
}

export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    out.push(d);
    if (out.length > 3700) break; // proteção
  }
  return out;
}

export function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}
export function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export function formatDateBR(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

export function formatDayMonth(date: string): string {
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
}

/** "19 a 21/10/2026", "30/10 a 02/11/2026", "28/12/2026 a 03/01/2027" ou "27/10/2026". */
export function formatPeriod(start: string, end: string): string {
  if (start === end) return formatDateBR(start);
  const [sy, sm, sd] = start.split('-');
  const [ey, em, ed] = end.split('-');
  if (sy === ey && sm === em) return `${sd} a ${ed}/${em}/${ey}`;
  if (sy === ey) return `${sd}/${sm} a ${ed}/${em}/${ey}`;
  return `${formatDateBR(start)} a ${formatDateBR(end)}`;
}

export function formatLongDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${WEEKDAYS_PT[weekday(date)]}, ${d} de ${MONTHS_PT[m - 1]} de ${y}`;
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const end = fromUTC(new Date(Date.UTC(y, m, 0)));
  return { start, end };
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS_PT[m - 1]} de ${y}`;
}

/** Segunda-feira da semana da data. */
export function startOfWeekMonday(date: string): string {
  const w = weekday(date);
  return addDays(date, w === 0 ? -6 : 1 - w);
}

export function isoWeekKey(date: string): string {
  const dt = toUTC(date);
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- fusos horários

function partsInTz(ms: number, tz: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(ms))) p[part.type] = part.value;
  return p;
}

function tzOffsetMs(utcMs: number, tz: string): number {
  const p = partsInTz(utcMs, tz);
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - Math.floor(utcMs / 1000) * 1000;
}

/** Converte data + hora locais de um fuso IANA para um instante UTC. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = tzOffsetMs(guess, tz);
  let ts = guess - off1;
  const off2 = tzOffsetMs(ts, tz);
  if (off2 !== off1) ts = guess - off2;
  return new Date(ts);
}

/** Data (YYYY-MM-DD) e hora (HH:MM) atuais no fuso informado. */
export function nowInTz(tz: string, now: Date = new Date()): { date: string; time: string; weekday: number } {
  const p = partsInTz(now.getTime(), tz);
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, time: `${p.hour}:${p.minute}`, weekday: weekday(date) };
}

export function todayInTz(tz: string, now: Date = new Date()): string {
  return nowInTz(tz, now).date;
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
