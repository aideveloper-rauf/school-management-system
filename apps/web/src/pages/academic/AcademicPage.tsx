import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  BellRing,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  CopyPlus,
  DoorOpen,
  GraduationCap,
  Layers,
  ListChecks,
} from 'lucide-react';
import { CALENDAR_EVENT_KINDS, LOCALES } from '@sms/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { query, useResource, useSubmit } from '../../lib/data';
import { daysBetween, formatDate } from '../../lib/format';
import { CrudSection } from '../../components/CrudSection';
import { Alert, Badge, Button, Checkbox, Drawer, Loading, PageHeader, Select, Tabs, useToast } from '../../components/ui';

interface Year {
  id: number;
  label: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
}
interface Term {
  id: number;
  label: string;
  sequence: number;
  startsOn: string;
  endsOn: string;
}
interface Grade {
  id: number;
  name: string;
  level: number;
  isActive: boolean;
}
interface Subject {
  id: number;
  code: string;
  name: string;
  nameSi: string | null;
  nameTa: string | null;
  isActive: boolean;
}
interface Room {
  id: number;
  name: string;
  capacity: number | null;
  isActive: boolean;
}
interface Section {
  id: number;
  academicYear: { id: number; label: string };
  grade: { id: number; name: string; level: number };
  name: string;
  medium: string | null;
  capacity: number | null;
  homeRoom: { id: number; name: string } | null;
}
interface Period {
  id: number;
  label: string;
  sequence: number;
  startsAt: string;
  endsAt: string;
  isBreak: boolean;
}
interface CalendarEvent {
  id: number;
  academicYearId: number | null;
  title: string;
  kind: string;
  startsOn: string;
  endsOn: string;
  isSchoolDay: boolean;
}

const TABS = ['years', 'grades', 'subjects', 'classes', 'rooms', 'periods', 'calendar'] as const;
type Tab = (typeof TABS)[number];
const TAB_ICONS: Record<Tab, typeof CalendarRange> = {
  years: CalendarRange,
  grades: GraduationCap,
  subjects: BookOpen,
  classes: Layers,
  rooms: DoorOpen,
  periods: BellRing,
  calendar: CalendarDays,
};

const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

export default function AcademicPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'years';

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('nav.dashboard'), to: '/' }, { label: t('academic.title') }]}
        title={t('academic.title')}
        description={t('academic.intro')}
      />
      <div className="mb-6">
        <Tabs
          label={t('academic.sections')}
          value={tab}
          onChange={(k) => setParams({ tab: k }, { replace: true })}
          items={TABS.map((k) => {
            const Icon = TAB_ICONS[k];
            return { key: k, label: t(`academic.tabs.${k}`), icon: <Icon className="size-4" /> };
          })}
        />
      </div>
      <div role="tabpanel" aria-label={t(`academic.tabs.${tab}`)}>
        {tab === 'years' && <YearsTab />}
        {tab === 'grades' && <GradesTab />}
        {tab === 'subjects' && <SubjectsTab />}
        {tab === 'classes' && <ClassesTab />}
        {tab === 'rooms' && <RoomsTab />}
        {tab === 'periods' && <PeriodsTab />}
        {tab === 'calendar' && <CalendarTab />}
      </div>
    </>
  );
}

function useCanManage() {
  return useAuth().can('academic.structure.manage');
}

/** Academic years for filters; picks the current year by default. */
function useYears() {
  const years = useResource<{ items: Year[] }>('/academic-years');
  const items = years.data?.items ?? [];
  const current = items.find((y) => y.isCurrent) ?? items[0];
  return { years: items, current, loading: years.loading, reload: years.reload };
}

function YearFilter({
  years,
  value,
  onChange,
  allowAll,
}: {
  years: Year[];
  value: string;
  onChange: (v: string) => void;
  allowAll?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Select aria-label={t('academic.year')} className="w-full sm:w-48" value={value} onChange={(e) => onChange(e.target.value)}>
      {allowAll && <option value="">{t('academic.allYears')}</option>}
      {years.map((y) => (
        <option key={y.id} value={y.id}>
          {y.label}
          {y.isCurrent ? ` · ${t('academic.current')}` : ''}
        </option>
      ))}
    </Select>
  );
}

