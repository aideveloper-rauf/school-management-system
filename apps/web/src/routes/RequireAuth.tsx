import { Navigate, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';

export function RequireAuth() {
  const { session, loading } = useAuth();
  const { t } = useTranslation();
  if (loading) return <p className="p-8 text-slate-500" role="status">{t('common.loading')}</p>;
  return session ? <Outlet /> : <Navigate to="/login" replace />;
}
