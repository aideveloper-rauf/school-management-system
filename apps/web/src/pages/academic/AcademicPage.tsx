import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CALENDAR_EVENT_KINDS, LOCALES } from '@sms/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { query, useResource, useSubmit } from '../../lib/data';
import { formatDate } from '../../lib/format';
import { CrudSection } from '../../components/CrudSection';
import { Alert, Button, Checkbox, Dialog, Field, FormActions, Loading, PageHeader, SelectInput, StatusBadge } from '../../components/ui';

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

const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

export default function AcademicPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'years';

  return (
    <>
      <PageHeader title={t('academic.title')} intro={t('academic.intro')} />
      {/* Index tabs along the page edge, like the dividers in a register. */}
      <nav aria-label={t('academic.sections')} className="-mt-2 mb-6 overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b border-rule">
          {TABS.map((k) => (
            <li key={k}>
              <button
                type="button"
                aria-current={tab === k ? 'page' : undefined}
                // Keep the selected tab visible in the scrollable strip on phones.
                ref={tab === k ? (el) => el?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) : undefined}
                onClick={() => setParams({ tab: k }, { replace: true })}
                className={`-mb-px rounded-t-md border px-4 py-2 text-sm ${
                  tab === k
                    ? 'border-rule border-b-sheet bg-sheet font-medium text-spine'
                    : 'border-transparent text-ink-soft hover:text-ink'
                }`}
              >
                {t(`academic.tabs.${k}`)}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {tab === 'years' && <YearsTab />}
      {tab === 'grades' && <GradesTab />}
      {tab === 'subjects' && <SubjectsTab />}
      {tab === 'classes' && <ClassesTab />}
      {tab === 'rooms' && <RoomsTab />}
      {tab === 'periods' && <PeriodsTab />}
      {tab === 'calendar' && <CalendarTab />}
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

function YearSelect({
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
    <div className="max-w-xs">
      <Field label={t('academic.year')}>
        {(id) => (
          <SelectInput id={id} value={value} onChange={(e) => onChange(e.target.value)}>
            {allowAll && <option value="">{t('academic.allYears')}</option>}
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.label}
                {y.isCurrent ? ` (${t('academic.current')})` : ''}
              </option>
            ))}
          </SelectInput>
        )}
      </Field>
    </div>
  );
}

function DateRange({ from, to }: { from: string; to: string }) {
  const { i18n } = useTranslation();
  return (
    <span className="whitespace-nowrap">
      {formatDate(from, i18n.language)} – {formatDate(to, i18n.language)}
    </span>
  );
}

