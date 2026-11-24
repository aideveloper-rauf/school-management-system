import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, Lock } from 'lucide-react';
import { useResource } from '../../lib/data';
import { formatDate } from '../../lib/format';
import { Alert, Card, EmptyState, Loading, PageHeader, Select } from '../../components/ui';

interface Overview {
  year: { id: number; label: string } | null;
  from: string;
  to: string;
  minGroup: number;
  classes: Array<{
    id: number;
    name: string;
    enrolled: number | null;
    attendanceDays: number;
    attendanceRate: number | null;
    suppressed: boolean;
  }>;
  results: Array<{
    seriesId: number;
    series: string;
    classSectionId: number;
    students: number;
    suppressed: boolean;
    average: number | null;
    subjects: Array<{ id: number; name: string; average: number | null }>;
  }>;
}

/** A plain horizontal bar (0–100) with the value written out, so it reads without colour. */
function Bar({ value }: { value: number | null }) {
  const { t } = useTranslation();
  if (value === null) return <span className="text-xs text-fg-faint">{t('analytics.hidden')}</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 w-32 overflow-hidden rounded-full bg-subtle" aria-hidden>
        <span
          className={`block h-full rounded-full ${value < 80 ? 'bg-warn' : 'bg-ok'}`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </span>
      <span className="tabular text-sm">{value}%</span>
    </span>
  );
}

export default function AnalyticsPage() {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState('30');
  const res = useResource<Overview>(`/analytics/overview?days=${days}`);
  const o = res.data;
  const className = (id: number) => o?.classes.find((c) => c.id === id)?.name ?? '';
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('nav.dashboard'), to: '/' }, { label: t('analytics.title') }]}
        title={t('analytics.title')}
        description={t('analytics.intro')}
      />
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Select aria-label={t('analytics.period')} className="w-48" value={days} onChange={(e) => setDays(e.target.value)}>
            {['7', '30', '90', '365'].map((d) => (
              <option key={d} value={d}>
                {t('analytics.lastDays', { count: Number(d) })}
              </option>
            ))}
          </Select>
          {o && (
            <p className="flex items-center gap-1.5 text-xs text-fg-faint">
              <Lock className="size-3.5" /> {t('analytics.privacy', { n: o.minGroup })}
            </p>
          )}
        </div>
        {res.error && <Alert>{t(res.error.message)}</Alert>}
        {!o ? (
          <Loading />
        ) : !o.year ? (
          <EmptyState icon={<BarChart3 className="size-5" />} title={t('analytics.noYear')} />
        ) : (
          <>
            <Card
              title={t('analytics.attendance', { year: o.year.label })}
              description={`${formatDate(o.from, i18n.language)} – ${formatDate(o.to, i18n.language)}`}
              flush
            >
              <table className="w-full text-sm">
                <thead className="bg-subtle text-left text-xs text-fg-muted">
                  <tr>
                    <th className="px-4 py-2">{t('students.class')}</th>
                    <th className="px-4 py-2 text-right">{t('analytics.enrolled')}</th>
                    <th className="px-4 py-2 text-right">{t('analytics.daysTaken')}</th>
                    <th className="px-4 py-2">{t('attendance.rate')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {o.classes.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-2 font-medium">{c.name}</td>
                      <td className="tabular px-4 py-2 text-right">{c.enrolled ?? '—'}</td>
                      <td className="tabular px-4 py-2 text-right">{c.attendanceDays}</td>
                      <td className="px-4 py-2">
                        {c.attendanceDays === 0 ? (
                          <span className="text-xs text-fg-faint">{t('analytics.noRegisters')}</span>
                        ) : (
                          <Bar value={c.attendanceRate} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title={t('analytics.results')} description={t('analytics.resultsHelp')}>
              {o.results.length === 0 ? (
                <p className="text-sm text-fg-faint">{t('analytics.noResults')}</p>
              ) : (
                <div className="space-y-5">
                  {o.results.map((r) => (
                    <section key={`${r.seriesId}-${r.classSectionId}`} className="space-y-2">
                      <h3 className="text-sm font-semibold">
                        {r.series} · {className(r.classSectionId)}{' '}
                        <span className="font-normal text-fg-muted">
                          · {t('analytics.classAverage')} {r.average ?? t('analytics.hidden')}
                        </span>
                      </h3>
                      <ul className="space-y-1">
                        {r.subjects.map((s) => (
                          <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                            <span>{s.name}</span>
                            <Bar value={s.average} />
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
