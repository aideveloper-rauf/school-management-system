import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BarChart3, CheckCheck, ClipboardCheck, ClipboardList, FilePen, Lock, Printer, Save } from 'lucide-react';
import { ATTENDANCE_STATUSES, type AttendanceStatus, type Paginated } from '@sms/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { query, useResource, useSubmit } from '../../lib/data';
import { addDaysIso, formatDate, formatDateTime, todayIso } from '../../lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
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

interface Registers {
  date: string;
  closure: string | null;
  items: Array<{ classSection: { id: number; name: string; gradeName: string }; taken: boolean; isClassTeacher: boolean }>;
}
interface Register {
  classSection: { id: number; name: string; gradeName: string; yearLabel: string };
  date: string;
  today: string;
  closure: string | null;
  inYear: boolean;
  editable: boolean;
  session: { takenAt: string; updatedAt: string; takenBy: string | null } | null;
  students: Array<{
    id: number;
    fullName: string;
    admissionNo: string;
    rollNo: number | null;
    status: AttendanceStatus | null;
    correctionPending: boolean;
  }>;
}
interface Summary {
  daysTaken: number;
  classSection: { name: string; gradeName: string };
  students: Array<{
    id: number;
    fullName: string;
    admissionNo: string;
    rollNo: number | null;
    present: number;
    absent: number;
    late: number;
    excused: number;
    marked: number;
    rate: number | null;
  }>;
}
interface Correction {
  id: number;
  date: string;
  classSection: { id: number; name: string; gradeName: string };
  student: { id: number; fullName: string; admissionNo: string };
  fromStatus: AttendanceStatus | null;
  toStatus: AttendanceStatus;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
}

type Tab = 'register' | 'summary' | 'corrections';
const TONE: Record<AttendanceStatus, string> = {
  present: 'bg-ok text-white border-ok',
  absent: 'bg-danger text-white border-danger',
  late: 'bg-warn text-white border-warn',
  excused: 'bg-brand-600 text-white border-brand-600',
};

export default function AttendancePage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (['register', 'summary', 'corrections'] as const).includes(params.get('tab') as Tab)
    ? (params.get('tab') as Tab)
    : 'register';
  const canTake = can('attendance.record.scoped') || can('attendance.correct');
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('nav.dashboard'), to: '/' }, { label: t('attendance.title') }]}
        title={t('attendance.title')}
        description={t('attendance.intro')}
      />
      <div className="space-y-6">
        <Tabs
          label={t('attendance.title')}
          value={tab}
          onChange={(k) => setParams(k === 'register' ? {} : { tab: k }, { replace: true })}
          items={[
            ...(canTake
              ? [{ key: 'register' as const, label: t('attendance.tabs.register'), icon: <ClipboardCheck className="size-4" /> }]
              : []),
            { key: 'summary' as const, label: t('attendance.tabs.summary'), icon: <BarChart3 className="size-4" /> },
            ...(canTake
              ? [{ key: 'corrections' as const, label: t('attendance.tabs.corrections'), icon: <FilePen className="size-4" /> }]
              : []),
          ]}
        />
        {tab === 'register' && canTake && <RegisterTab />}
        {(tab === 'summary' || !canTake) && <SummaryTab />}
        {tab === 'corrections' && canTake && <CorrectionsTab />}
      </div>
    </>
  );
}

