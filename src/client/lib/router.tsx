import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode, MouseEvent, AnchorHTMLAttributes } from 'react';

interface Loc {
  path: string;
  search: URLSearchParams;
}

const RouterCtx = createContext<{ loc: Loc; navigate: (to: string, opts?: { replace?: boolean }) => void }>({
  loc: { path: '/', search: new URLSearchParams() },
  navigate: () => {},
});

function current(): Loc {
  return { path: window.location.pathname, search: new URLSearchParams(window.location.search) };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState<Loc>(current);
  useEffect(() => {
    const on = () => setLoc(current());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const navigate = (to: string, opts: { replace?: boolean } = {}) => {
    if (opts.replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    setLoc(current());
    if (!opts.replace) window.scrollTo({ top: 0 });
  };
  return <RouterCtx.Provider value={{ loc, navigate }}>{children}</RouterCtx.Provider>;
}

export function useRouter() {
  return useContext(RouterCtx);
}

export function match(pattern: string, path: string): Record<string, string> | null {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z]+)/g, (_m, k) => (keys.push(k), '/([^/]+)')) + '/?$');
  const m = re.exec(path);
  if (!m) return null;
  return Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
}

export function Link({ to, children, onClick, ...rest }: { to: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
