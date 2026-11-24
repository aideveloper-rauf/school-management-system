import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Plus, Printer, Trash2 } from 'lucide-react';
import type { Paginated } from '@sms/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { query, useResource, useSubmit } from '../../lib/data';
import { sectionLabel, useSections, useYears } from '../../lib/academic';
import { Alert, Button, Drawer, EmptyState, Field, Loading, PageHeader, Select, useToast } from '../../components/ui';
import type { StaffItem } from '../students/types';

interface Entry {
  id: number;
  dayOfWeek: number;
  period: { id: number; label: string; sequence: number; startsAt: string; endsAt: string };
  classSection: { id: number; name: string; gradeName: string };
  subject: { id: number; name: string; code: string };
  teacher: { id: number; fullName: string } | null;
  room: { id: number; name: string } | null;
}
interface Period {
  id: number;
  label: string;
  sequence: number;
  startsAt: string;
  endsAt: string;
  isBreak: boolean;
}
type View = 'mine' | 'class' | 'teacher' | 'room';

export default function TimetablePage() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const canManage = can('timetable.manage');
  const { years, current } = useYears();
  const [yearId, setYearId] = useState('');
  const [view, setView] = useState<View>(canManage ? 'class' : 'mine');
  const [target, setTarget] = useState('');
  const [editing, setEditing] = useState<{ day: number; period: Period; entry: Entry | null } | null>(null);
  const [showWeekend, setShowWeekend] = useState(false);
  useEffect(() => {
    if (!yearId && current) setYearId(String(current.id));
  }, [current, yearId]);

  const { sections } = useSections(view === 'class' ? yearId || null : null);
  const staff = useResource<Paginated<StaffItem>>(view === 'teacher' && can('staff.read') ? '/staff?status=active&pageSize=100' : null);
  const rooms = useResource<{ items: Array<{ id: number; name: string; isActive: boolean }> }>(view === 'room' ? '/rooms' : null);
  const periods = useResource<{ items: Period[] }>('/periods');
  const options = useMemo(() => {
    if (view === 'class') return sections.map((s) => ({ value: String(s.id), label: sectionLabel(s) }));
    if (view === 'teacher') return (staff.data?.items ?? []).map((s) => ({ value: String(s.id), label: s.fullName }));
    if (view === 'room') return (rooms.data?.items ?? []).filter((r) => r.isActive).map((r) => ({ value: String(r.id), label: r.name }));
    return [];
  }, [view, sections, staff.data, rooms.data]);
  useEffect(() => {
    if (view !== 'mine' && options.length && !options.some((o) => o.value === target)) setTarget(options[0]!.value);
  }, [options, target, view]);

  const key = view === 'class' ? 'classSectionId' : view === 'teacher' ? 'staffId' : 'roomId';
  const path = view === 'mine' ? '/me/timetable' : target ? `/timetable${query({ [key]: target, academicYearId: yearId })}` : null;
  const data = useResource<{ items: Entry[]; kind?: string }>(path);
  const entries = data.data?.items ?? [];
  const days = useMemo(() => {
    const base = [1, 2, 3, 4, 5];
    const used = new Set(entries.map((e) => e.dayOfWeek));
    return [1, 2, 3, 4, 5, 6, 7].filter((d) => base.includes(d) || used.has(d) || showWeekend);
  }, [entries, showWeekend]);
  const cell = (day: number, periodId: number) => entries.find((e) => e.dayOfWeek === day && e.period.id === periodId) ?? null;
  const editable = canManage && view === 'class' && !!target;
  const dayName = (d: number) => new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }).format(new Date(Date.UTC(2024, 0, d))); // 2024-01-01 was a Monday

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('nav.dashboard'), to: '/' }, { label: t('timetable.title') }]}
        title={t('timetable.title')}
        description={canManage ? t('timetable.introManage') : t('timetable.intro')}
        actions={
          <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>
            {t('attendance.print')}
          </Button>
        }
      />
      <div className="space-y-5">
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <Field label={t('timetable.view')}>
            {(id) => (
              <Select id={id} value={view} onChange={(e) => (setView(e.target.value as View), setTarget(''))}>
                <option value="mine">{t('timetable.views.mine')}</option>
                <option value="class">{t('timetable.views.class')}</option>
                {can('staff.read') && <option value="teacher">{t('timetable.views.teacher')}</option>}
                <option value="room">{t('timetable.views.room')}</option>
              </Select>
            )}
          </Field>
          {view !== 'mine' && (
            <>
              <Field label={t('academic.year')}>
                {(id) => (
                  <Select id={id} value={yearId} onChange={(e) => setYearId(e.target.value)}>
                    {years.map((y) => (
                      <option key={y.id} value={y.id}>
                        {y.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t(`timetable.views.${view}`)}>
                {(id) => (
                  <Select id={id} className="min-w-44" value={target} onChange={(e) => setTarget(e.target.value)}>
                    {options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </>
          )}
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-brand-600"
              checked={showWeekend}
              onChange={(e) => setShowWeekend(e.target.checked)}
            />
            {t('timetable.showWeekend')}
          </label>
        </div>

        {data.error && <Alert>{t(data.error.message)}</Alert>}
        {(periods.data?.items.length ?? 0) === 0 && !periods.loading ? (
          <EmptyState
            icon={<CalendarClock className="size-5" />}
            title={t('timetable.noPeriods')}
            description={t('timetable.noPeriodsHelp')}
          />
        ) : view === 'mine' && data.data?.kind === 'none' ? (
          <EmptyState icon={<CalendarClock className="size-5" />} title={t('timetable.nothingMine')} />
        ) : !data.data || !periods.data ? (
          path ? (
            <Loading />
          ) : null
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full min-w-[40rem] table-fixed text-sm">
              <thead className="bg-subtle text-xs text-fg-muted">
                <tr>
                  <th className="w-28 px-3 py-2 text-left">{t('timetable.period')}</th>
                  {days.map((d) => (
                    <th key={d} className="px-2 py-2 text-left">
                      {dayName(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {periods.data.items.map((p) => (
                  <tr key={p.id} className={p.isBreak ? 'bg-subtle' : ''}>
                    <th className="px-3 py-2 text-left align-top font-normal">
                      <span className="block font-medium">{p.label}</span>
                      <span className="tabular text-xs text-fg-muted">
                        {p.startsAt.slice(0, 5)}–{p.endsAt.slice(0, 5)}
                      </span>
                    </th>
                    {days.map((d) => {
                      if (p.isBreak) return <td key={d} className="px-2 py-2 text-xs text-fg-faint" />;
                      const e = cell(d, p.id);
                      const content = e ? (
                        <span className="block rounded-md bg-brand-50 px-2 py-1.5 text-left">
                          <span className="block truncate font-medium text-brand-900">{e.subject.name}</span>
                          <span className="block truncate text-xs text-fg-muted">
                            {[
                              view !== 'class' && `${e.classSection.gradeName} / ${e.classSection.name}`,
                              view !== 'teacher' && !(view === 'mine' && data.data?.kind === 'teacher') && e.teacher?.fullName,
                              view !== 'room' && e.room?.name,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                      ) : editable ? (
                        <span className="flex h-full min-h-10 items-center justify-center rounded-md border border-dashed border-line text-fg-faint print:hidden">
                          <Plus className="size-4" aria-hidden />
                          <span className="sr-only">{t('timetable.add')}</span>
                        </span>
                      ) : null;
                      return (
                        <td key={d} className="px-1.5 py-1.5 align-top">
                          {editable ? (
                            <button type="button" className="block w-full" onClick={() => setEditing({ day: d, period: p, entry: e })}>
                              {content}
                            </button>
                          ) : (
                            content
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && (
        <EntryDrawer
          classSectionId={Number(target)}
          day={editing.day}
          dayLabel={dayName(editing.day)}
          period={editing.period}
          entry={editing.entry}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            data.reload();
          }}
        />
      )}
    </>
  );
}

interface Assignment {
  id: number;
  staff: { id: number; fullName: string };
  subject: { id: number; name: string };
}

function EntryDrawer({
  classSectionId,
  day,
  dayLabel,
  period,
  entry,
  onClose,
  onDone,
}: {
  classSectionId: number;
  day: number;
  dayLabel: string;
  period: Period;
  entry: Entry | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const assignments = useResource<{ items: Assignment[] }>(`/teacher-assignments?classSectionId=${classSectionId}`);
  const section = useResource<{ grade: { id: number } }>(`/class-sections/${classSectionId}`);
  const subjects = useResource<{ items: Array<{ subject: { id: number; name: string } }> }>(
    section.data ? `/grades/${section.data.grade.id}/subjects` : null,
  );
  const rooms = useResource<{ items: Array<{ id: number; name: string; isActive: boolean }> }>('/rooms');
  const [subjectId, setSubjectId] = useState(entry ? String(entry.subject.id) : '');
  const [staffId, setStaffId] = useState(entry?.teacher ? String(entry.teacher.id) : '');
  const [roomId, setRoomId] = useState(entry?.room ? String(entry.room.id) : '');
  const submit = useSubmit();
  const teachers = (assignments.data?.items ?? []).filter((a) => String(a.subject.id) === subjectId);

  async function save() {
    const body = { subjectId: Number(subjectId), staffId: staffId ? Number(staffId) : null, roomId: roomId ? Number(roomId) : null };
    const ok = await submit.run(async () =>
      entry
        ? ((await api(`/timetable-entries/${entry.id}`, { method: 'PATCH', body })) ?? true)
        : api('/timetable-entries', { method: 'POST', body: { ...body, classSectionId, dayOfWeek: day, periodId: period.id } }),
    );
    if (ok) {
      toast.success(t('common.saved'));
      onDone();
    }
  }
  async function remove() {
    if (!entry) return;
    const ok = await submit.run(async () => (await api(`/timetable-entries/${entry.id}`, { method: 'DELETE' })) ?? true);
    if (ok) {
      toast.success(t('timetable.removed'));
      onDone();
    }
  }

  return (
    <Drawer
      open
      title={entry ? t('timetable.editTitle') : t('timetable.addTitle')}
      description={`${dayLabel} · ${period.label} (${period.startsAt.slice(0, 5)}–${period.endsAt.slice(0, 5)})`}
      onClose={onClose}
      footer={
        <>
          {entry && (
            <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>
              {t('timetable.remove')}
            </Button>
          )}
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" busy={submit.busy} disabled={!subjectId} onClick={() => void save()}>
            {t('common.saveChanges')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {submit.error && <Alert>{submit.error}</Alert>}
        <Field label={t('staff.subject')} error={submit.fieldErrors.subjectId}>
          {(id) => (
            <Select id={id} value={subjectId} onChange={(e) => (setSubjectId(e.target.value), setStaffId(''))}>
              <option value="" disabled>
                {t('crud.choose')}
              </option>
              {(subjects.data?.items ?? []).map((s) => (
                <option key={s.subject.id} value={s.subject.id}>
                  {s.subject.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={t('timetable.teacher')}
          hint={t('timetable.teacherHint')}
          optional={t('common.optional')}
          error={submit.fieldErrors.staffId}
        >
          {(id) => (
            <Select id={id} value={staffId} onChange={(e) => setStaffId(e.target.value)} disabled={!subjectId}>
              <option value="">{t('crud.none')}</option>
              {teachers.map((a) => (
                <option key={a.staff.id} value={a.staff.id}>
                  {a.staff.fullName}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('timetable.room')} optional={t('common.optional')} error={submit.fieldErrors.roomId}>
          {(id) => (
            <Select id={id} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">{t('crud.none')}</option>
              {(rooms.data?.items ?? [])
                .filter((r) => r.isActive || String(r.id) === roomId)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
      </div>
    </Drawer>
  );
}
