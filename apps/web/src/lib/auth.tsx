import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LoginRequest, Permission, SessionResponse } from '@sms/shared';
import { api, ApiError, setCsrfToken } from './api';
import i18n from '../i18n';

interface AuthState {
  session: SessionResponse | null;
  loading: boolean;
  /**
   * True after the user pressed "Sign out" in this tab. The sign-in redirect then carries no
   * return target, so the next person on a shared device does not land on the previous user's page.
   */
  signedOut: boolean;
  login: (req: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-read the session (e.g. after a password change clears mustChangePassword). */
  refresh: () => Promise<void>;
  /** UI convenience only — the API enforces permissions and record scope. */
  can: (p: Permission) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);

  const apply = useCallback((s: SessionResponse | null) => {
    setSession(s);
    setCsrfToken(s?.csrfToken ?? null);
    if (s) void i18n.changeLanguage(s.user.locale);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    api<SessionResponse>('/auth/session', { signal: ctrl.signal })
      .then(apply)
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        if (!(e instanceof ApiError) || e.status !== 401) console.warn('session check failed');
      })
      // An aborted check (unmount, React StrictMode re-run) must not end "loading": that would
      // briefly treat the user as signed out and bounce a deep link through /login to /.
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [apply]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      loading,
      signedOut,
      login: async (req) => {
        apply(await api<SessionResponse>('/auth/login', { method: 'POST', body: req }));
        setSignedOut(false);
      },
      logout: async () => {
        try {
          await api('/auth/logout', { method: 'POST' });
        } finally {
          // Same render batch as clearing the session, so the guard sees both together.
          setSignedOut(true);
          apply(null);
        }
      },
      refresh: async () => apply(await api<SessionResponse>('/auth/session')),
      can: (p) => Boolean(session?.permissions.includes(p)),
    }),
    [session, loading, signedOut, apply],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
