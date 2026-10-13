import { useEffect, useMemo, useState } from 'react';
import { LuChevronLeft, LuPlus, LuRepeat, LuTriangleAlert, LuTrash2, LuSave } from 'react-icons/lu';
import { useApi, useDebounced } from '../lib/hooks.ts';
import { api, ApiError } from '../lib/api.ts';
import { Link, useRouter } from '../lib/router.tsx';
import { useSession } from '../lib/session.tsx';
import { Button, Card, ErrorState, Field, Input, Select, Skeleton, Switch, Textarea, useFeedback } from '../components/ui.tsx';
import { PageHeader } from '../components/Layout.tsx';
import { CATEGORIES, CATEGORY_KEYS, PRIORITIES, PRIORITY_KEYS, STATUSES, STATUS_KEYS } from '../../shared/constants.ts';
import type { CategoryKey, PriorityKey, StatusKey } from '../../shared/constants.ts';
import { detectConflicts } from '../../shared/intelligence.ts';
import { formatDateBR, nowInTz } from '../../shared/dates.ts';
import type { AgendaEvent } from '../../shared/types.ts';
import type { Holiday } from '../../shared/holidays.ts';

interface Options {
  units: Array<{ id: number; name: string; municipality: string | null; client: string | null }>;
  users: Array<{ id: number; name: string; role: string }>;
  auditsAndPreps: Array<{ id: number; title: string; category: string; start_date: string }>;
}

interface FormState {
  title: string;
  category: CategoryKey;
  start_date: string;
  end_date: string;
  withTime: boolean;
  start_time: string;
  end_time: string;
  unit_id: string;
  municipality: string;
  client: string;
  responsible_id: string;
  priority: PriorityKey;
  status: StatusKey;
  visibility: 'compartilhado' | 'privado';
  description: string;
  notes: string;
  related_event_id: string;
  notifEnabled: boolean;
  advanceDays: string;
  repeat: '' | 'semanal' | 'mensal';
  repeatCount: number;
  applyTemplates: boolean;
  participants: string[];
}

