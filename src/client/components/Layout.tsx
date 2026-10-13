import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  LuBot,
  LuCalendarDays,
  LuChartGantt,
  LuClipboardList,
  LuCloudDownload,
  LuEllipsis,
  LuFileText,
  LuHouse,
  LuLogOut,
  LuMessageCircle,
  LuMoon,
  LuPlus,
  LuSearch,
  LuSettings,
  LuShieldCheck,
  LuSun,
  LuUsers,
  LuX,
  LuTriangleAlert,
  LuWifiOff,
} from 'react-icons/lu';
import { Link, useRouter } from '../lib/router.tsx';
import { useSession } from '../lib/session.tsx';
import { useApi, useDebounced, useNow } from '../lib/hooks.ts';
import { api } from '../lib/api.ts';
import { cn, firstName } from '../lib/util.ts';
import { Logo, placeOf } from './EventBits.tsx';
import { IconButton, Modal } from './ui.tsx';
import { formatLongDate, formatPeriod, nowInTz } from '../../shared/dates.ts';
import type { Permission } from '../../shared/constants.ts';
import type { AgendaEvent } from '../../shared/types.ts';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  perm?: Permission | Permission[];
  mobile?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Início', icon: <LuHouse className="size-[18px]" />, mobile: true },
  { to: '/agenda', label: 'Agenda', icon: <LuCalendarDays className="size-[18px]" />, mobile: true },
  { to: '/auditorias', label: 'Auditorias GMP+', icon: <LuShieldCheck className="size-[18px]" />, mobile: true },
  { to: '/acoes', label: 'Ações', icon: <LuClipboardList className="size-[18px]" />, mobile: true },
  { to: '/assistente', label: 'Assistente', icon: <LuBot className="size-[18px]" />, perm: 'dashboard.view' },
  { to: '/relatorios', label: 'Relatórios', icon: <LuFileText className="size-[18px]" />, perm: 'reports.view' },
  { to: '/whatsapp', label: 'WhatsApp', icon: <LuMessageCircle className="size-[18px]" />, perm: 'whatsapp.manage' },
  { to: '/usuarios', label: 'Usuários', icon: <LuUsers className="size-[18px]" />, perm: 'users.manage' },
  { to: '/configuracoes', label: 'Configurações', icon: <LuSettings className="size-[18px]" /> },
];

function isActive(to: string, path: string) {
  return to === '/' ? path === '/' : path === to || path.startsWith(to + '/') || (to === '/agenda' && path.startsWith('/eventos'));
}

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('asa-theme', next ? 'dark' : 'light');
    } catch {
      /* armazenamento indisponível */
    }
  };
  return { dark, toggle };
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

function useInstall() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);
  return evt ? () => evt.prompt().finally(() => setEvt(null)) : null;
}

function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true);
    const b = () => setOn(false);
    window.addEventListener('online', a);
    window.addEventListener('offline', b);
    return () => {
      window.removeEventListener('online', a);
      window.removeEventListener('offline', b);
    };
  }, []);
  return on;
}

