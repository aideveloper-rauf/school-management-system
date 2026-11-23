import { useTranslation } from 'react-i18next';

export function PlaceholderPage({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">{t(titleKey)}</h1>
      <p className="text-slate-600">{t('dashboard.comingSoon')}</p>
    </section>
  );
}
