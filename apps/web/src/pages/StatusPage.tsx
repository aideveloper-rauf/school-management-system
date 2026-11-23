import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, DatabaseBackup, Info, ListChecks, RefreshCw, Server, TriangleAlert } from 'lucide-react';
import { useResource } from '../lib/data';
import { formatDateTime, formatRelative } from '../lib/format';
import { Alert, Badge, Button, Card, DescriptionList, Loading, PageHeader, type Tone } from '../components/ui';

interface OpsStatus {
  appVersion: string;
  schemaVersion: string | null;
  setupComplete: boolean;
  queue: Partial<Record<'pending' | 'running' | 'done' | 'failed', number>>;
  lastBackup: { at: string; file: string | null; bytes: number } | null;
  lastRestore: { at: string; from: string | null } | null;
  jobsOverdue: { count: number; oldestDueAt: string | null };
  mailTransport: 'file' | 'smtp';
  environment: string;
  serverTime: string;
}

/** A backup older than this (hours) is flagged: the daily cron job has probably stopped. */
const BACKUP_STALE_HOURS = 26;

interface Issue {
  tone: 'danger' | 'warn';
  title: string;
  fix: string;
}

function issuesOf(s: OpsStatus, t: (k: string, o?: Record<string, unknown>) => string, locale: string): Issue[] {
  const out: Issue[] = [];
  if (!s.lastBackup) out.push({ tone: 'danger', title: t('status.issues.noBackup'), fix: t('status.issues.noBackupFix') });
  else if (Date.now() - new Date(s.lastBackup.at).getTime() > BACKUP_STALE_HOURS * 3600_000)
    out.push({
      tone: 'warn',
      title: t('status.issues.staleBackup', { when: formatRelative(s.lastBackup.at, locale) }),
      fix: t('status.issues.staleBackupFix'),
    });
  if (s.jobsOverdue.count > 0)
    out.push({
      tone: 'danger',
      title: t('status.issues.jobsOverdue', { count: s.jobsOverdue.count }),
      fix: t('status.issues.jobsOverdueFix'),
    });
  if ((s.queue.failed ?? 0) > 0)
    out.push({ tone: 'warn', title: t('status.issues.jobsFailed', { count: s.queue.failed }), fix: t('status.issues.jobsFailedFix') });
  if (s.mailTransport === 'file' && s.environment === 'production')
    out.push({ tone: 'warn', title: t('status.issues.mailOff'), fix: t('status.issues.mailOffFix') });
  if (!s.setupComplete) out.push({ tone: 'warn', title: t('status.issues.setup'), fix: t('status.issues.setupFix') });
  return out;
}

function Metric({ label, value, tone }: { label: string; value: ReactNode; tone?: Tone }) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-fg';
  return (
    <div className="rounded-md border border-line px-3 py-2.5">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className={`tabular mt-1 text-lg font-semibold ${color}`}>{value}</p>
    </div>
  );
}

