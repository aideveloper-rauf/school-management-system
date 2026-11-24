import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, GraduationCap, Search, Upload, UserPlus } from 'lucide-react';
import { GENDERS, STUDENT_STATUSES, type Paginated } from '@sms/shared';
import { useAuth } from '../../lib/auth';
import { query, useResource } from '../../lib/data';
import { sectionLabel, useSections, useYears } from '../../lib/academic';
import { todayIso } from '../../lib/format';
import { FormDrawer, initialValues, type FieldDef } from '../../components/CrudSection';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  Select,
  useToast,
  type Column,
} from '../../components/ui';
import { StudentDrawer } from './StudentDrawer';
import { PromoteDrawer } from './PromoteDrawer';
import { STATUS_TONE, type StudentListItem } from './types';

/**
 * Students list. Registrars/principals see everyone; teachers see only students currently in classes
 * they teach (the API applies that scope — this page just shows what comes back).
 */
export default function StudentsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { years, current } = useYears();
  const [yearId, setYearId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [status, setStatus] = useState('active');
  const [unenrolled, setUnenrolled] = useState(false);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [creating, setCreating] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const openId = params.get('id') ? Number(params.get('id')) : null;
  const setOpenId = (id: number | null) => setParams(id ? { id: String(id) } : {}, { replace: id === null });

  const canManage = can('students.manage');
  const seesAll = can('students.read.all');
  const { sections } = useSections(yearId || null);

  useEffect(() => {
    if (!yearId && current) setYearId(String(current.id));
  }, [current, yearId]);
  useEffect(() => {
    const h = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(h);
  }, [search]);

  const path = `/students${query({
    q,
    status,
    page,
    pageSize,
    ...(unenrolled ? { unenrolled: 'true' } : { classSectionId: sectionId, academicYearId: sectionId ? '' : seesAll ? '' : yearId }),
  })}`;
  const list = useResource<Paginated<StudentListItem>>(path);
  const filtered = !!(q || sectionId || unenrolled || status !== 'active');

  const createFields: FieldDef[] = useMemo(
    () => [
      { name: 'admissionNo', label: t('students.admissionNo'), type: 'text', required: true, half: true },
      { name: 'admittedOn', label: t('students.admittedOn'), type: 'date', required: true, half: true, initial: todayIso() },
      { name: 'fullName', label: t('students.fullName'), type: 'text', required: true },
      {
        name: 'nameWithInitials',
        label: t('students.nameWithInitials'),
        type: 'text',
        nullable: true,
        hint: t('students.nameWithInitialsHint'),
      },
      { name: 'dateOfBirth', label: t('students.dateOfBirth'), type: 'date', nullable: true, half: true },
      {
        name: 'gender',
        label: t('students.gender'),
        type: 'select',
        nullable: true,
        half: true,
        options: GENDERS.map((g) => ({ value: g, label: t(`students.genders.${g}`) })),
      },
      {
        name: 'classSectionId',
        label: t('students.enrolInto'),
        type: 'select',
        numeric: true,
        hint: t('students.enrolIntoHint'),
        options: sections.map((s) => ({ value: String(s.id), label: sectionLabel(s) })),
      },
    ],
    [t, sections],
  );

  const columns: Column<StudentListItem>[] = [
    {
      key: 'student',
      header: t('students.student'),
      cell: (s) => (
        <span className="flex items-center gap-3">
          <Avatar name={s.fullName} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-fg">{s.fullName}</span>
            <span className="tabular block truncate text-[0.8125rem] text-fg-muted">{s.admissionNo}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'class',
      header: t('students.class'),
      cell: (s) =>
        s.currentClass ? (
          <span>
            {s.currentClass.grade.name} / {s.currentClass.name}
            {s.currentClass.rollNo !== null && <span className="ml-1.5 text-fg-faint">#{s.currentClass.rollNo}</span>}
          </span>
        ) : (
          <span className="text-fg-faint">{t('students.notEnrolled')}</span>
        ),
    },
    {
      key: 'year',
      header: t('academic.year'),
      hideBelow: 'lg',
      cell: (s) => s.currentClass?.academicYear.label ?? '—',
    },
    {
      key: 'status',
      header: t('students.status'),
      cell: (s) => (
        <Badge tone={STATUS_TONE[s.status]} dot>
          {t(`students.statuses.${s.status}`)}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('nav.dashboard'), to: '/' }, { label: t('students.title') }]}
        title={t('students.title')}
        description={seesAll ? t('students.intro') : t('students.introScoped')}
        actions={
          canManage && (
            <>
              <Link to="/imports?kind=students">
                <Button icon={<Upload className="size-4" />}>{t('imports.importCsv')}</Button>
              </Link>
              <Button icon={<ArrowUpRight className="size-4" />} onClick={() => setPromoting(true)}>
                {t('students.promote.action')}
              </Button>
              <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>
                {t('students.add')}
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

      <DataTable<StudentListItem>
        label={t('students.title')}
        columns={columns}
        rows={list.data?.items ?? null}
        loading={list.loading}
        onRowClick={(s) => setOpenId(s.id)}
        toolbar={
          <>
            <div className="min-w-[12rem] flex-1">
              <Input
                type="search"
                aria-label={t('students.search')}
                placeholder={t('students.searchPlaceholder')}
                leading={<Search className="size-4" />}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select
              aria-label={t('academic.year')}
              className="w-full sm:w-36"
              value={yearId}
              onChange={(e) => {
                setYearId(e.target.value);
                setSectionId('');
                setPage(1);
              }}
            >
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t('students.class')}
              className="w-full sm:w-44"
              value={unenrolled ? '__none' : sectionId}
              onChange={(e) => {
                setUnenrolled(e.target.value === '__none');
                setSectionId(e.target.value === '__none' ? '' : e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('students.anyClass')}</option>
              {seesAll && <option value="__none">{t('students.notEnrolled')}</option>}
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {sectionLabel(s)}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t('students.status')}
              className="w-full sm:w-36"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('students.anyStatus')}</option>
              {STUDENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`students.statuses.${s}`)}
                </option>
              ))}
            </Select>
            {filtered && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  setSectionId('');
                  setUnenrolled(false);
                  setStatus('active');
                  setPage(1);
                }}
              >
                {t('table.clearFilters')}
              </Button>
            )}
          </>
        }
        empty={
          <EmptyState
            icon={filtered ? <Search className="size-5" /> : <GraduationCap className="size-5" />}
            title={filtered ? t('students.noMatches') : seesAll ? t('students.empty') : t('students.emptyScoped')}
            description={filtered ? t('table.tryOtherFilters') : canManage ? t('students.emptyHelp') : undefined}
            action={
              canManage && !filtered ? (
                <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>
                  {t('students.add')}
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
          title={t('students.addTitle')}
          description={t('students.addIntro')}
          fields={createFields}
          initial={initialValues(createFields)}
          path="/students"
          mode="create"
          submitLabel={t('students.add')}
          onClose={() => setCreating(false)}
          onDone={(res) => {
            setCreating(false);
            toast.success(t('students.added'));
            list.reload();
            setOpenId((res as { id: number }).id);
          }}
        />
      )}
      {promoting && (
        <PromoteDrawer
          years={years}
          onClose={() => setPromoting(false)}
          onDone={() => {
            setPromoting(false);
            list.reload();
          }}
        />
      )}
      {openId !== null && <StudentDrawer studentId={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    </>
  );
}
