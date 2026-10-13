// Ponto de entrada do aplicativo (React). Monta os provedores, o controle de sessão e as rotas.
import { Component, StrictMode, useEffect } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { LuCompass, LuRefreshCw } from 'react-icons/lu';
import { RouterProvider, match, useRouter } from './lib/router.tsx';
import { SessionProvider, useSession } from './lib/session.tsx';
import { Button, EmptyState, FeedbackProvider, Spinner } from './components/ui.tsx';
import { Layout } from './components/Layout.tsx';
import { Logo } from './components/EventBits.tsx';
import { LoginPage, ChangePasswordPage } from './pages/Login.tsx';
import { DashboardPage } from './pages/Dashboard.tsx';
import { CalendarPage } from './pages/Calendar.tsx';
import { EventDetailPage } from './pages/EventDetail.tsx';
import { EventFormPage } from './pages/EventForm.tsx';
import { AuditsPage } from './pages/Audits.tsx';
import { ActionsPage } from './pages/Actions.tsx';
import { AssistantPage } from './pages/Assistant.tsx';
import { ReportsPage } from './pages/Reports.tsx';
import { WhatsAppPage } from './pages/WhatsApp.tsx';
import { UsersPage } from './pages/Users.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import type { Permission } from '../shared/constants.ts';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[app] erro de renderização', error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="max-w-md text-center">
          <p className="text-[18px] font-semibold text-ink">Algo deu errado nesta tela</p>
          <p className="mt-2 text-[14px] text-muted">{this.state.error.message}</p>
          <Button className="mt-5" icon={<LuRefreshCw className="size-4" />} onClick={() => window.location.reload()}>
            Recarregar
          </Button>
        </div>
      </div>
    );
  }
}

function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-forest text-white">
      <Logo size={64} />
      <Spinner className="text-mint" />
    </div>
  );
}

function NoAccess() {
  return <EmptyState icon={<LuCompass className="size-5" />} title="Sem acesso a esta área" text="Seu perfil não tem permissão para esta tela. Peça ao administrador se precisar." />;
}

function NotFound() {
  const { navigate } = useRouter();
  return (
    <EmptyState
      icon={<LuCompass className="size-5" />}
      title="Página não encontrada"
      text="O endereço pode ter mudado ou o compromisso foi removido."
      action={<Button onClick={() => navigate('/')}>Voltar ao início</Button>}
    />
  );
}

/** Link curto usado nos botões "Visualizar agenda" do WhatsApp: /e/123 → /eventos/123 */
function ShortLink({ id }: { id: string }) {
  const { navigate } = useRouter();
  useEffect(() => navigate(`/eventos/${id}`, { replace: true }), [id]);
  return null;
}

interface RouteDef {
  path: string;
  perm?: Permission | Permission[];
  render: (p: Record<string, string>) => ReactNode;
}

const ROUTES: RouteDef[] = [
  { path: '/', perm: 'dashboard.view', render: () => <DashboardPage /> },
  { path: '/agenda', render: () => <CalendarPage /> },
  { path: '/eventos/novo', perm: 'events.create', render: () => <EventFormPage /> },
  { path: '/eventos/:id/editar', perm: 'events.edit', render: (p) => <EventFormPage key={`f${p.id}`} id={Number(p.id)} /> },
  { path: '/eventos/:id', render: (p) => <EventDetailPage key={`e${p.id}`} id={Number(p.id)} /> },
  { path: '/e/:id', render: (p) => <ShortLink id={p.id} /> },
  { path: '/auditorias', render: () => <AuditsPage /> },
  { path: '/acoes', render: () => <ActionsPage /> },
  { path: '/assistente', perm: 'dashboard.view', render: () => <AssistantPage /> },
  { path: '/relatorios', perm: 'reports.view', render: () => <ReportsPage /> },
  { path: '/whatsapp', perm: 'whatsapp.manage', render: () => <WhatsAppPage /> },
  { path: '/usuarios', perm: 'users.manage', render: () => <UsersPage /> },
  { path: '/configuracoes', render: () => <SettingsPage /> },
];

function Routes() {
  const { loc } = useRouter();
  const { can } = useSession();
  for (const r of ROUTES) {
    const params = match(r.path, loc.path);
    if (!params) continue;
    if (r.perm && !(Array.isArray(r.perm) ? r.perm.some(can) : can(r.perm))) return <NoAccess />;
    return <>{r.render(params)}</>;
  }
  return <NotFound />;
}

function App() {
  const { status, user } = useSession();
  if (status === 'loading') return <Splash />;
  if (status === 'anon' || !user) return <LoginPage />;
  if (user.mustChangePassword) return <ChangePasswordPage />;
  return (
    <Layout>
      <Routes />
    </Layout>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <FeedbackProvider>
        <RouterProvider>
          <SessionProvider>
            <App />
          </SessionProvider>
        </RouterProvider>
      </FeedbackProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// O service worker só funciona em HTTPS (ou localhost) — requisito do navegador para instalar o app.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[pwa] service worker não registrado', e));
  });
}
