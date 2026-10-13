// Relatórios exportáveis: agenda mensal (PDF), resumo executivo, Excel, ICS, auditoria e visitas/reuniões.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { LuCalendarDays, LuCalendarPlus, LuExternalLink, LuFileDown, LuFileSpreadsheet, LuFileText, LuShieldCheck, LuUsers } from 'react-icons/lu';
import { download } from '../lib/api.ts';
import { useApi } from '../lib/hooks.ts';
import { useSession } from '../lib/session.tsx';
import { PageHeader } from '../components/Layout.tsx';
import { Button, Card, Field, Input, Select, Skeleton, Tabs, useFeedback } from '../components/ui.tsx';
import { addDays, addMonths, formatPeriod, monthLabel, monthRange, startOfWeekMonday, todayInTz } from '../../shared/dates.ts';
import type { AgendaEvent } from '../../shared/types.ts';
import type { Summary } from '../../shared/intelligence.ts';

function ReportCard({ icon, title, text, children, actions }: { icon: ReactNode; title: string; text: string; children?: ReactNode; actions: ReactNode }) {
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-soft-emerald text-emerald dark:text-[#4CC28F]">{icon}</span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-muted">{text}</p>
        </div>
      </div>
      {children && <div className="mt-4 grid gap-3 sm:grid-cols-2">{children}</div>}
      <div className="mt-auto flex flex-wrap gap-2 pt-4">{actions}</div>
    </Card>
  );
}

/** Seletor de mês que funciona igual em todos os navegadores (o campo "month" não existe no Safari de computador). */
function MonthSelect({ value, onChange, center }: { value: string; onChange: (v: string) => void; center: string }) {
  const options: string[] = [];
  for (let k = -12; k <= 18; k++) options.push(addMonths(`${center}-01`, k).slice(0, 7));
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((m) => {
        const l = monthLabel(m);
        return (
          <option key={m} value={m}>
            {l.charAt(0).toUpperCase() + l.slice(1)}
          </option>
        );
      })}
    </Select>
  );
}

