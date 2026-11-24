import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BookOpen, Briefcase, Pencil, Plus, Search, Trash2, Upload, UserPlus, UserRound } from 'lucide-react';
import { STAFF_STATUSES, type Paginated, type UserItem } from '@sms/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { query, useResource, useSubmit } from '../../lib/data';
import { sectionLabel, useSections, useYears } from '../../lib/academic';
import { formatDate } from '../../lib/format';
import { FormDrawer, initialValues, type FieldDef } from '../../components/CrudSection';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  DataTable,
  DescriptionList,
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
  type Column,
} from '../../components/ui';
import type { StaffItem } from '../students/types';

interface StaffDetail extends StaffItem {
  assignments: Array<{
    id: number;
    class: { id: number; name: string; gradeName: string; yearLabel: string };
    subject: { id: number; name: string };
  }>;
  classTeacherOf: Array<{ id: number; name: string; gradeName: string; yearLabel: string }>;
}

/** Accounts not yet linked to anyone, for the "sign-in account" picker. */
function useAccountOptions(current: StaffItem['account']) {
  const users = useResource<Paginated<UserItem>>('/users?pageSize=100&status=active');
  return useMemo(() => {
    const opts = (users.data?.items ?? []).map((u) => ({ value: String(u.id), label: `${u.displayName} (${u.identifier})` }));
    if (current && !opts.some((o) => o.value === String(current.id)))
      opts.unshift({ value: String(current.id), label: current.identifier });
    return opts;
  }, [users.data, current]);
}

export default function StaffPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const canManage = can('staff.manage');
  const accounts = useAccountOptions(null);

  useEffect(() => {
    const h = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(h);
  }, [search]);
  const list = useResource<Paginated<StaffItem>>(`/staff${query({ q, status, page, pageSize })}`);
  const filtered = !!(q || status !== 'active');

  const fields: FieldDef[] = staffFields(t, accounts);

  const columns: Column<StaffItem>[] = [
    {
      key: 'name',
      header: t('staff.person'),
      cell: (s) => (
        <span className="flex items-center gap-3">
          <Avatar name={s.fullName} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-fg">{s.fullName}</span>
            <span className="tabular block truncate text-[0.8125rem] text-fg-muted">{s.staffNo}</span>
          </span>
        </span>
      ),
    },
    { key: 'designation', header: t('staff.designation'), cell: (s) => s.designation ?? '—' },
    {
      key: 'account',
      header: t('staff.account'),
      hideBelow: 'lg',
      cell: (s) => (s.account ? s.account.identifier : <span className="text-fg-faint">{t('staff.noAccount')}</span>),
    },
    {
      key: 'status',
      header: t('staff.status'),
      cell: (s) => (
        <Badge tone={s.status === 'active' ? 'ok' : 'neutral'} dot>
          {t(`staff.statuses.${s.status}`)}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('nav.dashboard'), to: '/' }, { label: t('staff.title') }]}
        title={t('staff.title')}
        description={t('staff.intro')}
        actions={
          canManage && (
            <>
              <Link to="/imports?kind=staff">
                <Button icon={<Upload className="size-4" />}>{t('imports.importCsv')}</Button>
              </Link>
              <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>
                {t('staff.add')}
              </Button>
            </>
          )
        }
      />
      {list.error && (
        <div className="mb-4">
          <Alert>{t(list.error.message)}</Alert>
        </div>
      )}
      <DataTable<StaffItem>
        label={t('staff.title')}
        columns={columns}
        rows={list.data?.items ?? null}
        loading={list.loading}
        onRowClick={(s) => setOpenId(s.id)}
        toolbar={
          <>
            <div className="min-w-[12rem] flex-1">
              <Input
                type="search"
                aria-label={t('staff.search')}
                placeholder={t('staff.searchPlaceholder')}
                leading={<Search className="size-4" />}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select
              aria-label={t('staff.status')}
              className="w-full sm:w-36"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('staff.anyStatus')}</option>
              {STAFF_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`staff.statuses.${s}`)}
                </option>
              ))}
            </Select>
          </>
        }
        empty={
          <EmptyState
            icon={filtered ? <Search className="size-5" /> : <Briefcase className="size-5" />}
            title={filtered ? t('staff.noMatches') : t('staff.empty')}
            description={filtered ? t('table.tryOtherFilters') : t('staff.emptyHelp')}
            action={
              canManage && !filtered ? (
                <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>
                  {t('staff.add')}
                </Button>
              ) : undefined
            }
          />
        }
        footer={
          list.data && list.data.total > 0 ? (
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              onPage={setPage}
              onPageSize={(n) => {
                setPageSize(n);
                setPage(1);
              }}
            />
          ) : undefined
        }
      />
      {creating && (
        <FormDrawer
          title={t('staff.addTitle')}
          fields={fields}
          initial={initialValues(fields)}
          path="/staff"
          mode="create"
          submitLabel={t('staff.add')}
          onClose={() => setCreating(false)}
          onDone={(res) => {
            setCreating(false);
            toast.success(t('staff.added'));
            list.reload();
            setOpenId((res as { id: number }).id);
          }}
        />
      )}
      {openId !== null && <StaffDrawer staffId={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    </>
  );
}

