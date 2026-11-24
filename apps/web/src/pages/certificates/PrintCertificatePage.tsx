import { useEffect } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useResource } from '../../lib/data';
import { Alert, Button, Loading } from '../../components/ui';
import { CertificateView, type Certificate } from './CertificatesPage';

/** Full-page certificate for printing or "Save as PDF" (outside the app shell). */
export default function PrintCertificatePage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const cert = useResource<Certificate>(`/certificates/${Number(id)}`);
  const school = useResource<{ name: string | null }>('/school/branding');
  useEffect(() => {
    if (cert.data && school.data) setTimeout(() => window.print(), 300);
  }, [cert.data, school.data]);
  return (
    <main className="min-h-screen bg-surface p-6">
      <div className="mb-4 flex justify-end gap-2 print:hidden">
        <Button onClick={() => window.print()}>{t('attendance.print')}</Button>
        <Button onClick={() => window.close()}>{t('common.close')}</Button>
      </div>
      {cert.error ? (
        <Alert>{t(cert.error.message)}</Alert>
      ) : !cert.data ? (
        <Loading />
      ) : (
        <CertificateView cert={cert.data} school={school.data?.name ?? null} />
      )}
    </main>
  );
}
