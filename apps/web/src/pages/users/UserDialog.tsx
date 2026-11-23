import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCALES, ROLES, type Role, type UserItem } from '@sms/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useResource, useSubmit } from '../../lib/data';
import { Alert, Button, Checkbox, Dialog, Field, Loading, SelectInput, StatusBadge, TextInput } from '../../components/ui';
import { MIN_PASSWORD_LENGTH } from '../../components/NewPasswordFields';
import { formatDateTime, statusTone } from '../../lib/format';

/** One user: profile, roles and account actions. Each section saves on its own. */
export function UserDialog({ userId, onClose, onChanged }: { userId: number | null; onClose: () => void; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const { session, can } = useAuth();
  const res = useResource<UserItem>(userId === null ? null : `/users/${userId}`);
  const user = res.data && res.data.id === userId ? res.data : null;
  const isSelf = user?.id === session?.user.id;
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => setMessage(null), [userId]);

  const changed = (msg: string) => {
    setMessage(msg);
    res.reload();
    onChanged();
  };

  return (
    <Dialog open={userId !== null} title={user?.displayName ?? t('users.title')} onClose={onClose}>
      {!user ? (
        res.error ? (
          <Alert>{t(res.error.message)}</Alert>
        ) : (
          <Loading />
        )
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-soft">
            <span>{user.identifier}</span>
            <StatusBadge tone={statusTone(user.status)}>{t(`users.statuses.${user.status}`)}</StatusBadge>
            <span>
              {t('users.lastSignIn')}: {formatDateTime(user.lastLoginAt, i18n.language)}
            </span>
          </div>
          {message && <Alert tone="success">{message}</Alert>}
          {can('users.manage') && <ProfileSection key={`p${user.id}`} user={user} onSaved={() => changed(t('common.saved'))} />}
          {can('roles.assign') && <RolesSection key={`r${user.id}`} user={user} onSaved={() => changed(t('users.rolesSaved'))} />}
          {can('users.manage') && !isSelf && <AccountSection key={`a${user.id}`} user={user} onChanged={changed} />}
        </div>
      )}
    </Dialog>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className="mb-3 border-b border-rule pb-1 text-base font-semibold">{children}</h3>;
}

function ProfileSection({ user, onSaved }: { user: UserItem; onSaved: () => void }) {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [locale, setLocale] = useState(user.locale);
  const submit = useSubmit();
  const dirty = displayName !== user.displayName || locale !== user.locale;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (await submit.run(() => api(`/users/${user.id}`, { method: 'PATCH', body: { displayName, locale } }))) onSaved();
  }
  return (
    <form onSubmit={onSubmit} noValidate>
      <SectionTitle>{t('users.profile')}</SectionTitle>
      <div className="space-y-3">
        {submit.error && <Alert>{submit.error}</Alert>}
        <Field label={t('users.displayName')} error={submit.fieldErrors.displayName}>
          {(id) => <TextInput id={id} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />}
        </Field>
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
        <Button type="submit" variant="primary" busy={submit.busy} disabled={!dirty || !displayName.trim()}>
          {t('common.saveChanges')}
        </Button>
      </div>
    </form>
  );
}

function RolesSection({ user, onSaved }: { user: UserItem; onSaved: () => void }) {
  const { t } = useTranslation();
  const [roles, setRoles] = useState<Role[]>(user.roles);
  const submit = useSubmit();
  useEffect(() => setRoles(user.roles), [user.roles]);
  const dirty = [...roles].sort().join() !== [...user.roles].sort().join();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (await submit.run(() => api(`/users/${user.id}/roles`, { method: 'PUT', body: { roles } }))) onSaved();
  }
  return (
    <form onSubmit={onSubmit} noValidate>
      <SectionTitle>{t('users.roles')}</SectionTitle>
      {submit.error && (
        <div className="mb-3">
          <Alert>{submit.error}</Alert>
        </div>
      )}
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
      <Button type="submit" variant="primary" className="mt-3" busy={submit.busy} disabled={!dirty}>
        {t('users.saveRoles')}
      </Button>
    </form>
  );
}

function AccountSection({ user, onChanged }: { user: UserItem; onChanged: (msg: string) => void }) {
  const { t } = useTranslation();
  const submit = useSubmit();
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [tempOpen, setTempOpen] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState('');

  useEffect(() => {
    setConfirmDisable(false);
    setTempOpen(false);
    setTemporaryPassword('');
  }, [user.id, user.status]);

  const act = async (path: string, msg: string, body?: unknown) => {
    if (await submit.run(() => api(`/users/${user.id}/${path}`, { method: 'POST', body }))) onChanged(msg);
  };

  return (
    <section>
      <SectionTitle>{t('users.account')}</SectionTitle>
      {submit.error && (
        <div className="mb-3">
          <Alert>{submit.error}</Alert>
        </div>
      )}
      <div className="space-y-4 text-sm">
        {user.status === 'invited' && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-ink-soft">{t('users.invitationPending')}</p>
            <Button busy={submit.busy} onClick={() => void act('invitation', t('users.invitationResent'))}>
              {t('users.resendInvitation')}
            </Button>
          </div>
        )}

        {user.status !== 'disabled' && (
          <div>
            {!tempOpen ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-ink-soft">{t('users.temporaryPasswordHelp')}</p>
                <Button onClick={() => setTempOpen(true)}>{t('users.setTemporaryPassword')}</Button>
              </div>
            ) : (
              <form
                className="space-y-3 rounded-md border border-rule p-3"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  void act('temporary-password', t('users.temporaryPasswordSet'), { temporaryPassword });
                }}
              >
                <Field
                  label={t('users.temporaryPassword')}
                  hint={t('users.temporaryPasswordWarning')}
                  error={submit.fieldErrors.temporaryPassword}
                >
                  {(id, d) => (
                    <TextInput
                      id={id}
                      aria-describedby={d}
                      autoComplete="off"
                      spellCheck={false}
                      minLength={MIN_PASSWORD_LENGTH}
                      value={temporaryPassword}
                      onChange={(e) => setTemporaryPassword(e.target.value)}
                    />
                  )}
                </Field>
                <div className="flex gap-2">
                  <Button onClick={() => setTempOpen(false)}>{t('common.cancel')}</Button>
                  <Button type="submit" variant="primary" busy={submit.busy} disabled={temporaryPassword.length < MIN_PASSWORD_LENGTH}>
                    {t('users.setTemporaryPassword')}
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}

        {user.status === 'disabled' ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-ink-soft">{t('users.disabledHelp')}</p>
            <Button variant="primary" busy={submit.busy} onClick={() => void act('enable', t('users.enabled'))}>
              {t('users.enable')}
            </Button>
          </div>
        ) : !confirmDisable ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-ink-soft">{t('users.disableHelp')}</p>
            <Button variant="danger" onClick={() => setConfirmDisable(true)}>
              {t('users.disable')}
            </Button>
          </div>
        ) : (
          <div className="rounded-md border border-maroon/40 bg-maroon-soft p-3">
            <p className="mb-3 text-maroon">{t('users.disableConfirm', { name: user.displayName })}</p>
            <div className="flex gap-2">
              <Button onClick={() => setConfirmDisable(false)}>{t('common.cancel')}</Button>
              <Button variant="danger" busy={submit.busy} onClick={() => void act('disable', t('users.disabled'))}>
                {t('users.disable')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
