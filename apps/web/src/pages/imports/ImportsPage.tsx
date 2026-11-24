import { useMemo, useState, type ChangeEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Download, FileUp, History, TriangleAlert } from 'lucide-react';
import { IMPORT_COLUMNS, IMPORT_KINDS, type ImportKind, type Paginated, type Permission } from '@sms/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { query, useResource, useSubmit } from '../../lib/data';
import { formatDateTime } from '../../lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  PageHeader,
  Pagination,
  Select,
  useToast,
  type Column,
} from '../../components/ui';

interface ImportJob {
  id: number;
  kind: ImportKind;
  status: 'previewed' | 'applied';
  fileName: string;
  totalRows: number;
  created: number;
  updated: number;
  unchanged: number;
  errorRows: number;
  errors?: Array<{ row: number; field: string; message: string }>;
  createdAt: string;
  appliedAt: string | null;
  alreadyAppliedAs?: number | null;
}

const KIND_PERMISSION: Record<ImportKind, Permission> = {
  students: 'students.manage',
  staff: 'staff.manage',
  guardians: 'guardians.link.manage',
};
const MAX_BYTES = 2_000_000;

/**
 * CSV import: choose a file → preview (the server runs the import and rolls it back) → apply.
 * The file is read in the browser and sent as text; the server stores only counts and row errors.
 */
