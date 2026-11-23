import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <section className="space-y-3">
      <h1 className="text-2xl font-semibold">{t('common.notFoundPage')}</h1>
      <Link to="/" className="text-brand-700 underline">
        {t('common.backHome')}
      </Link>
    </section>
  );
}