// Years and terms ----------------------------------------------------------
function YearsTab() {
  const { t } = useTranslation();
  const canManage = useCanManage();
  const { years, current, reload } = useYears();
  const [version, setVersion] = useState(0);
  const [yearId, setYearId] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!yearId && current) setYearId(String(current.id));
  }, [current, yearId]);

  const makeCurrent = async (y: Year) => {
    setError(null);
    try {
      await api(`/academic-years/${y.id}/current`, { method: 'POST' });
      setVersion((v) => v + 1);
      reload();
    } catch (e) {
      setError(t((e as Error).message));
    }
  };

  return (
    <div className="space-y-10">
      {error && <Alert>{error}</Alert>}
      <CrudSection<Year>
        key={`years-${version}`}
        title={t('academic.years.title')}
        intro={t('academic.years.intro')}
        listPath="/academic-years"
        createPath="/academic-years"
        itemPath={(id) => `/academic-years/${id}`}
        noun={t('academic.years.noun')}
        emptyText={t('academic.years.empty')}
        canManage={canManage}
        onChanged={reload}
        columns={[
          {
            label: t('academic.label'),
            render: (y) => (
              <span className="inline-flex flex-wrap items-center gap-2">
                <span className="font-medium">{y.label}</span>
                {y.isCurrent && <StatusBadge tone="ok">{t('academic.current')}</StatusBadge>}
              </span>
            ),
          },
          { label: t('academic.dates'), render: (y) => <DateRange from={y.startsOn} to={y.endsOn} /> },
        ]}
        rowExtra={(y) =>
          canManage && !y.isCurrent ? (
            <Button variant="ghost" onClick={() => void makeCurrent(y)}>
              {t('academic.years.makeCurrent')}
            </Button>
          ) : null
        }
        fields={[
          { name: 'label', label: t('academic.label'), type: 'text', hint: t('academic.years.labelHint'), required: true },
          { name: 'startsOn', label: t('academic.startsOn'), type: 'date', required: true },
          { name: 'endsOn', label: t('academic.endsOn'), type: 'date', required: true },
          { name: 'isCurrent', label: t('academic.years.isCurrent'), type: 'checkbox', createOnly: true },
        ]}
        toValues={(y) => ({ label: y.label, startsOn: y.startsOn, endsOn: y.endsOn })}
      />

      {years.length > 0 && (
        <CrudSection<Term>
          key={`terms-${yearId}`}
          title={t('academic.terms.title')}
          intro={t('academic.terms.intro')}
          filters={<YearSelect years={years} value={yearId} onChange={setYearId} />}
          listPath={yearId ? `/academic-years/${yearId}/terms` : null}
          createPath={`/academic-years/${yearId}/terms`}
          itemPath={(id) => `/terms/${id}`}
          noun={t('academic.terms.noun')}
          emptyText={t('academic.terms.empty')}
          canManage={canManage}
          columns={[
            { label: t('academic.label'), render: (x) => <span className="font-medium">{x.label}</span> },
            { label: t('academic.dates'), render: (x) => <DateRange from={x.startsOn} to={x.endsOn} /> },
            { label: t('academic.sequence'), render: (x) => x.sequence, wide: true },
          ]}
          fields={[
            { name: 'label', label: t('academic.label'), type: 'text', required: true },
            { name: 'sequence', label: t('academic.sequence'), type: 'number', hint: t('academic.terms.sequenceHint'), required: true },
            { name: 'startsOn', label: t('academic.startsOn'), type: 'date', required: true },
            { name: 'endsOn', label: t('academic.endsOn'), type: 'date', required: true },
          ]}
          toValues={(x) => ({ label: x.label, sequence: String(x.sequence), startsOn: x.startsOn, endsOn: x.endsOn })}
        />
      )}
    </div>
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
        canManage={canManage}
        columns={[
          { label: t('academic.name'), render: (g) => <span className="font-medium">{g.name}</span> },
          { label: t('academic.grades.level'), render: (g) => g.level, wide: true },
          {
            label: t('academic.status'),
            render: (g) => (
              <StatusBadge tone={g.isActive ? 'ok' : 'muted'}>{g.isActive ? t('academic.active') : t('academic.retired')}</StatusBadge>
            ),
            wide: true,
          },
        ]}
        rowExtra={(g) => (
          <Button variant="ghost" onClick={() => setSubjectsFor(g)}>
            {t('academic.grades.subjects')}
          </Button>
        )}
        fields={[
          { name: 'name', label: t('academic.name'), type: 'text', hint: t('academic.grades.nameHint'), required: true },
          { name: 'level', label: t('academic.grades.level'), type: 'number', hint: t('academic.grades.levelHint'), required: true },
          { name: 'isActive', label: t('academic.inUse'), type: 'checkbox', initial: true },
        ]}
        toValues={(g) => ({ name: g.name, level: String(g.level), isActive: g.isActive })}
      />
      {subjectsFor && <GradeSubjectsDialog grade={subjectsFor} canManage={canManage} onClose={() => setSubjectsFor(null)} />}
    </>
  );
}