export default function StatusPage() {
  const { t, i18n } = useTranslation();
  const status = useResource<OpsStatus>('/ops/status');
  const s = status.data;
  const issues = s ? issuesOf(s, t, i18n.language) : [];

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('nav.dashboard'), to: '/' }, { label: t('status.title') }]}
        title={t('status.title')}
        description={t('status.intro')}
        actions={
          <Button icon={<RefreshCw className="size-4" />} busy={status.loading && !!s} onClick={status.reload}>
            {t('status.refresh')}
          </Button>
        }
      />
      {status.error && <Alert>{t(status.error.message)}</Alert>}
      {!s && !status.error && <Loading />}
      {s && (
        <div className="space-y-6">
          {/* Summary: what needs attention, each with the fix. */}
          {issues.length === 0 ? (
            <div role="status" className="flex items-start gap-3 rounded-lg border border-ok/25 bg-ok-bg px-4 py-3.5">
              <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-ok" />
              <div>
                <p className="font-medium text-ok">{t('status.allGood')}</p>
                <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
                  {t('status.checkedAt', { time: formatDateTime(s.serverTime, i18n.language) })}
                </p>
              </div>
            </div>
          ) : (
            <section
              aria-label={t('status.needsAttention')}
              className="overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--shadow-card)]"
            >
              <header className="flex items-center gap-2 border-b border-line px-5 py-3">
                <TriangleAlert aria-hidden className="size-4.5 text-warn" />
                <h2 className="text-[0.9375rem] font-semibold">{t('status.needsAttentionCount', { count: issues.length })}</h2>
              </header>
              <ul className="divide-y divide-line">
                {issues.map((i) => (
                  <li key={i.title} className="flex gap-3 px-5 py-3.5">
                    {i.tone === 'danger' ? (
                      <AlertCircle aria-hidden className="mt-0.5 size-4.5 shrink-0 text-danger" />
                    ) : (
                      <Info aria-hidden className="mt-0.5 size-4.5 shrink-0 text-warn" />
                    )}
                    <div>
                      <p className="text-sm font-medium">{i.title}</p>
                      <p className="mt-0.5 text-[0.8125rem] text-fg-muted">{i.fix}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card
              title={t('status.backups')}
              actions={
                s.lastBackup ? (
                  <Badge tone={Date.now() - new Date(s.lastBackup.at).getTime() > BACKUP_STALE_HOURS * 3600_000 ? 'warn' : 'ok'} dot>
                    {formatRelative(s.lastBackup.at, i18n.language)}
                  </Badge>
                ) : (
                  <Badge tone="danger" dot>
                    {t('status.never')}
                  </Badge>
                )
              }
            >
              <div className="flex gap-3">
                <DatabaseBackup aria-hidden className="mt-0.5 size-5 shrink-0 text-fg-faint" />
                <div className="min-w-0 flex-1">
                  <DescriptionList
                    items={[
                      {
                        label: t('status.lastBackup'),
                        value: s.lastBackup ? formatDateTime(s.lastBackup.at, i18n.language) : t('status.never'),
                      },
                      { label: t('status.size'), value: s.lastBackup ? `${(s.lastBackup.bytes / 1024).toFixed(1)} KB` : '—' },
                      {
                        label: t('status.file'),
                        value: s.lastBackup?.file ? <code className="text-xs break-all">{s.lastBackup.file}</code> : '—',
                      },
                      {
                        label: t('status.lastRestore'),
                        value: s.lastRestore
                          ? `${formatDateTime(s.lastRestore.at, i18n.language)}${s.lastRestore.from ? ` · ${s.lastRestore.from}` : ''}`
                          : t('status.never'),
                      },
                    ]}
                  />
                  <p className="mt-3 text-xs text-fg-muted">{t('status.backupHelp')}</p>
                </div>
              </div>
            </Card>

            <Card
              title={t('status.jobs')}
              actions={
                s.jobsOverdue.count > 0 ? (
                  <Badge tone="danger" dot>
                    {t('status.notRunning')}
                  </Badge>
                ) : (
                  <Badge tone="ok" dot>
                    {t('status.running')}
                  </Badge>
                )
              }
            >
              <div className="flex gap-3">
                <ListChecks aria-hidden className="mt-0.5 size-5 shrink-0 text-fg-faint" />
                <div className="min-w-0 flex-1">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Metric label={t('status.jobStates.pending')} value={s.queue.pending ?? 0} />
                    <Metric label={t('status.jobStates.running')} value={s.queue.running ?? 0} />
                    <Metric
                      label={t('status.jobStates.failed')}
                      value={s.queue.failed ?? 0}
                      tone={(s.queue.failed ?? 0) > 0 ? 'warn' : undefined}
                    />
                    <Metric label={t('status.jobStates.done')} value={s.queue.done ?? 0} />
                  </div>
                  <p className="mt-3 text-xs text-fg-muted">
                    {s.jobsOverdue.count > 0 && s.jobsOverdue.oldestDueAt
                      ? t('status.overdueSince', { when: formatRelative(s.jobsOverdue.oldestDueAt, i18n.language) })
                      : t('status.jobsHelp')}
                  </p>
                </div>
              </div>
            </Card>

            <Card title={t('status.application')} className="lg:col-span-2">
              <div className="flex gap-3">
                <Server aria-hidden className="mt-0.5 size-5 shrink-0 text-fg-faint" />
                <div className="min-w-0 flex-1">
                  <DescriptionList
                    items={[
                      { label: t('status.version'), value: s.appVersion },
                      { label: t('status.schema'), value: s.schemaVersion ? <code className="text-xs">{s.schemaVersion}</code> : '—' },
                      {
                        label: t('status.environment'),
                        value: s.environment === 'production' ? t('status.production') : t('status.nonProduction', { env: s.environment }),
                      },
                      {
                        label: t('status.email'),
                        value:
                          s.mailTransport === 'smtp' ? t('status.emailSmtp') : <span className="text-warn">{t('status.emailFile')}</span>,
                      },
                      { label: t('status.serverTime'), value: formatDateTime(s.serverTime, i18n.language) },
                    ]}
                  />
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
