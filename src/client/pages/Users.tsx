// Usuários e permissões: perfis (Administrador/Supervisor, Coordenador, Técnico, Gestor),
// permissões extras configuráveis pelo administrador e trilha de auditoria.
import { useState } from 'react';
import { LuCheck, LuCopy, LuKeyRound, LuMinus, LuPencil, LuPlus, LuScrollText, LuShieldCheck, LuUsers } from 'react-icons/lu';
import { api } from '../lib/api.ts';
import { useApi } from '../lib/hooks.ts';
import { useSession } from '../lib/session.tsx';
import { cn, fmtDateTime } from '../lib/util.ts';
import { PageHeader } from '../components/Layout.tsx';
import { Badge, Button, Card, EmptyState, ErrorState, Field, IconButton, Input, Modal, Select, Skeleton, Switch, Tabs, useFeedback } from '../components/ui.tsx';
import type { Permission, RoleKey } from '../../shared/constants.ts';

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: RoleKey;
  permissions: Permission[];
  extraPermissions: Permission[];
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface UsersResp {
  users: UserRow[];
  roles: Record<RoleKey, { label: string; description: string }>;
  permissions: Record<Permission, string>;
  roleDefaults: Record<RoleKey, Permission[]>;
  configurable: Permission[];
}

type Tab = 'usuarios' | 'matriz' | 'trilha';

