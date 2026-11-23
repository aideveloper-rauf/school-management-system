import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LoginRequest, Permission, SessionResponse } from '@sms/shared';
import { api, ApiError, setCsrfToken } from './api';
import i18n from '../i18n';

interface AuthState {
  session: SessionResponse | null;
  loading: boolean;
  login: (req: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  /** UI convenience only — the API enforces permissions and record scope. */
  can: (p: Permission) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((s: SessionResponse | null) => {
    setSession(s);
    setCsrfToken(s?.csrfToken ?? null);
    if (s) void i18n.changeLanguage(s.user.locale);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    api<SessionResponse>('/auth/session', { signal: ctrl.signal })
      .then(apply)
      .catch((e) => { if (!(e instanceof ApiError) || e.status !== 401) console.warn('session check failed'); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [apply]);

  const value = useMemo<AuthState>(() => ({
    session,
    loading,
    login: async (req) => apply(await api<SessionResponse>('/auth/login', { method: 'POST', body: req })),
    logout: async () => { try { await api('/auth/logout', { method: 'POST' }); } finally { apply(null); } },
    can: (p) => Boolean(session?.permissions.includes(p)),
  }), [session, loading, apply]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