function staffFields(t: (k: string) => string, accounts: Array<{ value: string; label: string }>): FieldDef[] {
  return [
    { name: 'staffNo', label: t('staff.staffNo'), type: 'text', required: true, half: true },
    { name: 'joinedOn', label: t('staff.joinedOn'), type: 'date', nullable: true, half: true },
    { name: 'fullName', label: t('staff.fullName'), type: 'text', required: true },
    { name: 'nameWithInitials', label: t('students.nameWithInitials'), type: 'text', nullable: true },
    { name: 'designation', label: t('staff.designation'), type: 'text', nullable: true, hint: t('staff.designationHint') },
    { name: 'workEmail', label: t('staff.workEmail'), type: 'email', nullable: true, half: true },
    { name: 'workPhone', label: t('staff.workPhone'), type: 'tel', nullable: true, half: true },
    {
      name: 'userId',
      label: t('staff.account'),
      type: 'select',
      nullable: true,
      numeric: true,
      hint: t('staff.accountHint'),
      options: accounts,
    },
  ];
}

type Tab = 'details' | 'teaching';

function StaffDrawer({ staffId, onClose, onChanged }: { staffId: number; onClose: () => void; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const res = useResource<StaffDetail>(`/staff/${staffId}`);
  const [tab, setTab] = useState<Tab>('details');
  const [editing, setEditing] = useState(false);
  const s = res.data;
  const accounts = useAccountOptions(s?.account ?? null);
  const changed = () => {
    res.reload();
    onChanged();
  };
  const fields: FieldDef[] = [
    ...staffFields(t, accounts),
    {
      name: 'status',
      label: t('staff.status'),
      type: 'select',
      required: true,
      half: true,
      options: STAFF_STATUSES.map((x) => ({ value: x, label: t(`staff.statuses.${x}`) })),
    },
    { name: 'leftOn', label: t('staff.leftOn'), type: 'date', nullable: true, half: true },
  ];

  return (
    <Drawer
      open
      wide
      title={s?.fullName ?? t('common.loading')}
      description={s ? [s.staffNo, s.designation].filter(Boolean).join(' · ') : undefined}
      onClose={onClose}
      footer={<Button onClick={onClose}>{t('common.close')}</Button>}
    >
      {res.error ? (
        <Alert>{t(res.error.message)}</Alert>
      ) : !s ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <Tabs
            label={t('staff.title')}
            value={tab}
            onChange={setTab}
            items={[
              { key: 'details', label: t('students.tabs.details'), icon: <UserRound className="size-4" /> },
              { key: 'teaching', label: t('staff.teaching'), icon: <BookOpen className="size-4" /> },
            ]}
          />
          {tab === 'details' && (
            <div className="space-y-4">
              <DescriptionList
                items={[
                  { label: t('staff.fullName'), value: s.fullName },
                  { label: t('students.nameWithInitials'), value: s.nameWithInitials ?? '—' },
                  { label: t('staff.staffNo'), value: <span className="tabular">{s.staffNo}</span> },
                  { label: t('staff.designation'), value: s.designation ?? '—' },
                  { label: t('staff.workEmail'), value: s.workEmail ?? '—' },
                  { label: t('staff.workPhone'), value: s.workPhone ?? '—' },
                  { label: t('staff.joinedOn'), value: s.joinedOn ? formatDate(s.joinedOn, i18n.language) : '—' },
                  { label: t('staff.status'), value: t(`staff.statuses.${s.status}`) },
                  {
                    label: t('staff.account'),
                    value: s.account ? `${s.account.displayName} (${s.account.identifier})` : t('staff.noAccount'),
                  },
                ]}
              />
              {can('staff.manage') && (
                <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                  {t('staff.edit')}
                </Button>
              )}
            </div>
          )}
          {tab === 'teaching' && <TeachingPanel staff={s} canManage={can('academic.structure.manage')} onChanged={changed} />}
        </div>
      )}
      {editing && s && (
        <FormDrawer
          title={t('staff.edit')}
          fields={fields}
          initial={{
            staffNo: s.staffNo,
            joinedOn: s.joinedOn ?? '',
            fullName: s.fullName,
            nameWithInitials: s.nameWithInitials ?? '',
            designation: s.designation ?? '',
            workEmail: s.workEmail ?? '',
            workPhone: s.workPhone ?? '',
            userId: s.account ? String(s.account.id) : '',
            status: s.status,
            leftOn: s.leftOn ?? '',
          }}
          path={`/staff/${s.id}`}
          mode="edit"
          submitLabel={t('common.saveChanges')}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            toast.success(t('common.saved'));
            changed();
          }}
        />
      )}
    </Drawer>
  );
}

