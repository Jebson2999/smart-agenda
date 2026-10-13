// Configurações: meu perfil e WhatsApp, senha, aparência e instalação do app; para administração,
// unidades, modelos de checklist (editáveis) e feriados municipais/estaduais.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { LuBuilding2, LuCalendarX2, LuGripVertical, LuListChecks, LuMonitorSmartphone, LuPlus, LuSave, LuTrash2, LuUser, LuFlag, LuInfo, LuSmartphone } from 'react-icons/lu';
import { api } from '../lib/api.ts';
import { useApi } from '../lib/hooks.ts';
import { useRouter } from '../lib/router.tsx';
import { useSession } from '../lib/session.tsx';
import { cn } from '../lib/util.ts';
import { PageHeader, useTheme } from '../components/Layout.tsx';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, IconButton, Input, Select, Skeleton, Switch, Tabs, useFeedback } from '../components/ui.tsx';
import { CATEGORIES, CHECKLIST_STAGES, CONSENT_STATUSES } from '../../shared/constants.ts';
import type { CategoryKey, ChecklistStage } from '../../shared/constants.ts';
import { addDays, formatDateBR, todayInTz } from '../../shared/dates.ts';

type Tab = 'perfil' | 'app' | 'unidades' | 'modelos' | 'feriados';

const TIMEZONES: Array<[string, string]> = [
  ['America/Cuiaba', 'Mato Grosso (Cuiabá) — UTC−4'],
  ['America/Campo_Grande', 'Mato Grosso do Sul — UTC−4'],
  ['America/Porto_Velho', 'Rondônia — UTC−4'],
  ['America/Manaus', 'Amazonas — UTC−4'],
  ['America/Boa_Vista', 'Roraima — UTC−4'],
  ['America/Rio_Branco', 'Acre — UTC−5'],
  ['America/Sao_Paulo', 'Brasília / São Paulo — UTC−3'],
  ['America/Belem', 'Pará — UTC−3'],
  ['America/Fortaleza', 'Ceará — UTC−3'],
  ['America/Recife', 'Pernambuco — UTC−3'],
  ['America/Bahia', 'Bahia — UTC−3'],
  ['America/Noronha', 'Fernando de Noronha — UTC−2'],
];

export function SettingsPage() {
  const { can } = useSession();
  const { loc, navigate } = useRouter();
  const admin = can('settings.manage');
  const tabs: Array<{ key: Tab; label: string; icon: ReactNode }> = [
    { key: 'perfil', label: 'Meu perfil', icon: <LuUser className="size-4" /> },
    { key: 'app', label: 'App e aparência', icon: <LuMonitorSmartphone className="size-4" /> },
    ...(admin
      ? [
          { key: 'unidades' as Tab, label: 'Unidades', icon: <LuBuilding2 className="size-4" /> },
          { key: 'modelos' as Tab, label: 'Modelos de checklist', icon: <LuListChecks className="size-4" /> },
          { key: 'feriados' as Tab, label: 'Feriados', icon: <LuCalendarX2 className="size-4" /> },
        ]
      : []),
  ];
  const tab = (tabs.find((t) => t.key === loc.search.get('aba'))?.key ?? 'perfil') as Tab;
  return (
    <div>
      <PageHeader title="Configurações" />
      <div className="mb-4">
        <Tabs<Tab> value={tab} onChange={(t) => navigate(`/configuracoes?aba=${t}`, { replace: true })} tabs={tabs} />
      </div>
      {tab === 'perfil' && <ProfileTab />}
      {tab === 'app' && <AppTab />}
      {tab === 'unidades' && admin && <UnitsTab />}
      {tab === 'modelos' && admin && <TemplatesTab />}
      {tab === 'feriados' && admin && <HolidaysTab />}
    </div>
  );
}

// ------------------------------------------------------------------ perfil

