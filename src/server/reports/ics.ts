// Exportação iCalendar (RFC 5545) — importável no Google Agenda, Outlook e iPhone.
import { config } from '../config.ts';
import { addDays, diffDays } from '../../shared/dates.ts';
import { CATEGORIES, STATUSES } from '../../shared/constants.ts';
import type { AgendaEvent } from '../../shared/types.ts';

function esc(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Dobra linhas em 75 octetos (UTF-8), como exige a RFC 5545. */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const len = Buffer.byteLength(ch, 'utf8');
    if (size + len > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += len;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const d = (date: string) => date.replace(/-/g, '');
const t = (time: string) => time.replace(':', '') + '00';
const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function eventsToIcs(events: AgendaEvent[], calName = 'ASTRAL Smart Agenda'): string {
  const tz = config.timezone;
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Astral Saude Ambiental//ASTRAL Smart Agenda//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(calName)}`,
    `X-WR-TIMEZONE:${tz}`,
  ];
  if (tz === 'America/Cuiaba') {
    // Mato Grosso: UTC-4 sem horário de verão.
    lines.push('BEGIN:VTIMEZONE', 'TZID:America/Cuiaba', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0400', 'TZNAME:-04', 'END:STANDARD', 'END:VTIMEZONE');
  }
  const now = stamp(new Date().toISOString());
  for (const e of events) {
    const location = [e.unit_name, e.municipality && e.municipality !== e.unit_name ? e.municipality : null].filter(Boolean).join(' — ');
    const desc = [
      e.description,
      `Categoria: ${CATEGORIES[e.category].label}`,
      `Status: ${STATUSES[e.status].label}`,
      e.responsible_name ? `Responsável: ${e.responsible_name}` : null,
      e.notes ? `Observações: ${e.notes}` : null,
      `${config.appUrl}/eventos/${e.id}`,
    ]
      .filter(Boolean)
      .join('\n');
    lines.push('BEGIN:VEVENT', `UID:astral-evento-${e.id}@astral-smart-agenda`, `DTSTAMP:${now}`, `SEQUENCE:${Math.max(0, e.version - 1)}`);
    if (e.start_time) {
      // Horário informado: repete no mesmo horário em cada dia do período.
      lines.push(`DTSTART;TZID=${tz}:${d(e.start_date)}T${t(e.start_time)}`);
      if (e.end_time) lines.push(`DTEND;TZID=${tz}:${d(e.start_date)}T${t(e.end_time)}`);
      const days = diffDays(e.start_date, e.end_date) + 1;
      if (days > 1) lines.push(`RRULE:FREQ=DAILY;COUNT=${days}`);
    } else {
      // Somente datas: evento de dia inteiro (sem presumir horário). DTEND é exclusivo.
      lines.push(`DTSTART;VALUE=DATE:${d(e.start_date)}`, `DTEND;VALUE=DATE:${d(addDays(e.end_date, 1))}`);
    }
    lines.push(
      `SUMMARY:${esc(e.title)}`,
      ...(location ? [`LOCATION:${esc(location)}`] : []),
      `DESCRIPTION:${esc(desc)}`,
      `CATEGORIES:${esc(CATEGORIES[e.category].label)}`,
      `STATUS:${e.status === 'cancelado' ? 'CANCELLED' : e.status === 'a_confirmar' ? 'TENTATIVE' : 'CONFIRMED'}`,
      'TRANSP:OPAQUE',
      `URL:${config.appUrl}/eventos/${e.id}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
