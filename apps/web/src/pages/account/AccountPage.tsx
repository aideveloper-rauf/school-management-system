import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../lib/auth';
import { Alert, PageHeader } from '../../components/ui';
import { ChangePasswordForm } from '../../components/ChangePasswordForm';

export default function AccountPage() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const [saved, setSaved] = useState(false);
  if (!session) return null;
  return (
    <>
      <PageHeader title={t('account.title')} />
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <section aria-labelledby="pw-heading" className="max-w-md">
          <h2 id="pw-heading" className="mb-1 text-lg font-semibold">
            {t('account.changePassword')}
          </h2>
          <p className="mb-4 text-sm text-ink-soft">{t('account.changePasswordIntro')}</p>
          {saved && (
            <div className="mb-4">
              <Alert tone="success">{t('account.passwordChanged')}</Alert>
            </div>
          )}
          <ChangePasswordForm submitLabel={t('account.saveNewPassword')} onDone={() => setSaved(true)} />
        </section>
        <section aria-labelledby="me-heading" className="text-sm">
          <h2 id="me-heading" className="mb-3 text-lg font-semibold">
            {t('account.you')}
          </h2>
          <dl className="divide-y divide-rule border-y border-rule">
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-ink-soft">{t('users.displayName')}</dt>
              <dd className="text-right">{session.user.displayName}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-ink-soft">{t('users.roles')}</dt>
              <dd className="text-right">{session.user.roles.map((r) => t(`roles.${r}`)).join(', ') || t('users.noRoles')}</dd>
            </div>
          </dl>
        </section>
      </div>
    </>
  );
}