function ProfileTab() {
  const { user, whatsapp, consentText, refresh } = useSession();
  const { toast } = useFeedback();
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [tz, setTz] = useState(user?.timezone ?? 'America/Cuiaba');
  const [consent, setConsent] = useState(whatsapp?.consent_status === 'concedido');
  const [busy, setBusy] = useState(false);
  useEffect(() => setConsent(whatsapp?.consent_status === 'concedido'), [whatsapp?.consent_status]);
  const save = async () => {
    setBusy(true);
    try {
      await api.patch('/api/me', { name: name.trim(), phone: phone.trim() || null, timezone: tz, ...(phone.trim() ? { whatsappConsent: consent } : {}) });
      await refresh();
      toast('ok', 'Perfil atualizado');
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-ink">Dados e notificações</h2>
        <p className="mt-0.5 text-[13px] text-muted">Seu WhatsApp é usado somente para os avisos da agenda que você escolher.</p>
        <div className="mt-4 space-y-3">
          <Field label="Nome">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="E-mail de acesso">
            <Input value={user?.email ?? ''} disabled />
          </Field>
          <Field label="WhatsApp" hint="DDD + número. Ao trocar o número, o consentimento precisa ser dado de novo.">
            <Input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(66) 99999-9999" />
          </Field>
          <Field label="Fuso horário">
            <Select value={tz} onChange={(e) => setTz(e.target.value)}>
              {TIMEZONES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          {phone.trim() && (
            <div className="rounded-2xl border border-line p-3.5">
              <Switch checked={consent} onChange={setConsent} label="Autorizo receber notificações no WhatsApp" description={consentText} />
              {whatsapp && (
                <div className="mt-1 flex items-center gap-2 text-[12.5px] text-muted">
                  Situação atual: <Badge tone={whatsapp.consent_status === 'concedido' ? 'ok' : whatsapp.consent_status === 'revogado' ? 'danger' : 'warn'}>{CONSENT_STATUSES[whatsapp.consent_status]}</Badge>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end">
          <Button icon={<LuSave className="size-4" />} loading={busy} onClick={() => void save()} disabled={name.trim().length < 2}>
            Salvar perfil
          </Button>
        </div>
      </Card>
      <PasswordCard />
    </div>
  );
}

function PasswordCard() {
  const { toast } = useFeedback();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = !!again && next !== again;
  const save = async () => {
    setBusy(true);
    try {
      await api.post('/api/auth/change-password', { current, next });
      setCurrent('');
      setNext('');
      setAgain('');
      toast('ok', 'Senha alterada. As outras sessões abertas foram encerradas.');
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="p-5">
      <h2 className="text-[15px] font-semibold text-ink">Senha</h2>
      <p className="mt-0.5 text-[13px] text-muted">Mínimo de 10 caracteres, com letras e números.</p>
      <div className="mt-4 space-y-3">
        <Field label="Senha atual">
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="Nova senha">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Confirme a nova senha" error={mismatch ? 'As senhas não conferem.' : null}>
          <Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end">
        <Button variant="secondary" loading={busy} disabled={!current || next.length < 10 || next !== again} onClick={() => void save()}>
          Alterar senha
        </Button>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ app

function AppTab() {
  const theme = useTheme();
  const { can } = useSession();
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {can('users.manage') && <BackupsCard />}
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-ink">Aparência</h2>
        <div className="mt-2 divide-y divide-line">
          <Switch checked={theme.dark} onChange={theme.toggle} label="Modo escuro" description="Fica salvo neste aparelho. Também pode ser trocado pelo botão no topo da tela." />
        </div>
      </Card>
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-soft-emerald text-emerald">
            <LuSmartphone className="size-5" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Instalar como aplicativo</h2>
            <p className="mt-0.5 text-[13px] text-muted">Abre em tela cheia, com ícone na tela inicial. Os lembretes chegam pelo WhatsApp mesmo com o app fechado.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-line p-4">
            <div className="text-[13.5px] font-semibold text-ink">Android (Chrome)</div>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-[13px] text-ink-2">
              <li>Abra o endereço do sistema no Chrome.</li>
              <li>Toque no menu ⋮.</li>
              <li>Escolha “Instalar app” ou “Adicionar à tela inicial”.</li>
            </ol>
          </div>
          <div className="rounded-2xl border border-line p-4">
            <div className="text-[13.5px] font-semibold text-ink">iPhone (Safari)</div>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-[13px] text-ink-2">
              <li>Abra o endereço do sistema no Safari.</li>
              <li>Toque em Compartilhar (quadrado com seta).</li>
              <li>Escolha “Adicionar à Tela de Início”.</li>
            </ol>
          </div>
        </div>
      </Card>
    </div>
  );
}

function BackupsCard() {
  const { data, reload } = useApi<{ backups: Array<{ name: string; size: number; at: string }>; dir: string }>('/api/admin/backups');
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      await api.post('/api/admin/backups');
      toast('ok', 'Cópia de segurança gerada');
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="p-5 xl:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Cópias de segurança</h2>
          <p className="mt-0.5 text-[13px] text-muted">O servidor grava uma cópia do banco todos os dias às 03:00 e mantém as mais recentes. Guarde uma cópia fora do servidor de tempos em tempos.</p>
        </div>
        <Button variant="secondary" loading={busy} onClick={() => void create()}>
          Gerar cópia agora
        </Button>
      </div>
      {!data ? (
        <Skeleton className="mt-4 h-16 w-full" />
      ) : data.backups.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted">Nenhuma cópia ainda.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
          {data.backups.slice(0, 8).map((b) => (
            <li key={b.name} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5 text-[13px]">
              <span className="num min-w-0 flex-1 truncate text-ink-2">{b.name}</span>
              <span className="num text-muted">{(b.size / 1024).toFixed(0)} KB</span>
              <a className="font-medium text-emerald hover:underline" href={`/api/admin/backups/${encodeURIComponent(b.name)}`}>
                Baixar
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ unidades

interface Unit {
  id: number;
  name: string;
  municipality: string | null;
  client: string | null;
  active: number;
}

function UnitsTab() {
  const { data, error, loading, reload } = useApi<{ units: Unit[] }>('/api/units');
  const { toast } = useFeedback();
  const [n, setN] = useState({ name: '', municipality: '', client: '' });
  const [drafts, setDrafts] = useState<Record<number, Partial<Unit>>>({});
  if (loading && !data) return <Skeleton className="h-72 w-full rounded-card" />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const add = async () => {
    try {
      await api.post('/api/units', { name: n.name.trim(), municipality: n.municipality.trim() || null, client: n.client.trim() || null });
      setN({ name: '', municipality: '', client: '' });
      toast('ok', 'Unidade cadastrada');
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const save = async (u: Unit, patch: Partial<Unit>) => {
    try {
      await api.patch(`/api/units/${u.id}`, { ...patch, ...(patch.active !== undefined ? { active: !!patch.active } : {}) });
      setDrafts((d) => ({ ...d, [u.id]: {} }));
      toast('ok', 'Unidade atualizada');
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  return (
    <Card>
      <CardHeader title="Unidades" subtitle="Cliente, unidade e município de cada compromisso. O município alimenta a detecção de deslocamentos e feriados municipais." icon={<LuBuilding2 className="size-[18px]" />} />
      <ul className="divide-y divide-line border-t border-line">
        {data.units.map((u) => {
          const d = { ...u, ...(drafts[u.id] ?? {}) };
          const dirty = d.name !== u.name || (d.municipality ?? '') !== (u.municipality ?? '') || (d.client ?? '') !== (u.client ?? '');
          return (
            <li key={u.id} className={cn('grid gap-2 px-5 py-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-center', !u.active && 'opacity-60')}>
              <Input aria-label="Nome da unidade" value={d.name} onChange={(e) => setDrafts({ ...drafts, [u.id]: { ...drafts[u.id], name: e.target.value } })} />
              <Input aria-label="Município" placeholder="Município" value={d.municipality ?? ''} onChange={(e) => setDrafts({ ...drafts, [u.id]: { ...drafts[u.id], municipality: e.target.value } })} />
              <Input aria-label="Cliente" placeholder="Cliente" value={d.client ?? ''} onChange={(e) => setDrafts({ ...drafts, [u.id]: { ...drafts[u.id], client: e.target.value } })} />
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={!dirty} onClick={() => void save(u, { name: d.name, municipality: d.municipality || null, client: d.client || null })}>
                  Salvar
                </Button>
                <Switch checked={!!u.active} onChange={(v) => void save(u, { active: v ? 1 : 0 })} label={<span className="text-[12.5px] text-muted">{u.active ? 'Ativa' : 'Inativa'}</span>} />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="grid gap-2 border-t border-line bg-surface-2/50 px-5 py-4 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <Input placeholder="Nova unidade" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} aria-label="Nova unidade" />
        <Input placeholder="Município" value={n.municipality} onChange={(e) => setN({ ...n, municipality: e.target.value })} aria-label="Município da nova unidade" />
        <Input placeholder="Cliente" value={n.client} onChange={(e) => setN({ ...n, client: e.target.value })} aria-label="Cliente da nova unidade" />
        <Button icon={<LuPlus className="size-4" />} disabled={n.name.trim().length < 2} onClick={() => void add()}>
          Cadastrar
        </Button>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ modelos de checklist

interface Template {
  key: string;
  name: string;
  category: string | null;
  stage: ChecklistStage;
  items: Array<{ text: string; critical?: boolean }>;
  updated_at: string;
}

function TemplatesTab() {
  const { data, error, loading, reload } = useApi<{ templates: Template[] }>('/api/checklist-templates');
  const [sel, setSel] = useState<string | null>(null);
  if (loading && !data) return <Skeleton className="h-96 w-full rounded-card" />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const current = data.templates.find((t) => t.key === (sel ?? data.templates[0]?.key));
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-[#F7DDA0] bg-soft-amber px-4 py-3 text-[13px] text-[#7A4A00] dark:border-[#5A4413] dark:text-amber">
        <LuInfo className="mt-0.5 size-4 shrink-0" />
        <p>Os modelos são pontos de partida editáveis. O sistema não presume requisitos específicos da certificação GMP+: confira cada item com a norma vigente e com a certificadora antes de usá-lo como referência.</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit p-2">
          {data.templates.map((t) => (
            <button key={t.key} onClick={() => setSel(t.key)} className={cn('flex w-full flex-col items-start rounded-xl px-3 py-2.5 text-left transition-colors', current?.key === t.key ? 'bg-soft-emerald' : 'hover:bg-surface-2')}>
              <span className="text-[14px] font-medium text-ink">{t.name}</span>
              <span className="text-[12px] text-muted">
                {CHECKLIST_STAGES[t.stage]} · {t.items.length} itens
              </span>
            </button>
          ))}
        </Card>
        {current ? <TemplateEditor key={current.key + current.updated_at} t={current} onSaved={reload} /> : <EmptyState title="Nenhum modelo" />}
      </div>
    </div>
  );
}

function TemplateEditor({ t, onSaved }: { t: Template; onSaved: () => void }) {
  const { toast } = useFeedback();
  const [name, setName] = useState(t.name);
  const [stage, setStage] = useState<ChecklistStage>(t.stage);
  const [items, setItems] = useState(t.items.map((i) => ({ text: i.text, critical: !!i.critical })));
  const [busy, setBusy] = useState(false);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  };
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/api/checklist-templates/${t.key}`, { name: name.trim(), category: t.category, stage, items: items.filter((i) => i.text.trim().length >= 2).map((i) => ({ text: i.text.trim(), critical: i.critical })) });
      toast('ok', 'Modelo salvo. Vale para os próximos compromissos que usarem este modelo.');
      onSaved();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="p-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <Field label="Nome do modelo">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Etapa">
          <Select value={stage} onChange={(e) => setStage(e.target.value as ChecklistStage)}>
            {(Object.keys(CHECKLIST_STAGES) as ChecklistStage[]).map((s) => (
              <option key={s} value={s}>
                {CHECKLIST_STAGES[s]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {t.category && CATEGORIES[t.category as CategoryKey] && <p className="mt-2 text-[12.5px] text-muted">Aplicado automaticamente em: {CATEGORIES[t.category as CategoryKey].label}</p>}
      <ul className="mt-4 space-y-2">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-2">
            <div className="flex flex-col">
              <button className="text-muted hover:text-ink disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir item">
                <LuGripVertical className="size-4 rotate-90" />
              </button>
            </div>
            <Input value={it.text} onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} aria-label={`Item ${i + 1}`} />
            <IconButton label={it.critical ? 'Remover marcação de crítico' : 'Marcar como crítico'} onClick={() => setItems(items.map((x, k) => (k === i ? { ...x, critical: !x.critical } : x)))}>
              <LuFlag className={cn('size-4', it.critical ? 'text-alert' : 'text-muted')} />
            </IconButton>
            <IconButton label="Remover item" onClick={() => setItems(items.filter((_, k) => k !== i))}>
              <LuTrash2 className="size-4" />
            </IconButton>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" size="sm" icon={<LuPlus className="size-3.5" />} onClick={() => setItems([...items, { text: '', critical: false }])}>
          Adicionar item
        </Button>
        <Button icon={<LuSave className="size-4" />} loading={busy} disabled={name.trim().length < 2} onClick={() => void save()}>
          Salvar modelo
        </Button>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ feriados

function HolidaysTab() {
  const { user } = useSession();
  const { toast } = useFeedback();
  const today = todayInTz(user?.timezone ?? 'America/Cuiaba');
  const all = useApi<{ holidays: Array<{ date: string; name: string; scope: string; municipality?: string | null }> }>(`/api/calendar/holidays?from=${today}&to=${addDays(today, 365)}`);
  const custom = useApi<{ holidays: Array<{ id: number; date: string; name: string; scope: string; municipality: string | null }> }>('/api/holidays/custom');
  const units = useApi<{ units: Unit[] }>('/api/units');
  const [f, setF] = useState({ date: '', name: '', scope: 'municipal', municipality: '' });
  const municipalities = [...new Set((units.data?.units ?? []).map((u) => u.municipality).filter(Boolean) as string[])];
  const add = async () => {
    try {
      await api.post('/api/holidays/custom', { ...f, name: f.name.trim(), municipality: f.scope === 'municipal' ? f.municipality || null : null });
      setF({ date: '', name: '', scope: 'municipal', municipality: '' });
      toast('ok', 'Feriado cadastrado');
      custom.reload();
      all.reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const remove = async (id: number) => {
    try {
      await api.del(`/api/holidays/custom/${id}`);
      custom.reload();
      all.reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader title="Feriados municipais e estaduais" subtitle="Entram nos alertas da agenda, nos dias livres sugeridos e nos relatórios." icon={<LuCalendarX2 className="size-[18px]" />} />
        <div className="grid gap-2 border-y border-line bg-surface-2/50 px-5 py-4 sm:grid-cols-2">
          <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Data" />
          <Input placeholder="Nome do feriado" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Nome do feriado" />
          <Select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} aria-label="Abrangência">
            <option value="municipal">Municipal</option>
            <option value="estadual">Estadual</option>
            <option value="facultativo">Ponto facultativo</option>
          </Select>
          {f.scope === 'municipal' ? (
            <Select value={f.municipality} onChange={(e) => setF({ ...f, municipality: e.target.value })} aria-label="Município">
              <option value="">Selecione o município</option>
              {municipalities.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          ) : (
            <div />
          )}
          <Button className="sm:col-span-2" icon={<LuPlus className="size-4" />} disabled={!f.date || f.name.trim().length < 2 || (f.scope === 'municipal' && !f.municipality)} onClick={() => void add()}>
            Cadastrar feriado
          </Button>
        </div>
        {custom.data?.holidays.length ? (
          <ul className="divide-y divide-line">
            {custom.data.holidays.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-5 py-2.5">
                <span className="num w-24 text-[13px] text-ink-2">{formatDateBR(h.date)}</span>
                <span className="min-w-0 flex-1 text-[14px] text-ink">
                  {h.name}
                  <span className="block text-[12px] text-muted">
                    {h.scope}
                    {h.municipality ? ` · ${h.municipality}` : ''}
                  </span>
                </span>
                <IconButton label="Remover feriado" onClick={() => void remove(h.id)}>
                  <LuTrash2 className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact title="Nenhum feriado local cadastrado" text="Inclua aniversários dos municípios e feriados estaduais das unidades atendidas." />
        )}
      </Card>
      <Card>
        <CardHeader title="Próximos 12 meses" subtitle="Feriados nacionais (calculados automaticamente) e locais cadastrados" />
        <ul className="max-h-[560px] divide-y divide-line overflow-y-auto border-t border-line scroll-thin">
          {all.data?.holidays.map((h) => (
            <li key={h.date + h.name} className="flex items-center gap-3 px-5 py-2.5 text-[13.5px]">
              <span className="num w-24 text-ink-2">{formatDateBR(h.date)}</span>
              <span className="min-w-0 flex-1 text-ink">{h.name}</span>
              <Badge tone={h.scope === 'nacional' ? 'info' : h.scope === 'facultativo' ? 'muted' : 'warn'}>{h.scope}</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
