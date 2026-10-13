import type { ReactNode } from 'react';
import { LuClock, LuMapPin, LuTriangleAlert, LuFlag } from 'react-icons/lu';
import { CATEGORIES, PRIORITIES, STATUSES } from '../../shared/constants.ts';
import type { CategoryKey, PriorityKey, StatusKey } from '../../shared/constants.ts';
import { formatPeriod } from '../../shared/dates.ts';
import type { AgendaEvent } from '../../shared/types.ts';
import { Badge } from './ui.tsx';
import { Link } from '../lib/router.tsx';
import { catColor, cn, tint } from '../lib/util.ts';

export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden>
      <rect width="48" height="48" rx="13" fill="#0B4336" />
      <path d="M14 17.5h20a2.5 2.5 0 0 1 2.5 2.5v13a2.5 2.5 0 0 1-2.5 2.5H14a2.5 2.5 0 0 1-2.5-2.5V20a2.5 2.5 0 0 1 2.5-2.5Z" fill="none" stroke="#D6F4E7" strokeWidth="2.2" />
      <path d="M18 14v6M30 14v6" stroke="#D6F4E7" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M19 31c0-5.5 4.2-8.7 10.5-9.2-.3 6.2-3.6 9.9-8.6 10.1" fill="#3ED19A" />
      <path d="M19 31.6c2.2-2.6 4.6-4.4 7.4-5.6" stroke="#0B4336" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function CategoryTag({ category, short }: { category: CategoryKey; short?: boolean }) {
  const c = CATEGORIES[category];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium leading-5" style={{ background: tint(c.color, 0.12), color: c.color }}>
      <span className="size-1.5 rounded-full" style={{ background: c.color }} />
      {short ? c.short : c.label}
    </span>
  );
}

export function StatusBadge({ status, overdue }: { status: StatusKey; overdue?: boolean }) {
  if (overdue) return <Badge tone="danger">Atrasado</Badge>;
  const s = STATUSES[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function PriorityBadge({ priority }: { priority: PriorityKey }) {
  if (priority === 'media' || priority === 'baixa') return null;
  return (
    <Badge tone={priority === 'critica' ? 'danger' : 'warn'} icon={<LuFlag className="size-3" />}>
      {PRIORITIES[priority].label}
    </Badge>
  );
}

export function placeOf(e: Pick<AgendaEvent, 'unit_name' | 'municipality'>) {
  return e.unit_name || e.municipality || 'Unidade a definir';
}

export function EventRow({ e, right, alert, compact }: { e: AgendaEvent; right?: ReactNode; alert?: string | null; compact?: boolean }) {
  const color = catColor(e.category);
  return (
    <Link to={`/eventos/${e.id}`} className={cn('group flex items-stretch gap-3 rounded-xl px-2 transition-colors hover:bg-surface-2', compact ? 'py-2' : 'py-2.5')}>
      <span className="w-1 shrink-0 rounded-full" style={{ background: color }} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn('truncate font-medium text-ink', compact ? 'text-[13.5px]' : 'text-[14px]')}>{e.title}</span>
          <PriorityBadge priority={e.priority} />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-muted">
          <span className="num inline-flex items-center gap-1">
            <LuClock className="size-3.5" />
            {formatPeriod(e.start_date, e.end_date)}
            {e.start_time && ` · ${e.start_time}${e.end_time ? `–${e.end_time}` : ''}`}
          </span>
          <span className="inline-flex items-center gap-1">
            <LuMapPin className="size-3.5" />
            {placeOf(e)}
          </span>
        </div>
        {alert && (
          <div className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-[#A76200] dark:text-amber">
            <LuTriangleAlert className="size-3.5" />
            {alert}
          </div>
        )}
      </div>
      {right && <div className="flex shrink-0 items-center">{right}</div>}
    </Link>
  );
}

/** Faixa de dias do compromisso: um bloco por dia, o dia atual destacado. */
export function DayStrip({ start, end, today, dark }: { start: string; end: string; today: string; dark?: boolean }) {
  const days: string[] = [];
  for (let d = start; d <= end && days.length < 14; ) {
    days.push(d);
    const dt = new Date(`${d}T12:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + 1);
    d = dt.toISOString().slice(0, 10);
  }
  const wd = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  return (
    <div className="flex gap-1.5" aria-label={`Período: ${formatPeriod(start, end)}`}>
      {days.map((d) => {
        const past = d < today;
        const isToday = d === today;
        return (
          <div
            key={d}
            className={cn(
              'num flex min-w-[46px] flex-col items-center rounded-xl px-2 py-1.5 text-center',
              dark
                ? isToday
                  ? 'bg-[#3ED19A] text-forest'
                  : past
                    ? 'bg-white/5 text-white/45'
                    : 'bg-white/10 text-white'
                : isToday
                  ? 'bg-emerald text-white'
                  : 'bg-surface-2 text-ink',
            )}
          >
            <span className="text-[10.5px] opacity-75">{wd[new Date(`${d}T12:00:00Z`).getUTCDay()]}</span>
            <span className="text-[17px] font-semibold leading-tight">{Number(d.slice(8))}</span>
          </div>
        );
      })}
    </div>
  );
}