function GradeSubjectsDialog({ grade, canManage, onClose }: { grade: Grade; canManage: boolean; onClose: () => void }) {
  const { t } = useTranslation();
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
    if (ok) onClose();
  }

  const available = (subjects.data?.items ?? []).filter((s) => s.isActive || chosen?.has(s.id));
  return (
    <Dialog open title={t('academic.grades.subjectsFor', { grade: grade.name })} onClose={onClose}>
      {!chosen || !subjects.data ? (
        <Loading />
      ) : available.length === 0 ? (
        <p className="text-sm text-ink-soft">{t('academic.subjects.empty')}</p>
      ) : (
        <div className="space-y-4">
          {submit.error && <Alert>{submit.error}</Alert>}
          <p className="text-sm text-ink-soft">{t('academic.grades.subjectsIntro')}</p>
          <ul className="divide-y divide-rule border-y border-rule">
            {available.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-4">
                <Checkbox
                  label={`${s.name} (${s.code})`}
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
          <FormActions>
            <Button onClick={onClose}>{canManage ? t('common.cancel') : t('common.close')}</Button>
            {canManage && (
              <Button variant="primary" busy={submit.busy} onClick={() => void save()}>
                {t('common.saveChanges')}
              </Button>
            )}
          </FormActions>
        </div>
      )}
    </Dialog>
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
      canManage={useCanManage()}
      columns={[
        {
          label: t('academic.name'),
          render: (s) => (
            <>
              <span className="font-medium">{s.name}</span>
              {(s.nameSi || s.nameTa) && <span className="block text-ink-soft">{[s.nameSi, s.nameTa].filter(Boolean).join(' / ')}</span>}
            </>
          ),
        },
        { label: t('academic.subjects.code'), render: (s) => s.code },
        {
          label: t('academic.status'),
          render: (s) => (
            <StatusBadge tone={s.isActive ? 'ok' : 'muted'}>{s.isActive ? t('academic.active') : t('academic.retired')}</StatusBadge>
          ),
          wide: true,
        },
      ]}
      fields={[
        { name: 'code', label: t('academic.subjects.code'), type: 'text', hint: t('academic.subjects.codeHint'), required: true },
        { name: 'name', label: t('academic.subjects.nameEn'), type: 'text', required: true },
        { name: 'nameSi', label: t('academic.subjects.nameSi'), type: 'text', nullable: true },
        { name: 'nameTa', label: t('academic.subjects.nameTa'), type: 'text', nullable: true },
        { name: 'isActive', label: t('academic.inUse'), type: 'checkbox', initial: true },
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

  if (!loading && years.length === 0) return <Alert tone="info">{t('academic.classes.needYear')}</Alert>;
  return (
    <CrudSection<Section>
      key={`${yearId}-${gradeId}`}
      title={t('academic.classes.title')}
      intro={t('academic.classes.intro')}
      filters={
        <div className="flex flex-wrap gap-3">
          <YearSelect years={years} value={yearId} onChange={setYearId} />
          <div className="max-w-xs">
            <Field label={t('academic.grade')}>
              {(id) => (
                <SelectInput id={id} value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
                  <option value="">{t('academic.allGrades')}</option>
                  {(grades.data?.items ?? []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
          </div>
        </div>
      }
      listPath={yearId ? `/class-sections${query({ academicYearId: yearId, gradeId })}` : null}
      createPath="/class-sections"
      itemPath={(id) => `/class-sections/${id}`}
      noun={t('academic.classes.noun')}
      emptyText={t('academic.classes.empty')}
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
        { label: t('academic.classes.medium'), render: (c) => (c.medium ? t(`language.${c.medium}`) : '—') },
        { label: t('academic.classes.homeRoom'), render: (c) => c.homeRoom?.name ?? '—', wide: true },
        { label: t('academic.capacity'), render: (c) => c.capacity ?? '—', wide: true },
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
          options: LOCALES.map((l) => ({ value: l, label: t(`language.${l}`) })),
        },
        { name: 'capacity', label: t('academic.capacity'), type: 'number', nullable: true },
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
      canManage={useCanManage()}
      columns={[
        { label: t('academic.name'), render: (r) => <span className="font-medium">{r.name}</span> },
        { label: t('academic.capacity'), render: (r) => r.capacity ?? '—' },
        {
          label: t('academic.status'),
          render: (r) => (
            <StatusBadge tone={r.isActive ? 'ok' : 'muted'}>{r.isActive ? t('academic.active') : t('academic.retired')}</StatusBadge>
          ),
          wide: true,
        },
      ]}
      fields={[
        { name: 'name', label: t('academic.name'), type: 'text', required: true },
        { name: 'capacity', label: t('academic.capacity'), type: 'number', nullable: true },
        { name: 'isActive', label: t('academic.inUse'), type: 'checkbox', initial: true },
      ]}
      toValues={(r) => ({ name: r.name, capacity: str(r.capacity), isActive: r.isActive })}
    />
  );
}

// Bell schedule ----------------------------------------------------------------
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
      canManage={useCanManage()}
      columns={[
        {
          label: t('academic.label'),
          render: (p) => <span className={p.isBreak ? 'italic text-ink-soft' : 'font-medium'}>{p.label}</span>,
        },
        {
          label: t('academic.periods.time'),
          render: (p) => (
            <span className="tabular-nums">
              {p.startsAt} – {p.endsAt}
            </span>
          ),
        },
        { label: t('academic.sequence'), render: (p) => p.sequence, wide: true },
      ]}
      fields={[
        { name: 'label', label: t('academic.label'), type: 'text', hint: t('academic.periods.labelHint'), required: true },
        { name: 'sequence', label: t('academic.sequence'), type: 'number', required: true },
        { name: 'startsAt', label: t('academic.periods.startsAt'), type: 'time', required: true },
        { name: 'endsAt', label: t('academic.periods.endsAt'), type: 'time', required: true },
        { name: 'isBreak', label: t('academic.periods.isBreak'), type: 'checkbox' },
      ]}
      toValues={(p) => ({ label: p.label, sequence: String(p.sequence), startsAt: p.startsAt, endsAt: p.endsAt, isBreak: p.isBreak })}
    />
  );
}

// Calendar -------------------------------------------------------------------
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
      filters={<YearSelect years={years} value={yearId} onChange={setYearId} allowAll />}
      listPath={`/calendar-events${query({ academicYearId: yearId })}`}
      createPath="/calendar-events"
      itemPath={(id) => `/calendar-events/${id}`}
      noun={t('academic.calendar.noun')}
      emptyText={t('academic.calendar.empty')}
      canManage={useCanManage()}
      columns={[
        { label: t('academic.dates'), render: (e) => <DateRange from={e.startsOn} to={e.endsOn} /> },
        { label: t('academic.calendar.event'), render: (e) => <span className="font-medium">{e.title}</span> },
        { label: t('academic.calendar.kind'), render: (e) => t(`academic.calendar.kinds.${e.kind}`), wide: true },
        {
          label: t('academic.calendar.schoolDay'),
          render: (e) => (e.isSchoolDay ? t('common.yes') : <StatusBadge tone="warn">{t('academic.calendar.closed')}</StatusBadge>),
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
          options: CALENDAR_EVENT_KINDS.map((k) => ({ value: k, label: t(`academic.calendar.kinds.${k}`) })),
        },
        { name: 'startsOn', label: t('academic.startsOn'), type: 'date', required: true },
        { name: 'endsOn', label: t('academic.calendar.endsOnInclusive'), type: 'date', required: true },
        { name: 'isSchoolDay', label: t('academic.calendar.isSchoolDay'), type: 'checkbox' },
        {
          name: 'academicYearId',
          label: t('academic.year'),
          type: 'select',
          numeric: true,
          nullable: true,
          initial: yearId,
          hint: t('academic.calendar.yearHint'),
          options: years.map((y) => ({ value: String(y.id), label: y.label })),
        },
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
