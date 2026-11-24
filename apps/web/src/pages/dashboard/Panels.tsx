import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Award, BookOpen, CalendarClock, ClipboardCheck, Megaphone } from 'lucide-react';
import type { Paginated } from '@sms/shared';
import { query, useResource } from '../../lib/data';
import { formatDate, formatDateTime } from '../../lib/format';
import { Badge, Card, Loading, Select } from '../../components/ui';

interface Lesson {
  id: number;
  dayOfWeek: number;
  period: { label: string; startsAt: string; endsAt: string; sequence: number };
  classSection: { name: string; gradeName: string };
  subject: { name: string };
  teacher: { fullName: string } | null;
  room: { name: string } | null;
}
/** ISO weekday of today in the browser (1 = Monday). */
const isoWeekday = () => ((new Date().getDay() + 6) % 7) + 1;

function TodayLessons({ studentId, teacher }: { studentId?: string; teacher?: boolean }) {
  const { t } = useTranslation();
  const tt = useResource<{ kind: string; items: Lesson[] }>(`/me/timetable${query({ studentId })}`);
  const lessons = (tt.data?.items ?? []).filter((l) => l.dayOfWeek === isoWeekday()).sort((a, b) => a.period.sequence - b.period.sequence);
  return (
    <Card
      title={t('portal.todayLessons')}
      actions={
        <Link className="text-[0.8125rem] text-brand-600 hover:underline" to="/timetable">
          {t('portal.fullWeek')}
        </Link>
      }
    >
      {!tt.data ? (
        <Loading />
      ) : lessons.length === 0 ? (
        <p className="text-sm text-fg-faint">{t('portal.noLessonsToday')}</p>
      ) : (
        <ol className="divide-y divide-line">
          {lessons.map((l) => (
            <li key={l.id} className="flex gap-3 py-2 text-sm">
              <span className="tabular w-24 shrink-0 text-fg-muted">
                {l.period.startsAt}–{l.period.endsAt}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{l.subject.name}</span>
                <span className="block text-[0.8125rem] text-fg-muted">
                  {teacher ? `${l.classSection.gradeName} / ${l.classSection.name}` : l.teacher?.fullName}
                  {l.room && ` · ${l.room.name}`}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** Teacher's day: registers to take and today's lessons. */
export function TeacherDay() {
  const { t } = useTranslation();
  const regs = useResource<{
    closure: string | null;
    items: Array<{ classSection: { id: number; name: string; gradeName: string }; taken: boolean; isClassTeacher: boolean }>;
  }>('/me/attendance-registers');
  const mine = (regs.data?.items ?? []).filter((r) => r.isClassTeacher);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title={t('portal.registersToday')} actions={<ClipboardCheck className="size-4 text-fg-faint" />}>
        {!regs.data ? (
          <Loading />
        ) : regs.data.closure ? (
          <p className="text-sm text-fg-muted">{t('attendance.closed', { title: regs.data.closure })}</p>
        ) : mine.length === 0 ? (
          <p className="text-sm text-fg-faint">{t('portal.noClassTeacher')}</p>
        ) : (
          <ul className="space-y-2">
            {mine.map((r) => (
              <li key={r.classSection.id} className="flex items-center justify-between gap-2 text-sm">
                <Link className="font-medium text-brand-600 hover:underline" to="/attendance">
                  {r.classSection.gradeName} / {r.classSection.name}
                </Link>
                <Badge tone={r.taken ? 'ok' : 'warn'} dot>
                  {r.taken ? t('portal.taken') : t('portal.notTaken')}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <TodayLessons teacher />
    </div>
  );
}

interface Child {
  id: number;
  fullName: string;
  admissionNo: string;
  currentClass: { name: string; gradeName: string } | null;
}

/** Student / guardian home: child switcher, attendance, work due, notices and released results. */
export function FamilyHome() {
  const { t, i18n } = useTranslation();
  const children = useResource<{ items: Child[] }>('/me/children');
  const [childId, setChildId] = useState('');
  useEffect(() => {
    if (!childId && children.data?.items.length) setChildId(String(children.data.items[0]!.id));
  }, [children.data, childId]);
  const child = children.data?.items.find((c) => String(c.id) === childId);
  const attendance = useResource<{
    items: Array<{ date: string; status: string }>;
    summary: { present: number; absent: number; late: number; excused: number };
  }>(childId ? `/me/attendance${query({ studentId: childId })}` : null);
  const work = useResource<
    Paginated<{ id: number; title: string; dueAt: string | null; subject: { name: string }; mySubmission: { status: string } | null }>
  >(childId ? `/learning-items${query({ kind: 'assignment', studentId: childId, pageSize: 20 })}` : null);
  const notices = useResource<Paginated<{ id: number; title: string; publishedAt: string | null; isRead: boolean }> & { unread: number }>(
    '/announcements?pageSize=3',
  );
  const results = useResource<{
    items: Array<{
      releaseId: number;
      series: { name: string };
      result: { average: number | null; rank: number | null };
      classSize: number;
    }>;
  }>(childId ? `/me/results${query({ studentId: childId })}` : null);

  if (children.data && children.data.items.length === 0) {
    return (
      <Card>
        <p className="text-sm text-fg-muted">{t('results.noChildren')}</p>
      </Card>
    );
  }
  const now = Date.now();
  const due = (work.data?.items ?? [])
    .filter((w) => !w.mySubmission && w.dueAt && new Date(w.dueAt).getTime() > now - 86_400_000)
    .slice(0, 5);
  const s = attendance.data?.summary;
  const marked = s ? s.present + s.absent + s.late + s.excused : 0;

  return (
    <div className="space-y-6">
      {(children.data?.items.length ?? 0) > 1 && (
        <Select aria-label={t('portal.child')} className="w-full sm:w-64" value={childId} onChange={(e) => setChildId(e.target.value)}>
          {children.data!.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.fullName}
            </option>
          ))}
        </Select>
      )}
      {child && (
        <p className="text-sm text-fg-muted">
          {child.fullName} · {child.admissionNo}
          {child.currentClass && ` · ${child.currentClass.gradeName} / ${child.currentClass.name}`}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('portal.attendance30')} actions={<ClipboardCheck className="size-4 text-fg-faint" />}>
          {!attendance.data ? (
            <Loading />
          ) : marked === 0 ? (
            <p className="text-sm text-fg-faint">{t('portal.noAttendance')}</p>
          ) : (
            <div className="space-y-3">
              <p className="text-2xl font-semibold tabular">{Math.round(((s!.present + s!.late) / marked) * 100)}%</p>
              <p className="text-[0.8125rem] text-fg-muted">
                {(['present', 'absent', 'late', 'excused'] as const).map((k) => `${t(`attendance.statuses.${k}`)} ${s![k]}`).join(' · ')}
              </p>
              {attendance.data.items.filter((i) => i.status === 'absent').length > 0 && (
                <p className="text-[0.8125rem]">
                  {t('portal.absentOn')}{' '}
                  {attendance.data.items
                    .filter((i) => i.status === 'absent')
                    .slice(0, 5)
                    .map((i) => formatDate(i.date, i18n.language))
                    .join(', ')}
                </p>
              )}
            </div>
          )}
        </Card>
        <TodayLessons studentId={childId} />
        <Card
          title={t('portal.workDue')}
          actions={
            <Link className="text-[0.8125rem] text-brand-600 hover:underline" to="/learning">
              {t('portal.allWork')}
            </Link>
          }
        >
          {!work.data ? (
            <Loading />
          ) : due.length === 0 ? (
            <p className="text-sm text-fg-faint">{t('portal.nothingDue')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {due.map((w) => (
                <li key={w.id} className="flex gap-2 py-2 text-sm">
                  <BookOpen className="mt-0.5 size-4 shrink-0 text-fg-faint" />
                  <span className="min-w-0">
                    <span className="block font-medium">{w.title}</span>
                    <span className="block text-[0.8125rem] text-fg-muted">
                      {w.subject.name} · {t('learning.due', { when: formatDateTime(w.dueAt, i18n.language) })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card
          title={t('portal.notices')}
          actions={
            <Link className="flex items-center gap-1.5 text-[0.8125rem] text-brand-600 hover:underline" to="/announcements">
              <Megaphone className="size-3.5" />
              {notices.data?.unread ? t('portal.unread', { count: notices.data.unread }) : t('portal.allNotices')}
            </Link>
          }
        >
          {!notices.data ? (
            <Loading />
          ) : notices.data.items.length === 0 ? (
            <p className="text-sm text-fg-faint">{t('announcements.empty')}</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {notices.data.items.map((n) => (
                <li key={n.id} className={n.isRead ? 'text-fg-muted' : 'font-medium'}>
                  {n.title}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card
          title={t('portal.latestResults')}
          actions={
            <Link className="flex items-center gap-1.5 text-[0.8125rem] text-brand-600 hover:underline" to="/results">
              <Award className="size-3.5" />
              {t('portal.allResults')}
            </Link>
          }
        >
          {!results.data ? (
            <Loading />
          ) : results.data.items.length === 0 ? (
            <p className="text-sm text-fg-faint">{t('results.none')}</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {results.data.items.slice(0, 3).map((r) => (
                <li key={r.releaseId} className="flex justify-between gap-2">
                  <span>{r.series.name}</span>
                  <span className="tabular text-fg-muted">
                    {t('exams.average')} {r.result.average ?? '—'}
                    {r.result.rank && ` · ${t('results.rankOf', { rank: r.result.rank, size: r.classSize })}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-fg-faint">
        <CalendarClock className="size-3.5" /> {t('portal.privacy')}
      </p>
    </div>
  );
}
