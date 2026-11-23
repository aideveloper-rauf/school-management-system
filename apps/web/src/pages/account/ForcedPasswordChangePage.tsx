import { useTranslation } from 'react-i18next';
import { useAuth } from '../../lib/auth';
import { PublicLayout } from '../../components/PublicLayout';
import { ChangePasswordForm } from '../../components/ChangePasswordForm';

/** Shown instead of the app while a temporary password is in use (the API blocks everything else). */
export function ForcedPasswordChangePage() {
  const { t } = useTranslation();
  const { refresh, logout } = useAuth();
  return (
    <PublicLayout title={t('account.forcedTitle')} intro={t('account.forcedIntro')}>
      <ChangePasswordForm submitLabel={t('account.saveNewPassword')} onDone={refresh} />
      <button type="button" className="mt-4 text-sm text-register underline" onClick={() => void logout()}>
        {t('auth.logout')}
      </button>
    </PublicLayout>
  );
}
