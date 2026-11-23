import { useTranslation } from 'react-i18next';
import { useAuth } from '../../lib/auth';
import { PublicLayout } from '../../components/PublicLayout';
import { ChangePasswordForm } from '../../components/ChangePasswordForm';

/** Shown instead of the app while a temporary password is in use (the API blocks everything else). */
export function ForcedPasswordChangePage() {
  const { t } = useTranslation();
  const { refresh, logout, session } = useAuth();
  return (
    <PublicLayout title={t('account.forcedTitle')} intro={t('account.forcedIntro', { name: session?.user.displayName ?? '' })}>
      <ChangePasswordForm submitLabel={t('account.saveNewPassword')} onDone={refresh} fullWidth />
      <button
        type="button"
        className="mt-8 text-[0.8125rem] font-medium text-brand-600 hover:text-brand-700 hover:underline"
        onClick={() => void logout()}
      >
        {t('account.notYou')}
      </button>
    </PublicLayout>
  );
}
