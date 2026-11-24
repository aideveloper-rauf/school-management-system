import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, Contact, Inbox, Search, Upload, UserPlus, X } from 'lucide-react';
import { LOCALES, VERIFICATION_METHODS, type Paginated } from '@sms/shared';
import { api } from '../../lib/api';
import { query, useResource, useSubmit } from '../../lib/data';
import { formatDateTime } from '../../lib/format';
import { FormDrawer, initialValues, type FieldDef } from '../../components/CrudSection';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  DescriptionList,
  Drawer,
  EmptyState,
  Input,
  Loading,
  PageHeader,
  Pagination,
  Select,
  Tabs,
  useToast,
  type Column,
} from '../../components/ui';
import type { GuardianItem } from '../students/types';

interface PendingLink {
  student: { id: number; admissionNo: string; fullName: string };
  guardian: { id: number; fullName: string; phone: string | null; email: string | null; hasAccount: boolean };
  relationship: string;
  isPrimary: boolean;
  verificationStatus: string;
  linkedAt: string;
}

type Tab = 'queue' | 'all';

/** Registrar: verify guardian ↔ student links (only verified links give a guardian access) and keep guardian details. */
export default function GuardiansPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'all' ? 'all' : 'queue';
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('nav.dashboard'), to: '/' }, { label: t('guardians.title') }]}
        title={t('guardians.title')}
        description={t('guardians.intro')}
        actions={
          <Link to="/imports?kind=guardians">
            <Button icon={<Upload className="size-4" />}>{t('imports.importCsv')}</Button>
          </Link>
        }
      />
      <div className="space-y-6">
        <Tabs
          label={t('guardians.title')}
          value={tab}
          onChange={(k) => setParams(k === 'queue' ? {} : { tab: k }, { replace: true })}
          items={[
            { key: 'queue', label: t('guardians.queue'), icon: <BadgeCheck className="size-4" /> },
            { key: 'all', label: t('guardians.all'), icon: <Contact className="size-4" /> },
          ]}
        />
        {tab === 'queue' ? <VerificationQueue /> : <GuardianDirectory />}
      </div>
    </>
  );
}

function VerificationQueue() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [method, setMethod] = useState<string>(VERIFICATION_METHODS[0]);
  const list = useResource<Paginated<PendingLink & { id: number }>>(`/guardian-links${query({ page, pageSize: 25 })}`);
  const action = useSubmit();
  const rows = (list.data?.items ?? []).map((l) => ({ ...l, id: l.student.id * 1_000_000 + l.guardian.id }));

  const decide = async (l: PendingLink, decision: 'verified' | 'rejected') => {
    const ok = await action.run(async () => {
      await api(`/students/${l.student.id}/guardians/${l.guardian.id}/verify`, {
        method: 'POST',
        body: decision === 'verified' ? { decision, method } : { decision },
      });
      return true;
    });
    if (ok) {
      toast.success(decision === 'verified' ? t('guardians.verified') : t('guardians.rejected'));
      list.reload();
    }
  };

  const columns: Column<PendingLink & { id: number }>[] = [
    {
      key: 'guardian',
      header: t('guardians.guardian'),
      cell: (l) => (
        <span className="min-w-0">
          <span className="block font-medium">{l.guardian.fullName}</span>
          <span className="block text-[0.8125rem] text-fg-muted">
            {[l.guardian.phone, l.guardian.email].filter(Boolean).join(' · ') || '—'}
          </span>
        </span>
      ),
    },
    {
      key: 'student',
      header: t('students.student'),
      cell: (l) => (
        <span>
          <Link className="font-medium text-brand-600 hover:underline" to={`/students?id=${l.student.id}`}>
            {l.student.fullName}
          </Link>
          <span className="tabular ml-2 text-[0.8125rem] text-fg-muted">{l.student.admissionNo}</span>
        </span>
      ),
    },
    { key: 'rel', header: t('guardians.relationship'), cell: (l) => t(`guardians.relationships.${l.relationship}`) },
    { key: 'when', header: t('guardians.linkedAt'), hideBelow: 'lg', cell: (l) => formatDateTime(l.linkedAt, i18n.language) },
    {
      key: 'actions',
      header: t('guardians.decision'),
      cell: (l) => (
        <span className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" icon={<BadgeCheck className="size-4" />} onClick={() => void decide(l, 'verified')}>
            {t('guardians.verify')}
          </Button>
          <Button size="sm" icon={<X className="size-4" />} onClick={() => void decide(l, 'rejected')}>
            {t('guardians.reject')}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-[0.8125rem] text-fg-muted">{t('guardians.queueHelp')}</p>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-fg-muted">{t('guardians.method')}</span>
          <Select className="w-48" value={method} onChange={(e) => setMethod(e.target.value)}>
            {VERIFICATION_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`guardians.methods.${m}`)}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {(list.error || action.error) && <Alert>{action.error ?? t(list.error!.message)}</Alert>}
      <DataTable
        label={t('guardians.queue')}
        columns={columns}
        rows={list.data ? rows : null}
        loading={list.loading}
        empty={
          <EmptyState icon={<Inbox className="size-5" />} title={t('guardians.queueEmpty')} description={t('guardians.queueEmptyHelp')} />
        }
        footer={
          list.data && list.data.total > list.data.pageSize ? (
            <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          ) : undefined
        }
      />
    </div>
  );
}