function DateRange({ from, to }: { from: string; to: string }) {
  const { i18n } = useTranslation();
  if (from === to) return <span className="tabular whitespace-nowrap">{formatDate(from, i18n.language)}</span>;
  return (
    <span className="tabular whitespace-nowrap">
      {formatDate(from, i18n.language)} – {formatDate(to, i18n.language)}
    </span>
  );
}

const ActiveBadge = ({ active }: { active: boolean }) => {
  const { t } = useTranslation();
  return (
    <Badge tone={active ? 'ok' : 'neutral'} dot>
      {active ? t('academic.active') : t('academic.retired')}
    </Badge>
  );
};

// Years and terms ----------------------------------------------------------
function YearsTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const canManage = useCanManage();
  const { years, current, reload } = useYears();
  const [version, setVersion] = useState(0);
  const [yearId, setYearId] = useState('');
  const [rolloverTo, setRolloverTo] = useState<Year | null>(null);
  useEffect(() => {
    if (!yearId && current) setYearId(String(current.id));
  }, [current, yearId]);

  const makeCurrent = async (y: Year) => {
    try {
      await api(`/academic-years/${y.id}/current`, { method: 'POST' });
      toast.success(t('academic.years.nowCurrent', { year: y.label }));
      setVersion((v) => v + 1);
      reload();
    } catch (e) {
      toast.error(t((e as Error).message));
    }
  };

  return (
    <div className="space-y-10">
      <CrudSection<Year>
        key={`years-${version}`}
        title={t('academic.years.title')}
        intro={t('academic.years.intro')}
        listPath="/academic-years"
        createPath="/academic-years"
        itemPath={(id) => `/academic-years/${id}`}
        noun={t('academic.years.noun')}
        emptyText={t('academic.years.empty')}
        emptyHelp={t('academic.years.emptyHelp')}
        canManage={canManage}
        onChanged={reload}
        columns={[
          {
            label: t('academic.label'),
            render: (y) => (
              <span className="inline-flex flex-wrap items-center gap-2">
                <span className="font-medium">{y.label}</span>
                {y.isCurrent && <Badge tone="brand">{t('academic.current')}</Badge>}
              </span>
            ),
          },
          { label: t('academic.dates'), render: (y) => <DateRange from={y.startsOn} to={y.endsOn} /> },
          {
            label: t('academic.length'),
            render: (y) => t('academic.weeks', { count: Math.round(daysBetween(y.startsOn, y.endsOn) / 7) }),
            wide: true,
          },
        ]}
        extraActions={(y) =>
          canManage
            ? [
                ...(!y.isCurrent
                  ? [
                      {
                        label: t('academic.years.makeCurrent'),
                        icon: <CalendarCheck className="size-4" />,
                        onSelect: () => void makeCurrent(y),
                      },
                    ]
                  : []),
                ...(years.length > 1
                  ? [{ label: t('academic.rollover.action'), icon: <CopyPlus className="size-4" />, onSelect: () => setRolloverTo(y) }]
                  : []),
              ]
            : []
        }
        fields={[
          { name: 'label', label: t('academic.label'), type: 'text', hint: t('academic.years.labelHint'), required: true },
          { name: 'startsOn', label: t('academic.startsOn'), type: 'date', required: true, half: true },
          { name: 'endsOn', label: t('academic.endsOn'), type: 'date', required: true, half: true },
          {
            name: 'isCurrent',
            label: t('academic.years.isCurrent'),
            hint: t('academic.years.isCurrentHint'),
            type: 'checkbox',
            createOnly: true,
          },
        ]}
        toValues={(y) => ({ label: y.label, startsOn: y.startsOn, endsOn: y.endsOn })}
      />

      {years.length > 0 && (
        <CrudSection<Term>
          key={`terms-${yearId}`}
          title={t('academic.terms.title')}
          intro={t('academic.terms.intro')}
          filters={<YearFilter years={years} value={yearId} onChange={setYearId} />}
          listPath={yearId ? `/academic-years/${yearId}/terms` : null}
          createPath={`/academic-years/${yearId}/terms`}
          itemPath={(id) => `/terms/${id}`}
          noun={t('academic.terms.noun')}
          emptyText={t('academic.terms.empty')}
          emptyHelp={t('academic.terms.emptyHelp')}
          canManage={canManage}
          columns={[
            { label: t('academic.label'), render: (x) => <span className="font-medium">{x.label}</span> },
            { label: t('academic.dates'), render: (x) => <DateRange from={x.startsOn} to={x.endsOn} /> },
            {
              label: t('academic.length'),
              render: (x) => t('academic.weeks', { count: Math.round(daysBetween(x.startsOn, x.endsOn) / 7) }),
              wide: true,
            },
          ]}
          fields={[
            { name: 'label', label: t('academic.label'), type: 'text', hint: t('academic.terms.labelHint'), required: true },
            { name: 'sequence', label: t('academic.sequence'), type: 'number', hint: t('academic.terms.sequenceHint'), required: true },
            { name: 'startsOn', label: t('academic.startsOn'), type: 'date', required: true, half: true },
            { name: 'endsOn', label: t('academic.endsOn'), type: 'date', required: true, half: true },
          ]}
          toValues={(x) => ({ label: x.label, sequence: String(x.sequence), startsOn: x.startsOn, endsOn: x.endsOn })}
        />
      )}
      {rolloverTo && <RolloverDrawer target={rolloverTo} years={years} onClose={() => setRolloverTo(null)} />}
    </div>
  );
}

