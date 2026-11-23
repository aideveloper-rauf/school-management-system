import { useTranslation } from 'react-i18next';
import { useAuth } from '../../lib/auth';
import { Avatar, Badge, Card, FormSection, PageHeader, useToast } from '../../components/ui';
import { ChangePasswordForm } from '../../components/ChangePasswordForm';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';

export default function AccountPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { session } = useAuth();
  if (!session) return null;
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('nav.dashboard'), to: '/' }, { label: t('account.title') }]}
        title={t('account.title')}
        description={t('account.intro')}
      />
      <div className="space-y-6">
        <Card>
          <div className="flex flex-wrap items-center gap-4">
            <Avatar name={session.user.displayName} size="lg" />
            <div className="min-w-0">
              <p className="text-base font-semibold">{session.user.displayName}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {session.user.roles.length ? (
                  session.user.roles.map((r) => (
                    <Badge key={r} tone={r === 'school_admin' ? 'brand' : 'neutral'}>
                      {t(`roles.${r}`)}
                    </Badge>
                  ))
                ) : (
                  <span className="text-[0.8125rem] text-fg-muted">{t('users.noRoles')}</span>
                )}
              </div>
            </div>
          </div>
        </Card>
        <Card>
          <FormSection title={t('account.changePassword')} description={t('account.changePasswordIntro')}>
            <ChangePasswordForm submitLabel={t('account.saveNewPassword')} onDone={() => toast.success(t('account.passwordChanged'))} />
          </FormSection>
          <FormSection title={t('account.languageTitle')} description={t('account.languageHelp')}>
            <LanguageSwitcher />
          </FormSection>
        </Card>
      </div>
    </>
  );
}
