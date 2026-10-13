import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { LuEye, LuEyeOff, LuKeyRound, LuLock } from 'react-icons/lu';
import { api, ApiError } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { Button, Field, Input } from '../components/ui.tsx';
import { Logo } from '../components/EventBits.tsx';
import type { SessionUser } from '../../shared/types.ts';

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <div className="contours relative hidden flex-col justify-between overflow-hidden bg-forest p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <Logo size={44} />
          <div className="leading-tight">
            <div className="text-[18px] font-bold tracking-[-0.02em]">ASTRAL Smart Agenda</div>
            <div className="text-[13px] text-white/65">Astral Saúde Ambiental</div>
          </div>
        </div>
        <div className="max-w-md">
          <p className="text-[34px] leading-[1.15] font-semibold tracking-[-0.03em]">Auditorias, visitas técnicas e reuniões em uma agenda que avisa antes de virar problema.</p>
          <p className="mt-5 text-[15px] leading-relaxed text-white/70">Conflitos de data, preparação de auditoria, confirmações pendentes e lembretes no WhatsApp — para o supervisor e a coordenação acompanharem juntos.</p>
        </div>
        <p className="text-[12px] text-white/45">Lucas do Rio Verde, Sorriso e Nova Ubiratã — Mato Grosso</p>
      </div>
      <div className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm animate-rise">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo size={40} />
            <div className="leading-tight">
              <div className="text-[17px] font-bold tracking-[-0.02em] text-forest dark:text-mint">ASTRAL Smart Agenda</div>
              <div className="text-[12.5px] text-muted">Astral Saúde Ambiental</div>
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { setUser, refresh } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: SessionUser }>('/api/auth/login', { email, password });
      setUser(r.user);
      await refresh();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell>
      <h1 className="text-[26px] font-bold tracking-[-0.025em] text-ink">Entrar</h1>
      <p className="mt-1 text-[14px] text-muted">Use o e-mail e a senha cadastrados pelo administrador.</p>
      <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
        <Field label="E-mail" htmlFor="email">
          <Input id="email" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Senha" htmlFor="password">
          <div className="relative">
            <Input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="pr-10" />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-1.5 text-muted hover:text-ink">
              {show ? <LuEyeOff className="size-4" /> : <LuEye className="size-4" />}
            </button>
          </div>
        </Field>
        {error && (
          <p role="alert" className="rounded-xl bg-soft-alert px-3 py-2.5 text-[13px] text-[#A12828] dark:text-[#F19B9B]">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={busy} icon={<LuLock className="size-4" />}>
          Entrar
        </Button>
      </form>
      <p className="mt-6 text-[12.5px] text-muted">Esqueceu a senha? Peça ao administrador para gerar uma senha temporária.</p>
    </Shell>
  );
}

export function ChangePasswordPage() {
  const { user, setUser, logout } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setError('A confirmação não confere com a nova senha.');
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: SessionUser }>('/api/auth/change-password', { current, next });
      setUser(r.user);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell>
      <div className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-soft-emerald text-emerald">
        <LuKeyRound className="size-5" />
      </div>
      <h1 className="text-[24px] font-bold tracking-[-0.025em] text-ink">Crie sua senha</h1>
      <p className="mt-1 text-[14px] text-muted">Olá, {user?.name}. Por segurança, troque a senha temporária antes de continuar.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Senha temporária" htmlFor="cur">
          <Input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="Nova senha" htmlFor="new" hint="Mínimo de 10 caracteres, com letras e números.">
          <Input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Confirme a nova senha" htmlFor="conf">
          <Input id="conf" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="rounded-xl bg-soft-alert px-3 py-2.5 text-[13px] text-[#A12828] dark:text-[#F19B9B]">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Salvar nova senha
        </Button>
        <button type="button" onClick={() => void logout()} className="w-full text-center text-[13px] text-muted hover:text-ink">
          Sair
        </button>
      </form>
    </Shell>
  );
}
