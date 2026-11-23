import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCALES, ROLES, isEmailIdentifier, type Role, type UserItem } from '@sms/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSubmit } from '../../lib/data';
import { Alert, Button, Checkbox, Dialog, Field, FormActions, SelectInput, TextInput } from '../../components/ui';
import { MIN_PASSWORD_LENGTH } from '../../components/NewPasswordFields';

type Onboarding = 'invite' | 'temporary_password';

export function CreateUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (u: UserItem, invited: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [onboarding, setOnboarding] = useState<Onboarding>('invite');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [locale, setLocale] = useState(i18n.language);
  const [roles, setRoles] = useState<Role[]>([]);
  const submit = useSubmit();

  useEffect(() => {
    if (!open) return;
    setDisplayName('');
    setIdentifier('');
    setOnboarding('invite');
    setTemporaryPassword('');
    setRoles([]);
    submit.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  // No email address → an invitation cannot be sent; switch to a temporary password.
  const hasEmail = isEmailIdentifier(identifier.trim().toLowerCase());
  useEffect(() => {
    if (identifier && !hasEmail && onboarding === 'invite') setOnboarding('temporary_password');
  }, [identifier, hasEmail, onboarding]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body =
      onboarding === 'invite'
        ? { onboarding, identifier, displayName, locale, roles }
        : { onboarding, identifier, displayName, locale, roles, temporaryPassword };
    const created = await submit.run(() => api<UserItem>('/users', { method: 'POST', body }));
    if (created) onCreated(created, onboarding === 'invite');
  }

  const fe = submit.fieldErrors;
  return (
    <Dialog open={open} title={t('users.add')} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {submit.error && <Alert>{submit.error}</Alert>}
        <Field label={t('users.displayName')} error={fe.displayName}>
          {(id, d) => (
            <TextInput id={id} aria-describedby={d} required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          )}
        </Field>
        <Field label={t('users.identifier')} hint={t('users.identifierHint')} error={fe.identifier}>
          {(id, d) => (
            <TextInput
              id={id}
              aria-describedby={d}
              autoComplete="off"
              spellCheck={false}
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          )}
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('users.howToSignIn')}</legend>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="radio"
              name="onboarding"
              className="mt-1 size-4 accent-register"
              checked={onboarding === 'invite'}
              disabled={!!identifier && !hasEmail}
              onChange={() => setOnboarding('invite')}
            />
            <span>
              {t('users.onboardingInvite')}
              <span className="block text-ink-soft">{t('users.onboardingInviteHint')}</span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="radio"
              name="onboarding"
              className="mt-1 size-4 accent-register"
              checked={onboarding === 'temporary_password'}
              onChange={() => setOnboarding('temporary_password')}
            />
            <span>
              {t('users.onboardingTemporary')}
              <span className="block text-ink-soft">{t('users.onboardingTemporaryHint')}</span>
            </span>
          </label>
        </fieldset>

        {onboarding === 'temporary_password' && (
          <Field
            label={t('users.temporaryPassword')}
            hint={t('account.passwordHint', { min: MIN_PASSWORD_LENGTH })}
            error={fe.temporaryPassword}
          >
            {(id, d) => (
              <TextInput
                id={id}
                aria-describedby={d}
                type="text"
                autoComplete="off"
                spellCheck={false}
                minLength={MIN_PASSWORD_LENGTH}
                value={temporaryPassword}
                onChange={(e) => setTemporaryPassword(e.target.value)}
              />
            )}
          </Field>
        )}

        <Field label={t('users.language')}>
          {(id) => (
            <SelectInput id={id} value={locale} onChange={(e) => setLocale(e.target.value)}>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {t(`language.${l}`)}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>

        {can('roles.assign') && (
          <fieldset>
            <legend className="mb-1 text-sm font-medium">{t('users.roles')}</legend>
            <div className="grid sm:grid-cols-2">
              {ROLES.map((r) => (
                <Checkbox
                  key={r}
                  label={t(`roles.${r}`)}
                  checked={roles.includes(r)}
                  onChange={(e) => setRoles((cur) => (e.target.checked ? [...cur, r] : cur.filter((x) => x !== r)))}
                />
              ))}
            </div>
          </fieldset>
        )}

        <FormActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" busy={submit.busy} disabled={!displayName.trim() || !identifier.trim()}>
            {onboarding === 'invite' ? t('users.createAndInvite') : t('users.create')}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
