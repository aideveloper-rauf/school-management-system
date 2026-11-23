import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Permission } from '@sms/shared';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/ui';

/**
 * Hide screens the user's roles do not cover (same rule as the menu). This is a UX guard only:
 * the API enforces permissions and record scope on every request.
 */
export function RequirePermission({ anyOf, children }: { anyOf: Permission[]; children: ReactNode }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  if (anyOf.length === 0 || anyOf.some(can)) return <>{children}</>;
  return (
    <>
      <PageHeader title={t('errors.forbidden')} />
      <Link to="/" className="text-register underline">
        {t('common.backHome')}
      </Link>
    </>
  );
}
