import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Award, CheckCircle2, ClipboardPen, Plus, Printer, RotateCcw, Save, Send, Settings2, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { query, useResource, useSubmit } from '../../lib/data';
import { useYears } from '../../lib/academic';
import { formatDateTime } from '../../lib/format';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Loading, PageHeader, Select, Tabs, useToast } from '../../components/ui';

interface Band {
  min: number;
  grade: string;
  label: string | null;
}
interface Scale {
  id: number;
  name: string;
  versions: Array<{ id: number; version: number; bands: Band[] }>;
}
interface SeriesRow {
  id: number;
  name: string;
  academicYear: { id: number; label: string };
  term: string | null;
  scale: string;
}
interface SeriesDetail {
  id: number;
  name: string;
  academicYearId: number;
  scale: { name: string; version: number; bands: Band[] };
  components: Array<{
    id: number;
    name: string;
    maxMarks: number;
    weight: number;
    grade: { id: number; name: string };
    subject: { id: number; name: string };
    sheets: Array<{ classSectionId: number; className: string; status: SheetStatus }>;
  }>;
  classes: Array<{ id: number; name: string; gradeId: number }>;
}
type SheetStatus = 'open' | 'submitted' | 'moderated' | 'approved';
const SHEET_TONE: Record<SheetStatus, 'neutral' | 'warn' | 'brand' | 'ok'> = {
  open: 'neutral',
  submitted: 'warn',
  moderated: 'brand',
  approved: 'ok',
};

type Tab = 'marks' | 'results' | 'setup';