function useDownloader() {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, path: string, name: string) => {
    setBusy(key);
    try {
      await download(path, name);
      toast('ok', 'Arquivo gerado');
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

export function ReportsPage() {
  const { user } = useSession();
  const today = todayInTz(user?.timezone ?? 'America/Cuiaba');
  const month0 = today.slice(0, 7);
  const [month, setMonth] = useState(month0);
  const [kind, setKind] = useState<'semana' | 'mes'>('mes');
  const [sumMonth, setSumMonth] = useState(month0);
  const [sumWeek, setSumWeek] = useState(startOfWeekMonday(today));
  const [from, setFrom] = useState(monthRange(month0).start);
  const [to, setTo] = useState(addDays(addMonths(monthRange(month0).start, 3), -1));
  const [auditId, setAuditId] = useState('');
  const audits = useApi<{ audits: Array<{ event: AgendaEvent }> }>('/api/audits');
  const ref = kind === 'semana' ? sumWeek : sumMonth;
  const summary = useApi<Summary>(`/api/summary?kind=${kind}&ref=${ref}`);
  const { busy, run } = useDownloader();
  const rangeOk = from && to && to >= from;
  const q = `from=${from}&to=${to}`;
  const auditList = audits.data?.audits ?? [];
  const selectedAudit = auditId || (auditList[0] ? String(auditList[0].event.id) : '');

  return (
    <div>
      <PageHeader title="Relatórios" subtitle="Tudo é gerado na hora, a partir dos dados cadastrados que você pode ver." />
      <div className="grid gap-5 lg:grid-cols-2">
        <ReportCard
          icon={<LuCalendarDays className="size-5" />}
          title="Agenda mensal (PDF)"
          text="Calendário do mês com compromissos, feriados e alertas de conflito, pronto para imprimir."
          actions={
            <>
              <Button icon={<LuFileDown className="size-4" />} loading={busy === 'mensal'} disabled={!month} onClick={() => void run('mensal', `/api/reports/agenda-mensal.pdf?month=${month}`, `agenda-${month}.pdf`)}>
                Baixar PDF
              </Button>
              <Button variant="secondary" icon={<LuExternalLink className="size-4" />} disabled={!month} onClick={() => window.open(`/api/reports/agenda-mensal.pdf?month=${month}&inline=1`, '_blank', 'noopener')}>
                Abrir
              </Button>
            </>
          }
        >
          <Field label="Mês">
            <MonthSelect value={month} onChange={setMonth} center={month0} />
          </Field>
        </ReportCard>

        <ReportCard
          icon={<LuFileSpreadsheet className="size-5" />}
          title="Agenda em Excel"
          text="Planilha com compromissos, checklists e ações, incluindo os alertas de cada compromisso."
          actions={
            <Button icon={<LuFileDown className="size-4" />} loading={busy === 'xlsx'} disabled={!rangeOk} onClick={() => void run('xlsx', `/api/reports/agenda.xlsx?${q}`, `agenda-${from}_${to}.xlsx`)}>
              Baixar Excel
            </Button>
          }
        >
          <Field label="De">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Até">
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </ReportCard>

        <Card className="p-5 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-soft-emerald text-emerald dark:text-[#4CC28F]">
                <LuFileText className="size-5" />
              </span>
              <div>
                <h2 className="text-[15px] font-semibold text-ink">Resumo executivo</h2>
                <p className="mt-0.5 text-[13px] text-muted">Para enviar ao coordenador: totais, distribuição por local, situação, alertas e pendências.</p>
              </div>
            </div>
            <Tabs<'semana' | 'mes'>
              value={kind}
              onChange={setKind}
              tabs={[
                { key: 'mes', label: 'Mensal' },
                { key: 'semana', label: 'Semanal' },
              ]}
            />
          </div>
          <div className="mt-4 grid gap-5 lg:grid-cols-[260px_1fr]">
            <div className="space-y-3">
              {kind === 'mes' ? (
                <Field label="Mês">
                  <MonthSelect value={sumMonth} onChange={setSumMonth} center={month0} />
                </Field>
              ) : (
                <Field label="Semana que contém o dia" hint={`Semana de ${formatPeriod(startOfWeekMonday(sumWeek || today), addDays(startOfWeekMonday(sumWeek || today), 6))}`}>
                  <Input type="date" value={sumWeek} onChange={(e) => setSumWeek(e.target.value)} />
                </Field>
              )}
              <Button className="w-full" icon={<LuFileDown className="size-4" />} loading={busy === 'resumo'} disabled={!ref} onClick={() => void run('resumo', `/api/reports/resumo-executivo.pdf?kind=${kind}&ref=${ref}`, `resumo-${kind}-${ref}.pdf`)}>
                Baixar PDF
              </Button>
            </div>
            <div className="min-h-[160px] rounded-2xl border border-line bg-surface-2 p-4">
              {!summary.data ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
              ) : (
                <>
                  <div className="mb-2 flex flex-wrap gap-2 text-[12px]">
                    <span className="num rounded-lg bg-surface px-2 py-1 text-ink-2">{summary.data.total} compromisso(s)</span>
                    <span className="num rounded-lg bg-surface px-2 py-1 text-ink-2">{summary.data.agendaDays} dia(s) em campo</span>
                    <span className="num rounded-lg bg-surface px-2 py-1 text-ink-2">{summary.data.concluded} concluído(s)</span>
                    {summary.data.conflicts.length > 0 && <span className="num rounded-lg bg-soft-amber px-2 py-1 text-[#8A5300] dark:text-amber">{summary.data.conflicts.length} conflito(s)</span>}
                    {summary.data.pending.length > 0 && <span className="num rounded-lg bg-soft-amber px-2 py-1 text-[#8A5300] dark:text-amber">{summary.data.pending.length} a confirmar</span>}
                  </div>
                  <div className="max-h-64 space-y-1 overflow-y-auto pr-1 text-[13px] leading-relaxed text-ink-2 scroll-thin">
                    <p className="font-semibold text-ink first-letter:uppercase">Resumo — {summary.data.label}</p>
                    {summary.data.lines.map((l, i) => (
                      <p key={i} className={l.startsWith('Atenção') || l.startsWith('Pendente') ? 'text-[#8A5300] dark:text-amber' : ''}>
                        {l}
                      </p>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </Card>

        <ReportCard
          icon={<LuShieldCheck className="size-5" />}
          title="Relatório de auditoria (PDF)"
          text="Preparação, checklists por etapa, apontamentos com responsáveis e prazos, participantes, alertas e histórico."
          actions={
            <Button icon={<LuFileDown className="size-4" />} loading={busy === 'auditoria'} disabled={!selectedAudit} onClick={() => void run('auditoria', `/api/reports/auditoria/${selectedAudit}`, `relatorio-auditoria-${selectedAudit}.pdf`)}>
              Baixar PDF
            </Button>
          }
        >
          <Field label="Auditoria" className="sm:col-span-2">
            <Select value={selectedAudit} onChange={(e) => setAuditId(e.target.value)} disabled={!auditList.length}>
              {!auditList.length && <option value="">Nenhuma auditoria cadastrada</option>}
              {auditList.map((a) => (
                <option key={a.event.id} value={a.event.id}>
                  {formatPeriod(a.event.start_date, a.event.end_date)} — {a.event.title}
                </option>
              ))}
            </Select>
          </Field>
        </ReportCard>

        <ReportCard
          icon={<LuUsers className="size-5" />}
          title="Visitas técnicas e reuniões (PDF)"
          text="Objetivos, atividades, pendências, encaminhamentos, resultados, pautas, atas e decisões do período."
          actions={
            <Button icon={<LuFileDown className="size-4" />} loading={busy === 'visitas'} disabled={!rangeOk} onClick={() => void run('visitas', `/api/reports/visitas-reunioes.pdf?${q}`, `visitas-reunioes-${from}.pdf`)}>
              Baixar PDF
            </Button>
          }
        >
          <Field label="De">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Até">
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </ReportCard>

        <ReportCard
          icon={<LuCalendarPlus className="size-5" />}
          title="Arquivo de calendário (ICS)"
          text="Importe no Google Agenda, Outlook ou no calendário do celular. Compromissos sem horário entram como dia inteiro."
          actions={
            <Button icon={<LuFileDown className="size-4" />} loading={busy === 'ics'} disabled={!rangeOk} onClick={() => void run('ics', `/api/reports/agenda.ics?${q}`, `agenda-${from}_${to}.ics`)}>
              Baixar ICS
            </Button>
          }
        >
          <p className="text-[12.5px] text-muted sm:col-span-2">
            Usa o mesmo período do Excel: <span className="num">{rangeOk ? formatPeriod(from, to) : 'período inválido'}</span>.
          </p>
        </ReportCard>
      </div>
    </div>
  );
}
