import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, MailCheck, CheckCircle2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useSubmit } from '../../lib/data';
import { PublicLayout } from '../../components/PublicLayout';
import { Alert, Button, Field, Input } from '../../components/ui';
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

function BackToSignIn() {
  const { t } = useTranslation();
  return (
    <Link
      to="/login"
      className="mt-8 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-brand-600 hover:text-brand-700 hover:underline"
    >
      <ArrowLeft aria-hidden className="size-3.5" />
      {t('reset.backToSignIn')}
    </Link>
  );
}

/** Large confirmation used after a successful step. */
export function DoneState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div role="status">
      <span className="flex size-11 items-center justify-center rounded-full bg-ok-bg text-ok">{icon}</span>
      <h2 className="mt-4 text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-fg-muted">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
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

  if (sent) {
    return (
      <PublicLayout title={t('reset.requestTitle')}>
        <DoneState icon={<MailCheck className="size-5" />} title={t('reset.checkEmail')} body={t('reset.requestSent')} />
        <p className="mt-6 text-[0.8125rem] text-fg-muted">{t('reset.noEmailHelp')}</p>
        <BackToSignIn />
      </PublicLayout>
    );
  }

  return (
    <PublicLayout title={t('reset.requestTitle')} intro={t('reset.requestIntro')}>
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {submit.error && <Alert>{submit.error}</Alert>}
        <Field label={t('reset.emailLabel')}>
          {(id) => (
            <Input
              id={id}
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" busy={submit.busy} disabled={!identifier.trim()} className="w-full">
          {t('reset.sendLink')}
        </Button>
      </form>
      <p className="mt-6 text-[0.8125rem] text-fg-muted">{t('reset.noEmailHelp')}</p>
      <BackToSignIn />
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

  if (done) {
    return (
      <PublicLayout title={t('reset.chooseTitle')}>
        <DoneState
          icon={<CheckCircle2 className="size-5" />}
          title={t('reset.doneTitle')}
          body={t('reset.done')}
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
    <PublicLayout title={t('reset.chooseTitle')} intro={t('reset.chooseIntro')}>
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {(problem || submit.error) && (
          <Alert>
            {problem ?? submit.error}
            {submit.error && (
              <Link to="/reset-password" className="mt-1 block font-medium underline">
                {t('reset.requestNewLink')}
              </Link>
            )}
          </Alert>
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
      <BackToSignIn />
    </PublicLayout>
  );
}
