// Feriados nacionais brasileiros (fixos + Sexta-feira Santa) e pontos facultativos
// móveis. Feriados municipais/estaduais são cadastrados pelo administrador.
import { addDays } from './dates.ts';

export interface Holiday {
  date: string;
  name: string;
  scope: 'nacional' | 'estadual' | 'municipal' | 'facultativo';
  municipality?: string | null;
}

const FIXED: Array<[string, string]> = [
  ['01-01', 'Confraternização Universal'],
  ['04-21', 'Tiradentes'],
  ['05-01', 'Dia do Trabalho'],
  ['09-07', 'Independência do Brasil'],
  ['10-12', 'Nossa Senhora Aparecida'],
  ['11-02', 'Finados'],
  ['11-15', 'Proclamação da República'],
  ['11-20', 'Dia Nacional de Zumbi e da Consciência Negra'],
  ['12-25', 'Natal'],
];

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function nationalHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  const list: Holiday[] = FIXED.map(([md, name]) => ({ date: `${year}-${md}`, name, scope: 'nacional' as const }));
  list.push({ date: addDays(easter, -2), name: 'Sexta-feira Santa', scope: 'nacional' });
  list.push({ date: addDays(easter, -48), name: 'Carnaval (ponto facultativo)', scope: 'facultativo' });
  list.push({ date: addDays(easter, -47), name: 'Carnaval (ponto facultativo)', scope: 'facultativo' });
  list.push({ date: addDays(easter, 60), name: 'Corpus Christi (ponto facultativo)', scope: 'facultativo' });
  return list.sort((x, y) => x.date.localeCompare(y.date));
}

export function holidaysBetween(start: string, end: string, custom: Holiday[] = []): Holiday[] {
  const y1 = Number(start.slice(0, 4));
  const y2 = Number(end.slice(0, 4));
  const out: Holiday[] = [];
  for (let y = y1; y <= y2; y++) out.push(...nationalHolidays(y));
  out.push(...custom);
  return out.filter((h) => h.date >= start && h.date <= end).sort((a, b) => a.date.localeCompare(b.date));
}
