import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Award, FilePlus2, FileText, Printer, Search, XCircle } from 'lucide-react';
import { CERTIFICATE_PLACEHOLDERS, LOCALES, type Paginated } from '@sms/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { query, useResource, useSubmit } from '../../lib/data';
import { sectionLabel, useSections, useYears } from '../../lib/academic';
import { formatDate, todayIso } from '../../lib/format';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Drawer,
  EmptyState,
  Field,
  Input,
  Loading,
  PageHeader,
  Pagination,
  Select,
  Tabs,
  useToast,
} from '../../components/ui';

export interface Certificate {
  id: number;
  serial: string;
  title: string;
  body: string;
  issuedOn: string;
  status: 'issued' | 'revoked';
  issuedBy: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  student: { id: number; fullName: string; admissionNo: string };
}
interface Template {
  id: number;
  name: string;
  locale: string;
  title: string;
  body: string;
  isActive: boolean;
}

/** Print-friendly certificate. Use the browser's "Save as PDF" for a PDF copy. */
export function CertificateView({ cert, school }: { cert: Certificate; school: string | null }) {
  const { t, i18n } = useTranslation();
  const verifyUrl = `${window.location.origin}${window.location.pathname}#/verify?serial=${encodeURIComponent(cert.serial)}`;
  return (
    <article className="certificate mx-auto max-w-2xl space-y-6 rounded-lg border-4 border-double border-brand-600 bg-surface p-10 text-center">
      <p className="text-sm tracking-widest text-fg-muted uppercase">{school}</p>
      <h2 className="text-2xl font-semibold">{cert.title}</h2>
      <p className="text-base leading-relaxed whitespace-pre-line">{cert.body}</p>
      <p className="text-sm text-fg-muted">{formatDate(cert.issuedOn, i18n.language)}</p>
      <div className="flex items-end justify-between pt-10 text-xs text-fg-muted">
        <span className="border-t border-fg-faint px-6 pt-1">{t('certificates.signature')}</span>
        <span className="text-right">
          {t('certificates.serial')}: <span className="font-mono">{cert.serial}</span>
          <br />
          {t('certificates.verifyAt')} {verifyUrl}
        </span>
      </div>
      {cert.status === 'revoked' && <p className="font-semibold text-danger">{t('certificates.revokedStamp')}</p>}
    </article>
  );
}

export default function CertificatesPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = (['issued', 'issue', 'templates'] as const).find((k) => k === params.get('tab')) ?? 'issued';
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('nav.dashboard'), to: '/' }, { label: t('certificates.title') }]}
        title={t('certificates.title')}
        description={t('certificates.intro')}
      />
      <div className="space-y-6">
        <Tabs
          label={t('certificates.title')}
          value={tab}
          onChange={(k) => setParams(k === 'issued' ? {} : { tab: k }, { replace: true })}
          items={[
            { key: 'issued', label: t('certificates.tabs.issued'), icon: <Award className="size-4" /> },
            { key: 'issue', label: t('certificates.tabs.issue'), icon: <FilePlus2 className="size-4" /> },
            { key: 'templates', label: t('certificates.tabs.templates'), icon: <FileText className="size-4" /> },
          ]}
        />
        {tab === 'issued' && <Issued />}
        {tab === 'issue' && <IssueForm onDone={() => setParams({}, { replace: true })} />}
        {tab === 'templates' && <Templates />}
      </div>
    </>
  );
}

