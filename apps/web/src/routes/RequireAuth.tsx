import { Navigate, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { RefreshCw, WifiOff } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Button, EmptyState, Loading } from '../components/ui';
import { ForcedPasswordChangePage } from '../pages/account/ForcedPasswordChangePage';

export function RequireAuth() {
  const { t } = useTranslation();
  const { session, loading, signedOut, unreachable, retry } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="mx-auto max-w-md p-8">
        <Loading />
      </div>
    );
  // Server unreachable: keep the user where they are and offer a retry, instead of "signing them out".
  if (!session && unreachable)
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md rounded-lg border border-line bg-surface shadow-[var(--shadow-card)]">
          <EmptyState
            icon={<WifiOff className="size-5" />}
            title={t('common.offlineTitle')}
            description={t('common.offlineBody')}
            action={
              <Button variant="primary" icon={<RefreshCw className="size-4" />} onClick={retry}>
                {t('common.retry')}
              </Button>
            }
          />
        </div>
      </div>
    );
  // Remember where they were going, so sign-in returns them there — unless they signed out on purpose.
  if (!session) return <Navigate to="/login" replace state={signedOut ? null : { from: `${location.pathname}${location.search}` }} />;
  // The API refuses everything else until a temporary password is replaced, so show only that.
  if (session.mustChangePassword) return <ForcedPasswordChangePage />;
  return <Outlet />;
}