export function UsersPage() {
  const [tab, setTab] = useState<Tab>('usuarios');
  const { data, error, loading, reload } = useApi<UsersResp>('/api/users');
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ title: string; email: string; password: string } | null>(null);
  const { user } = useSession();
  const { toast, confirm } = useFeedback();
  if (loading && !data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full rounded-card" />
      </div>
    );
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  const reset = async (u: UserRow) => {
    if (!(await confirm({ title: `Redefinir a senha de ${u.name}?`, message: 'Uma senha temporária será gerada e todas as sessões abertas desse usuário serão encerradas. A troca é obrigatória no próximo acesso.', confirmLabel: 'Gerar senha temporária' }))) return;
    try {
      const r = await api.post<{ temporaryPassword: string }>(`/api/users/${u.id}/reset-password`);
      setSecret({ title: `Nova senha temporária de ${u.name}`, email: u.email, password: r.temporaryPassword });
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  return (
    <div>
      <PageHeader
        title="Usuários e permissões"
        subtitle="Perfis prontos para supervisor e coordenador, com permissões extras liberadas individualmente."
        actions={
          <Button icon={<LuPlus className="size-4" />} onClick={() => setCreating(true)}>
            Novo usuário
          </Button>
        }
      />
      <div className="mb-4">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'usuarios', label: 'Usuários', count: data.users.length, icon: <LuUsers className="size-4" /> },
            { key: 'matriz', label: 'Perfis e permissões', icon: <LuShieldCheck className="size-4" /> },
            { key: 'trilha', label: 'Trilha de auditoria', icon: <LuScrollText className="size-4" /> },
          ]}
        />
      </div>

      {tab === 'usuarios' && (
        <Card>
          <ul className="divide-y divide-line">
            {data.users.map((u) => (
              <li key={u.id} className={cn('flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5', !u.active && 'opacity-60')}>
                <div className="flex size-10 items-center justify-center rounded-full bg-soft-emerald text-[13px] font-semibold text-forest dark:text-mint">{u.name.slice(0, 2).toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14.5px] font-medium text-ink">{u.name}</span>
                    {u.id === user?.id && <span className="text-[12px] text-muted">(você)</span>}
                    <Badge tone={u.role === 'admin' ? 'ok' : 'info'}>{data.roles[u.role].label}</Badge>
                    {!u.active && <Badge tone="muted">Inativo</Badge>}
                    {u.mustChangePassword && u.active && <Badge tone="warn">Troca de senha pendente</Badge>}
                    {u.extraPermissions.length > 0 && <Badge tone="neutral">+{u.extraPermissions.length} permissão(ões)</Badge>}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-muted">
                    {u.email} · último acesso {u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : 'nunca'}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" icon={<LuPencil className="size-3.5" />} onClick={() => setEditing(u)}>
                    Editar
                  </Button>
                  <IconButton label="Redefinir senha" onClick={() => void reset(u)}>
                    <LuKeyRound className="size-4" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === 'matriz' && <Matrix data={data} />}
      {tab === 'trilha' && <AuditTrail />}

      {creating && <CreateUser data={data} onClose={() => setCreating(false)} onCreated={(email, password) => (setCreating(false), setSecret({ title: 'Usuário criado', email, password }), reload())} />}
      {editing && <EditUser u={editing} data={data} selfId={user?.id ?? -1} onClose={() => setEditing(null)} onDone={() => (setEditing(null), reload())} />}
      {secret && <SecretModal {...secret} onClose={() => setSecret(null)} />}
    </div>
  );
}

function PermissionPicker({ data, role, value, onChange }: { data: UsersResp; role: RoleKey; value: Permission[]; onChange: (v: Permission[]) => void }) {
  if (role === 'admin') return <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-[13px] text-ink-2">O administrador tem acesso completo a todas as funções.</p>;
  const defaults = new Set(data.roleDefaults[role]);
  return (
    <div className="divide-y divide-line rounded-xl border border-line px-3">
      {data.configurable.map((p) => {
        const inherited = defaults.has(p);
        return (
          <Switch
            key={p}
            checked={inherited || value.includes(p)}
            disabled={inherited}
            onChange={(v) => onChange(v ? [...value, p] : value.filter((x) => x !== p))}
            label={data.permissions[p]}
            description={inherited ? 'Já incluída no perfil' : undefined}
          />
        );
      })}
    </div>
  );
}

function CreateUser({ data, onClose, onCreated }: { data: UsersResp; onClose: () => void; onCreated: (email: string, password: string) => void }) {
  const { toast } = useFeedback();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<RoleKey>('coordenador');
  const [extra, setExtra] = useState<Permission[]>([]);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ id: number; temporaryPassword: string }>('/api/users', { name: name.trim(), email: email.trim(), role, extra_permissions: extra });
      onCreated(email.trim(), r.temporaryPassword);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Novo usuário"
      description="O sistema gera uma senha temporária; a troca é obrigatória no primeiro acesso."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={name.trim().length < 2 || !email.includes('@')}>
            Criar usuário
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <Field label="Nome">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="E-mail (login)">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Perfil" hint={data.roles[role].description}>
            <Select value={role} onChange={(e) => setRole(e.target.value as RoleKey)}>
              {(Object.keys(data.roles) as RoleKey[]).map((k) => (
                <option key={k} value={k}>
                  {data.roles[k].label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-ink-2">Permissões extras</div>
          <PermissionPicker data={data} role={role} value={extra} onChange={setExtra} />
        </div>
      </div>
    </Modal>
  );
}

function EditUser({ u, data, selfId, onClose, onDone }: { u: UserRow; data: UsersResp; selfId: number; onClose: () => void; onDone: () => void }) {
  const { toast } = useFeedback();
  const [name, setName] = useState(u.name);
  const [email, setEmail] = useState(u.email);
  const [role, setRole] = useState<RoleKey>(u.role);
  const [extra, setExtra] = useState<Permission[]>(u.extraPermissions);
  const [active, setActive] = useState(u.active);
  const [busy, setBusy] = useState(false);
  const self = u.id === selfId;
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/users/${u.id}`, { name: name.trim(), email: email.trim(), role, extra_permissions: extra, active });
      toast('ok', 'Usuário atualizado');
      onDone();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Editar ${u.name}`}
      description={u.email}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={name.trim().length < 2 || !email.includes('@')}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <Field label="Nome">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="E-mail (login)" hint="Passa a valer no próximo acesso.">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Perfil" hint={self ? 'Você não pode rebaixar o seu próprio acesso.' : data.roles[role].description}>
            <Select value={role} disabled={self} onChange={(e) => setRole(e.target.value as RoleKey)}>
              {(Object.keys(data.roles) as RoleKey[]).map((k) => (
                <option key={k} value={k}>
                  {data.roles[k].label}
                </option>
              ))}
            </Select>
          </Field>
          <Switch checked={active} disabled={self} onChange={setActive} label="Acesso ativo" description="Desativar encerra as sessões abertas e bloqueia o login." />
        </div>
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-ink-2">Permissões extras</div>
          <PermissionPicker data={data} role={role} value={extra} onChange={setExtra} />
        </div>
      </div>
    </Modal>
  );
}

function SecretModal({ title, email, password, onClose }: { title: string; email: string; password: string; onClose: () => void }) {
  const { toast } = useFeedback();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Acesso à ASTRAL Smart Agenda\nE-mail: ${email}\nSenha temporária: ${password}`);
      toast('ok', 'Dados de acesso copiados');
    } catch {
      toast('error', 'Não foi possível copiar');
    }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={title} footer={<Button onClick={onClose}>Concluir</Button>}>
      <p className="text-[13.5px] text-ink-2">Entregue estes dados por um canal seguro. A senha aparece só agora e precisa ser trocada no primeiro acesso.</p>
      <div className="mt-3 space-y-2 rounded-xl border border-line bg-surface-2 p-3.5">
        <div className="text-[12px] text-muted">E-mail</div>
        <div className="text-[14px] font-medium text-ink">{email}</div>
        <div className="pt-1 text-[12px] text-muted">Senha temporária</div>
        <div className="num text-[17px] font-semibold tracking-wide text-ink">{password}</div>
      </div>
      <Button variant="secondary" className="mt-3 w-full" icon={<LuCopy className="size-4" />} onClick={() => void copy()}>
        Copiar dados de acesso
      </Button>
    </Modal>
  );
}

function Matrix({ data }: { data: UsersResp }) {
  const roles = Object.keys(data.roles) as RoleKey[];
  const perms = Object.keys(data.permissions) as Permission[];
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-line bg-surface-2">
            <th className="px-4 py-3 font-medium text-muted">Permissão</th>
            {roles.map((r) => (
              <th key={r} className="px-3 py-3 text-center font-medium text-ink">
                {data.roles[r].label.split(' / ')[0]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {perms.map((p) => (
            <tr key={p}>
              <td className="px-4 py-2.5 text-ink-2">
                {data.permissions[p]}
                {data.configurable.includes(p) && <span className="ml-2 text-[11.5px] text-emerald">configurável</span>}
              </td>
              {roles.map((r) => {
                const has = r === 'admin' || data.roleDefaults[r].includes(p);
                return (
                  <td key={r} className="px-3 py-2.5 text-center">
                    {has ? <LuCheck className="mx-auto size-4 text-emerald" aria-label="sim" /> : <LuMinus className="mx-auto size-4 text-line-strong" aria-label="não" />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-3 text-[12.5px] text-muted">
        Itens marcados como configuráveis podem ser liberados individualmente (ex.: permitir que o coordenador edite compromissos). A autorização é sempre verificada no servidor.
      </p>
    </Card>
  );
}

const ACTION_LABELS: Record<string, string> = {
  login: 'Entrou no sistema',
  login_falhou: 'Tentativa de login falhou',
  senha_alterada: 'Alterou a senha',
  senha_redefinida: 'Redefiniu senha de usuário',
  usuario_criado: 'Criou usuário',
  usuario_alterado: 'Alterou usuário',
  evento_criado: 'Criou compromisso',
  evento_excluido: 'Excluiu compromisso',
  acao_criada: 'Registrou ação',
  acao_removida: 'Removeu ação',
  whatsapp_config: 'Alterou configuração do WhatsApp',
  destinatario_criado: 'Cadastrou número de WhatsApp',
  destinatario_alterado: 'Alterou número de WhatsApp',
  destinatario_removido: 'Removeu número de WhatsApp',
  consentimento_concedido: 'Registrou consentimento',
  consentimento_revogado: 'Revogou consentimento',
  consentimento_pendente: 'Marcou consentimento como pendente',
  template_alterado: 'Alterou template',
  templates_sincronizados: 'Sincronizou templates com a Meta',
  whatsapp_teste: 'Enviou mensagem de teste',
  notificacao_reenviada: 'Autorizou reenvio de aviso',
  agendador_manual: 'Executou o agendador manualmente',
  unidade_criada: 'Criou unidade',
  unidade_alterada: 'Alterou unidade',
  modelo_checklist_salvo: 'Salvou modelo de checklist',
};

function AuditTrail() {
  const { data, error, loading, reload } = useApi<{ entries: Array<{ id: number; action: string; entity: string | null; entity_id: number | null; detail: Record<string, unknown>; ip: string | null; created_at: string; user_name: string | null }> }>('/api/audit-trail?limit=300');
  if (loading && !data) return <Skeleton className="h-96 w-full rounded-card" />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data?.entries.length)
    return (
      <Card>
        <EmptyState title="Nenhum registro" />
      </Card>
    );
  return (
    <Card>
      <ul className="divide-y divide-line">
        {data.entries.map((e) => (
          <li key={e.id} className="flex flex-wrap items-start gap-x-3 gap-y-0.5 px-5 py-2.5 text-[13px]">
            <span className="num w-36 shrink-0 text-muted">{fmtDateTime(e.created_at)}</span>
            <span className="min-w-0 flex-1">
              <span className="font-medium text-ink">{e.user_name ?? 'Sistema'}</span> <span className="text-ink-2">— {ACTION_LABELS[e.action] ?? e.action}</span>
              {e.detail && Object.keys(e.detail).length > 0 && <span className="block truncate text-[12px] text-muted">{summarize(e.detail)}</span>}
            </span>
            {e.ip && <span className="num text-[12px] text-muted">{e.ip}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function summarize(d: Record<string, unknown>): string {
  return Object.entries(d)
    .filter(([, v]) => v !== undefined && v !== null && typeof v !== 'object')
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ');
}