interface GradeSubject {
  subject: { id: number; name: string };
}

function TeachingPanel({ staff, canManage, onChanged }: { staff: StaffDetail; canManage: boolean; onChanged: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { years, current } = useYears();
  const [yearId, setYearId] = useState('');
  const { sections } = useSections(yearId || null);
  const [sectionId, setSectionId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const section = sections.find((x) => String(x.id) === sectionId);
  const subjects = useResource<{ items: GradeSubject[] }>(section ? `/grades/${section.grade.id}/subjects` : null);
  const submit = useSubmit();
  useEffect(() => {
    if (!yearId && current) setYearId(String(current.id));
  }, [current, yearId]);

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    const ok = await submit.run(async () => (await fn()) ?? true);
    if (ok) {
      toast.success(msg);
      onChanged();
    }
  };

  async function add(e: FormEvent) {
    e.preventDefault();
    await run(
      () =>
        api('/teacher-assignments', {
          method: 'POST',
          body: { staffId: staff.id, classSectionId: Number(sectionId), subjectId: Number(subjectId) },
        }),
      t('staff.assigned'),
    );
    setSubjectId('');
  }

  return (
    <div className="space-y-5">
      <p className="text-[0.8125rem] text-fg-muted">{t('staff.teachingNote')}</p>
      {submit.error && <Alert>{submit.error}</Alert>}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('staff.classTeacherOf')}</h3>
        {staff.classTeacherOf.length === 0 ? (
          <p className="text-sm text-fg-faint">{t('staff.none')}</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {staff.classTeacherOf.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 px-3.5 py-2">
                <span>
                  {c.gradeName} / {c.name} <span className="text-fg-muted">· {c.yearLabel}</span>
                </span>
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 className="size-4" />}
                    onClick={() =>
                      void run(
                        () => api(`/class-sections/${c.id}/class-teacher`, { method: 'PUT', body: { staffId: null } }),
                        t('common.saved'),
                      )
                    }
                  >
                    {t('staff.remove')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('staff.subjectsTaught')}</h3>
        {staff.assignments.length === 0 ? (
          <p className="text-sm text-fg-faint">{t('staff.none')}</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {staff.assignments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 px-3.5 py-2">
                <span>
                  <span className="font-medium">{a.subject.name}</span> · {a.class.gradeName} / {a.class.name}{' '}
                  <span className="text-fg-muted">· {a.class.yearLabel}</span>
                </span>
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 className="size-4" />}
                    onClick={() => void run(() => api(`/teacher-assignments/${a.id}`, { method: 'DELETE' }), t('staff.unassigned'))}
                  >
                    {t('staff.remove')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {canManage && staff.status === 'active' && (
        <form onSubmit={add} className="space-y-4 rounded-lg border border-line p-4">
          <h3 className="text-sm font-semibold">{t('staff.assignTitle')}</h3>
          <div className="grid gap-4 sm:grid-cols-3">
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
                <Select id={id} value={sectionId} onChange={(e) => (setSectionId(e.target.value), setSubjectId(''))}>
                  <option value="" disabled>
                    {t('crud.choose')}
                  </option>
                  {sections.map((x) => (
                    <option key={x.id} value={x.id}>
                      {sectionLabel(x)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('staff.subject')} error={submit.fieldErrors.subjectId}>
              {(id) => (
                <Select id={id} value={subjectId} onChange={(e) => setSubjectId(e.target.value)} disabled={!section}>
                  <option value="" disabled>
                    {t('crud.choose')}
                  </option>
                  {(subjects.data?.items ?? []).map((gs) => (
                    <option key={gs.subject.id} value={gs.subject.id}>
                      {gs.subject.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="primary"
              icon={<Plus className="size-4" />}
              busy={submit.busy}
              disabled={!sectionId || !subjectId}
            >
              {t('staff.assign')}
            </Button>
            <Button
              type="button"
              disabled={!sectionId}
              onClick={() =>
                void run(
                  () => api(`/class-sections/${sectionId}/class-teacher`, { method: 'PUT', body: { staffId: staff.id } }),
                  t('staff.classTeacherSet'),
                )
              }
            >
              {t('staff.makeClassTeacher')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
