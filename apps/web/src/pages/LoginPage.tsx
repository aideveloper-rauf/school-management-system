import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

export function LoginPage() {
  const { t } = useTranslation();
  const { session, login } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ identifier, password });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'errors.network');
    } finally {
      setBusy(false);
      setPassword('');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm" noValidate>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm text-slate-500">{t('app.name')}</p>
            <h1 className="text-xl font-semibold">{t('auth.title')}</h1>
          </div>
          <LanguageSwitcher />
        </div>
        {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{t(error)}</p>}
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('auth.identifier')}</span>
          <input className="w-full rounded-md border border-slate-300 px-3 py-2" autoComplete="username" required
            value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('auth.password')}</span>
          <input className="w-full rounded-md border border-slate-300 px-3 py-2" type="password" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="submit" disabled={busy || !identifier || !password}
          className="w-full rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-60">
          {busy ? t('auth.signingIn') : t('auth.submit')}
        </button>
      </form>
    </div>
  );
}