function guardianFields(t: (k: string) => string): FieldDef[] {
  return [
    { name: 'fullName', label: t('guardians.fullName'), type: 'text', required: true },
    { name: 'phone', label: t('guardians.phone'), type: 'tel', nullable: true, half: true },
    { name: 'email', label: t('guardians.email'), type: 'email', nullable: true, half: true },
    {
      name: 'preferredLocale',
      label: t('guardians.language'),
      type: 'select',
      required: true,
      initial: 'en',
      options: LOCALES.map((l) => ({ value: l, label: t(`language.${l}`) })),
    },
    { name: 'notifyEmail', label: t('guardians.notifyEmail'), type: 'checkbox', initial: true },
    { name: 'notifySms', label: t('guardians.notifySms'), type: 'checkbox', initial: false },
  ];
}

function GuardianDirectory() {
  const { t } = useTranslation();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  useEffect(() => {
    const h = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(h);
  }, [search]);
  const list = useResource<Paginated<GuardianItem>>(`/guardians${query({ q, page, pageSize: 25 })}`);
  const fields = guardianFields(t);

  const columns: Column<GuardianItem>[] = [
    { key: 'name', header: t('guardians.fullName'), cell: (g) => <span className="font-medium">{g.fullName}</span> },
    { key: 'contact', header: t('guardians.contact'), cell: (g) => [g.phone, g.email].filter(Boolean).join(' · ') || '—' },
    { key: 'students', header: t('guardians.students'), cell: (g) => g.studentCount ?? 0 },
    {
      key: 'account',
      header: t('staff.account'),
      hideBelow: 'lg',
      cell: (g) =>
        g.account ? <Badge tone="ok">{t('guardians.hasAccount')}</Badge> : <span className="text-fg-faint">{t('staff.noAccount')}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      {list.error && <Alert>{t(list.error.message)}</Alert>}
      <DataTable<GuardianItem>
        label={t('guardians.all')}
        columns={columns}
        rows={list.data?.items ?? null}
        loading={list.loading}
        onRowClick={(g) => setOpenId(g.id)}
        toolbar={
          <>
            <div className="min-w-[12rem] flex-1">
              <Input
                type="search"
                aria-label={t('guardians.search')}
                placeholder={t('guardians.searchPlaceholder')}
                leading={<Search className="size-4" />}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>
              {t('guardians.add')}
            </Button>
          </>
        }
        empty={<EmptyState icon={<Contact className="size-5" />} title={q ? t('guardians.noMatches') : t('guardians.empty')} />}
        footer={
          list.data && list.data.total > list.data.pageSize ? (
            <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          ) : undefined
        }
      />
      {creating && (
        <FormDrawer
          title={t('guardians.addTitle')}
          description={t('guardians.addIntro')}
          fields={fields}
          initial={initialValues(fields)}
          path="/guardians"
          mode="create"
          submitLabel={t('guardians.add')}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            toast.success(t('guardians.added'));
            list.reload();
          }}
        />
      )}
      {openId !== null && <GuardianDrawer id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    </div>
  );
}

