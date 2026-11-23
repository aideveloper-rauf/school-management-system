import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, KeyRound, MailPlus, RotateCcw, ShieldCheck, UserRound } from 'lucide-react';
import { LOCALES, type Role, type UserItem } from '@sms/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useResource, useSubmit } from '../../lib/data';
import { formatDateTime, statusTone } from '../../lib/format';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  DescriptionList,
  Drawer,
  Field,
  Input,
  Loading,
  Select,
  Tabs,
  useToast,
} from '../../components/ui';
import { MIN_PASSWORD_LENGTH } from '../../components/NewPasswordFields';
import { RolePicker } from './CreateUserDialog';

export type UserTab = 'details' | 'roles' | 'security';

/** One user in a side drawer: details, roles and account security, each saved on its own. */
export function UserDialog({
  userId,
  initialTab,
  onClose,
  onChanged,
}: {
  userId: number | null;
  initialTab: UserTab;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { session, can } = useAuth();
  const res = useResource<UserItem>(userId === null ? null : `/users/${userId}`);
  const user = res.data && res.data.id === userId ? res.data : null;
  const isSelf = user?.id === session?.user.id;
  const [tab, setTab] = useState<UserTab>(initialTab);
  useEffect(() => setTab(initialTab), [userId, initialTab]);

  const changed = () => {
    res.reload();
    onChanged();
  };

  const tabs = [
    { key: 'details' as const, label: t('users.tabDetails'), icon: <UserRound className="size-4" /> },
    ...(can('roles.assign') ? [{ key: 'roles' as const, label: t('users.roles'), icon: <ShieldCheck className="size-4" /> }] : []),
    { key: 'security' as const, label: t('users.tabSecurity'), icon: <KeyRound className="size-4" /> },
  ];

  return (
    <Drawer
      open={userId !== null}
      wide
      title={user?.displayName ?? t('users.title')}
      onClose={onClose}
      header={
        user ? (
          <div className="flex items-center gap-3">
            <Avatar name={user.displayName} size="lg" />
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">{user.displayName}</h2>
              <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-fg-muted">
                <span className="truncate">{user.identifier}</span>
                <Badge tone={statusTone(user.status)} dot>
                  {t(`users.statuses.${user.status}`)}
                </Badge>
              </p>
            </div>
          </div>
        ) : undefined
      }
    >
      {!user ? (
        res.error ? (
          <Alert>{t(res.error.message)}</Alert>
        ) : (
          <Loading />
        )
      ) : (
        <div className="space-y-6">
          <div className="-mt-2">
            <Tabs items={tabs} value={tab} onChange={setTab} label={t('users.title')} />
          </div>
          {tab === 'details' && <DetailsTab key={`d${user.id}`} user={user} canEdit={can('users.manage')} onSaved={changed} />}
          {tab === 'roles' && <RolesTab key={`r${user.id}`} user={user} onSaved={changed} />}
          {tab === 'security' && (
            <SecurityTab key={`s${user.id}`} user={user} canManage={can('users.manage') && !isSelf} isSelf={isSelf} onChanged={changed} />
          )}
        </div>
      )}
    </Drawer>
  );
}

function DetailsTab({ user, canEdit, onSaved }: { user: UserItem; canEdit: boolean; onSaved: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [locale, setLocale] = useState(user.locale);
  const submit = useSubmit();
  const dirty = displayName !== user.displayName || locale !== user.locale;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (await submit.run(() => api(`/users/${user.id}`, { method: 'PATCH', body: { displayName, locale } }))) {
      toast.success(t('common.saved'));
      onSaved();
    }
  }
  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {submit.error && <Alert>{submit.error}</Alert>}
        <Field label={t('users.displayName')} error={submit.fieldErrors.displayName}>
          {(id, d, invalid) => (
            <Input
              id={id}
              aria-describedby={d}
              aria-invalid={invalid || undefined}
              disabled={!canEdit}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('users.language')}>
          {(id) => (
            <Select id={id} disabled={!canEdit} value={locale} onChange={(e) => setLocale(e.target.value)}>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {t(`language.${l}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {canEdit && (
          <div className="flex gap-2">
            <Button type="submit" variant="primary" busy={submit.busy} disabled={!dirty || !displayName.trim()}>
              {t('common.saveChanges')}
            </Button>
            {dirty && (
              <Button
                onClick={() => {
                  setDisplayName(user.displayName);
                  setLocale(user.locale);
                }}
              >
                {t('common.discard')}
              </Button>
            )}
          </div>
        )}
      </form>
      <DescriptionList
        items={[
          { label: t('users.identifier'), value: user.identifier },
          { label: t('users.created'), value: formatDateTime(user.createdAt, i18n.language) },
          { label: t('users.lastSignIn'), value: user.lastLoginAt ? formatDateTime(user.lastLoginAt, i18n.language) : t('users.never') },
        ]}
      />
    </div>
  );
}

function RolesTab({ user, onSaved }: { user: UserItem; onSaved: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [roles, setRoles] = useState<Role[]>(user.roles);
  const submit = useSubmit();
  const dirty = [...roles].sort().join() !== [...user.roles].sort().join();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (await submit.run(() => api(`/users/${user.id}/roles`, { method: 'PUT', body: { roles } }))) {
      toast.success(t('users.rolesSaved'));
      onSaved();
    }
  }
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <p className="text-[0.8125rem] text-fg-muted">{t('users.rolesIntro')}</p>
      {submit.error && <Alert>{submit.error}</Alert>}
      <RolePicker value={roles} onChange={setRoles} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={submit.busy} disabled={!dirty}>
          {t('users.saveRoles')}
        </Button>
        {dirty && <Button onClick={() => setRoles(user.roles)}>{t('common.discard')}</Button>}
      </div>
    </form>
  );
}

function ActionRow({ title, description, action }: { title: string; description: string; action: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 py-4">
      <div className="min-w-0 max-w-md">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-[0.8125rem] text-fg-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}

function SecurityTab({
  user,
  canManage,
  isSelf,
  onChanged,
}: {
  user: UserItem;
  canManage: boolean;
  isSelf: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const submit = useSubmit();
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [tempOpen, setTempOpen] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState('');

  const act = async (path: string, msg: string, body?: unknown) => {
    const ok = await submit.run(async () => {
      await api(`/users/${user.id}/${path}`, { method: 'POST', body });
      return true;
    });
    if (ok) {
      toast.success(msg);
      setConfirmDisable(false);
      setTempOpen(false);
      setTemporaryPassword('');
      onChanged();
    }
    return ok;
  };

  return (
    <div>
      <DescriptionList
        items={[
          {
            label: t('users.status'),
            value: (
              <Badge tone={statusTone(user.status)} dot>
                {t(`users.statuses.${user.status}`)}
              </Badge>
            ),
          },
          {
            label: t('auth.password'),
            value:
              user.status === 'invited'
                ? t('users.passwordNotSet')
                : user.mustChangePassword
                  ? t('users.passwordTemporary')
                  : t('users.passwordOwn'),
          },
        ]}
      />
      {isSelf && (
        <div className="mt-4">
          <Alert tone="info">{t('users.selfSecurityHint')}</Alert>
        </div>
      )}
      {canManage && (
        <div className="mt-6">
          {submit.error && !confirmDisable && <Alert>{submit.error}</Alert>}
          <div className="divide-y divide-line">
            {user.status === 'invited' && (
              <ActionRow
                title={t('users.resendInvitation')}
                description={t('users.invitationPending')}
                action={
                  <Button
                    icon={<MailPlus className="size-4" />}
                    busy={submit.busy}
                    onClick={() => void act('invitation', t('users.invitationResent'))}
                  >
                    {t('users.resend')}
                  </Button>
                }
              />
            )}
            {user.status !== 'disabled' && (
              <div className="py-4">
                <ActionRow
                  title={t('users.setTemporaryPassword')}
                  description={t('users.temporaryPasswordHelp')}
                  action={
                    !tempOpen && (
                      <Button icon={<KeyRound className="size-4" />} onClick={() => setTempOpen(true)}>
                        {t('users.setPassword')}
                      </Button>
                    )
                  }
                />
                {tempOpen && (
                  <form
                    className="space-y-3 rounded-lg border border-line bg-subtle/50 p-4"
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
                      {(id, d, invalid) => (
                        <Input
                          id={id}
                          aria-describedby={d}
                          aria-invalid={invalid || undefined}
                          autoComplete="off"
                          spellCheck={false}
                          autoFocus
                          value={temporaryPassword}
                          onChange={(e) => setTemporaryPassword(e.target.value)}
                        />
                      )}
                    </Field>
                    <div className="flex gap-2">
                      <Button type="submit" variant="primary" busy={submit.busy} disabled={temporaryPassword.length < MIN_PASSWORD_LENGTH}>
                        {t('users.setTemporaryPassword')}
                      </Button>
                      <Button onClick={() => setTempOpen(false)}>{t('common.cancel')}</Button>
                    </div>
                  </form>
                )}
              </div>
            )}
            {user.status === 'disabled' ? (
              <ActionRow
                title={t('users.enable')}
                description={t('users.disabledHelp')}
                action={
                  <Button
                    variant="primary"
                    icon={<RotateCcw className="size-4" />}
                    busy={submit.busy}
                    onClick={() => void act('enable', t('users.enabledNamed', { name: user.displayName }))}
                  >
                    {t('users.enable')}
                  </Button>
                }
              />
            ) : (
              <ActionRow
                title={t('users.disable')}
                description={t('users.disableHelp')}
                action={
                  <Button
                    variant="secondary"
                    className="text-danger!"
                    icon={<Ban className="size-4" />}
                    onClick={() => setConfirmDisable(true)}
                  >
                    {t('users.disable')}
                  </Button>
                }
              />
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmDisable}
        title={t('users.disableTitle', { name: user.displayName })}
        body={t('users.disableHelp')}
        confirmLabel={t('users.disable')}
        busy={submit.busy}
        error={confirmDisable ? submit.error : null}
        onClose={() => setConfirmDisable(false)}
        onConfirm={() => void act('disable', t('users.disabledNamed', { name: user.displayName }))}
      />
    </div>
  );
}
