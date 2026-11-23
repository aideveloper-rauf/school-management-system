import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Hourglass } from 'lucide-react';
import { NAV } from '../routes/nav';
import { Card, EmptyState, PageHeader } from '../components/ui';

/** Sections on the roadmap but not built yet. Honest, with a way back. */
export function PlaceholderPage({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  const Icon = NAV.find((n) => n.labelKey === titleKey)?.icon ?? Hourglass;
  return (
    <>
      <PageHeader crumbs={[{ label: t('nav.dashboard'), to: '/' }, { label: t(titleKey) }]} title={t(titleKey)} />
      <Card>
        <EmptyState
          icon={<Icon className="size-5" />}
          title={t('placeholder.title')}
          description={t('placeholder.body')}
          action={
            <Link to="/" className="text-sm font-medium text-brand-600 hover:underline">
              {t('common.backHome')}
            </Link>
          }
        />
      </Card>
    </>
  );
}
