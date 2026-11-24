import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Award, Printer } from 'lucide-react';
import { query, useResource } from '../../lib/data';
import { formatDateTime } from '../../lib/format';
import { Alert, Badge, Button, Card, Drawer, EmptyState, Loading, PageHeader, Select } from '../../components/ui';
import { CertificateView, type Certificate } from '../certificates/CertificatesPage';

interface Release {
  releaseId: number;
  version: number;
  publishedAt: string;
  series: { name: string; year: string };
  classSection: { name: string; gradeName: string };
  scale: { name: string; bands: Array<{ min: number; grade: string; label: string | null }> };
  subjects: Array<{ id: number; name: string }>;
  classSize: number;
  result: {
    subjects: Array<{ subjectId: number; percent: number | null; grade: string | null; absent: boolean; exempt: boolean }>;
    total: number;
    average: number | null;
    rank: number | null;
  };
}

/** Released results only (immutable snapshots). Guardians pick among verified children. */
export default function ResultsPage() {
  const { t, i18n } = useTranslation();
  const children = useResource<{ items: Array<{ id: number; fullName: string }> }>('/me/children');
  const [childId, setChildId] = useState('');
  useEffect(() => {
    if (!childId && children.data?.items.length) setChildId(String(children.data.items[0]!.id));
  }, [children.data, childId]);
  const list = useResource<{ items: Release[] }>(children.data ? `/me/results${query({ studentId: childId })}` : null);
  const certs = useResource<{ items: Certificate[] }>(children.data ? `/me/certificates${query({ studentId: childId })}` : null);
  const school = useResource<{ name: string | null }>('/school/branding');
  const [cert, setCert] = useState<Certificate | null>(null);

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('nav.dashboard'), to: '/' }, { label: t('nav.results') }]}
        title={t('nav.results')}
        description={t('results.intro')}
        actions={
          <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>
            {t('attendance.print')}
          </Button>
        }
      />
      <div className="space-y-5">
        {(children.data?.items.length ?? 0) > 1 && (
          <Select
            aria-label={t('portal.child')}
            className="w-full sm:w-60 print:hidden"
            value={childId}
            onChange={(e) => setChildId(e.target.value)}
          >
            {children.data!.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
          </Select>
        )}
        {children.data && children.data.items.length === 0 && <Alert tone="info">{t('results.noChildren')}</Alert>}
        {list.error && <Alert>{t(list.error.message)}</Alert>}
        {children.data?.items.length && !list.data ? <Loading /> : null}
        {list.data && list.data.items.length === 0 && <EmptyState icon={<Award className="size-5" />} title={t('results.none')} />}
        {list.data?.items.map((r) => (
          <Card
            key={r.releaseId}
            title={`${r.series.name} · ${r.series.year}`}
            description={`${r.classSection.gradeName} / ${r.classSection.name} · ${t('results.published', { when: formatDateTime(r.publishedAt, i18n.language) })}`}
            actions={r.version > 1 ? <Badge tone="warn">{t('results.corrected', { version: r.version })}</Badge> : undefined}
          >
            <div className="space-y-4">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-fg-muted">
                  <tr>
                    <th className="py-1.5">{t('staff.subject')}</th>
                    <th className="py-1.5 text-right">{t('results.percent')}</th>
                    <th className="py-1.5 text-right">{t('results.grade')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {r.subjects.map((s) => {
                    const x = r.result.subjects.find((y) => y.subjectId === s.id);
                    return (
                      <tr key={s.id}>
                        <td className="py-2">{s.name}</td>
                        <td className="tabular py-2 text-right">
                          {x?.exempt ? t('exams.exemptShort') : x?.absent ? t('exams.absentShort') : (x?.percent ?? '—')}
                        </td>
                        <td className="py-2 text-right font-semibold">{x?.grade ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <dl className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-subtle p-3">
                  <dt className="text-xs text-fg-muted">{t('exams.total')}</dt>
                  <dd className="tabular text-lg font-semibold">{r.result.total}</dd>
                </div>
                <div className="rounded-lg bg-subtle p-3">
                  <dt className="text-xs text-fg-muted">{t('exams.average')}</dt>
                  <dd className="tabular text-lg font-semibold">{r.result.average ?? '—'}</dd>
                </div>
                <div className="rounded-lg bg-subtle p-3">
                  <dt className="text-xs text-fg-muted">{t('exams.rank')}</dt>
                  <dd className="tabular text-lg font-semibold">
                    {r.result.rank ? t('results.rankOf', { rank: r.result.rank, size: r.classSize }) : '—'}
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-fg-faint">
                {t('results.scale', { name: r.scale.name })}: {r.scale.bands.map((b) => `${b.grade} ≥ ${b.min}`).join(' · ')}
              </p>
            </div>
          </Card>
        ))}
        {(certs.data?.items.length ?? 0) > 0 && (
          <Card title={t('certificates.title')}>
            <ul className="divide-y divide-line">
              {certs.data!.items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm hover:text-brand-600"
                    onClick={() => setCert(c)}
                  >
                    <span>{c.title}</span>
                    <Badge tone={c.status === 'issued' ? 'ok' : 'danger'} dot>
                      {t(`certificates.statuses.${c.status}`)}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      {cert && (
        <Drawer
          open
          wide
          title={cert.title}
          onClose={() => setCert(null)}
          footer={
            <>
              <a href={`#/print/certificate/${cert.id}`} target="_blank" rel="noopener">
                <Button icon={<Printer className="size-4" />}>{t('attendance.print')}</Button>
              </a>
              <Button onClick={() => setCert(null)}>{t('common.close')}</Button>
            </>
          }
        >
          <CertificateView cert={cert} school={school.data?.name ?? null} />
        </Drawer>
      )}
    </>
  );
}
