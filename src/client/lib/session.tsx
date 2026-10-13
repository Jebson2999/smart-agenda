import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, onAuthProblem } from './api.ts';
import type { Permission } from '../../shared/constants.ts';
import type { Recipient, SessionUser } from '../../shared/types.ts';

interface SessionState {
  status: 'loading' | 'anon' | 'ready';
  user: SessionUser | null;
  whatsapp: (Recipient & { phoneFormatted?: string }) | null;
  consentText: string;
  can: (p: Permission) => boolean;
  refresh: () => Promise<void>;
  setUser: (u: SessionUser | null) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionState>(null as unknown as SessionState);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionState['status']>('loading');
  const [user, setUserState] = useState<SessionUser | null>(null);
  const [whatsapp, setWhatsapp] = useState<SessionState['whatsapp']>(null);
  const [consentText, setConsentText] = useState('');

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<{ user: SessionUser; whatsapp: SessionState['whatsapp']; consentText: string }>('/api/auth/me');
      setUserState(me.user);
      setWhatsapp(me.whatsapp);
      setConsentText(me.consentText);
      setStatus('ready');
    } catch {
      setUserState(null);
      setStatus('anon');
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onAuthProblem((code) => {
      if (code === 401) {
        setUserState(null);
        setStatus('anon');
      } else if (code === 428) {
        setUserState((u) => (u ? { ...u, mustChangePassword: true } : u));
      }
    });
  }, [refresh]);

  const setUser = (u: SessionUser | null) => {
    setUserState(u);
    setStatus(u ? 'ready' : 'anon');
  };

  const logout = async () => {
    await api.post('/api/auth/logout').catch(() => {});
    setUser(null);
    window.history.replaceState(null, '', '/');
  };

  const can = (p: Permission) => !!user?.permissions.includes(p);

  return <Ctx.Provider value={{ status, user, whatsapp, consentText, can, refresh, setUser, logout }}>{children}</Ctx.Provider>;
}

export function useSession() {
  return useContext(Ctx);
}
