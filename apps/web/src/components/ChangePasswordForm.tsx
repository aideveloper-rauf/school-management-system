import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useSubmit } from '../lib/data';
import { Alert, Button, Field, TextInput } from './ui';
import { NewPasswordFields, newPasswordProblem } from './NewPasswordFields';

/** Change own password. Other devices are signed out by the API; this one stays signed in. */
export function ChangePasswordForm({ onDone, submitLabel }: { onDone: () => void | Promise<void>; submitLabel: string }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const submit = useSubmit();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const p = newPasswordProblem(t, password, confirm);
    setProblem(p);
    if (p) return;
    const ok = await submit.run(() => api('/auth/password', { method: 'POST', body: { currentPassword: current, newPassword: password } }));
    if (ok) {
      setCurrent('');
      setPassword('');
      setConfirm('');
      await onDone();
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {(problem || submit.error) && <Alert>{problem ?? submit.error}</Alert>}
      <Field label={t('account.currentPassword')} error={submit.fieldErrors.currentPassword}>
        {(id, d) => (
          <TextInput
            id={id}
            aria-describedby={d}
            aria-invalid={!!submit.fieldErrors.currentPassword || undefined}
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        )}
      </Field>
      <NewPasswordFields
        password={password}
        confirm={confirm}
        onPassword={setPassword}
        onConfirm={setConfirm}
        serverError={submit.fieldErrors.newPassword}
        showMismatch
      />
      <Button type="submit" variant="primary" busy={submit.busy} className="w-full sm:w-auto" disabled={!current || !password || !confirm}>
        {submitLabel}
      </Button>
    </form>
  );
}
