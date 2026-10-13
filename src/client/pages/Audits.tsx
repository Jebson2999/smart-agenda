// Gestão de auditorias GMP+: acompanhamento por etapas (pré, durante e pós), preparação e apontamentos.
import type { ReactNode } from 'react';
import { LuArrowRight, LuCalendarRange, LuCircleCheck, LuFileDown, LuFlag, LuInfo, LuMapPin, LuShieldCheck, LuTriangleAlert, LuClipboardCheck, LuSearchCheck, LuFileCheck } from 'react-icons/lu';
import { useApi } from '../lib/hooks.ts';
import { download } from '../lib/api.ts';
import { Link } from '../lib/router.tsx';
import { useSession } from '../lib/session.tsx';
import { cn, relDays } from '../lib/util.ts';
import { PageHeader } from '../components/Layout.tsx';
import { Badge, Button, Card, EmptyState, ErrorState, Progress, Ring, Skeleton, useFeedback } from '../components/ui.tsx';
import { StatusBadge, placeOf } from '../components/EventBits.tsx';
import { formatPeriod } from '../../shared/dates.ts';
import type { AgendaEvent } from '../../shared/types.ts';
import type { Conflict, Readiness } from '../../shared/intelligence.ts';

interface StageCount {
  total: number;
  done: number;
}

interface AuditRow {
  event: AgendaEvent;
  readiness: Readiness;
  stages: { pre: StageCount; durante: StageCount; pos: StageCount };
  findings: { total: number; open: number; critical: number };
  conflicts: Conflict[];
  statusLabel: string;
}

const LEVEL: Record<Readiness['level'], { label: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'done' }> = {
  pronta: { label: 'Preparação concluída', tone: 'ok' },
  em_preparacao: { label: 'Em preparação', tone: 'warn' },
  insuficiente: { label: 'Preparação insuficiente', tone: 'danger' },
  em_andamento: { label: 'Auditoria em andamento', tone: 'info' },
  pos_auditoria: { label: 'Pós-auditoria', tone: 'info' },
  concluida: { label: 'Concluída', tone: 'done' },
};

const STAGES: Array<{ key: 'pre' | 'durante' | 'pos'; label: string; hint: string; icon: ReactNode }> = [
  { key: 'pre', label: 'Pré-auditoria', hint: 'Inspeção, não conformidades, plano de ação, documentação e evidências', icon: <LuSearchCheck className="size-4" /> },
  { key: 'durante', label: 'Durante a auditoria', hint: 'Presença, solicitações, evidências apresentadas e observações do auditor', icon: <LuClipboardCheck className="size-4" /> },
  { key: 'pos', label: 'Pós-auditoria', hint: 'Relatório, apontamentos, responsáveis, prazos e conclusão das ações', icon: <LuFileCheck className="size-4" /> },
];

function pct(s: StageCount) {
  return s.total ? Math.round((s.done / s.total) * 100) : 0;
}

function StageTrack({ a }: { a: AuditRow }) {
  const phase = a.readiness.phase;
  return (
    <ol className="grid gap-3 md:grid-cols-3">
      {STAGES.map((s, i) => {
        const c = a.stages[s.key];
        const p = pct(c);
        const current = phase === s.key;
        const passed = (phase === 'durante' && i === 0) || (phase === 'pos' && i < 2);
        return (
          <li key={s.key} className={cn('relative rounded-2xl border p-4 transition-colors', current ? 'border-emerald bg-soft-emerald/60 dark:bg-soft-emerald/40' : 'border-line bg-surface')}>
            <div className="flex items-center justify-between gap-2">
              <span className={cn('inline-flex items-center gap-2 text-[13.5px] font-semibold', current ? 'text-forest dark:text-mint' : 'text-ink')}>
                <span className={cn('flex size-7 items-center justify-center rounded-lg', current ? 'bg-emerald text-white' : passed ? 'bg-soft-emerald text-emerald' : 'bg-surface-2 text-muted')}>{passed && p === 100 ? <LuCircleCheck className="size-4" /> : s.icon}</span>
                {s.label}
              </span>
              <span className="num text-[13px] font-semibold text-ink">{c.total ? `${p}%` : '—'}</span>
            </div>
            <Progress className="mt-3" value={p} tone={p === 100 ? 'emerald' : current ? 'emerald' : 'amber'} label={`${s.label} ${p}%`} />
            <div className="mt-2 flex items-center justify-between gap-2 text-[12px] text-muted">
              <span className="num">
                {c.done} de {c.total} itens
              </span>
              {current && <span className="font-medium text-emerald">etapa atual</span>}
            </div>
            <p className="mt-2 text-[12px] leading-snug text-muted">{s.hint}</p>
          </li>
        );
      })}
    </ol>
  );
}

