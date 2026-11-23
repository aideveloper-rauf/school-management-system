import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Compass } from 'lucide-react';
import { Card, EmptyState } from '../components/ui';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <Card>
      <EmptyState
        icon={<Compass className="size-5" />}
        title={t('common.notFoundPage')}
        description={t('common.notFoundHelp')}
        action={
          <Link to="/" className="text-sm font-medium text-brand-600 hover:underline">
            {t('common.backHome')}
          </Link>
        }
      />
    </Card>
  );
}
