import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useSubmit } from '../../lib/data';
import { PublicLayout } from '../../components/PublicLayout';
import { Alert, Button } from '../../components/ui';
import { NewPasswordFields, newPasswordProblem } from '../../components/NewPasswordFields';
import { DoneState } from './ResetPasswordPage';

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
        <Alert title={t('errors.invalidToken')}>{t('invite.askAdmin')}</Alert>
      </PublicLayout>
    );
  }

  if (done) {
    return (
      <PublicLayout title={t('invite.title')}>
        <DoneState
          icon={<CheckCircle2 className="size-5" />}
          title={t('invite.doneTitle')}
          body={t('invite.done')}
          action={
            <Link
              to="/login"
              className="inline-flex h-9 w-full items-center justify-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
            >
              {t('auth.submit')}
            </Link>
          }
        />
      </PublicLayout>
    );
  }

  return (
    <PublicLayout title={t('invite.title')} intro={t('invite.intro')}>
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {(problem || submit.error) && (
          <Alert title={problem ?? submit.error ?? undefined}>{submit.error ? t('invite.askAdmin') : undefined}</Alert>
        )}
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
    </PublicLayout>
  );
}
