import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Circle,
  GraduationCap,
  Layers,
  MailPlus,
  UserCheck,
  UserPlus,
  CalendarPlus,
} from 'lucide-react';
import type { Paginated, UserItem } from '@sms/shared';
import { useAuth } from '../lib/auth';
import { query, useResource } from '../lib/data';
import { formatDate, todayIso, addDaysIso, daysBetween } from '../lib/format';
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '../components/ui';

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
  startsOn: string;
  endsOn: string;
}
interface CalendarEvent {
  id: number;
  title: string;
  kind: string;
  startsOn: string;
  endsOn: string;
  isSchoolDay: boolean;
}
type List<T> = { items: T[] };

function greetingKey(): string {
  const h = new Date().getHours();
  return h < 12 ? 'dashboard.goodMorning' : h < 17 ? 'dashboard.goodAfternoon' : 'dashboard.goodEvening';
}

function Stat({ label, value, icon, to, loading }: { label: string; value: ReactNode; icon: ReactNode; to?: string; loading?: boolean }) {
  const body = (
    <div className="flex items-start justify-between gap-3 p-4 sm:p-5">
      <div>
        <p className="text-[0.8125rem] text-fg-muted">{label}</p>
        <div className="tabular mt-2 text-2xl font-semibold tracking-tight text-fg">
          {loading ? <Skeleton className="h-7 w-12" /> : value}
        </div>
      </div>
      <span className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 sm:flex">{icon}</span>
    </div>
  );
  return (
    <div className="rounded-lg border border-line bg-surface shadow-[var(--shadow-card)] transition-colors has-[a:hover]:border-line-strong">
      {to ? (
        <Link to={to} className="block rounded-lg">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { session, can } = useAuth();
  const canAcademic = can('academic.structure.read');
  const canUsers = can('users.read');
  const today = todayIso();

  const years = useResource<List<Year>>(canAcademic ? '/academic-years' : null);
  const current = years.data?.items.find((y) => y.isCurrent) ?? null;
  const terms = useResource<List<Term>>(current ? `/academic-years/${current.id}/terms` : null);
  const sections = useResource<List<{ id: number }>>(current ? `/class-sections${query({ academicYearId: current.id })}` : null);
  const grades = useResource<List<{ id: number; isActive: boolean }>>(canAcademic ? '/grades' : null);
  const subjects = useResource<List<{ id: number }>>(canAcademic ? '/subjects' : null);
  const periods = useResource<List<{ id: number }>>(canAcademic ? '/periods' : null);
  const events = useResource<List<CalendarEvent>>(
    canAcademic ? `/calendar-events${query({ from: today, to: addDaysIso(today, 60) })}` : null,
  );
  const activeUsers = useResource<Paginated<UserItem>>(canUsers ? '/users?status=active&pageSize=1' : null);
  const invited = useResource<Paginated<UserItem>>(canUsers ? '/users?status=invited&pageSize=1' : null);

  if (!session) return null;
  const name = session.user.displayName.split(/\s+/)[0] ?? session.user.displayName;
  const longDate = new Intl.DateTimeFormat(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(),
  );

  const currentTerm = terms.data?.items.find((x) => x.startsOn <= today && x.endsOn >= today) ?? null;
  const nextTerm = terms.data?.items.find((x) => x.startsOn > today) ?? null;

  // Setup checklist for administrators: each step links to where it is done.
  const isAdmin = can('academic.structure.manage') || can('users.manage');
  const steps =
    isAdmin && years.data && grades.data && subjects.data && periods.data
      ? [
          { done: years.data.items.length > 0, label: t('dashboard.setup.year'), to: '/academic?tab=years' },
          { done: !!current, label: t('dashboard.setup.current'), to: '/academic?tab=years' },
          { done: (terms.data?.items.length ?? 0) > 0, label: t('dashboard.setup.terms'), to: '/academic?tab=years' },
          { done: grades.data.items.length > 0, label: t('dashboard.setup.grades'), to: '/academic?tab=grades' },
          { done: subjects.data.items.length > 0, label: t('dashboard.setup.subjects'), to: '/academic?tab=subjects' },
          { done: (sections.data?.items.length ?? 0) > 0, label: t('dashboard.setup.classes'), to: '/academic?tab=classes' },
          { done: periods.data.items.length > 0, label: t('dashboard.setup.periods'), to: '/academic?tab=periods' },
          ...(canUsers
            ? [{ done: (activeUsers.data?.total ?? 0) + (invited.data?.total ?? 0) > 1, label: t('dashboard.setup.staff'), to: '/users' }]
            : []),
        ]
      : null;
  const doneCount = steps?.filter((s) => s.done).length ?? 0;

  return (
    <>
      <PageHeader title={t(greetingKey(), { name })} description={longDate} />

      {canAcademic || canUsers ? (
        <div className="space-y-6">
          {/* Key numbers */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            {canUsers && (
              <>
                <Stat
                  label={t('dashboard.activeUsers')}
                  value={activeUsers.data?.total ?? 0}
                  loading={!activeUsers.data}
                  icon={<UserCheck className="size-4.5" />}
                  to="/users"
                />
                <Stat
                  label={t('dashboard.pendingInvites')}
                  value={invited.data?.total ?? 0}
                  loading={!invited.data}
                  icon={<MailPlus className="size-4.5" />}
                  to="/users"
                />
              </>
            )}
            {canAcademic && (
              <>
                <Stat
                  label={t('dashboard.classesThisYear')}
                  value={current ? (sections.data?.items.length ?? 0) : '—'}
                  loading={!years.data || (!!current && !sections.data)}
                  icon={<Layers className="size-4.5" />}
                  to="/academic?tab=classes"
                />
                <Stat
                  label={t('dashboard.grades')}
                  value={grades.data?.items.filter((g) => g.isActive).length ?? 0}
                  loading={!grades.data}
                  icon={<GraduationCap className="size-4.5" />}
                  to="/academic?tab=grades"
                />
              </>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="space-y-6">
              {canAcademic && (
                <Card title={t('dashboard.schoolYear')} actions={current && <Badge tone="brand">{current.label}</Badge>}>
                  {!years.data ? (
                    <div className="space-y-3">
                      <Skeleton className="w-1/3" />
                      <Skeleton className="h-2 w-full" />
                    </div>
                  ) : !current ? (
                    <EmptyState
                      icon={<CalendarDays className="size-5" />}
                      title={t('dashboard.noCurrentYear')}
                      description={t('dashboard.noCurrentYearHelp')}
                      action={
                        <Link to="/academic?tab=years" className="text-sm font-medium text-brand-600 hover:underline">
                          {t('dashboard.goToYears')}
                        </Link>
                      }
                    />
                  ) : currentTerm ? (
                    <TermProgress term={currentTerm} today={today} locale={i18n.language} />
                  ) : (
                    <p className="text-sm text-fg-muted">
                      {nextTerm
                        ? t('dashboard.betweenTerms', { term: nextTerm.label, date: formatDate(nextTerm.startsOn, i18n.language) })
                        : t('dashboard.noTermToday')}
                    </p>
                  )}
                </Card>
              )}

              {steps && doneCount < steps.length && (
                <Card
                  title={t('dashboard.setup.title')}
                  description={t('dashboard.setup.progress', { done: doneCount, total: steps.length })}
                  flush
                >
                  <div className="px-5 pt-4">
                    <div
                      className="h-1.5 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={steps.length}
                      aria-valuenow={doneCount}
                      aria-label={t('dashboard.setup.title')}
                    >
                      <div className="h-full rounded-full bg-brand-600" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
                    </div>
                  </div>
                  <ul className="mt-2 divide-y divide-line">
                    {steps.map((s) => (
                      <li key={s.label}>
                        <Link to={s.to} className="group flex items-center gap-3 px-5 py-3 text-sm hover:bg-subtle/70">
                          {s.done ? (
                            <CheckCircle2 aria-hidden className="size-4.5 shrink-0 text-ok" />
                          ) : (
                            <Circle aria-hidden className="size-4.5 shrink-0 text-line-strong" />
                          )}
                          <span className={s.done ? 'text-fg-muted line-through decoration-line-strong' : 'font-medium text-fg'}>
                            {s.label}
                          </span>
                          <span className="sr-only">{s.done ? t('dashboard.setup.done') : t('dashboard.setup.todo')}</span>
                          {!s.done && <ArrowRight aria-hidden className="ml-auto size-4 text-fg-faint group-hover:text-brand-600" />}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>

            <div className="space-y-6">
              {isAdmin && (
                <Card title={t('dashboard.quickActions')}>
                  <div className="grid gap-2">
                    {can('users.manage') && <QuickLink to="/users?new=1" icon={<UserPlus className="size-4" />} label={t('users.add')} />}
                    {can('academic.structure.manage') && (
                      <>
                        <QuickLink to="/academic?tab=classes" icon={<Layers className="size-4" />} label={t('dashboard.manageClasses')} />
                        <QuickLink
                          to="/academic?tab=calendar"
                          icon={<CalendarPlus className="size-4" />}
                          label={t('dashboard.editCalendar')}
                        />
                      </>
                    )}
                  </div>
                </Card>
              )}
              {canAcademic && (
                <Card
                  title={t('dashboard.upcoming')}
                  actions={
                    <Link to="/academic?tab=calendar" className="text-[0.8125rem] font-medium text-brand-600 hover:underline">
                      {t('dashboard.viewCalendar')}
                    </Link>
                  }
                  flush
                >
                  {!events.data ? (
                    <div className="space-y-3 p-5">
                      <Skeleton className="w-2/3" />
                      <Skeleton className="w-1/2" />
                    </div>
                  ) : events.data.items.length === 0 ? (
                    <p className="px-5 py-6 text-sm text-fg-muted">{t('dashboard.noUpcoming')}</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {events.data.items.slice(0, 6).map((e) => (
                        <li key={e.id} className="flex items-start gap-3 px-5 py-3">
                          <DateTile iso={e.startsOn} locale={i18n.language} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{e.title}</p>
                            <p className="text-[0.8125rem] text-fg-muted">
                              {t(`academic.calendar.kinds.${e.kind}`)}
                              {e.endsOn !== e.startsOn && ` · ${t('dashboard.until', { date: formatDate(e.endsOn, i18n.language) })}`}
                            </p>
                          </div>
                          {!e.isSchoolDay && <Badge tone="warn">{t('academic.calendar.closed')}</Badge>}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}
            </div>
          </div>
        </div>
      ) : (
        <Card>
          <div className="max-w-xl">
            <p className="font-medium">
              {t('dashboard.signedInAs', { roles: session.user.roles.map((r) => t(`roles.${r}`)).join(', ') || t('users.noRoles') })}
            </p>
            <p className="mt-1 text-sm text-fg-muted">{t('dashboard.memberIntro')}</p>
          </div>
        </Card>
      )}
    </>
  );
}

function QuickLink({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-md border border-line px-3 py-2.5 text-sm font-medium hover:border-line-strong hover:bg-subtle/70"
    >
      <span className="text-fg-faint group-hover:text-brand-600">{icon}</span>
      {label}
      <ArrowRight aria-hidden className="ml-auto size-4 text-fg-faint" />
    </Link>
  );
}

function DateTile({ iso, locale }: { iso: string; locale: string }) {
  const d = new Date(`${iso}T00:00:00Z`);
  return (
    <span className="flex w-11 shrink-0 flex-col items-center rounded-md border border-line py-1 leading-none">
      <span className="text-[0.625rem] font-medium text-danger">
        {new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(d)}
      </span>
      <span className="tabular mt-0.5 text-base font-semibold">{d.getUTCDate()}</span>
    </span>
  );
}

function TermProgress({ term, today, locale }: { term: Term; today: string; locale: string }) {
  const { t } = useTranslation();
  const total = Math.max(1, daysBetween(term.startsOn, term.endsOn));
  const elapsed = Math.min(total, Math.max(0, daysBetween(term.startsOn, today)));
  const pct = Math.round((elapsed / total) * 100);
  const left = daysBetween(today, term.endsOn);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-base font-semibold">{term.label}</p>
        <p className="tabular text-[0.8125rem] text-fg-muted">{t('dashboard.daysLeft', { count: left })}</p>
      </div>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={term.label}
      >
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
      </div>
      <div className="tabular mt-2 flex justify-between text-xs text-fg-muted">
        <span>{formatDate(term.startsOn, locale)}</span>
        <span>{t('dashboard.percentDone', { pct })}</span>
        <span>{formatDate(term.endsOn, locale)}</span>
      </div>
    </div>
  );
}
