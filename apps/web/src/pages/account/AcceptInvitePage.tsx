import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useSubmit } from '../../lib/data';
import { PublicLayout } from '../../components/PublicLayout';
import { Alert, Button } from '../../components/ui';
import { NewPasswordFields, newPasswordProblem } from '../../components/NewPasswordFields';

/** Landing page for the invitation email: choose a password, then sign in. */
export default function AcceptInvitePage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
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
    const ok = await submit.run(() => api('/auth/invitations/accept', { method: 'POST', body: { token, password } }));
    if (ok) setDone(true);
  }

  if (!token) {
    return (
      <PublicLayout title={t('invite.title')}>
        <Alert>{t('errors.invalidToken')}</Alert>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout title={t('invite.title')} intro={done ? undefined : t('invite.intro')}>
      {done ? (
        <div className="space-y-4">
          <Alert tone="success">{t('invite.done')}</Alert>
          <Link to="/login" className="inline-block text-sm font-medium text-register underline">
            {t('auth.submit')}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {(problem || submit.error) && <Alert>{problem ?? submit.error}</Alert>}
          {submit.error && <p className="text-sm text-ink-soft">{t('invite.askAdmin')}</p>}
          <NewPasswordFields
            password={password}
            confirm={confirm}
            onPassword={setPassword}
            onConfirm={setConfirm}
            serverError={submit.fieldErrors.password}
            showMismatch
          />
          <Button type="submit" variant="primary" busy={submit.busy} disabled={!password || !confirm} className="w-full">
            {t('invite.activate')}
          </Button>
        </form>
      )}
    </PublicLayout>
  );
}