interface GuardianDetail extends GuardianItem {
  students: Array<{
    id: number;
    admissionNo: string;
    fullName: string;
    relationship: string;
    isPrimary: boolean;
    verificationStatus: string;
  }>;
}

function GuardianDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const res = useResource<GuardianDetail>(`/guardians/${id}`);
  const [editing, setEditing] = useState(false);
  const g = res.data;
  return (
    <Drawer
      open
      title={g?.fullName ?? t('common.loading')}
      onClose={onClose}
      footer={<Button onClick={onClose}>{t('common.close')}</Button>}
    >
      {res.error ? (
        <Alert>{t(res.error.message)}</Alert>
      ) : !g ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <DescriptionList
            items={[
              { label: t('guardians.phone'), value: g.phone ?? '—' },
              { label: t('guardians.email'), value: g.email ?? '—' },
              { label: t('guardians.language'), value: t(`language.${g.preferredLocale}`) },
              {
                label: t('guardians.notifications'),
                value:
                  [g.notifyEmail && t('guardians.byEmail'), g.notifySms && t('guardians.bySms')].filter(Boolean).join(', ') ||
                  t('guardians.noNotifications'),
              },
              { label: t('staff.account'), value: g.account ? g.account.identifier : t('staff.noAccount') },
            ]}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setEditing(true)}>{t('guardians.edit')}</Button>
            {!g.account && <InviteButton guardianId={g.id} email={g.email} onDone={() => (res.reload(), onChanged())} />}
          </div>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t('guardians.students')}</h3>
            {g.students.length === 0 ? (
              <p className="text-sm text-fg-faint">{t('staff.none')}</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {g.students.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2">
                    <Link className="font-medium text-brand-600 hover:underline" to={`/students?id=${s.id}`}>
                      {s.fullName}
                    </Link>
                    <span className="flex items-center gap-2 text-[0.8125rem] text-fg-muted">
                      {t(`guardians.relationships.${s.relationship}`)}
                      <Badge
                        tone={s.verificationStatus === 'verified' ? 'ok' : s.verificationStatus === 'rejected' ? 'danger' : 'warn'}
                        dot
                      >
                        {t(`guardians.verification.${s.verificationStatus}`)}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {editing && g && (
        <FormDrawer
          title={t('guardians.edit')}
          fields={guardianFields(t)}
          initial={{
            fullName: g.fullName,
            phone: g.phone ?? '',
            email: g.email ?? '',
            preferredLocale: g.preferredLocale,
            notifyEmail: g.notifyEmail,
            notifySms: g.notifySms,
          }}
          path={`/guardians/${g.id}`}
          mode="edit"
          submitLabel={t('common.saveChanges')}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            toast.success(t('common.saved'));
            res.reload();
            onChanged();
          }}
        />
      )}
    </Drawer>
  );
}

function InviteButton({ guardianId, email, onDone }: { guardianId: number; email: string | null; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const submit = useSubmit();
  return (
    <div className="space-y-2">
      <Button
        variant="primary"
        busy={submit.busy}
        disabled={!email}
        title={email ? t('guardians.inviteHelp') : t('errors.guardianNeedsEmail')}
        onClick={async () => {
          const ok = await submit.run(() => api(`/guardians/${guardianId}/invite`, { method: 'POST' }));
          if (ok) {
            toast.success(t('guardians.invited', { email }));
            onDone();
          }
        }}
      >
        {t('guardians.invite')}
      </Button>
      {submit.error && <Alert>{submit.error}</Alert>}
    </div>
  );
}