export function EventFormPage({ id }: { id?: number }) {
  const { loc, navigate } = useRouter();
  const { user } = useSession();
  const { toast } = useFeedback();
  const opts = useApi<Options>('/api/options');
  const existing = useApi<{ event: AgendaEvent }>(id ? `/api/events/${id}` : null);
  const today = nowInTz(user?.timezone ?? 'America/Cuiaba').date;
  const initialDate = loc.search.get('date') ?? today;
  const [f, setF] = useState<FormState>({
    title: '',
    category: 'visita_tecnica',
    start_date: initialDate,
    end_date: initialDate,
    withTime: false,
    start_time: '',
    end_time: '',
    unit_id: '',
    municipality: '',
    client: '',
    responsible_id: user ? String(user.id) : '',
    priority: 'media',
    status: 'programado',
    visibility: 'compartilhado',
    description: '',
    notes: '',
    related_event_id: '',
    notifEnabled: true,
    advanceDays: '',
    repeat: '',
    repeatCount: 6,
    applyTemplates: true,
    participants: [],
  });
  const [participant, setParticipant] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!id);

  useEffect(() => {
    const e = existing.data?.event;
    if (!e || loaded) return;
    setF((s) => ({
      ...s,
      title: e.title,
      category: e.category,
      start_date: e.start_date,
      end_date: e.end_date,
      withTime: !!e.start_time,
      start_time: e.start_time ?? '',
      end_time: e.end_time ?? '',
      unit_id: e.unit_id ? String(e.unit_id) : '',
      municipality: e.unit_id ? '' : e.municipality ?? '',
      client: e.client ?? '',
      responsible_id: e.responsible_id ? String(e.responsible_id) : '',
      priority: e.priority,
      status: e.status,
      visibility: e.visibility,
      description: e.description ?? '',
      notes: e.notes ?? '',
      related_event_id: e.related_event_id ? String(e.related_event_id) : '',
      notifEnabled: e.notification_settings?.enabled !== false,
      advanceDays: e.notification_settings?.advanceDays ? String(e.notification_settings.advanceDays) : '',
    }));
    setLoaded(true);
  }, [existing.data, loaded]);

  // Verificação de conflitos em tempo real (mesmas regras do servidor)
  const range = useDebounced(`${f.start_date}|${f.end_date}`, 350);
  const [from, to] = range.split('|');
  const nearby = useApi<{ events: AgendaEvent[]; holidays: Holiday[] }>(from && to && to >= from ? `/api/events?from=${from}&to=${to}` : null);
  const warnings = useMemo(() => {
    if (!nearby.data || !f.start_date || f.end_date < f.start_date) return { conflicts: [], holidays: [] as Holiday[] };
    const unit = opts.data?.units.find((u) => String(u.id) === f.unit_id);
    const draft = {
      id: -1,
      title: f.title || 'Este compromisso',
      category: f.category,
      start_date: f.start_date,
      end_date: f.end_date,
      start_time: f.withTime ? f.start_time || null : null,
      end_time: f.withTime ? f.end_time || null : null,
      status: f.status,
      municipality: unit?.municipality ?? (f.municipality || null),
      unit_name: unit?.name ?? null,
      unit_id: unit?.id ?? null,
      priority: f.priority,
      related_event_id: null,
    };
    const others = nearby.data.events.filter((e) => e.id !== id);
    const conflicts = detectConflicts([draft as AgendaEvent, ...others]).filter((c) => c.a.id === -1 || c.b.id === -1);
    const holidays = nearby.data.holidays.filter((h) => h.date >= f.start_date && h.date <= f.end_date);
    return { conflicts, holidays };
  }, [nearby.data, f, opts.data, id]);

  if (opts.error) return <ErrorState error={opts.error} onRetry={opts.reload} />;
  if (!opts.data || (id && !loaded)) return <Skeleton className="h-[640px] w-full rounded-card" />;
  const o = opts.data;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (f.title.trim().length < 3) errs.title = 'Informe um título com pelo menos 3 letras.';
    if (!f.start_date) errs.start_date = 'Informe a data inicial.';
    if (!f.end_date || f.end_date < f.start_date) errs.end_date = 'A data final precisa ser igual ou posterior à inicial.';
    if (f.withTime && !f.start_time) errs.start_time = 'Informe o horário inicial ou desligue a opção.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const body = {
      title: f.title.trim(),
      category: f.category,
      start_date: f.start_date,
      end_date: f.end_date,
      start_time: f.withTime ? f.start_time || null : null,
      end_time: f.withTime ? f.end_time || null : null,
      unit_id: f.unit_id ? Number(f.unit_id) : null,
      municipality: f.unit_id ? undefined : f.municipality.trim() || null,
      client: f.client.trim() || null,
      responsible_id: f.responsible_id ? Number(f.responsible_id) : null,
      priority: f.priority,
      status: f.status,
      visibility: f.visibility,
      description: f.description.trim() || null,
      notes: f.notes.trim() || null,
      related_event_id: f.related_event_id ? Number(f.related_event_id) : null,
      notification_settings: { enabled: f.notifEnabled, advanceDays: f.advanceDays ? Number(f.advanceDays) : null },
    };
    try {
      if (id) {
        await api.patch(`/api/events/${id}`, { ...body, version: existing.data?.event.version });
        toast('ok', 'Alterações salvas — registradas no histórico');
        navigate(`/eventos/${id}`);
      } else {
        const r = await api.post<{ id: number; ids: number[] }>('/api/events', {
          ...body,
          recurrence: f.repeat ? { freq: f.repeat, interval: 1, count: f.repeatCount } : null,
          applyTemplates: f.applyTemplates,
          participants: f.participants.map((name) => ({ name })),
        });
        toast('ok', r.ids.length > 1 ? `${r.ids.length} compromissos criados` : 'Compromisso criado');
        navigate(`/eventos/${r.id}`);
      }
    } catch (e) {
      const err = e as ApiError;
      if (err.details) setErrors(Object.fromEntries(err.details.map((d) => [d.campo, d.mensagem])));
      toast('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <Link to={id ? `/eventos/${id}` : '/agenda'} className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink">
        <LuChevronLeft className="size-4" /> {id ? 'Voltar ao compromisso' : 'Agenda'}
      </Link>
      <PageHeader title={id ? 'Editar compromisso' : 'Novo compromisso'} subtitle={id ? 'Os dados originais e cada alteração ficam guardados no histórico.' : 'Preencha as datas; o horário é opcional e nunca é presumido.'} />
      <div className="space-y-5">
        <Card className="space-y-4 p-5">
          <Field label="Título" error={errors.title} htmlFor="title">
            <Input id="title" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Ex.: Visita técnica — Lucas do Rio Verde" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Categoria">
              <Select value={f.category} onChange={(e) => set('category', e.target.value as CategoryKey)}>
                {CATEGORY_KEYS.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORIES[c].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Prioridade">
              <Select value={f.priority} onChange={(e) => set('priority', e.target.value as PriorityKey)}>
                {PRIORITY_KEYS.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITIES[p].label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Descrição">
            <Textarea value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="O que será feito" />
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-[15px] font-semibold text-ink">Quando</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Data inicial" error={errors.start_date}>
              <Input type="date" value={f.start_date} onChange={(e) => setF((s) => ({ ...s, start_date: e.target.value, end_date: s.end_date < e.target.value ? e.target.value : s.end_date }))} />
            </Field>
            <Field label="Data final" error={errors.end_date}>
              <Input type="date" value={f.end_date} min={f.start_date} onChange={(e) => set('end_date', e.target.value)} />
            </Field>
          </div>
          <Switch checked={f.withTime} onChange={(v) => set('withTime', v)} label="Informar horário" description="Desligado: o compromisso é registrado só com as datas (sem horário presumido)." />
          {f.withTime && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Início" error={errors.start_time}>
                <Input type="time" value={f.start_time} onChange={(e) => set('start_time', e.target.value)} />
              </Field>
              <Field label="Término (opcional)" error={errors.end_time}>
                <Input type="time" value={f.end_time} onChange={(e) => set('end_time', e.target.value)} />
              </Field>
            </div>
          )}
          {(warnings.conflicts.length > 0 || warnings.holidays.length > 0) && (
            <div className="space-y-2 rounded-2xl border border-[#F7DDA0] bg-soft-amber p-3.5 dark:border-[#5A4413]">
              {warnings.conflicts.map((c) => (
                <p key={c.id} className="flex gap-2 text-[13px] text-ink-2">
                  <LuTriangleAlert className="mt-0.5 size-4 shrink-0 text-amber" />
                  {c.message}
                </p>
              ))}
              {warnings.holidays.map((h) => (
                <p key={h.date} className="flex gap-2 text-[13px] text-ink-2">
                  <LuTriangleAlert className="mt-0.5 size-4 shrink-0 text-amber" />
                  {formatDateBR(h.date)} é {h.scope === 'facultativo' ? 'ponto facultativo' : 'feriado'}: {h.name}.
                </p>
              ))}
              <p className="text-[12px] text-muted">Você pode salvar mesmo assim — o sistema só alerta, nunca altera sozinho.</p>
            </div>
          )}
          {!id && (
            <div className="rounded-2xl bg-surface-2 p-3.5">
              <div className="flex flex-wrap items-center gap-3">
                <LuRepeat className="size-4 text-muted" />
                <span className="text-[14px] text-ink">Repetir</span>
                <Select value={f.repeat} onChange={(e) => set('repeat', e.target.value as FormState['repeat'])} className="h-9 w-auto">
                  <option value="">Não repetir</option>
                  <option value="semanal">Toda semana</option>
                  <option value="mensal">Todo mês (mesmo dia)</option>
                </Select>
                {f.repeat && (
                  <>
                    <span className="text-[14px] text-ink-2">por</span>
                    <Input type="number" min={2} max={24} value={f.repeatCount} onChange={(e) => set('repeatCount', Math.max(2, Math.min(24, Number(e.target.value) || 2)))} className="h-9 w-20" />
                    <span className="text-[14px] text-ink-2">ocorrências</span>
                  </>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-[15px] font-semibold text-ink">Onde e com quem</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Unidade">
              <Select value={f.unit_id} onChange={(e) => set('unit_id', e.target.value)}>
                <option value="">A definir / outra</option>
                {o.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            {!f.unit_id ? (
              <Field label="Município">
                <Input value={f.municipality} onChange={(e) => set('municipality', e.target.value)} placeholder="Opcional" />
              </Field>
            ) : (
              <Field label="Cliente">
                <Input value={f.client} onChange={(e) => set('client', e.target.value)} placeholder="Opcional" />
              </Field>
            )}
            <Field label="Responsável">
              <Select value={f.responsible_id} onChange={(e) => set('responsible_id', e.target.value)}>
                <option value="">A definir</option>
                {o.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={f.status} onChange={(e) => set('status', e.target.value as StatusKey)}>
                {STATUS_KEYS.map((s) => (
                  <option key={s} value={s}>
                    {STATUSES[s].label}
                  </option>
                ))}
              </Select>
            </Field>
            {f.category === 'auditoria' && (
              <Field label="Preparação vinculada" hint="O percentual de preparação soma este checklist ao da pré-auditoria.">
                <Select value={f.related_event_id} onChange={(e) => set('related_event_id', e.target.value)}>
                  <option value="">Nenhuma (ou detectar pela unidade)</option>
                  {o.auditsAndPreps
                    .filter((a) => a.category === 'preparacao_auditoria')
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {formatDateBR(a.start_date)} — {a.title}
                      </option>
                    ))}
                </Select>
              </Field>
            )}
            <Field label="Visibilidade">
              <Select value={f.visibility} onChange={(e) => set('visibility', e.target.value as FormState['visibility'])}>
                <option value="compartilhado">Compartilhado com a coordenação</option>
                <option value="privado">Privado (responsável, participantes e administração)</option>
              </Select>
            </Field>
          </div>
          {!id && (
            <div>
              <div className="text-[13px] font-medium text-ink-2">Participantes</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {f.participants.map((p, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 pr-1 pl-3 text-[13px] text-ink">
                    {p}
                    <button aria-label={`Remover ${p}`} onClick={() => set('participants', f.participants.filter((_, j) => j !== i))} className="rounded-full p-1 text-muted hover:text-alert">
                      <LuTrash2 className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <Input value={participant} onChange={(e) => setParticipant(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && participant.trim() && (set('participants', [...f.participants, participant.trim()]), setParticipant(''))} placeholder="Nome do participante" />
                <Button variant="secondary" icon={<LuPlus className="size-4" />} onClick={() => participant.trim() && (set('participants', [...f.participants, participant.trim()]), setParticipant(''))}>
                  Incluir
                </Button>
              </div>
            </div>
          )}
          <Field label="Observações">
            <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </Card>

        <Card className="space-y-1 p-5">
          <h2 className="mb-2 text-[15px] font-semibold text-ink">Avisos e checklist</h2>
          <Switch checked={f.notifEnabled} onChange={(v) => set('notifEnabled', v)} label="Enviar lembretes no WhatsApp" description="Aviso antecipado, véspera e dia — conforme as preferências de cada destinatário." />
          {f.notifEnabled && (
            <div className="flex flex-wrap items-center gap-2 py-2 text-[14px] text-ink-2">
              Aviso antecipado
              <Select value={f.advanceDays} onChange={(e) => set('advanceDays', e.target.value)} className="h-9 w-auto">
                <option value="">conforme preferência de cada pessoa</option>
                {[2, 3, 5, 7, 10, 14].map((n) => (
                  <option key={n} value={n}>
                    {n} dias antes
                  </option>
                ))}
              </Select>
            </div>
          )}
          {!id && <Switch checked={f.applyTemplates} onChange={(v) => set('applyTemplates', v)} label="Aplicar o modelo de checklist da categoria" description="Os modelos são editáveis em Configurações." />}
        </Card>

        <div className="sticky bottom-20 z-10 flex justify-end gap-2 rounded-2xl border border-line bg-surface/95 p-3 shadow-pop backdrop-blur lg:bottom-4">
          <Button variant="secondary" onClick={() => navigate(id ? `/eventos/${id}` : '/agenda')}>
            Voltar
          </Button>
          <Button onClick={() => void submit()} loading={busy} icon={<LuSave className="size-4" />}>
            {id ? 'Salvar alterações' : 'Criar compromisso'}
          </Button>
        </div>
      </div>
    </div>
  );
}