function RegisterTab() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [date, setDate] = useState(todayIso());
  const registers = useResource<Registers>(`/me/attendance-registers${query({ date })}`);
  const [sectionId, setSectionId] = useState('');
  useEffect(() => {
    const items = registers.data?.items ?? [];
    if (items.length && !items.some((i) => String(i.classSection.id) === sectionId)) {
      setSectionId(String((items.find((i) => i.isClassTeacher) ?? items[0])!.classSection.id));
    }
  }, [registers.data, sectionId]);
  const reg = useResource<Register>(sectionId ? `/class-sections/${sectionId}/attendance/${date}` : null);
  const [marks, setMarks] = useState<Map<number, AttendanceStatus>>(new Map());
  const [correcting, setCorrecting] = useState<number | null>(null);
  const submit = useSubmit();

  useEffect(() => {
    if (reg.data) setMarks(new Map(reg.data.students.filter((s) => s.status).map((s) => [s.id, s.status!])));
  }, [reg.data]);

  const r = reg.data;
  const counts = useMemo(() => {
    const c: Record<AttendanceStatus, number> = { present: 0, absent: 0, late: 0, excused: 0 };
    for (const v of marks.values()) c[v]++;
    return c;
  }, [marks]);
  const unmarked = r ? r.students.filter((s) => !marks.has(s.id)).length : 0;
  const dirty = r ? r.students.some((s) => (marks.get(s.id) ?? null) !== s.status) : false;

  async function save() {
    if (!r) return;
    const records = r.students.filter((s) => marks.has(s.id)).map((s) => ({ studentId: s.id, status: marks.get(s.id)! }));
    const ok = await submit.run(
      async () => (await api(`/class-sections/${r.classSection.id}/attendance/${date}`, { method: 'PUT', body: { records } })) ?? true,
    );
    if (ok) {
      toast.success(t('attendance.saved'));
      reg.reload();
      registers.reload();
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('attendance.date')}>
          {(id) => <Input id={id} type="date" max={todayIso()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />}
        </Field>
        <Field label={t('attendance.class')}>
          {(id) => (
            <Select
              id={id}
              className="min-w-48"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              disabled={!registers.data?.items.length}
            >
              {(registers.data?.items ?? []).map((i) => (
                <option key={i.classSection.id} value={i.classSection.id}>
                  {i.classSection.gradeName} / {i.classSection.name}
                  {i.taken ? ` ✓` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {registers.data && registers.data.items.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="size-5" />}
          title={t('attendance.noClasses')}
          description={t('attendance.noClassesHelp')}
        />
      ) : reg.error ? (
        <Alert>{t(reg.error.message)}</Alert>
      ) : !r ? (
        sectionId ? (
          <Loading />
        ) : null
      ) : (
        <Card
          title={`${r.classSection.gradeName} / ${r.classSection.name} · ${formatDate(r.date, i18n.language)}`}
          description={
            r.session
              ? t('attendance.takenBy', { name: r.session.takenBy ?? '—', when: formatDateTime(r.session.updatedAt, i18n.language) })
              : t('attendance.notTaken')
          }
          actions={
            r.editable && (
              <Button
                size="sm"
                icon={<CheckCheck className="size-4" />}
                onClick={() => setMarks((m) => new Map(r.students.map((s) => [s.id, m.get(s.id) ?? 'present'])))}
              >
                {t('attendance.markRestPresent')}
              </Button>
            )
          }
        >
          <div className="space-y-4">
            {r.closure && <Alert tone="info">{t('attendance.closed', { title: r.closure })}</Alert>}
            {!r.inYear && <Alert tone="info">{t('attendance.outsideYear')}</Alert>}
            {!r.editable && !r.closure && r.inYear && (
              <Alert tone="info" title={t('attendance.lockedTitle')}>
                {t('attendance.lockedHelp')}
              </Alert>
            )}
            {submit.error && <Alert>{submit.error}</Alert>}
            {r.students.length === 0 ? (
              <p className="text-sm text-fg-faint">{t('attendance.noStudents')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {r.students.map((s) => (
                  <li key={s.id} className="py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {s.rollNo !== null && <span className="tabular mr-1.5 text-fg-faint">{s.rollNo}.</span>}
                          {s.fullName}
                        </p>
                        <p className="tabular text-xs text-fg-muted">
                          {s.admissionNo}
                          {s.correctionPending && (
                            <span className="ml-2">
                              <Badge tone="warn">{t('attendance.correctionPending')}</Badge>
                            </span>
                          )}
                        </p>
                      </div>
                      <div role="radiogroup" aria-label={t('attendance.statusFor', { name: s.fullName })} className="flex gap-1">
                        {ATTENDANCE_STATUSES.map((st) => {
                          const on = marks.get(s.id) === st;
                          return (
                            <button
                              key={st}
                              type="button"
                              role="radio"
                              aria-checked={on}
                              disabled={!r.editable}
                              title={t(`attendance.statuses.${st}`)}
                              onClick={() => setMarks((m) => new Map(m).set(s.id, st))}
                              className={`h-9 min-w-10 rounded-md border px-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${
                                on ? TONE[st] : 'border-line-strong bg-surface text-fg-muted hover:bg-subtle disabled:opacity-50'
                              }`}
                            >
                              {t(`attendance.short.${st}`)}
                            </button>
                          );
                        })}
                        {!r.editable && r.session && !s.correctionPending && (
                          <Button size="sm" variant="ghost" onClick={() => setCorrecting(correcting === s.id ? null : s.id)}>
                            {t('attendance.requestCorrection')}
                          </Button>
                        )}
                      </div>
                    </div>
                    {correcting === s.id && (
                      <CorrectionForm
                        classSectionId={r.classSection.id}
                        date={r.date}
                        studentId={s.id}
                        current={s.status}
                        onDone={() => {
                          setCorrecting(null);
                          reg.reload();
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {r.editable && r.students.length > 0 && (
              <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-5 py-3">
                <p className="text-[0.8125rem] text-fg-muted">
                  {ATTENDANCE_STATUSES.map((st) => `${t(`attendance.statuses.${st}`)} ${counts[st]}`).join(' · ')}
                  {unmarked > 0 && ` · ${t('attendance.unmarked', { count: unmarked })}`}
                </p>
                <Button
                  variant="primary"
                  icon={<Save className="size-4" />}
                  busy={submit.busy}
                  disabled={!dirty || marks.size === 0}
                  onClick={() => void save()}
                >
                  {t('attendance.save')}
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function CorrectionForm({
  classSectionId,
  date,
  studentId,
  current,
  onDone,
}: {
  classSectionId: number;
  date: string;
  studentId: number;
  current: AttendanceStatus | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [toStatus, setToStatus] = useState<AttendanceStatus>(ATTENDANCE_STATUSES.find((s) => s !== current)!);
  const [reason, setReason] = useState('');
  const submit = useSubmit();
  async function send() {
    const res = await submit.run(() =>
      api<{ status: string }>('/attendance/corrections', { method: 'POST', body: { classSectionId, date, studentId, toStatus, reason } }),
    );
    if (res) {
      toast.success(res.status === 'approved' ? t('attendance.correctionApplied') : t('attendance.correctionSent'));
      onDone();
    }
  }
  return (
    <div className="mt-2 space-y-3 rounded-md bg-subtle p-3">
      {submit.error && <Alert>{submit.error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label={t('attendance.changeTo')}>
          {(id) => (
            <Select id={id} value={toStatus} onChange={(e) => setToStatus(e.target.value as AttendanceStatus)}>
              {ATTENDANCE_STATUSES.filter((s) => s !== current).map((s) => (
                <option key={s} value={s}>
                  {t(`attendance.statuses.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('attendance.reason')} hint={t('attendance.reasonHint')} error={submit.fieldErrors.reason}>
          {(id) => <Input id={id} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
      <Button size="sm" variant="primary" busy={submit.busy} disabled={!reason.trim()} onClick={() => void send()}>
        {t('attendance.sendCorrection')}
      </Button>
    </div>
  );
}

function SummaryTab() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [from, setFrom] = useState(addDaysIso(todayIso(), -30));
  const [to, setTo] = useState(todayIso());
  const [sectionId, setSectionId] = useState('');
  // Teachers: their classes. Principals/registrars: every class of the current year.
  const mine = useResource<Registers>(can('attendance.record.scoped') || can('attendance.correct') ? `/me/attendance-registers` : null);
  const years = useResource<{ items: Array<{ id: number; isCurrent: boolean }> }>(can('students.read.all') ? '/academic-years' : null);
  const currentYear = years.data?.items.find((y) => y.isCurrent)?.id;
  const all = useResource<{ items: Array<{ id: number; name: string; grade: { name: string } }> }>(
    currentYear ? `/class-sections?academicYearId=${currentYear}` : null,
  );
  const options = useMemo(
    () =>
      all.data
        ? all.data.items.map((s) => ({ id: s.id, label: `${s.grade.name} / ${s.name}` }))
        : (mine.data?.items ?? []).map((i) => ({ id: i.classSection.id, label: `${i.classSection.gradeName} / ${i.classSection.name}` })),
    [all.data, mine.data],
  );
  useEffect(() => {
    if (!sectionId && options.length) setSectionId(String(options[0]!.id));
  }, [options, sectionId]);
  const summary = useResource<Summary>(sectionId && from <= to ? `/class-sections/${sectionId}/attendance${query({ from, to })}` : null);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <Field label={t('attendance.class')}>
          {(id) => (
            <Select id={id} className="min-w-48" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('attendance.from')}>
          {(id) => <Input id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
        </Field>
        <Field label={t('attendance.to')}>{(id) => <Input id={id} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
        <Button icon={<Printer className="size-4" />} onClick={() => window.print()} disabled={!summary.data}>
          {t('attendance.print')}
        </Button>
      </div>
      {options.length === 0 && !mine.loading && !all.loading ? (
        <EmptyState icon={<BarChart3 className="size-5" />} title={t('attendance.noClasses')} />
      ) : summary.error ? (
        <Alert>{t(summary.error.message)}</Alert>
      ) : !summary.data ? (
        sectionId ? (
          <Loading />
        ) : null
      ) : (
        <Card
          title={t('attendance.summaryTitle', { cls: `${summary.data.classSection.gradeName} / ${summary.data.classSection.name}` })}
          description={t('attendance.daysTaken', { count: summary.data.daysTaken })}
          flush
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-subtle text-left text-xs text-fg-muted">
                <tr>
                  <th className="px-4 py-2">{t('students.student')}</th>
                  {ATTENDANCE_STATUSES.map((s) => (
                    <th key={s} className="px-3 py-2 text-right">
                      {t(`attendance.statuses.${s}`)}
                    </th>
                  ))}
                  <th className="px-4 py-2 text-right">{t('attendance.rate')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {summary.data.students.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2">
                      <span className="font-medium">{s.fullName}</span>{' '}
                      <span className="tabular text-xs text-fg-muted">{s.admissionNo}</span>
                    </td>
                    {ATTENDANCE_STATUSES.map((st) => (
                      <td key={st} className="tabular px-3 py-2 text-right">
                        {s[st]}
                      </td>
                    ))}
                    <td className={`tabular px-4 py-2 text-right font-medium ${s.rate !== null && s.rate < 80 ? 'text-danger' : ''}`}>
                      {s.rate === null ? '—' : `${s.rate}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function CorrectionsTab() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const approver = can('attendance.correct');
  const [status, setStatus] = useState(approver ? 'pending' : '');
  const [page, setPage] = useState(1);
  const list = useResource<Paginated<Correction>>(`/attendance/corrections${query({ status, page, pageSize: 20 })}`);
  const act = useSubmit();
  const decide = async (c: Correction, decision: 'approved' | 'rejected') => {
    const ok = await act.run(
      async () => (await api(`/attendance/corrections/${c.id}/decide`, { method: 'POST', body: { decision } })) ?? true,
    );
    if (ok) {
      toast.success(decision === 'approved' ? t('attendance.approved') : t('attendance.rejected'));
      list.reload();
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[0.8125rem] text-fg-muted">
          {approver ? t('attendance.correctionsHelpApprover') : t('attendance.correctionsHelp')}
        </p>
        <Select
          aria-label={t('attendance.correctionStatus')}
          className="w-44"
          value={status}
          onChange={(e) => (setStatus(e.target.value), setPage(1))}
        >
          <option value="">{t('attendance.anyStatus')}</option>
          {(['pending', 'approved', 'rejected'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`attendance.correctionStatuses.${s}`)}
            </option>
          ))}
        </Select>
      </div>
      {(list.error || act.error) && <Alert>{act.error ?? t(list.error!.message)}</Alert>}
      {list.loading && !list.data ? (
        <Loading />
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <EmptyState icon={<FilePen className="size-5" />} title={t('attendance.noCorrections')} />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {list.data!.items.map((c) => (
            <li key={c.id} className="space-y-1.5 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p>
                  <span className="font-medium">{c.student.fullName}</span>{' '}
                  <span className="text-[0.8125rem] text-fg-muted">
                    · {c.classSection.gradeName} / {c.classSection.name} · {formatDate(c.date, i18n.language)}
                  </span>
                </p>
                <Badge tone={c.status === 'approved' ? 'ok' : c.status === 'rejected' ? 'danger' : 'warn'} dot>
                  {t(`attendance.correctionStatuses.${c.status}`)}
                </Badge>
              </div>
              <p className="text-sm">
                {c.fromStatus ? t(`attendance.statuses.${c.fromStatus}`) : t('attendance.unmarkedShort')} →{' '}
                <strong>{t(`attendance.statuses.${c.toStatus}`)}</strong>
              </p>
              <p className="text-[0.8125rem] text-fg-muted">“{c.reason}”</p>
              <p className="text-xs text-fg-faint">
                {t('attendance.requestedBy', { name: c.requestedBy ?? '—', when: formatDateTime(c.requestedAt, i18n.language) })}
                {c.decidedBy && ` · ${t('attendance.decidedBy', { name: c.decidedBy })}`}
              </p>
              {approver && c.status === 'pending' && (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="primary" onClick={() => void decide(c, 'approved')}>
                    {t('attendance.approve')}
                  </Button>
                  <Button size="sm" onClick={() => void decide(c, 'rejected')}>
                    {t('attendance.reject')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {list.data && list.data.total > list.data.pageSize && (
        <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
      )}
      <p className="flex items-center gap-1.5 text-xs text-fg-faint">
        <Lock className="size-3.5" /> {t('attendance.reasonPrivacy')}
      </p>
    </div>
  );
}
