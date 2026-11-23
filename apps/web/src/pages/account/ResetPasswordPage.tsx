import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useSubmit } from '../../lib/data';
import { PublicLayout } from '../../components/PublicLayout';
import { Alert, Button, Field, TextInput } from '../../components/ui';
import { NewPasswordFields, newPasswordProblem } from '../../components/NewPasswordFields';

/**
 * Without ?token: ask for a reset link. With ?token (from the email): choose a new password.
 * The request always shows the same confirmation, whether or not the account exists.
 */
export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  return token ? <ChooseNewPassword token={token} /> : <RequestLink />;
}

function RequestLink() {
  const { t } = useTranslation();
  const [identifier, setIdentifier] = useState('');
  const [sent, setSent] = useState(false);
  const submit = useSubmit();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await submit.run(() => api('/auth/password-reset/request', { method: 'POST', body: { identifier } }));
    if (ok) setSent(true);
  }

  return (
    <PublicLayout title={t('reset.requestTitle')} intro={sent ? undefined : t('reset.requestIntro')}>
      {sent ? (
        <div className="space-y-4">
          <Alert tone="success">{t('reset.requestSent')}</Alert>
          <p className="text-sm text-ink-soft">{t('reset.noEmailHelp')}</p>
          <Link to="/login" className="text-sm text-register underline">
            {t('reset.backToSignIn')}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {submit.error && <Alert>{submit.error}</Alert>}
          <Field label={t('reset.emailLabel')}>
            {(id) => (
              <TextInput
                id={id}
                type="email"
                autoComplete="username"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" busy={submit.busy} disabled={!identifier.trim()} className="w-full">
            {t('reset.sendLink')}
          </Button>
          <p className="text-sm text-ink-soft">{t('reset.noEmailHelp')}</p>
          <Link to="/login" className="text-sm text-register underline">
            {t('reset.backToSignIn')}
          </Link>
        </form>
      )}
    </PublicLayout>
  );
}

function ChooseNewPassword({ token }: { token: string }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submit = useSubmit();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const p = newPasswordProblem(t, password, confirm);
    setProblem(p);
    if (p) return;
    const ok = await submit.run(() => api('/auth/password-reset/confirm', { method: 'POST', body: { token, newPassword: password } }));
    if (ok) setDone(true);
  }

  return (
    <PublicLayout title={t('reset.chooseTitle')}>
      {done ? (
        <div className="space-y-4">
          <Alert tone="success">{t('reset.done')}</Alert>
          <Link to="/login" className="inline-block text-sm font-medium text-register underline">
            {t('auth.submit')}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {(problem || submit.error) && <Alert>{problem ?? submit.error}</Alert>}
          {submit.error && (
            <Link to="/reset-password" className="block text-sm text-register underline">
              {t('reset.requestNewLink')}
            </Link>
          )}
          <NewPasswordFields
            password={password}
            confirm={confirm}
            onPassword={setPassword}
            onConfirm={setConfirm}
            serverError={submit.fieldErrors.newPassword}
            showMismatch
          />
          <Button type="submit" variant="primary" busy={submit.busy} disabled={!password || !confirm} className="w-full">
            {t('reset.save')}
          </Button>
        </form>
      )}
    </PublicLayout>
  );
}