function Issued() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Certificate | null>(null);
  const [reason, setReason] = useState('');
  const school = useResource<{ name: string | null }>('/school/branding');
  const revoke = useSubmit();
  useEffect(() => {
    const h = setTimeout(() => (setQ(search.trim()), setPage(1)), 300);
    return () => clearTimeout(h);
  }, [search]);
  const list = useResource<Paginated<Certificate>>(`/certificates${query({ q, page, pageSize: 25 })}`);
  return (
    <div className="space-y-4">
      <Input
        type="search"
        leading={<Search className="size-4" />}
        aria-label={t('certificates.search')}
        placeholder={t('certificates.search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {list.error && <Alert>{t(list.error.message)}</Alert>}
      {!list.data ? (
        <Loading />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon={<Award className="size-5" />} title={t('certificates.none')} />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {list.data.items.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-subtle"
                onClick={() => (setOpen(c), setReason(''), revoke.reset())}
              >
                <span>
                  <span className="font-medium">{c.student.fullName}</span>
                  <span className="ml-2 text-[0.8125rem] text-fg-muted">
                    {c.title} · {formatDate(c.issuedOn, i18n.language)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-xs text-fg-muted">{c.serial}</span>
                  <Badge tone={c.status === 'issued' ? 'ok' : 'danger'} dot>
                    {t(`certificates.statuses.${c.status}`)}
                  </Badge>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.data && list.data.total > list.data.pageSize && (
        <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
      )}
      {open && (
        <Drawer
          open
          wide
          title={open.title}
          description={`${open.student.fullName} · ${open.serial}`}
          onClose={() => setOpen(null)}
          footer={
            <>
              <a href={`#/print/certificate/${open.id}`} target="_blank" rel="noopener">
                <Button icon={<Printer className="size-4" />}>{t('attendance.print')}</Button>
              </a>
              <Button onClick={() => setOpen(null)}>{t('common.close')}</Button>
            </>
          }
        >
          <div className="space-y-5">
            <CertificateView cert={open} school={school.data?.name ?? null} />
            {open.status === 'revoked' ? (
              <Alert
                tone="info"
                title={t('certificates.revokedOn', { date: open.revokedAt ? formatDate(open.revokedAt.slice(0, 10), i18n.language) : '' })}
              >
                {open.revokeReason}
              </Alert>
            ) : (
              can('certificates.revoke') && (
                <div className="flex flex-wrap items-end gap-2 print:hidden">
                  {revoke.error && <Alert>{revoke.error}</Alert>}
                  <Field label={t('certificates.revokeReason')}>
                    {(id) => <Input id={id} className="w-80" value={reason} onChange={(e) => setReason(e.target.value)} />}
                  </Field>
                  <Button
                    variant="danger"
                    icon={<XCircle className="size-4" />}
                    disabled={!reason.trim()}
                    busy={revoke.busy}
                    onClick={async () => {
                      const ok = await revoke.run(() => api(`/certificates/${open.id}/revoke`, { method: 'POST', body: { reason } }));
                      if (ok) {
                        toast.success(t('certificates.revoked'));
                        setOpen(null);
                        list.reload();
                      }
                    }}
                  >
                    {t('certificates.revoke')}
                  </Button>
                </div>
              )
            )}
          </div>
        </Drawer>
      )}
    </div>
  );
}

function IssueForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const templates = useResource<{ items: Template[] }>('/certificate-templates');
  const { years, current } = useYears();
  const [yearId, setYearId] = useState('');
  const { sections } = useSections(yearId || null);
  const [sectionId, setSectionId] = useState('');
  const roster = useResource<{ items: Array<{ id: number; fullName: string; admissionNo: string }> }>(
    sectionId ? `/class-sections/${sectionId}/students` : null,
  );
  const [templateId, setTemplateId] = useState('');
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [issuedOn, setIssuedOn] = useState(todayIso());
  const [details, setDetails] = useState('');
  const submit = useSubmit();
  useEffect(() => {
    if (!yearId && current) setYearId(String(current.id));
  }, [current, yearId]);
  const active = (templates.data?.items ?? []).filter((x) => x.isActive);
  useEffect(() => {
    if (!templateId && active.length) setTemplateId(String(active[0]!.id));
  }, [active, templateId]);
  useEffect(() => setChosen(new Set()), [sectionId]);
  async function issue() {
    const res = await submit.run(() =>
      api<{ items: unknown[] }>('/certificates', {
        method: 'POST',
        body: { templateId: Number(templateId), studentIds: [...chosen], issuedOn, details: details.trim() || null },
      }),
    );
    if (res) {
      toast.success(t('certificates.issued', { count: res.items.length }));
      onDone();
    }
  }
  if (templates.data && active.length === 0) return <Alert tone="info">{t('certificates.needTemplate')}</Alert>;
  const students = roster.data?.items ?? [];
  return (
    <div className="space-y-5">
      {submit.error && <Alert>{submit.error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('certificates.template')}>
          {(id) => (
            <Select id={id} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {active.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({t(`language.${x.locale}`)})
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('academic.year')}>
          {(id) => (
            <Select id={id} value={yearId} onChange={(e) => (setYearId(e.target.value), setSectionId(''))}>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('students.class')}>
          {(id) => (
            <Select id={id} value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              <option value="" disabled>
                {t('crud.choose')}
              </option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {sectionLabel(s)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('certificates.issuedOn')}>
          {(id) => <Input id={id} type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />}
        </Field>
      </div>
      <Field label={t('certificates.details')} hint={t('certificates.detailsHint')} optional={t('common.optional')}>
        {(id) => <Input id={id} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />}
      </Field>
      {sectionId &&
        (roster.loading ? (
          <Loading />
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[0.8125rem] text-fg-muted">{t('certificates.chooseStudents', { count: chosen.size })}</p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setChosen(chosen.size === students.length ? new Set() : new Set(students.map((s) => s.id)))}
              >
                {chosen.size === students.length ? t('certificates.selectNone') : t('certificates.selectAll')}
              </Button>
            </div>
            <ul className="divide-y divide-line rounded-lg border border-line px-3.5">
              {students.map((s) => (
                <li key={s.id}>
                  <Checkbox
                    label={s.fullName}
                    description={s.admissionNo}
                    checked={chosen.has(s.id)}
                    onChange={(e) =>
                      setChosen((cur) => {
                        const n = new Set(cur);
                        if (e.target.checked) n.add(s.id);
                        else n.delete(s.id);
                        return n;
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      <Button
        variant="primary"
        icon={<FilePlus2 className="size-4" />}
        busy={submit.busy}
        disabled={!templateId || chosen.size === 0 || !issuedOn}
        onClick={() => void issue()}
      >
        {t('certificates.issue', { count: chosen.size })}
      </Button>
    </div>
  );
}

function Templates() {
  const { t } = useTranslation();
  const toast = useToast();
  const list = useResource<{ items: Template[] }>('/certificate-templates');
  const [editing, setEditing] = useState<Template | 'new' | null>(null);
  const [form, setForm] = useState({ name: '', locale: 'en', title: '', body: '', isActive: true });
  const submit = useSubmit();
  const startEdit = (x: Template | 'new') => {
    setEditing(x);
    submit.reset();
    setForm(
      x === 'new'
        ? {
            name: '',
            locale: 'en',
            title: '',
            body: t('certificates.sampleBody', Object.fromEntries(CERTIFICATE_PLACEHOLDERS.map((k) => [k, `{{${k}}}`]))),
            isActive: true,
          }
        : { name: x.name, locale: x.locale, title: x.title, body: x.body, isActive: x.isActive },
    );
  };
  async function save() {
    const ok = await submit.run(async () =>
      editing === 'new'
        ? api('/certificate-templates', { method: 'POST', body: form })
        : ((await api(`/certificate-templates/${(editing as Template).id}`, { method: 'PUT', body: form })) ?? true),
    );
    if (ok) {
      toast.success(t('common.saved'));
      setEditing(null);
      list.reload();
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" icon={<FilePlus2 className="size-4" />} onClick={() => startEdit('new')}>
          {t('certificates.newTemplate')}
        </Button>
      </div>
      {!list.data ? (
        <Loading />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon={<FileText className="size-5" />} title={t('certificates.noTemplates')} />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {list.data.items.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-subtle"
                onClick={() => startEdit(x)}
              >
                <span>
                  <span className="font-medium">{x.name}</span>{' '}
                  <span className="text-[0.8125rem] text-fg-muted">
                    · {t(`language.${x.locale}`)} · {x.title}
                  </span>
                </span>
                {!x.isActive && <Badge>{t('certificates.inactive')}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <Drawer
          open
          wide
          title={editing === 'new' ? t('certificates.newTemplate') : t('certificates.editTemplate')}
          description={t('certificates.templateHelp')}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
              <Button
                variant="primary"
                busy={submit.busy}
                disabled={!form.name.trim() || !form.title.trim() || !form.body.trim()}
                onClick={() => void save()}
              >
                {t('common.saveChanges')}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {submit.error && <Alert>{submit.error}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('certificates.templateName')}>
                {(id) => <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
              </Field>
              <Field label={t('questions.language')}>
                {(id) => (
                  <Select id={id} value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value })}>
                    {LOCALES.map((l) => (
                      <option key={l} value={l}>
                        {t(`language.${l}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <Field label={t('certificates.certTitle')}>
              {(id) => <Input id={id} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}
            </Field>
            <Field
              label={t('certificates.body')}
              hint={t('certificates.placeholders', { list: CERTIFICATE_PLACEHOLDERS.map((p) => `{{${p}}}`).join(' ') })}
            >
              {(id) => (
                <textarea
                  id={id}
                  rows={6}
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  className="block w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm focus:border-brand-500 focus:ring-3 focus:ring-brand-100 focus:outline-none"
                />
              )}
            </Field>
            <Checkbox
              label={t('certificates.active')}
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            <Alert tone="info">{t('certificates.frozenNote')}</Alert>
          </div>
        </Drawer>
      )}
    </div>
  );
}