function AuditCard({ a, today }: { a: AuditRow; today: string }) {
  const { can } = useSession();
  const { toast } = useFeedback();
  const r = a.readiness;
  const lv = LEVEL[r.level];
  const ringColor = r.level === 'insuficiente' ? '#DC4444' : r.percent >= 90 ? '#198A5D' : '#F59E0B';
  const e = a.event;
  return (
    <Card className="overflow-hidden animate-rise">
      <div className="h-1.5 bg-[#7C3AED]" />
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={lv.tone}>{lv.label}</Badge>
              <StatusBadge status={e.status} overdue={e.end_date < today && e.status !== 'concluido' && e.status !== 'cancelado'} />
              {a.conflicts.length > 0 && (
                <Badge tone="warn" icon={<LuTriangleAlert className="size-3" />}>
                  Possível conflito
                </Badge>
              )}
            </div>
            <h2 className="mt-2.5 text-[20px] leading-tight font-semibold tracking-[-0.02em] text-ink sm:text-[22px]">{e.title}</h2>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13.5px] text-ink-2">
              <span className="inline-flex items-center gap-1.5">
                <LuMapPin className="size-4 text-muted" />
                {placeOf(e)}
              </span>
              <span className="num inline-flex items-center gap-1.5">
                <LuCalendarRange className="size-4 text-muted" />
                {formatPeriod(e.start_date, e.end_date)}
                <span className="text-muted">({r.phase === 'pre' ? relDays(r.daysRemaining) : r.phase === 'durante' ? 'em andamento' : 'realizada'})</span>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Ring value={r.percent} size={84} stroke={8} color={ringColor}>
              <div className="text-center leading-none">
                <div className="num text-[18px] font-semibold text-ink">{r.percent}%</div>
                <div className="mt-1 text-[10px] text-muted">preparação</div>
              </div>
            </Ring>
            <div className="hidden text-[12.5px] leading-relaxed text-muted sm:block">
              <div className="num">
                <strong className="text-ink">{r.done}</strong> de {r.total} itens
              </div>
              <div className="num">
                <strong className={r.criticalPending ? 'text-alert' : 'text-ink'}>{r.criticalPending}</strong> pendência(s) crítica(s)
              </div>
              <div className="num">{r.phase === 'pre' ? `${r.daysRemaining} dia(s) restantes` : '—'}</div>
            </div>
          </div>
        </div>

        <div className="mt-5">
          <StageTrack a={a} />
        </div>

        {(r.reasons.length > 0 || a.conflicts.length > 0) && (
          <div className="mt-4 space-y-2">
            {r.reasons.map((x) => (
              <p key={x} className={cn('flex items-start gap-2 rounded-xl px-3 py-2 text-[13px]', r.level === 'insuficiente' ? 'bg-soft-alert text-[#A12828] dark:text-[#F19B9B]' : 'bg-soft-amber text-[#8A5300] dark:text-amber')}>
                <LuTriangleAlert className="mt-0.5 size-4 shrink-0" />
                {x}
              </p>
            ))}
            {a.conflicts.map((c) => (
              <p key={c.id} className="flex items-start gap-2 rounded-xl bg-soft-amber px-3 py-2 text-[13px] text-[#8A5300] dark:text-amber">
                <LuTriangleAlert className="mt-0.5 size-4 shrink-0" />
                {c.message}
              </p>
            ))}
          </div>
        )}

        <div className="mt-5 grid gap-4 border-t border-line pt-4 lg:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-ink">Pendências da preparação</div>
            {r.pendingItems.length === 0 ? (
              <p className="mt-1 text-[13px] text-muted">{r.total ? 'Todos os itens de preparação foram concluídos.' : 'Nenhum item de preparação cadastrado.'}</p>
            ) : (
              <ul className="mt-1.5 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                {r.pendingItems.slice(0, 8).map((i) => (
                  <li key={i.id} className="flex items-start gap-2 text-[13px] text-ink-2">
                    <span className={cn('mt-[7px] size-1.5 shrink-0 rounded-full', i.critical ? 'bg-alert' : 'bg-amber')} />
                    <span>
                      {i.text}
                      {i.critical && <span className="ml-1 text-[11.5px] font-medium text-alert">crítico</span>}
                    </span>
                  </li>
                ))}
                {r.pendingItems.length > 8 && <li className="text-[12.5px] text-muted">+ {r.pendingItems.length - 8} itens</li>}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                <LuFlag className="size-3.5" />
                <span className="num">
                  {a.findings.total} apontamento(s) · {a.findings.open} em aberto · {a.findings.critical} crítico(s)
                </span>
              </span>
              {r.prepEventId ? (
                <Link to={`/eventos/${r.prepEventId}`} className="font-medium text-emerald hover:underline">
                  Ver preparação vinculada
                </Link>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2 lg:flex-col lg:items-stretch">
            <Link to={`/eventos/${e.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald px-4 text-[14px] font-medium text-white hover:bg-emerald-2">
              Abrir checklist e apontamentos <LuArrowRight className="size-4" />
            </Link>
            {can('reports.view') && (
              <Button variant="secondary" icon={<LuFileDown className="size-4" />} onClick={() => void download(`/api/reports/auditoria/${e.id}`, `relatorio-auditoria-${e.id}.pdf`).catch((er: Error) => toast('error', er.message))}>
                Relatório da auditoria
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function AuditsPage() {
  const { data, error, loading, reload } = useApi<{ today: string; audits: AuditRow[] }>('/api/audits');
  const { can } = useSession();
  if (loading && !data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full rounded-card" />
        <Skeleton className="h-[420px] w-full rounded-card" />
      </div>
    );
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const upcoming = data.audits.filter((a) => a.event.end_date >= data.today && a.event.status !== 'cancelado');
  const past = data.audits.filter((a) => !(a.event.end_date >= data.today && a.event.status !== 'cancelado'));
  const critical = upcoming.reduce((s, a) => s + a.readiness.criticalPending, 0);
  const openFindings = data.audits.reduce((s, a) => s + a.findings.open, 0);
  const insufficient = upcoming.filter((a) => a.readiness.level === 'insuficiente').length;

  return (
    <div>
      <PageHeader title="Auditorias GMP+" subtitle="Acompanhamento por etapas, com preparação calculada a partir dos checklists cadastrados." />
      <Card className="mb-5 overflow-hidden">
        <div className="grid grid-cols-2 divide-line lg:grid-cols-4 [&>*]:border-line [&>*:nth-child(-n+2)]:border-b lg:[&>*]:border-b-0 lg:[&>*:not(:last-child)]:border-r">
          <Kpi label="Auditorias à frente" value={upcoming.length} icon={<LuShieldCheck className="size-[18px]" />} />
          <Kpi label="Com preparação insuficiente" value={insufficient} icon={<LuTriangleAlert className="size-[18px]" />} tone={insufficient ? 'danger' : 'ok'} />
          <Kpi label="Pendências críticas" value={critical} icon={<LuFlag className="size-[18px]" />} tone={critical ? 'danger' : 'ok'} />
          <Kpi label="Apontamentos em aberto" value={openFindings} icon={<LuClipboardCheck className="size-[18px]" />} tone={openFindings ? 'warn' : 'ok'} />
        </div>
      </Card>
      <div className="mb-5 flex items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-[13px] text-ink-2">
        <LuInfo className="mt-0.5 size-4 shrink-0 text-emerald" />
        <p>
          Os checklists de cada etapa são <strong>modelos editáveis</strong>
          {can('settings.manage') ? (
            <>
              {' '}
              (em{' '}
              <Link to="/configuracoes?aba=modelos" className="font-medium text-emerald hover:underline">
                Configurações → Modelos de checklist
              </Link>
              )
            </>
          ) : null}
          . O sistema não presume requisitos específicos da certificação: valide os itens com a norma GMP+ vigente e com a certificadora.
        </p>
      </div>
      {upcoming.length === 0 && past.length === 0 ? (
        <Card>
          <EmptyState icon={<LuShieldCheck className="size-5" />} title="Nenhuma auditoria cadastrada" text="Crie um compromisso na categoria Auditoria GMP+ para acompanhar a preparação aqui." />
        </Card>
      ) : (
        <div className="space-y-5">
          {upcoming.map((a) => (
            <AuditCard key={a.event.id} a={a} today={data.today} />
          ))}
          {past.length > 0 && (
            <div>
              <h2 className="mb-3 text-[15px] font-semibold text-ink">Realizadas ou canceladas</h2>
              <div className="space-y-5">
                {past.map((a) => (
                  <AuditCard key={a.event.id} a={a} today={data.today} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, icon, tone }: { label: string; value: ReactNode; icon: ReactNode; tone?: 'ok' | 'warn' | 'danger' }) {
  return (
    <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', tone === 'danger' ? 'bg-soft-alert text-alert' : tone === 'warn' ? 'bg-soft-amber text-[#B26B00] dark:text-amber' : 'bg-soft-emerald text-emerald dark:text-[#4CC28F]')}>{icon}</span>
      <div className="min-w-0">
        <div className="num text-[22px] leading-none font-semibold text-ink">{value}</div>
        <div className="mt-1 truncate text-[12.5px] text-muted">{label}</div>
      </div>
    </div>
  );
}
