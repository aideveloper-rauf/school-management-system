import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { Field, PasswordInput } from './ui';

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
  const longEnough = password.length >= MIN_PASSWORD_LENGTH;
  const toggle = { showLabel: t('common.showPassword'), hideLabel: t('common.hidePassword') };
  return (
    <>
      <Field label={t('account.newPassword')} error={serverError}>
        {(id, d, invalid) => (
          <>
            <PasswordInput
              id={id}
              aria-describedby={d}
              aria-invalid={invalid || undefined}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
              value={password}
              onChange={(e) => onPassword(e.target.value)}
              {...toggle}
            />
            {/* Live requirement check instead of a rule the user has to remember. */}
            <p className={`mt-1.5 flex items-center gap-1.5 text-xs ${longEnough ? 'text-ok' : 'text-fg-muted'}`}>
              <Check aria-hidden className={`size-3.5 ${longEnough ? '' : 'opacity-30'}`} />
              {t('account.passwordHint', { min: MIN_PASSWORD_LENGTH })}
            </p>
          </>
        )}
      </Field>
      <Field label={t('account.confirmPassword')} error={mismatch ? t('account.passwordsDoNotMatch') : undefined}>
        {(id, d, invalid) => (
          <PasswordInput
            id={id}
            aria-describedby={d}
            aria-invalid={invalid || undefined}
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => onConfirm(e.target.value)}
            {...toggle}
          />
        )}
      </Field>
    </>
  );
}
