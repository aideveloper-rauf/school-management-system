import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { PublicLayout } from '../components/PublicLayout';
import { Alert, Button, Field, TextInput } from '../components/ui';

export function LoginPage() {
  const { t } = useTranslation();
  const { session, login } = useAuth();
  const location = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Only same-app paths are accepted as a return target.
  const from = (location.state as { from?: unknown } | null)?.from;
  const target = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && from !== '/login' ? from : '/';
  if (session) return <Navigate to={target} replace />;

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
    <PublicLayout title={t('auth.title')}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{t(error)}</Alert>}
        <Field label={t('auth.identifier')}>
          {(id) => (
            <TextInput id={id} autoComplete="username" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
          )}
        </Field>
        <Field label={t('auth.password')}>
          {(id) => (
            <TextInput
              id={id}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" busy={busy} disabled={!identifier || !password} className="w-full">
          {busy ? t('auth.signingIn') : t('auth.submit')}
        </Button>
        <Link to="/reset-password" className="block text-sm text-register underline">
          {t('auth.forgotPassword')}
        </Link>
      </form>
    </PublicLayout>
  );
}