export default function ExamsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs: Array<{ key: Tab; label: string; icon: ReactNode }> = [
    ...(can('marks.enter.scoped') || can('marks.moderate') || can('results.approve')
      ? [{ key: 'marks' as const, label: t('exams.tabs.marks'), icon: <ClipboardPen className="size-4" /> }]
      : []),
    ...(can('marks.moderate') || can('results.approve') || can('results.publish') || can('exams.manage')
      ? [{ key: 'results' as const, label: t('exams.tabs.results'), icon: <Award className="size-4" /> }]
      : []),
    ...(can('exams.manage') ? [{ key: 'setup' as const, label: t('exams.tabs.setup'), icon: <Settings2 className="size-4" /> }] : []),
  ];
  const requested = params.get('tab') as Tab | null;
  const tab = tabs.find((x) => x.key === requested)?.key ?? tabs[0]?.key ?? 'marks';
  const [seriesId, setSeriesId] = useState(params.get('series') ?? '');
  const { current } = useYears();
  const series = useResource<{ items: SeriesRow[] }>(current ? `/exam-series${query({ academicYearId: current.id })}` : null);
  useEffect(() => {
    if (!seriesId && series.data?.items.length) setSeriesId(String(series.data.items[0]!.id));
  }, [series.data, seriesId]);
  const detail = useResource<SeriesDetail>(seriesId ? `/exam-series/${seriesId}` : null);

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('nav.dashboard'), to: '/' }, { label: t('exams.title') }]}
        title={t('exams.title')}
        description={t('exams.intro')}
      />
      <div className="space-y-6">
        <Tabs
          label={t('exams.title')}
          value={tab}
          onChange={(k) => setParams({ tab: k, ...(seriesId && { series: seriesId }) }, { replace: true })}
          items={tabs}
        />
        {tab !== 'setup' && (
          <Field label={t('exams.series')}>
            {(id) => (
              <Select
                id={id}
                className="max-w-sm"
                value={seriesId}
                onChange={(e) => setSeriesId(e.target.value)}
                disabled={!series.data?.items.length}
              >
                {(series.data?.items ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.term ? ` · ${s.term}` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {tab !== 'setup' && series.data && series.data.items.length === 0 && (
          <EmptyState icon={<Award className="size-5" />} title={t('exams.noSeries')} description={t('exams.noSeriesHelp')} />
        )}
        {tab === 'marks' && detail.data && <MarksTab series={detail.data} onChanged={detail.reload} />}
        {tab === 'results' && detail.data && <ResultsTab series={detail.data} />}
        {tab === 'setup' && (
          <SetupTab
            series={series.data?.items ?? []}
            yearId={current?.id ?? null}
            onChanged={() => (series.reload(), detail.reload())}
            detail={detail.data}
            seriesId={seriesId}
            setSeriesId={setSeriesId}
          />
        )}
      </div>
    </>
  );
}

// Marks ------------------------------------------------------------------------
interface Sheet {
  component: { id: number; name: string; maxMarks: number; subject: string; series: string };
  classSection: { id: number; name: string };
  status: SheetStatus;
  reopenReason: string | null;
  can: { enter: boolean; correct: boolean; submit: boolean; moderate: boolean; approve: boolean; reopen: boolean };
  students: Array<{
    id: number;
    fullName: string;
    admissionNo: string;
    rollNo: number | null;
    status: 'present' | 'absent' | 'exempt' | null;
    rawMark: number | null;
  }>;
  changes: Array<{
    studentId: number;
    from: number | string | null;
    to: number | string;
    reason: string;
    changedBy: string | null;
    changedAt: string;
  }>;
}
type Cell = { value: string; status: 'present' | 'absent' | 'exempt' };

function MarksTab({ series, onChanged }: { series: SeriesDetail; onChanged: () => void }) {
  const { t } = useTranslation();
  const options = series.components.flatMap((c) =>
    c.sheets.map((s) => ({
      key: `${c.id}:${s.classSectionId}`,
      label: `${c.grade.name} ${s.className} · ${c.subject.name} · ${c.name}`,
      status: s.status,
    })),
  );
  const [key, setKey] = useState('');
  useEffect(() => {
    if (options.length && !options.some((o) => o.key === key)) setKey(options[0]!.key);
  }, [options, key]);
  if (options.length === 0)
    return <EmptyState icon={<ClipboardPen className="size-5" />} title={t('exams.noSheets')} description={t('exams.noSheetsHelp')} />;
  const [componentId, classSectionId] = key.split(':');
  return (
    <div className="space-y-4">
      <Field label={t('exams.sheet')}>
        {(id) => (
          <Select id={id} className="max-w-xl" value={key} onChange={(e) => setKey(e.target.value)}>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label} — {t(`exams.sheetStatuses.${o.status}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {key && <MarkSheet key={key} componentId={Number(componentId)} classSectionId={Number(classSectionId)} onChanged={onChanged} />}
    </div>
  );
}

function MarkSheet({ componentId, classSectionId, onChanged }: { componentId: number; classSectionId: number; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const res = useResource<Sheet>(`/exam-components/${componentId}/sheets/${classSectionId}`);
  const draftKey = `sms.marks.${componentId}.${classSectionId}`;
  const [cells, setCells] = useState<Map<number, Cell>>(new Map());
  const [reason, setReason] = useState('');
  const [actionReason, setActionReason] = useState('');
  const submit = useSubmit();
  const act = useSubmit();
  const s = res.data;
  const editable = !!s && (s.can.enter || s.can.correct);

  useEffect(() => {
    if (!s) return;
    const fromServer = new Map<number, Cell>(
      s.students.filter((x) => x.status).map((x) => [x.id, { value: x.rawMark === null ? '' : String(x.rawMark), status: x.status! }]),
    );
    // Offline-tolerant: restore unsaved entries kept on this device.
    try {
      const saved = s.can.enter ? (JSON.parse(localStorage.getItem(draftKey) ?? 'null') as Array<[number, Cell]> | null) : null;
      if (saved) for (const [id, c] of saved) fromServer.set(id, c);
    } catch {
      /* storage unavailable */
    }
    setCells(fromServer);
  }, [s, draftKey]);

  const update = (id: number, c: Cell) =>
    setCells((cur) => {
      const n = new Map(cur).set(id, c);
      try {
        localStorage.setItem(draftKey, JSON.stringify([...n]));
      } catch {
        /* storage unavailable */
      }
      return n;
    });

  const original = (id: number) => s?.students.find((x) => x.id === id);
  const dirtyIds = s
    ? s.students
        .filter((x) => {
          const c = cells.get(x.id);
          if (!c) return false;
          return c.status !== x.status || (c.status === 'present' && Number(c.value) !== x.rawMark);
        })
        .map((x) => x.id)
    : [];
  const invalid = s
    ? [...cells.entries()].some(
        ([, c]) =>
          c.status === 'present' &&
          (c.value === '' || Number.isNaN(Number(c.value)) || Number(c.value) < 0 || Number(c.value) > s.component.maxMarks),
      )
    : false;

  async function save() {
    if (!s) return;
    const marks = dirtyIds.map((id) => {
      const c = cells.get(id)!;
      return { studentId: id, status: c.status, rawMark: c.status === 'present' ? Number(c.value) : null };
    });
    const ok = await submit.run(() =>
      api(`/exam-components/${componentId}/sheets/${classSectionId}/marks`, {
        method: 'PUT',
        body: { marks, ...(s.can.correct && { reason }) },
      }),
    );
    if (ok) {
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* storage unavailable */
      }
      toast.success(t('exams.marksSaved'));
      setReason('');
      res.reload();
    }
  }
  async function action(a: 'submit' | 'moderate' | 'approve' | 'reopen') {
    const ok = await act.run(() =>
      api(`/exam-components/${componentId}/sheets/${classSectionId}/actions`, {
        method: 'POST',
        body: { action: a, ...(a === 'reopen' && { reason: actionReason }) },
      }),
    );
    if (ok) {
      toast.success(t(`exams.actionDone.${a}`));
      setActionReason('');
      res.reload();
      onChanged();
    }
  }

  if (res.error) return <Alert>{t(res.error.message)}</Alert>;
  if (!s) return <Loading />;
  return (
    <Card
      title={`${s.component.subject} · ${s.component.name} · ${s.classSection.name}`}
      description={t('exams.outOf', { max: s.component.maxMarks })}
      actions={
        <Badge tone={SHEET_TONE[s.status]} dot>
          {t(`exams.sheetStatuses.${s.status}`)}
        </Badge>
      }
    >
      <div className="space-y-4">
        {s.status !== 'open' && !s.can.correct && <Alert tone="info">{t(`exams.lockedHelp.${s.status}`)}</Alert>}
        {s.can.correct && <Alert tone="warning">{t('exams.correctHelp')}</Alert>}
        {s.reopenReason && s.status === 'open' && (
          <Alert tone="info" title={t('exams.reopened')}>
            {s.reopenReason}
          </Alert>
        )}
        {(submit.error || act.error) && <Alert>{submit.error ?? act.error}</Alert>}
        <ul className="divide-y divide-line">
          {s.students.map((st) => {
            const c = cells.get(st.id);
            const bad = c?.status === 'present' && c.value !== '' && (Number(c.value) > s.component.maxMarks || Number(c.value) < 0);
            return (
              <li key={st.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {st.rollNo !== null && <span className="tabular mr-1.5 text-fg-faint">{st.rollNo}.</span>}
                    {st.fullName}
                  </span>
                  <span className="tabular text-xs text-fg-muted">{st.admissionNo}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Input
                    aria-label={t('exams.markFor', { name: st.fullName })}
                    aria-invalid={bad || undefined}
                    className={`w-24 text-right ${bad ? 'border-danger' : ''}`}
                    inputMode="decimal"
                    disabled={!editable || (c && c.status !== 'present')}
                    value={c?.status === 'present' ? c.value : ''}
                    placeholder={c && c.status !== 'present' ? t(`exams.markStatuses.${c.status}`) : '—'}
                    onChange={(e) => update(st.id, { value: e.target.value.replace(',', '.'), status: 'present' })}
                  />
                  {(['absent', 'exempt'] as const).map((x) => (
                    <button
                      key={x}
                      type="button"
                      disabled={!editable}
                      aria-pressed={c?.status === x}
                      title={t(`exams.markStatuses.${x}`)}
                      onClick={() => update(st.id, c?.status === x ? { value: '', status: 'present' } : { value: '', status: x })}
                      className={`h-9 min-w-9 rounded-md border px-2 text-xs font-semibold disabled:opacity-50 ${c?.status === x ? 'border-fg bg-fg text-surface' : 'border-line-strong text-fg-muted hover:bg-subtle'}`}
                    >
                      {t(`exams.markShort.${x}`)}
                    </button>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
        {editable && (
          <div className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
            {s.can.correct && (
              <Field label={t('exams.changeReason')} error={submit.fieldErrors.reason}>
                {(id) => <Input id={id} className="w-80" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
              </Field>
            )}
            <Button
              variant="primary"
              icon={<Save className="size-4" />}
              busy={submit.busy}
              disabled={dirtyIds.length === 0 || invalid || (s.can.correct && !reason.trim())}
              onClick={() => void save()}
            >
              {t('exams.saveMarks', { count: dirtyIds.length })}
            </Button>
            {dirtyIds.length > 0 && <span className="text-xs text-fg-faint">{t('exams.draftKept')}</span>}
          </div>
        )}
        {(s.can.submit || s.can.moderate || s.can.approve || s.can.reopen) && (
          <div className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
            {s.can.submit && (
              <Button
                icon={<Send className="size-4" />}
                disabled={dirtyIds.length > 0}
                busy={act.busy}
                onClick={() => void action('submit')}
              >
                {t('exams.submit')}
              </Button>
            )}
            {s.can.moderate && (
              <Button icon={<ShieldCheck className="size-4" />} busy={act.busy} onClick={() => void action('moderate')}>
                {t('exams.moderate')}
              </Button>
            )}
            {s.can.approve && (
              <Button variant="primary" icon={<CheckCircle2 className="size-4" />} busy={act.busy} onClick={() => void action('approve')}>
                {t('exams.approve')}
              </Button>
            )}
            {s.can.reopen && (
              <>
                <Input
                  aria-label={t('exams.reopenReason')}
                  placeholder={t('exams.reopenReason')}
                  className="w-72"
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                />
                <Button
                  icon={<RotateCcw className="size-4" />}
                  disabled={!actionReason.trim()}
                  busy={act.busy}
                  onClick={() => void action('reopen')}
                >
                  {t('exams.reopen')}
                </Button>
              </>
            )}
          </div>
        )}
        {s.changes.length > 0 && (
          <details className="text-[0.8125rem]">
            <summary className="cursor-pointer font-medium">{t('exams.changeLog', { count: s.changes.length })}</summary>
            <ul className="mt-2 space-y-1">
              {s.changes.map((ch, i) => (
                <li key={i} className="text-fg-muted">
                  {original(ch.studentId)?.fullName}: {String(ch.from ?? '—')} → {String(ch.to)} · “{ch.reason}” · {ch.changedBy},{' '}
                  {formatDateTime(ch.changedAt, i18n.language)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Card>
  );
}

// Results ------------------------------------------------------------------------
interface ResultStudent {
  id: number;
  admissionNo: string;
  fullName: string;
  subjects: Array<{ subjectId: number; percent: number | null; grade: string | null; absent: boolean; exempt: boolean }>;
  total: number;
  average: number | null;
  rank: number | null;
}
interface Preview {
  preview: { subjects: Array<{ id: number; name: string }>; students: ResultStudent[]; classSection: { name: string; gradeName: string } };
  sheets: Array<{ componentId: number; subject: string; name: string; status: SheetStatus }>;
  allApproved: boolean;
  releases: Array<{ id: number; version: number; reason: string | null; publishedAt: string; publishedBy: string | null }>;
}

export function ResultTable({ subjects, students }: { subjects: Array<{ id: number; name: string }>; students: ResultStudent[] }) {
  const { t } = useTranslation();
  const cell = (x: ResultStudent['subjects'][number] | undefined) =>
    !x
      ? '—'
      : x.exempt
        ? t('exams.exemptShort')
        : x.absent
          ? t('exams.absentShort')
          : x.percent === null
            ? '…'
            : `${x.percent} ${x.grade ?? ''}`;
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead className="bg-subtle text-left text-xs text-fg-muted">
          <tr>
            <th className="px-3 py-2">{t('students.student')}</th>
            {subjects.map((s) => (
              <th key={s.id} className="px-3 py-2 text-right">
                {s.name}
              </th>
            ))}
            <th className="px-3 py-2 text-right">{t('exams.total')}</th>
            <th className="px-3 py-2 text-right">{t('exams.average')}</th>
            <th className="px-3 py-2 text-right">{t('exams.rank')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {students.map((st) => (
            <tr key={st.id}>
              <td className="px-3 py-2">
                <span className="font-medium">{st.fullName}</span> <span className="tabular text-xs text-fg-muted">{st.admissionNo}</span>
              </td>
              {subjects.map((s) => (
                <td key={s.id} className="tabular px-3 py-2 text-right whitespace-nowrap">
                  {cell(st.subjects.find((x) => x.subjectId === s.id))}
                </td>
              ))}
              <td className="tabular px-3 py-2 text-right">{st.total}</td>
              <td className="tabular px-3 py-2 text-right font-medium">{st.average ?? '—'}</td>
              <td className="tabular px-3 py-2 text-right">{st.rank ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultsTab({ series }: { series: SeriesDetail }) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const classes = series.classes.filter((cl) => series.components.some((c) => c.grade.id === cl.gradeId));
  const [classId, setClassId] = useState('');
  useEffect(() => {
    if (!classId && classes.length) setClassId(String(classes[0]!.id));
  }, [classes, classId]);
  const res = useResource<Preview>(classId ? `/exam-series/${series.id}/classes/${classId}/results` : null);
  const [reason, setReason] = useState('');
  const submit = useSubmit();
  const gradeName = useMemo(() => Object.fromEntries(series.components.map((c) => [c.grade.id, c.grade.name])), [series]);
  async function publish() {
    const ok = await submit.run(() =>
      api(`/exam-series/${series.id}/releases`, { method: 'POST', body: { classSectionId: Number(classId), ...(reason && { reason }) } }),
    );
    if (ok) {
      toast.success(t('exams.published'));
      setReason('');
      res.reload();
    }
  }
  if (classes.length === 0) return <EmptyState icon={<Award className="size-5" />} title={t('exams.noComponents')} />;
  const r = res.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <Field label={t('students.class')}>
          {(id) => (
            <Select id={id} value={classId} onChange={(e) => setClassId(e.target.value)}>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {gradeName[c.gradeId]} / {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button icon={<Printer className="size-4" />} onClick={() => window.print()} disabled={!r}>
          {t('attendance.print')}
        </Button>
      </div>
      {res.error && <Alert>{t(res.error.message)}</Alert>}
      {!r ? (
        classId ? (
          <Loading />
        ) : null
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 print:hidden">
            {r.sheets.map((sh) => (
              <Badge key={sh.componentId} tone={SHEET_TONE[sh.status]} dot>
                {sh.subject} {sh.name}: {t(`exams.sheetStatuses.${sh.status}`)}
              </Badge>
            ))}
          </div>
          {!r.allApproved && <Alert tone="info">{t('exams.previewNote')}</Alert>}
          <ResultTable subjects={r.preview.subjects} students={r.preview.students} />
          <Card title={t('exams.releases')} description={t('exams.releasesHelp')}>
            <div className="space-y-3">
              {r.releases.length === 0 ? (
                <p className="text-sm text-fg-faint">{t('exams.notPublished')}</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {r.releases.map((rel) => (
                    <li key={rel.id}>
                      <strong>v{rel.version}</strong> · {formatDateTime(rel.publishedAt, i18n.language)} · {rel.publishedBy}
                      {rel.reason && <span className="text-fg-muted"> · “{rel.reason}”</span>}
                    </li>
                  ))}
                </ul>
              )}
              {can('results.publish') && (
                <div className="flex flex-wrap items-end gap-3 print:hidden">
                  {submit.error && <Alert>{submit.error}</Alert>}
                  {r.releases.length > 0 && (
                    <Field label={t('exams.correctionReason')} error={submit.fieldErrors.reason}>
                      {(id) => <Input id={id} className="w-80" value={reason} onChange={(e) => setReason(e.target.value)} />}
                    </Field>
                  )}
                  <Button
                    variant="primary"
                    icon={<Send className="size-4" />}
                    busy={submit.busy}
                    disabled={!r.allApproved || (r.releases.length > 0 && !reason.trim())}
                    onClick={() => void publish()}
                  >
                    {r.releases.length ? t('exams.publishNewVersion') : t('exams.publish')}
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// Setup ------------------------------------------------------------------------
function SetupTab({
  series,
  yearId,
  onChanged,
  detail,
  seriesId,
  setSeriesId,
}: {
  series: SeriesRow[];
  yearId: number | null;
  onChanged: () => void;
  detail: SeriesDetail | null;
  seriesId: string;
  setSeriesId: (v: string) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const scales = useResource<{ items: Scale[] }>('/grading-scales');
  const grades = useResource<{ items: Array<{ id: number; name: string; isActive: boolean }> }>('/grades');
  const subjects = useResource<{ items: Array<{ id: number; name: string; isActive: boolean }> }>('/subjects');
  const submit = useSubmit();
  const [scaleName, setScaleName] = useState('');
  const [bandsText, setBandsText] = useState('75 A\n65 B\n50 C\n35 S\n0 W');
  const [seriesName, setSeriesName] = useState('');
  const [scaleVersionId, setScaleVersionId] = useState('');
  const [comp, setComp] = useState({ gradeId: '', subjectId: '', name: '', maxMarks: '100', weight: '100' });
  const latestVersions = (scales.data?.items ?? []).map((s) => ({ id: s.versions[0]!.id, label: `${s.name} v${s.versions[0]!.version}` }));
  useEffect(() => {
    if (!scaleVersionId && latestVersions.length) setScaleVersionId(String(latestVersions[0]!.id));
  }, [latestVersions, scaleVersionId]);
  const parseBands = () =>
    bandsText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [min, grade, ...label] = l.split(/\s+/);
        return { min: Number(min), grade: grade ?? '', label: label.join(' ') || null };
      });
  const run = async (fn: () => Promise<unknown>, msg: string, after?: () => void) => {
    const ok = await submit.run(async () => (await fn()) ?? true);
    if (ok) {
      toast.success(msg);
      after?.();
      onChanged();
      scales.reload();
    }
  };
  return (
    <div className="space-y-6">
      {submit.error && <Alert>{submit.error}</Alert>}
      <Card title={t('exams.scales')} description={t('exams.scalesHelp')}>
        <div className="space-y-4">
          <ul className="space-y-1 text-sm">
            {(scales.data?.items ?? []).map((s) => (
              <li key={s.id}>
                <strong>
                  {s.name} v{s.versions[0]!.version}
                </strong>
                : {s.versions[0]!.bands.map((b) => `${b.grade} ≥ ${b.min}`).join(' · ')}
              </li>
            ))}
          </ul>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label={t('exams.scaleName')}>
              {(id) => <Input id={id} value={scaleName} onChange={(e) => setScaleName(e.target.value)} />}
            </Field>
            <Field label={t('exams.bands')} hint={t('exams.bandsHint')}>
              {(id) => (
                <textarea
                  id={id}
                  rows={5}
                  className="block w-full rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-sm"
                  value={bandsText}
                  onChange={(e) => setBandsText(e.target.value)}
                />
              )}
            </Field>
            <Button
              icon={<Plus className="size-4" />}
              disabled={!scaleName.trim()}
              onClick={() =>
                void run(
                  () => api('/grading-scales', { method: 'POST', body: { name: scaleName, bands: parseBands() } }),
                  t('exams.scaleSaved'),
                  () => setScaleName(''),
                )
              }
            >
              {t('exams.addScale')}
            </Button>
          </div>
        </div>
      </Card>
      <Card title={t('exams.newSeries')}>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label={t('exams.seriesName')} hint={t('exams.seriesNameHint')}>
            {(id) => <Input id={id} value={seriesName} onChange={(e) => setSeriesName(e.target.value)} />}
          </Field>
          <Field label={t('exams.scale')}>
            {(id) => (
              <Select id={id} value={scaleVersionId} onChange={(e) => setScaleVersionId(e.target.value)}>
                {latestVersions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button
            variant="primary"
            icon={<Plus className="size-4" />}
            disabled={!seriesName.trim() || !scaleVersionId || !yearId}
            onClick={() =>
              void run(
                () =>
                  api<{ id: number }>('/exam-series', {
                    method: 'POST',
                    body: { academicYearId: yearId, name: seriesName, gradingScaleVersionId: Number(scaleVersionId) },
                  }),
                t('exams.seriesSaved'),
                () => setSeriesName(''),
              )
            }
          >
            {t('exams.addSeries')}
          </Button>
        </div>
      </Card>
      {series.length > 0 && (
        <Card title={t('exams.components')} description={t('exams.componentsHelp')}>
          <div className="space-y-4">
            <Select aria-label={t('exams.series')} className="max-w-sm" value={seriesId} onChange={(e) => setSeriesId(e.target.value)}>
              {series.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {(detail?.components ?? []).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 px-3.5 py-2 text-sm">
                  <span>
                    {c.grade.name} · {c.subject.name} · {c.name} — {t('exams.outOf', { max: c.maxMarks })},{' '}
                    {t('exams.weight', { weight: c.weight })}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 className="size-4" />}
                    onClick={() =>
                      void run(
                        () => api(`/exam-components/${c.id}`, { method: 'DELETE' }),
                        t('crud.deleted', { noun: t('exams.component') }),
                      )
                    }
                  >
                    {t('crud.delete')}
                  </Button>
                </li>
              ))}
            </ul>
            <div className="grid gap-3 sm:grid-cols-6 sm:items-end">
              <Field label={t('announcements.grade')}>
                {(id) => (
                  <Select id={id} value={comp.gradeId} onChange={(e) => setComp({ ...comp, gradeId: e.target.value })}>
                    <option value="" disabled>
                      {t('crud.choose')}
                    </option>
                    {(grades.data?.items ?? [])
                      .filter((g) => g.isActive)
                      .map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
              <Field label={t('staff.subject')}>
                {(id) => (
                  <Select id={id} value={comp.subjectId} onChange={(e) => setComp({ ...comp, subjectId: e.target.value })}>
                    <option value="" disabled>
                      {t('crud.choose')}
                    </option>
                    {(subjects.data?.items ?? [])
                      .filter((s) => s.isActive)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
              <Field label={t('exams.componentName')}>
                {(id) => (
                  <Input id={id} placeholder="Paper I" value={comp.name} onChange={(e) => setComp({ ...comp, name: e.target.value })} />
                )}
              </Field>
              <Field label={t('exams.maxMarks')}>
                {(id) => (
                  <Input id={id} type="number" value={comp.maxMarks} onChange={(e) => setComp({ ...comp, maxMarks: e.target.value })} />
                )}
              </Field>
              <Field label={t('exams.weightLabel')}>
                {(id) => <Input id={id} type="number" value={comp.weight} onChange={(e) => setComp({ ...comp, weight: e.target.value })} />}
              </Field>
              <Button
                icon={<Plus className="size-4" />}
                disabled={!seriesId || !comp.gradeId || !comp.subjectId || !comp.name.trim()}
                onClick={() =>
                  void run(
                    () =>
                      api(`/exam-series/${seriesId}/components`, {
                        method: 'POST',
                        body: {
                          gradeId: Number(comp.gradeId),
                          subjectId: Number(comp.subjectId),
                          name: comp.name,
                          maxMarks: Number(comp.maxMarks),
                          weight: Number(comp.weight),
                        },
                      }),
                    t('exams.componentSaved'),
                    () => setComp({ ...comp, name: '' }),
                  )
                }
              >
                {t('exams.addComponent')}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
