import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { PublicLayout } from '../components/PublicLayout';
import { Alert, Button, Field, Input, PasswordInput } from '../components/ui';

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
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicLayout title={t('auth.title')} intro={t('auth.intro')}>
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && <Alert>{t(error)}</Alert>}
        <Field label={t('auth.identifier')}>
          {(id) => (
            <Input
              id={id}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          )}
        </Field>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="login-password" className="text-[0.8125rem] font-medium">
              {t('auth.password')}
            </label>
            <Link to="/reset-password" className="text-[0.8125rem] font-medium text-brand-600 hover:text-brand-700 hover:underline">
              {t('auth.forgotPassword')}
            </Link>
          </div>
          <PasswordInput
            id="login-password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            showLabel={t('common.showPassword')}
            hideLabel={t('common.hidePassword')}
          />
        </div>
        <Button type="submit" variant="primary" busy={busy} disabled={!identifier || !password} className="w-full">
          {busy ? t('auth.signingIn') : t('auth.submit')}
        </Button>
      </form>
      <p className="mt-8 text-[0.8125rem] text-fg-muted">{t('auth.helpText')}</p>
    </PublicLayout>
  );
}