interface RolloverPlan {
  dryRun: boolean;
  created: Array<{ grade: { id: number; name: string }; name: string; homeRoomDropped: boolean }>;
  skipped: Array<{ grade: { id: number; name: string }; name: string; reason: 'exists' | 'grade_inactive' }>;
}

/** Copy class sections from another year into `target`: preview first (dry run), then apply. */
function RolloverDrawer({ target, years, onClose }: { target: Year; years: Year[]; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const sources = years.filter((y) => y.id !== target.id);
  // Default to the most recent year that starts before the target, else any other year.
  const [fromId, setFromId] = useState(() => String((sources.find((y) => y.startsOn < target.startsOn) ?? sources[0])?.id ?? ''));
  const [plan, setPlan] = useState<RolloverPlan | null>(null);
  const preview = useSubmit();
  const apply = useSubmit();

  useEffect(() => {
    if (!fromId) return;
    setPlan(null);
    let live = true;
    void preview
      .run(() =>
        api<RolloverPlan>(`/academic-years/${target.id}/rollover`, {
          method: 'POST',
          body: { fromAcademicYearId: Number(fromId), dryRun: true },
        }),
      )
      .then((p) => live && p && setPlan(p));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- preview.run is stable; rerun only when the source changes
  }, [fromId, target.id]);

  async function run() {
    const res = await apply.run(() =>
      api<RolloverPlan>(`/academic-years/${target.id}/rollover`, { method: 'POST', body: { fromAcademicYearId: Number(fromId) } }),
    );
    if (res) {
      toast.success(t('academic.rollover.done', { count: res.created.length, year: target.label }));
      onClose();
    }
  }

  return (
    <Drawer
      open
      title={t('academic.rollover.title', { year: target.label })}
      description={t('academic.rollover.intro')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" busy={apply.busy} disabled={!plan || plan.created.length === 0} onClick={() => void run()}>
            {t('academic.rollover.confirm', { count: plan?.created.length ?? 0 })}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-[0.8125rem] font-medium">{t('academic.rollover.from')}</span>
          <Select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {sources.map((y) => (
              <option key={y.id} value={y.id}>
                {y.label}
              </option>
            ))}
          </Select>
        </label>
        {(preview.error || apply.error) && <Alert>{apply.error ?? preview.error}</Alert>}
        {!plan ? (
          preview.busy && <Loading />
        ) : plan.created.length === 0 && plan.skipped.length === 0 ? (
          <Alert tone="info">{t('academic.rollover.nothing')}</Alert>
        ) : (
          <>
            <p className="text-[0.8125rem] text-fg-muted">{t('academic.rollover.willCreate', { count: plan.created.length })}</p>
            {plan.created.length > 0 && (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {plan.created.map((c) => (
                  <li key={`${c.grade.id}-${c.name}`} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2">
                    <span>
                      {c.grade.name} / {c.name}
                    </span>
                    {c.homeRoomDropped && <Badge tone="warn">{t('academic.rollover.roomDropped')}</Badge>}
                  </li>
                ))}
              </ul>
            )}
            {plan.skipped.length > 0 && (
              <>
                <p className="text-[0.8125rem] text-fg-muted">{t('academic.rollover.willSkip', { count: plan.skipped.length })}</p>
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {plan.skipped.map((c) => (
                    <li
                      key={`${c.grade.id}-${c.name}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 text-fg-muted"
                    >
                      <span>
                        {c.grade.name} / {c.name}
                      </span>
                      <Badge>{t(`academic.rollover.reason.${c.reason}`)}</Badge>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="text-[0.8125rem] text-fg-muted">{t('academic.rollover.note')}</p>
          </>
        )}
      </div>
    </Drawer>
  );
}

// Grades and their subjects ---------------------------------------------------
function GradesTab() {
  const { t } = useTranslation();
  const canManage = useCanManage();
  const [subjectsFor, setSubjectsFor] = useState<Grade | null>(null);
  return (
    <>
      <CrudSection<Grade>
        title={t('academic.grades.title')}
        intro={t('academic.grades.intro')}
        listPath="/grades"
        createPath="/grades"
        itemPath={(id) => `/grades/${id}`}
        noun={t('academic.grades.noun')}
        emptyText={t('academic.grades.empty')}
        emptyHelp={t('academic.grades.emptyHelp')}
        canManage={canManage}
        searchText={(g) => g.name}
        columns={[
          { label: t('academic.name'), render: (g) => <span className="font-medium">{g.name}</span> },
          { label: t('academic.grades.level'), render: (g) => <span className="tabular">{g.level}</span> },
          { label: t('academic.status'), render: (g) => <ActiveBadge active={g.isActive} />, wide: true },
        ]}
        extraActions={(g) => [
          { label: t('academic.grades.manageSubjects'), icon: <ListChecks className="size-4" />, onSelect: () => setSubjectsFor(g) },
        ]}
        fields={[
          { name: 'name', label: t('academic.name'), type: 'text', hint: t('academic.grades.nameHint'), required: true },
          { name: 'level', label: t('academic.grades.level'), type: 'number', hint: t('academic.grades.levelHint'), required: true },
          { name: 'isActive', label: t('academic.inUse'), hint: t('academic.inUseHint'), type: 'checkbox', initial: true },
        ]}
        toValues={(g) => ({ name: g.name, level: String(g.level), isActive: g.isActive })}
      />
      {subjectsFor && <GradeSubjectsDrawer grade={subjectsFor} canManage={canManage} onClose={() => setSubjectsFor(null)} />}
    </>
  );
}

function GradeSubjectsDrawer({ grade, canManage, onClose }: { grade: Grade; canManage: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const subjects = useResource<{ items: Subject[] }>('/subjects');
  const current = useResource<{ items: Array<{ subject: Subject; isOptional: boolean }> }>(`/grades/${grade.id}/subjects`);
  const [chosen, setChosen] = useState<Map<number, boolean> | null>(null);
  const submit = useSubmit();

  useEffect(() => {
    if (current.data && chosen === null) setChosen(new Map(current.data.items.map((i) => [i.subject.id, i.isOptional])));
  }, [current.data, chosen]);

  const toggle = (id: number, on: boolean) =>
    setChosen((m) => {
      const next = new Map(m);
      if (on) next.set(id, false);
      else next.delete(id);
      return next;
    });

  async function save() {
    const body = { subjects: [...(chosen ?? new Map())].map(([subjectId, isOptional]) => ({ subjectId, isOptional })) };
    const ok = await submit.run(() => api(`/grades/${grade.id}/subjects`, { method: 'PUT', body }));
    if (ok) {
      toast.success(t('academic.grades.subjectsSaved', { grade: grade.name }));
      onClose();
    }
  }

  const available = (subjects.data?.items ?? []).filter((s) => s.isActive || chosen?.has(s.id));
  return (
    <Drawer
      open
      title={t('academic.grades.subjectsFor', { grade: grade.name })}
      description={t('academic.grades.subjectsIntro')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{canManage ? t('common.cancel') : t('common.close')}</Button>
          {canManage && (
            <Button variant="primary" busy={submit.busy} onClick={() => void save()} disabled={!chosen}>
              {t('common.saveChanges')}
            </Button>
          )}
        </>
      }
    >
      {!chosen || !subjects.data ? (
        <Loading />
      ) : available.length === 0 ? (
        <Alert tone="info">{t('academic.grades.noSubjectsYet')}</Alert>
      ) : (
        <div className="space-y-4">
          {submit.error && <Alert>{submit.error}</Alert>}
          <p className="text-[0.8125rem] text-fg-muted">{t('academic.grades.selectedCount', { count: chosen.size })}</p>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {available.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-4 px-3.5">
                <Checkbox
                  label={s.name}
                  description={[s.code, s.nameSi, s.nameTa].filter(Boolean).join(' · ')}
                  checked={chosen.has(s.id)}
                  disabled={!canManage}
                  onChange={(e) => toggle(s.id, e.target.checked)}
                />
                {chosen.has(s.id) && (
                  <Checkbox
                    label={t('academic.grades.optional')}
                    checked={chosen.get(s.id) === true}
                    disabled={!canManage}
                    onChange={(e) => setChosen((m) => new Map(m).set(s.id, e.target.checked))}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Drawer>
  );
}

// Subjects -------------------------------------------------------------------
function SubjectsTab() {
  const { t } = useTranslation();
  return (
    <CrudSection<Subject>
      title={t('academic.subjects.title')}
      intro={t('academic.subjects.intro')}
      listPath="/subjects"
      createPath="/subjects"
      itemPath={(id) => `/subjects/${id}`}
      noun={t('academic.subjects.noun')}
      emptyText={t('academic.subjects.empty')}
      emptyHelp={t('academic.subjects.emptyHelp')}
      canManage={useCanManage()}
      searchText={(s) => [s.code, s.name, s.nameSi, s.nameTa].filter(Boolean).join(' ')}
      columns={[
        {
          label: t('academic.name'),
          render: (s) => (
            <>
              <span className="font-medium">{s.name}</span>
              {(s.nameSi || s.nameTa) && (
                <span className="block text-[0.8125rem] text-fg-muted">{[s.nameSi, s.nameTa].filter(Boolean).join(' · ')}</span>
              )}
            </>
          ),
        },
        { label: t('academic.subjects.code'), render: (s) => <code className="rounded bg-subtle px-1.5 py-0.5 text-xs">{s.code}</code> },
        { label: t('academic.status'), render: (s) => <ActiveBadge active={s.isActive} />, wide: true },
      ]}
      fields={[
        { name: 'name', label: t('academic.subjects.nameEn'), type: 'text', required: true },
        { name: 'code', label: t('academic.subjects.code'), type: 'text', hint: t('academic.subjects.codeHint'), required: true },
        { name: 'nameSi', label: t('academic.subjects.nameSi'), type: 'text', nullable: true, half: true },
        { name: 'nameTa', label: t('academic.subjects.nameTa'), type: 'text', nullable: true, half: true },
        { name: 'isActive', label: t('academic.inUse'), hint: t('academic.inUseHint'), type: 'checkbox', initial: true },
      ]}
      toValues={(s) => ({ code: s.code, name: s.name, nameSi: s.nameSi ?? '', nameTa: s.nameTa ?? '', isActive: s.isActive })}
    />
  );
}

// Class sections -------------------------------------------------------------
function ClassesTab() {
  const { t } = useTranslation();
  const canManage = useCanManage();
  const { years, current, loading } = useYears();
  const grades = useResource<{ items: Grade[] }>('/grades');
  const rooms = useResource<{ items: Room[] }>('/rooms');
  const [yearId, setYearId] = useState('');
  const [gradeId, setGradeId] = useState('');
  useEffect(() => {
    if (!yearId && current) setYearId(String(current.id));
  }, [current, yearId]);

  const gradeOptions = useMemo(
    () => (grades.data?.items ?? []).filter((g) => g.isActive).map((g) => ({ value: String(g.id), label: g.name })),
    [grades.data],
  );
  const roomOptions = useMemo(
    () => (rooms.data?.items ?? []).filter((r) => r.isActive).map((r) => ({ value: String(r.id), label: r.name })),
    [rooms.data],
  );

  if (!loading && years.length === 0) return <Alert tone="info" title={t('academic.classes.needYear')} />;
  return (
    <CrudSection<Section>
      key={`${yearId}-${gradeId}`}
      title={t('academic.classes.title')}
      intro={t('academic.classes.intro')}
      searchText={(c) => `${c.grade.name} ${c.name} ${c.homeRoom?.name ?? ''}`}
      filters={
        <>
          <YearFilter years={years} value={yearId} onChange={setYearId} />
          <Select aria-label={t('academic.grade')} className="w-full sm:w-44" value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
            <option value="">{t('academic.allGrades')}</option>
            {(grades.data?.items ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </>
      }
      listPath={yearId ? `/class-sections${query({ academicYearId: yearId, gradeId })}` : null}
      createPath="/class-sections"
      itemPath={(id) => `/class-sections/${id}`}
      noun={t('academic.classes.noun')}
      emptyText={t('academic.classes.empty')}
      emptyHelp={t('academic.classes.emptyHelp')}
      canManage={canManage}
      columns={[
        {
          label: t('academic.classes.class'),
          render: (c) => (
            <span className="font-medium">
              {c.grade.name} {c.name}
            </span>
          ),
        },
        {
          label: t('academic.classes.medium'),
          render: (c) => (c.medium ? <Badge tone="neutral">{t(`language.${c.medium}`)}</Badge> : '—'),
        },
        { label: t('academic.classes.homeRoom'), render: (c) => c.homeRoom?.name ?? '—', wide: true },
        { label: t('academic.capacity'), render: (c) => <span className="tabular">{c.capacity ?? '—'}</span>, wide: true },
      ]}
      fields={[
        {
          name: 'academicYearId',
          label: t('academic.year'),
          type: 'select',
          numeric: true,
          required: true,
          createOnly: true,
          initial: yearId,
          half: true,
          options: years.map((y) => ({ value: String(y.id), label: y.label })),
        },
        {
          name: 'gradeId',
          label: t('academic.grade'),
          type: 'select',
          numeric: true,
          required: true,
          createOnly: true,
          initial: gradeId,
          half: true,
          options: gradeOptions,
        },
        {
          name: 'name',
          label: t('academic.classes.sectionName'),
          type: 'text',
          hint: t('academic.classes.sectionNameHint'),
          required: true,
        },
        {
          name: 'medium',
          label: t('academic.classes.medium'),
          type: 'select',
          nullable: true,
          half: true,
          options: LOCALES.map((l) => ({ value: l, label: t(`language.${l}`) })),
        },
        { name: 'capacity', label: t('academic.capacity'), type: 'number', nullable: true, half: true },
        { name: 'homeRoomId', label: t('academic.classes.homeRoom'), type: 'select', numeric: true, nullable: true, options: roomOptions },
      ]}
      toValues={(c) => ({ name: c.name, medium: c.medium ?? '', capacity: str(c.capacity), homeRoomId: str(c.homeRoom?.id) })}
    />
  );
}

// Rooms ----------------------------------------------------------------------
function RoomsTab() {
  const { t } = useTranslation();
  return (
    <CrudSection<Room>
      title={t('academic.rooms.title')}
      intro={t('academic.rooms.intro')}
      listPath="/rooms"
      createPath="/rooms"
      itemPath={(id) => `/rooms/${id}`}
      noun={t('academic.rooms.noun')}
      emptyText={t('academic.rooms.empty')}
      emptyHelp={t('academic.rooms.emptyHelp')}
      canManage={useCanManage()}
      searchText={(r) => r.name}
      columns={[
        { label: t('academic.name'), render: (r) => <span className="font-medium">{r.name}</span> },
        { label: t('academic.capacity'), render: (r) => <span className="tabular">{r.capacity ?? '—'}</span> },
        { label: t('academic.status'), render: (r) => <ActiveBadge active={r.isActive} />, wide: true },
      ]}
      fields={[
        { name: 'name', label: t('academic.name'), type: 'text', hint: t('academic.rooms.nameHint'), required: true },
        { name: 'capacity', label: t('academic.capacity'), type: 'number', nullable: true },
        { name: 'isActive', label: t('academic.inUse'), hint: t('academic.inUseHint'), type: 'checkbox', initial: true },
      ]}
      toValues={(r) => ({ name: r.name, capacity: str(r.capacity), isActive: r.isActive })}
    />
  );
}

// Bell schedule ----------------------------------------------------------------
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

function PeriodsTab() {
  const { t } = useTranslation();
  return (
    <CrudSection<Period>
      title={t('academic.periods.title')}
      intro={t('academic.periods.intro')}
      listPath="/periods"
      createPath="/periods"
      itemPath={(id) => `/periods/${id}`}
      noun={t('academic.periods.noun')}
      emptyText={t('academic.periods.empty')}
      emptyHelp={t('academic.periods.emptyHelp')}
      canManage={useCanManage()}
      columns={[
        {
          label: t('academic.label'),
          render: (p) => (
            <span className="inline-flex items-center gap-2">
              <span className={p.isBreak ? 'text-fg-muted' : 'font-medium'}>{p.label}</span>
              {p.isBreak && <Badge tone="warn">{t('academic.periods.break')}</Badge>}
            </span>
          ),
        },
        {
          label: t('academic.periods.time'),
          render: (p) => (
            <span className="tabular whitespace-nowrap">
              {p.startsAt} – {p.endsAt}
            </span>
          ),
        },
        {
          label: t('academic.periods.duration'),
          render: (p) => t('academic.periods.minutes', { count: minutes(p.endsAt) - minutes(p.startsAt) }),
          wide: true,
        },
      ]}
      fields={[
        { name: 'label', label: t('academic.label'), type: 'text', hint: t('academic.periods.labelHint'), required: true },
        { name: 'sequence', label: t('academic.sequence'), type: 'number', hint: t('academic.periods.sequenceHint'), required: true },
        { name: 'startsAt', label: t('academic.periods.startsAt'), type: 'time', required: true, half: true },
        { name: 'endsAt', label: t('academic.periods.endsAt'), type: 'time', required: true, half: true },
        { name: 'isBreak', label: t('academic.periods.isBreak'), type: 'checkbox' },
      ]}
      toValues={(p) => ({ label: p.label, sequence: String(p.sequence), startsAt: p.startsAt, endsAt: p.endsAt, isBreak: p.isBreak })}
    />
  );
}

// Calendar -------------------------------------------------------------------
const KIND_TONE: Record<string, 'danger' | 'warn' | 'brand' | 'neutral'> = {
  holiday: 'danger',
  term_break: 'warn',
  exam: 'brand',
  event: 'neutral',
};

function CalendarTab() {
  const { t } = useTranslation();
  const { years, current } = useYears();
  const [yearId, setYearId] = useState('');
  useEffect(() => {
    if (!yearId && current) setYearId(String(current.id));
  }, [current, yearId]);

  return (
    <CrudSection<CalendarEvent>
      key={yearId}
      title={t('academic.calendar.title')}
      intro={t('academic.calendar.intro')}
      filters={<YearFilter years={years} value={yearId} onChange={setYearId} allowAll />}
      searchText={(e) => e.title}
      listPath={`/calendar-events${query({ academicYearId: yearId })}`}
      createPath="/calendar-events"
      itemPath={(id) => `/calendar-events/${id}`}
      noun={t('academic.calendar.noun')}
      emptyText={t('academic.calendar.empty')}
      emptyHelp={t('academic.calendar.emptyHelp')}
      canManage={useCanManage()}
      columns={[
        { label: t('academic.calendar.event'), render: (e) => <span className="font-medium">{e.title}</span> },
        { label: t('academic.dates'), render: (e) => <DateRange from={e.startsOn} to={e.endsOn} /> },
        {
          label: t('academic.calendar.kind'),
          render: (e) => <Badge tone={KIND_TONE[e.kind] ?? 'neutral'}>{t(`academic.calendar.kinds.${e.kind}`)}</Badge>,
        },
        {
          label: t('academic.calendar.schoolDay'),
          render: (e) =>
            e.isSchoolDay ? (
              <span className="text-fg-muted">{t('common.yes')}</span>
            ) : (
              <span className="text-fg-muted">{t('academic.calendar.closed')}</span>
            ),
          wide: true,
        },
      ]}
      fields={[
        { name: 'title', label: t('academic.calendar.event'), type: 'text', required: true },
        {
          name: 'kind',
          label: t('academic.calendar.kind'),
          type: 'select',
          required: true,
          initial: 'holiday',
          half: true,
          options: CALENDAR_EVENT_KINDS.map((k) => ({ value: k, label: t(`academic.calendar.kinds.${k}`) })),
        },
        {
          name: 'academicYearId',
          label: t('academic.year'),
          type: 'select',
          numeric: true,
          nullable: true,
          initial: yearId,
          half: true,
          hint: t('academic.calendar.yearHint'),
          options: years.map((y) => ({ value: String(y.id), label: y.label })),
        },
        { name: 'startsOn', label: t('academic.calendar.firstDay'), type: 'date', required: true, half: true },
        { name: 'endsOn', label: t('academic.calendar.endsOnInclusive'), type: 'date', required: true, half: true },
        { name: 'isSchoolDay', label: t('academic.calendar.isSchoolDay'), hint: t('academic.calendar.isSchoolDayHint'), type: 'checkbox' },
      ]}
      toValues={(e) => ({
        title: e.title,
        kind: e.kind,
        startsOn: e.startsOn,
        endsOn: e.endsOn,
        isSchoolDay: e.isSchoolDay,
        academicYearId: str(e.academicYearId),
      })}
    />
  );
}