function Search({ onClose }: { onClose?: () => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q.trim(), 250);
  const [results, setResults] = useState<AgendaEvent[] | null>(null);
  const { navigate } = useRouter();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (dq.length < 2) {
      setResults(null);
      return;
    }
    let alive = true;
    api.get<{ events: AgendaEvent[] }>(`/api/events?q=${encodeURIComponent(dq)}`).then((r) => alive && setResults(r.events.slice(0, 8))).catch(() => alive && setResults([]));
    return () => {
      alive = false;
    };
  }, [dq]);
  useEffect(() => {
    const on = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, []);
  return (
    <div ref={box} className="relative w-full">
      <LuSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Buscar compromisso, unidade ou observação"
        aria-label="Buscar compromissos"
        className="h-10 w-full rounded-xl border border-line bg-surface-2 pr-3 pl-9 text-[14px] text-ink placeholder:text-muted focus:border-emerald focus:bg-surface focus:outline-none"
      />
      {open && results && (
        <div className="absolute top-12 right-0 left-0 z-40 overflow-hidden rounded-2xl border border-line bg-surface shadow-pop animate-pop">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-muted">Nada encontrado para “{dq}”.</p>
          ) : (
            results.map((e) => (
              <button
                key={e.id}
                className="flex w-full flex-col items-start px-4 py-2.5 text-left hover:bg-surface-2"
                onClick={() => {
                  setOpen(false);
                  setQ('');
                  onClose?.();
                  navigate(`/eventos/${e.id}`);
                }}
              >
                <span className="text-[14px] font-medium text-ink">{e.title}</span>
                <span className="num text-[12px] text-muted">
                  {formatPeriod(e.start_date, e.end_date)} — {placeOf(e)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Clock({ tz }: { tz: string }) {
  const now = useNow(1000);
  const { date, time } = nowInTz(tz, now);
  const sec = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, second: '2-digit' }).format(now).padStart(2, '0');
  return (
    <div className="hidden text-right leading-tight lg:block">
      <div className="num text-[15px] font-semibold text-ink">
        {time}
        <span className="text-muted">:{sec}</span>
      </div>
      <div className="text-[11.5px] text-muted">{formatLongDate(date)}</div>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, can, logout } = useSession();
  const { loc, navigate } = useRouter();
  const theme = useTheme();
  const install = useInstall();
  const online = useOnline();
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const wa = useApi<{ credentials: { effectiveMode: 'demo' | 'live' } }>(can('whatsapp.manage') ? '/api/whatsapp/status' : null);
  const visible = NAV.filter((n) => !n.perm || (Array.isArray(n.perm) ? n.perm.some(can) : can(n.perm)));
  const tz = user?.timezone ?? 'America/Cuiaba';
  const demo = wa.data?.credentials.effectiveMode === 'demo';

  return (
    <div className="min-h-dvh lg:pl-[248px]">
      {/* barra lateral */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-line bg-surface lg:flex">
        <Link to="/" className="flex items-center gap-3 px-5 pt-5 pb-6">
          <Logo size={36} />
          <span className="leading-tight">
            <span className="block text-[15px] font-bold tracking-[-0.02em] text-forest dark:text-mint">ASTRAL</span>
            <span className="block text-[12px] text-muted">Smart Agenda</span>
          </span>
        </Link>
        <nav className="flex-1 space-y-0.5 px-3" aria-label="Principal">
          {visible.map((n) => {
            const active = isActive(n.to, loc.path);
            return (
              <Link
                key={n.to}
                to={n.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-colors',
                  active ? 'bg-soft-emerald text-forest dark:text-mint' : 'text-ink-2 hover:bg-surface-2',
                )}
              >
                <span className={active ? 'text-emerald dark:text-[#4CC28F]' : 'text-muted'}>{n.icon}</span>
                {n.label}
              </Link>
            );
          })}
        </nav>
        {can('events.create') && (
          <div className="px-4 pb-3">
            <button onClick={() => navigate('/eventos/novo')} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-forest text-[14px] font-semibold text-white transition hover:bg-forest-2 dark:bg-emerald">
              <LuPlus className="size-4" /> Novo compromisso
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <div className="flex size-9 items-center justify-center rounded-full bg-soft-emerald text-[13px] font-semibold text-forest dark:text-mint">{firstName(user?.name ?? '?').slice(0, 2).toUpperCase()}</div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-medium text-ink">{user?.name}</div>
            <div className="truncate text-[11.5px] text-muted">{user?.role === 'admin' ? 'Administrador' : user?.role === 'coordenador' ? 'Coordenação' : user?.role}</div>
          </div>
          <IconButton label="Sair" onClick={() => void logout()}>
            <LuLogOut className="size-4" />
          </IconButton>
        </div>
      </aside>

      {/* topo */}
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md no-print">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 lg:hidden" aria-label="Início">
            <Logo size={32} />
            <span className="text-[15px] font-bold tracking-[-0.02em] text-forest dark:text-mint">ASTRAL</span>
          </Link>
          <div className="hidden max-w-md flex-1 md:block">
            <Search />
          </div>
          <div className="flex-1 md:hidden" />
          <IconButton label="Buscar" className="md:hidden" onClick={() => setSearchOpen(true)}>
            <LuSearch className="size-[18px]" />
          </IconButton>
          {install && (
            <button onClick={() => void install()} className="hidden h-9 items-center gap-2 rounded-xl border border-line-strong px-3 text-[13px] font-medium text-ink-2 hover:bg-surface-2 sm:inline-flex">
              <LuCloudDownload className="size-4" /> Instalar app
            </button>
          )}
          <IconButton label={theme.dark ? 'Usar tema claro' : 'Usar tema escuro'} onClick={theme.toggle}>
            {theme.dark ? <LuSun className="size-[18px]" /> : <LuMoon className="size-[18px]" />}
          </IconButton>
          <Clock tz={tz} />
        </div>
        {(!online || demo) && (
          <div className={cn('px-4 py-1.5 text-center text-[12.5px] font-medium', !online ? 'bg-[#3B1414] text-white' : 'bg-soft-amber text-[#7A4A00] dark:text-amber')}>
            {!online ? (
              <span className="inline-flex items-center gap-1.5">
                <LuWifiOff className="size-3.5" /> Sem conexão — mostrando o que já estava carregado. Alterações exigem internet.
              </span>
            ) : (
              <Link to="/whatsapp" className="inline-flex items-center gap-1.5 underline-offset-2 hover:underline">
                <LuTriangleAlert className="size-3.5" /> WhatsApp em modo demonstração: nenhuma mensagem é enviada até a conexão com a Meta ser configurada.
              </Link>
            )}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1280px] px-4 pt-5 pb-28 sm:px-6 lg:pb-12">{children}</main>

      {/* navegação inferior (celular) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-md lg:hidden safe-bottom no-print" aria-label="Principal">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {visible
            .filter((n) => n.mobile)
            .map((n) => {
              const active = isActive(n.to, loc.path);
              return (
                <Link key={n.to} to={n.to} className={cn('flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium', active ? 'text-emerald dark:text-[#4CC28F]' : 'text-muted')}>
                  {n.icon}
                  {n.label.replace(' GMP+', '')}
                </Link>
              );
            })}
          <button onClick={() => setMoreOpen(true)} className="flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted">
            <LuEllipsis className="size-[18px]" />
            Mais
          </button>
        </div>
      </nav>
      {can('events.create') && !loc.path.startsWith('/eventos/novo') && (
        <button onClick={() => navigate('/eventos/novo')} aria-label="Novo compromisso" className="fixed right-4 bottom-20 z-30 flex size-14 items-center justify-center rounded-2xl bg-forest text-white shadow-pop lg:hidden dark:bg-emerald safe-bottom">
          <LuPlus className="size-6" />
        </button>
      )}

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Mais opções">
        <div className="grid grid-cols-2 gap-2">
          {visible
            .filter((n) => !n.mobile)
            .map((n) => (
              <button
                key={n.to}
                onClick={() => {
                  setMoreOpen(false);
                  navigate(n.to);
                }}
                className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3.5 text-left text-[14px] font-medium text-ink hover:bg-surface-2"
              >
                <span className="text-emerald">{n.icon}</span>
                {n.label}
              </button>
            ))}
          {install && (
            <button onClick={() => void install()} className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3.5 text-left text-[14px] font-medium text-ink hover:bg-surface-2">
              <LuCloudDownload className="size-[18px] text-emerald" /> Instalar app
            </button>
          )}
          <button onClick={() => void logout()} className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3.5 text-left text-[14px] font-medium text-alert hover:bg-surface-2">
            <LuLogOut className="size-[18px]" /> Sair
          </button>
        </div>
        <p className="mt-4 text-center text-[12px] text-muted">
          Conectado como {user?.name} — <LuChartGantt className="inline size-3" /> fuso {tz}
        </p>
      </Modal>
      <Modal open={searchOpen} onClose={() => setSearchOpen(false)} title="Buscar">
        <div className="min-h-[300px]">
          <Search onClose={() => setSearchOpen(false)} />
        </div>
        <button className="sr-only" onClick={() => setSearchOpen(false)}>
          <LuX />
        </button>
      </Modal>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[24px] font-bold tracking-[-0.025em] text-ink sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[14px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
