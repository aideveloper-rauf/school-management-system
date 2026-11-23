import { useTranslation } from 'react-i18next';
import { Field, TextInput } from './ui';

export const MIN_PASSWORD_LENGTH = 10;

/** New password + confirmation. Returns a translated problem, or null when both are valid. */
export function newPasswordProblem(t: (k: string, o?: Record<string, unknown>) => string, pw: string, confirm: string): string | null {
  if (pw.length < MIN_PASSWORD_LENGTH) return t('account.passwordTooShort', { min: MIN_PASSWORD_LENGTH });
  if (pw !== confirm) return t('account.passwordsDoNotMatch');
  return null;
}

export function NewPasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
  serverError,
  showMismatch,
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  serverError?: string;
  showMismatch: boolean;
}) {
  const { t } = useTranslation();
  const mismatch = showMismatch && confirm.length > 0 && password !== confirm;
  return (
    <>
      <Field label={t('account.newPassword')} hint={t('account.passwordHint', { min: MIN_PASSWORD_LENGTH })} error={serverError}>
        {(id, d) => (
          <TextInput
            id={id}
            aria-describedby={d}
            aria-invalid={!!serverError || undefined}
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            value={password}
            onChange={(e) => onPassword(e.target.value)}
          />
        )}
      </Field>
      <Field label={t('account.confirmPassword')} error={mismatch ? t('account.passwordsDoNotMatch') : undefined}>
        {(id, d) => (
          <TextInput
            id={id}
            aria-describedby={d}
            aria-invalid={mismatch || undefined}
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => onConfirm(e.target.value)}
          />
        )}
      </Field>
    </>
  );
}