export default function ImportsPage() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const kinds = IMPORT_KINDS.filter((k) => can(KIND_PERMISSION[k]));
  const requested = params.get('kind') as ImportKind | null;
  const [kind, setKind] = useState<ImportKind>(requested && kinds.includes(requested) ? requested : (kinds[0] ?? 'students'));
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportJob | null>(null);
  const [page, setPage] = useState(1);
  const history = useResource<Paginated<ImportJob>>(`/imports${query({ page, pageSize: 10 })}`);
  const submit = useSubmit();
  const cols = IMPORT_COLUMNS[kind];

  const template = useMemo(() => {
    const header = [...cols.required, ...cols.optional].join(',');
    return `data:text/csv;charset=utf-8,${encodeURIComponent(`${header}\n`)}`;
  }, [cols]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    setPreview(null);
    setFileError(null);
    submit.reset();
    const f = e.target.files?.[0];
    if (!f) return setFile(null);
    if (f.size > MAX_BYTES) {
      setFile(null);
      return setFileError(t('imports.tooLarge'));
    }
    setFile({ name: f.name, content: await f.text() });
  }

  async function runPreview() {
    if (!file) return;
    const job = await submit.run(() =>
      api<ImportJob>('/imports', { method: 'POST', body: { kind, fileName: file.name, content: file.content } }),
    );
    if (job) {
      setPreview(job);
      history.reload();
    }
  }

  async function apply() {
    if (!file || !preview) return;
    const job = await submit.run(() => api<ImportJob>(`/imports/${preview.id}/apply`, { method: 'POST', body: { content: file.content } }));
    if (job) {
      toast.success(t('imports.applied', { created: job.created, updated: job.updated }));
      setPreview(null);
      setFile(null);
      history.reload();
    }
  }

  const historyColumns: Column<ImportJob>[] = [
    { key: 'file', header: t('imports.file'), cell: (j) => <span className="font-medium">{j.fileName}</span> },
    { key: 'kind', header: t('imports.kind'), cell: (j) => t(`imports.kinds.${j.kind}`) },
    {
      key: 'status',
      header: t('imports.status'),
      cell: (j) => (
        <Badge tone={j.status === 'applied' ? 'ok' : 'neutral'} dot>
          {t(`imports.statuses.${j.status}`)}
        </Badge>
      ),
    },
    {
      key: 'counts',
      header: t('imports.result'),
      cell: (j) => t('imports.counts', { created: j.created, updated: j.updated, unchanged: j.unchanged }),
    },
    { key: 'when', header: t('imports.when'), hideBelow: 'lg', cell: (j) => formatDateTime(j.appliedAt ?? j.createdAt, i18n.language) },
  ];

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('nav.dashboard'), to: '/' }, { label: t('imports.title') }]}
        title={t('imports.title')}
        description={t('imports.intro')}
      />
      <div className="space-y-8">
        <Card title={t('imports.newImport')} description={t('imports.newImportHelp')}>
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('imports.kind')}>
                {(id) => (
                  <Select
                    id={id}
                    value={kind}
                    onChange={(e) => {
                      setKind(e.target.value as ImportKind);
                      setPreview(null);
                    }}
                  >
                    {kinds.map((k) => (
                      <option key={k} value={k}>
                        {t(`imports.kinds.${k}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('imports.file')} hint={t('imports.fileHint')} error={fileError ?? undefined}>
                {(id, d) => (
                  <input
                    id={id}
                    aria-describedby={d}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => void onFile(e)}
                    className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-subtle"
                  />
                )}
              </Field>
            </div>
            <div className="rounded-lg bg-subtle p-3.5 text-[0.8125rem]">
              <p>
                <span className="font-medium">{t('imports.requiredColumns')}:</span> <code>{cols.required.join(', ')}</code>
              </p>
              <p className="mt-1">
                <span className="font-medium">{t('imports.optionalColumns')}:</span> <code>{cols.optional.join(', ')}</code>
              </p>
              <p className="mt-1 text-fg-muted">{t(`imports.help.${kind}`)}</p>
              <a
                className="mt-2 inline-flex items-center gap-1.5 font-medium text-brand-600 hover:underline"
                href={template}
                download={`${kind}-template.csv`}
              >
                <Download className="size-4" /> {t('imports.template')}
              </a>
            </div>
            {submit.error && (
              <Alert>
                {submit.error}
                {Object.keys(submit.fieldErrors).length > 0 && (
                  <ul className="mt-1 list-disc pl-5">
                    {Object.entries(submit.fieldErrors)
                      .slice(0, 10)
                      .map(([k, v]) => (
                        <li key={k}>{v}</li>
                      ))}
                  </ul>
                )}
              </Alert>
            )}
            <Button
              variant="primary"
              icon={<FileUp className="size-4" />}
              busy={submit.busy && !preview}
              disabled={!file}
              onClick={() => void runPreview()}
            >
              {t('imports.preview')}
            </Button>
          </div>
        </Card>

        {preview && (
          <Card title={t('imports.previewTitle', { file: preview.fileName })}>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(
                  [
                    ['created', preview.created],
                    ['updated', preview.updated],
                    ['unchanged', preview.unchanged],
                    ['errorRows', preview.errorRows],
                  ] as const
                ).map(([k, n]) => (
                  <div key={k} className="rounded-lg border border-line p-3">
                    <p className="text-xs text-fg-muted">{t(`imports.summary.${k}`)}</p>
                    <p className={`tabular text-xl font-semibold ${k === 'errorRows' && n > 0 ? 'text-danger' : ''}`}>{n}</p>
                  </div>
                ))}
              </div>
              {preview.alreadyAppliedAs && <Alert tone="warning">{t('imports.alreadyApplied')}</Alert>}
              {preview.errorRows > 0 ? (
                <>
                  <Alert tone="warning" title={t('imports.fixErrors')}>
                    {t('imports.fixErrorsHelp')}
                  </Alert>
                  <div className="max-h-80 overflow-auto rounded-lg border border-line">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-subtle text-left text-xs text-fg-muted">
                        <tr>
                          <th className="px-3 py-2">{t('imports.line')}</th>
                          <th className="px-3 py-2">{t('imports.column')}</th>
                          <th className="px-3 py-2">{t('imports.problem')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {preview.errors?.map((e, i) => (
                          <tr key={i}>
                            <td className="tabular px-3 py-1.5">{e.row}</td>
                            <td className="px-3 py-1.5">
                              <code>{e.field}</code>
                            </td>
                            <td className="px-3 py-1.5">{e.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="primary"
                    icon={<CheckCircle2 className="size-4" />}
                    busy={submit.busy}
                    disabled={!!preview.alreadyAppliedAs || preview.created + preview.updated === 0}
                    onClick={() => void apply()}
                  >
                    {t('imports.apply')}
                  </Button>
                  <span className="text-[0.8125rem] text-fg-muted">{t('imports.applyHelp')}</span>
                </div>
              )}
              {preview.errorRows > 0 && (
                <p className="flex items-center gap-1.5 text-[0.8125rem] text-fg-muted">
                  <TriangleAlert className="size-4" /> {t('imports.nothingChanged')}
                </p>
              )}
            </div>
          </Card>
        )}

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <History className="size-4" /> {t('imports.history')}
          </h2>
          <DataTable<ImportJob>
            label={t('imports.history')}
            columns={historyColumns}
            rows={history.data?.items ?? null}
            loading={history.loading}
            empty={<EmptyState icon={<FileUp className="size-5" />} title={t('imports.noHistory')} />}
            footer={
              history.data && history.data.total > history.data.pageSize ? (
                <Pagination page={history.data.page} pageSize={history.data.pageSize} total={history.data.total} onPage={setPage} />
              ) : undefined
            }
          />
        </section>
      </div>
    </>
  );
}
