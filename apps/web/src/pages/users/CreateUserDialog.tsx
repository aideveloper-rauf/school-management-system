import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Mail } from 'lucide-react';
import { LOCALES, ROLES, isEmailIdentifier, type Role, type UserItem } from '@sms/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSubmit } from '../../lib/data';
import { Alert, Button, Checkbox, Drawer, Field, Input, RadioCard, Select } from '../../components/ui';
import { MIN_PASSWORD_LENGTH } from '../../components/NewPasswordFields';

type Onboarding = 'invite' | 'temporary_password';
const FORM_ID = 'create-user-form';

/** Checkbox list of roles with one-line explanations. */
export function RolePicker({ value, onChange, disabled }: { value: Role[]; onChange: (r: Role[]) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="divide-y divide-line rounded-lg border border-line px-3.5">
      {ROLES.map((r) => (
        <Checkbox
          key={r}
          label={t(`roles.${r}`)}
          description={t(`roleHelp.${r}`)}
          checked={value.includes(r)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))}
        />
      ))}
    </div>
  );
}

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the drawer opens
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
  const ready = displayName.trim() && identifier.trim() && (onboarding === 'invite' || temporaryPassword.length >= MIN_PASSWORD_LENGTH);
  return (
    <Drawer
      open={open}
      wide
      title={t('users.add')}
      description={t('users.addIntro')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form={FORM_ID} variant="primary" busy={submit.busy} disabled={!ready}>
            {onboarding === 'invite' ? t('users.createAndInvite') : t('users.create')}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit} noValidate className="space-y-7">
        {submit.error && <Alert>{submit.error}</Alert>}

        <section className="space-y-4">
          <h3 className="text-sm font-semibold">{t('users.sectionPerson')}</h3>
          <Field label={t('users.displayName')} error={fe.displayName}>
            {(id, d, invalid) => (
              <Input
                id={id}
                aria-describedby={d}
                aria-invalid={invalid || undefined}
                required
                autoFocus
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('users.identifier')} hint={t('users.identifierHint')} error={fe.identifier}>
            {(id, d, invalid) => (
              <Input
                id={id}
                aria-describedby={d}
                aria-invalid={invalid || undefined}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('users.language')} hint={t('users.languageHint')}>
            {(id, d) => (
              <Select id={id} aria-describedby={d} value={locale} onChange={(e) => setLocale(e.target.value)}>
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {t(`language.${l}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </section>

        <fieldset className="space-y-3">
          <legend className="mb-3 text-sm font-semibold">{t('users.howToSignIn')}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <RadioCard
              name="onboarding"
              checked={onboarding === 'invite'}
              disabled={!!identifier && !hasEmail}
              onChange={() => setOnboarding('invite')}
              icon={<Mail className="size-4.5" />}
              title={t('users.onboardingInvite')}
              description={identifier && !hasEmail ? t('users.inviteNeedsEmail') : t('users.onboardingInviteHint')}
            />
            <RadioCard
              name="onboarding"
              checked={onboarding === 'temporary_password'}
              onChange={() => setOnboarding('temporary_password')}
              icon={<KeyRound className="size-4.5" />}
              title={t('users.onboardingTemporary')}
              description={t('users.onboardingTemporaryHint')}
            />
          </div>
          {onboarding === 'temporary_password' && (
            <Field
              label={t('users.temporaryPassword')}
              hint={t('account.passwordHint', { min: MIN_PASSWORD_LENGTH })}
              error={fe.temporaryPassword}
            >
              {(id, d, invalid) => (
                <Input
                  id={id}
                  aria-describedby={d}
                  aria-invalid={invalid || undefined}
                  autoComplete="off"
                  spellCheck={false}
                  minLength={MIN_PASSWORD_LENGTH}
                  value={temporaryPassword}
                  onChange={(e) => setTemporaryPassword(e.target.value)}
                />
              )}
            </Field>
          )}
        </fieldset>

        {can('roles.assign') && (
          <fieldset>
            <legend className="text-sm font-semibold">{t('users.roles')}</legend>
            <p className="mt-1 mb-3 text-[0.8125rem] text-fg-muted">{t('users.rolesIntro')}</p>
            <RolePicker value={roles} onChange={setRoles} />
          </fieldset>
        )}
      </form>
    </Drawer>
  );
}
