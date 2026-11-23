import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';

export function DashboardPage() {
  const { t } = useTranslation();
  const { session } = useAuth();
  if (!session) return null;
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">{t('dashboard.welcome', { name: session.user.displayName })}</h1>
      <p className="text-slate-600">{t('dashboard.roles', { roles: session.user.roles.map((r) => t(`roles.${r}`)).join(', ') })}</p>
    </section>
  );
}
