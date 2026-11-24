import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, Check, History, Link2, Pencil, School, Star, Trash2, UserRound, Users, X } from 'lucide-react';
import {
  GENDERS,
  GUARDIAN_RELATIONSHIPS,
  STUDENT_LEAVE_REASONS,
  VERIFICATION_METHODS,
  type GuardianRelationship,
  type Paginated,
} from '@sms/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { query, useResource, useSubmit } from '../../lib/data';
import { sectionLabel, useSections, useYears } from '../../lib/academic';
import { formatDate, formatDateTime, todayIso } from '../../lib/format';
import { FormDrawer, type FieldDef } from '../../components/CrudSection';
import { Alert, Avatar, Badge, Button, DescriptionList, Drawer, Field, Input, Loading, Select, Tabs, useToast } from '../../components/ui';
import { STATUS_TONE, type GuardianItem, type StudentDetail } from './types';

type Tab = 'details' | 'classes' | 'guardians' | 'history';

export function StudentDrawer({ studentId, onClose, onChanged }: { studentId: number; onClose: () => void; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const res = useResource<StudentDetail>(`/students/${studentId}`);
  const [tab, setTab] = useState<Tab>('details');
  const [editing, setEditing] = useState(false);
  const toast = useToast();
  const s = res.data;
  const canManage = can('students.manage');
  const changed = () => {
    res.reload();
    onChanged();
  };

  const tabs = [
    { key: 'details' as const, label: t('students.tabs.details'), icon: <UserRound className="size-4" /> },
    { key: 'classes' as const, label: t('students.tabs.classes'), icon: <School className="size-4" /> },
    ...(s?.guardians ? [{ key: 'guardians' as const, label: t('students.tabs.guardians'), icon: <Users className="size-4" /> }] : []),
    ...(s && s.statusHistory.length > 0
      ? [{ key: 'history' as const, label: t('students.tabs.history'), icon: <History className="size-4" /> }]
      : []),
  ];

  const editFields: FieldDef[] = [
    { name: 'admissionNo', label: t('students.admissionNo'), type: 'text', required: true, half: true },
    { name: 'admittedOn', label: t('students.admittedOn'), type: 'date', required: true, half: true },
    { name: 'fullName', label: t('students.fullName'), type: 'text', required: true },
    { name: 'nameWithInitials', label: t('students.nameWithInitials'), type: 'text', nullable: true },
    { name: 'dateOfBirth', label: t('students.dateOfBirth'), type: 'date', nullable: true, half: true },
    {
      name: 'gender',
      label: t('students.gender'),
      type: 'select',
      nullable: true,
      half: true,
      options: GENDERS.map((g) => ({ value: g, label: t(`students.genders.${g}`) })),
    },
  ];

  return (
    <Drawer
      open
      wide
      title={s?.fullName ?? t('common.loading')}
      header={
        s ? (
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={s.fullName} />
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">{s.fullName}</h2>
              <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-fg-muted">
                <span className="tabular">{s.admissionNo}</span>
                <Badge tone={STATUS_TONE[s.status]} dot>
                  {t(`students.statuses.${s.status}`)}
                </Badge>
              </p>
            </div>
          </div>
        ) : undefined
      }
      onClose={onClose}
      footer={<Button onClick={onClose}>{t('common.close')}</Button>}
    >
      {res.error ? (
        <Alert>{t(res.error.message)}</Alert>
      ) : !s ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <Tabs items={tabs} value={tab} onChange={setTab} label={t('students.tabs.label')} />
          {tab === 'details' && (
            <div className="space-y-4">
              <DescriptionList
                items={[
                  { label: t('students.fullName'), value: s.fullName },
                  { label: t('students.nameWithInitials'), value: s.nameWithInitials ?? '—' },
                  { label: t('students.admissionNo'), value: <span className="tabular">{s.admissionNo}</span> },
                  { label: t('students.admittedOn'), value: formatDate(s.admittedOn, i18n.language) },
                  { label: t('students.dateOfBirth'), value: s.dateOfBirth ? formatDate(s.dateOfBirth, i18n.language) : '—' },
                  { label: t('students.gender'), value: s.gender ? t(`students.genders.${s.gender}`) : '—' },
                  {
                    label: t('students.class'),
                    value: s.currentClass
                      ? `${s.currentClass.grade.name} / ${s.currentClass.name} · ${s.currentClass.academicYear.label}`
                      : t('students.notEnrolled'),
                  },
                  ...(s.leftOn ? [{ label: t('students.leftOn'), value: formatDate(s.leftOn, i18n.language) }] : []),
                  { label: t('students.account'), value: s.hasAccount ? t('common.yes') : t('students.noAccount') },
                ]}
              />
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                    {t('students.edit')}
                  </Button>
                  <StatusActions student={s} onChanged={changed} />
                  {!s.hasAccount && s.status === 'active' && <AccountAction student={s} onChanged={changed} />}
                </div>
              )}
              <p className="text-xs text-fg-faint">{t('students.privacyNote')}</p>
            </div>
          )}
          {tab === 'classes' && <ClassesPanel student={s} canManage={canManage} onChanged={changed} />}
          {tab === 'guardians' && s.guardians && (
            <GuardiansPanel student={s} canManage={can('guardians.link.manage')} onChanged={changed} />
          )}
          {tab === 'history' && <HistoryPanel student={s} />}
        </div>
      )}
      {editing && s && (
        <FormDrawer
          title={t('students.edit')}
          fields={editFields}
          initial={{
            admissionNo: s.admissionNo,
            admittedOn: s.admittedOn,
            fullName: s.fullName,
            nameWithInitials: s.nameWithInitials ?? '',
            dateOfBirth: s.dateOfBirth ?? '',
            gender: s.gender ?? '',
          }}
          path={`/students/${s.id}`}
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

// Classes ----------------------------------------------------------------------
function ClassesPanel({ student, canManage, onChanged }: { student: StudentDetail; canManage: boolean; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { years, current } = useYears();
  const [yearId, setYearId] = useState('');
  const { sections } = useSections(yearId || null);
  const [sectionId, setSectionId] = useState('');
  const [startsOn, setStartsOn] = useState(todayIso());
  const [rollNo, setRollNo] = useState('');
  const submit = useSubmit();
  useEffect(() => {
    if (!yearId && current) setYearId(String(current.id));
  }, [current, yearId]);
  const options = sections.filter((x) => x.id !== student.currentClass?.id);

  async function enrol(e: FormEvent) {
    e.preventDefault();
    const ok = await submit.run(() =>
      api(`/students/${student.id}/enrollments`, {
        method: 'POST',
        body: { classSectionId: Number(sectionId), startsOn, rollNo: rollNo ? Number(rollNo) : null },
      }),
    );
    if (ok) {
      toast.success(student.currentClass ? t('students.moved') : t('students.enrolled'));
      setSectionId('');
      setRollNo('');
      onChanged();
    }
  }

  return (
    <div className="space-y-5">
      {student.enrollments.length === 0 ? (
        <Alert tone="info">{t('students.noEnrolments')}</Alert>
      ) : (
        <ol className="divide-y divide-line rounded-lg border border-line">
          {student.enrollments.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
              <span>
                <span className="font-medium">
                  {e.class.gradeName} / {e.class.name}
                </span>
                <span className="ml-2 text-fg-muted">{e.class.yearLabel}</span>
                {e.rollNo !== null && <span className="ml-2 text-fg-faint">#{e.rollNo}</span>}
              </span>
              <span className="tabular text-[0.8125rem] text-fg-muted">
                {formatDate(e.startsOn, i18n.language)} – {e.endsOn ? formatDate(e.endsOn, i18n.language) : t('students.now')}
                {e.endReason && (
                  <span className="ml-2">
                    <Badge>{t(`students.endReasons.${e.endReason}`)}</Badge>
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
      {canManage && student.status === 'active' && (
        <form onSubmit={enrol} className="space-y-4 rounded-lg border border-line p-4">
          <h3 className="text-sm font-semibold">{student.currentClass ? t('students.moveTitle') : t('students.enrolTitle')}</h3>
          {submit.error && <Alert>{submit.error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
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
            <Field label={t('students.class')} error={submit.fieldErrors.classSectionId}>
              {(id) => (
                <Select id={id} value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                  <option value="" disabled>
                    {t('crud.choose')}
                  </option>
                  {options.map((x) => (
                    <option key={x.id} value={x.id}>
                      {sectionLabel(x)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('students.startsOn')} error={submit.fieldErrors.startsOn}>
              {(id) => <Input id={id} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />}
            </Field>
            <Field label={t('students.rollNo')} optional={t('common.optional')} error={submit.fieldErrors.rollNo}>
              {(id) => (
                <Input id={id} type="number" inputMode="numeric" min={1} value={rollNo} onChange={(e) => setRollNo(e.target.value)} />
              )}
            </Field>
          </div>
          {student.currentClass && <p className="text-[0.8125rem] text-fg-muted">{t('students.moveHelp')}</p>}
          <Button type="submit" variant="primary" busy={submit.busy} disabled={!sectionId || !startsOn}>
            {student.currentClass ? t('students.move') : t('students.enrol')}
          </Button>
        </form>
      )}
    </div>
  );
}

// Guardians ----------------------------------------------------------------------
function GuardiansPanel({ student, canManage, onChanged }: { student: StudentDetail; canManage: boolean; onChanged: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [verifying, setVerifying] = useState<number | null>(null);
  const [method, setMethod] = useState<string>(VERIFICATION_METHODS[0]);
  const [linking, setLinking] = useState(false);
  const action = useSubmit();
  const base = `/students/${student.id}/guardians`;

  const run = async (fn: () => Promise<unknown>, message: string) => {
    const ok = await action.run(async () => (await fn()) ?? true);
    if (ok) {
      toast.success(message);
      setVerifying(null);
      onChanged();
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[0.8125rem] text-fg-muted">{t('guardians.verifyNote')}</p>
      {action.error && <Alert>{action.error}</Alert>}
      {student.guardians!.length === 0 ? (
        <Alert tone="info">{t('guardians.noneLinked')}</Alert>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {student.guardians!.map((g) => (
            <li key={g.id} className="space-y-2 px-3.5 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {g.fullName}
                    {g.isPrimary && (
                      <span className="ml-2">
                        <Badge tone="brand">{t('guardians.primary')}</Badge>
                      </span>
                    )}
                  </p>
                  <p className="text-[0.8125rem] text-fg-muted">
                    {t(`guardians.relationships.${g.relationship}`)}
                    {g.phone && ` · ${g.phone}`}
                    {g.email && ` · ${g.email}`}
                  </p>
                </div>
                <Badge tone={g.verificationStatus === 'verified' ? 'ok' : g.verificationStatus === 'rejected' ? 'danger' : 'warn'} dot>
                  {t(`guardians.verification.${g.verificationStatus}`)}
                </Badge>
              </div>
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  {g.verificationStatus !== 'verified' && (
                    <Button
                      size="sm"
                      icon={<BadgeCheck className="size-4" />}
                      onClick={() => setVerifying(verifying === g.id ? null : g.id)}
                    >
                      {t('guardians.verify')}
                    </Button>
                  )}
                  {g.verificationStatus !== 'rejected' && (
                    <Button
                      size="sm"
                      icon={<X className="size-4" />}
                      onClick={() =>
                        void run(
                          () => api(`${base}/${g.id}/verify`, { method: 'POST', body: { decision: 'rejected' } }),
                          t('guardians.rejected'),
                        )
                      }
                    >
                      {t('guardians.reject')}
                    </Button>
                  )}
                  {!g.isPrimary && (
                    <Button
                      size="sm"
                      icon={<Star className="size-4" />}
                      onClick={() =>
                        void run(() => api(`${base}/${g.id}`, { method: 'PATCH', body: { isPrimary: true } }), t('common.saved'))
                      }
                    >
                      {t('guardians.makePrimary')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 className="size-4" />}
                    onClick={() => void run(() => api(`${base}/${g.id}`, { method: 'DELETE' }), t('guardians.unlinked'))}
                  >
                    {t('guardians.unlink')}
                  </Button>
                </div>
              )}
              {verifying === g.id && (
                <div className="flex flex-wrap items-end gap-2 rounded-md bg-subtle p-3">
                  <Field label={t('guardians.method')}>
                    {(id) => (
                      <Select id={id} value={method} onChange={(e) => setMethod(e.target.value)}>
                        {VERIFICATION_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {t(`guardians.methods.${m}`)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Button
                    variant="primary"
                    icon={<Check className="size-4" />}
                    busy={action.busy}
                    onClick={() =>
                      void run(
                        () => api(`${base}/${g.id}/verify`, { method: 'POST', body: { decision: 'verified', method } }),
                        t('guardians.verified'),
                      )
                    }
                  >
                    {t('guardians.confirmVerify')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage &&
        (linking ? (
          <LinkGuardianForm
            studentId={student.id}
            exclude={student.guardians!.map((g) => g.id)}
            onCancel={() => setLinking(false)}
            onDone={() => {
              setLinking(false);
              toast.success(t('guardians.linked'));
              onChanged();
            }}
          />
        ) : (
          <Button icon={<Link2 className="size-4" />} onClick={() => setLinking(true)}>
            {t('guardians.link')}
          </Button>
        ))}
    </div>
  );
}

function LinkGuardianForm({
  studentId,
  exclude,
  onCancel,
  onDone,
}: {
  studentId: number;
  exclude: number[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<number | 'new' | null>(null);
  const [relationship, setRelationship] = useState<GuardianRelationship>('mother');
  const [isPrimary, setIsPrimary] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const submit = useSubmit();
  useEffect(() => {
    const h = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(h);
  }, [search]);
  const results = useResource<Paginated<GuardianItem>>(q.length >= 2 ? `/guardians${query({ q, pageSize: 8 })}` : null);
  const matches = useMemo(() => (results.data?.items ?? []).filter((g) => !exclude.includes(g.id)), [results.data, exclude]);

  async function save(e: FormEvent) {
    e.preventDefault();
    const ok = await submit.run(async () => {
      let guardianId = chosen as number;
      if (chosen === 'new') {
        const created = await api<{ id: number }>('/guardians', { method: 'POST', body: { fullName, phone, email } });
        guardianId = created.id;
      }
      await api(`/students/${studentId}/guardians`, { method: 'POST', body: { guardianId, relationship, isPrimary } });
      return true;
    });
    if (ok) onDone();
  }

  return (
    <form onSubmit={save} className="space-y-4 rounded-lg border border-line p-4">
      <h3 className="text-sm font-semibold">{t('guardians.link')}</h3>
      {submit.error && <Alert>{submit.error}</Alert>}
      {chosen === null && (
        <>
          <Field label={t('guardians.findExisting')} hint={t('guardians.findHint')}>
            {(id) => <Input id={id} type="search" value={search} onChange={(e) => setSearch(e.target.value)} />}
          </Field>
          {matches.length > 0 && (
            <ul className="divide-y divide-line rounded-md border border-line">
              {matches.map((g) => (
                <li key={g.id}>
                  <button type="button" className="w-full px-3 py-2 text-left hover:bg-subtle" onClick={() => setChosen(g.id)}>
                    <span className="font-medium">{g.fullName}</span>
                    <span className="ml-2 text-[0.8125rem] text-fg-muted">{[g.phone, g.email].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button type="button" variant="ghost" onClick={() => setChosen('new')}>
            {t('guardians.addNew')}
          </Button>
        </>
      )}
      {chosen === 'new' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label={t('guardians.fullName')} error={submit.fieldErrors.fullName}>
              {(id) => <Input id={id} value={fullName} onChange={(e) => setFullName(e.target.value)} />}
            </Field>
          </div>
          <Field label={t('guardians.phone')} optional={t('common.optional')} error={submit.fieldErrors.phone}>
            {(id) => <Input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}
          </Field>
          <Field label={t('guardians.email')} optional={t('common.optional')} error={submit.fieldErrors.email}>
            {(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
        </div>
      )}
      {chosen !== null && (
        <div className="grid gap-4 sm:grid-cols-2">
          {typeof chosen === 'number' && (
            <p className="text-sm sm:col-span-2">
              {t('guardians.linking', {
                name: matches.find((g) => g.id === chosen)?.fullName ?? results.data?.items.find((g) => g.id === chosen)?.fullName,
              })}
            </p>
          )}
          <Field label={t('guardians.relationship')}>
            {(id) => (
              <Select id={id} value={relationship} onChange={(e) => setRelationship(e.target.value as GuardianRelationship)}>
                {GUARDIAN_RELATIONSHIPS.map((r) => (
                  <option key={r} value={r}>
                    {t(`guardians.relationships.${r}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-brand-600"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
            />
            {t('guardians.primaryContact')}
          </label>
        </div>
      )}
      <div className="flex gap-2">
        <Button type="button" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        {chosen !== null && (
          <Button type="submit" variant="primary" busy={submit.busy} disabled={chosen === 'new' && !fullName.trim()}>
            {t('guardians.linkConfirm')}
          </Button>
        )}
      </div>
    </form>
  );
}

// Status history -------------------------------------------------------------------
function HistoryPanel({ student }: { student: StudentDetail }) {
  const { t, i18n } = useTranslation();
  return (
    <ol className="divide-y divide-line rounded-lg border border-line">
      {student.statusHistory.map((h) => (
        <li key={h.id} className="space-y-1 px-3.5 py-2.5">
          <p className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              {t(`students.statuses.${h.toStatus}`)} · {t(`students.reasons.${h.reason}`, { defaultValue: h.reason })}
            </span>
            <span className="tabular text-[0.8125rem] text-fg-muted">{formatDate(h.effectiveOn, i18n.language)}</span>
          </p>
          {h.note && <p className="text-[0.8125rem] whitespace-pre-line text-fg-muted">{h.note}</p>}
          <p className="text-xs text-fg-faint">{t('students.recordedAt', { when: formatDateTime(h.recordedAt, i18n.language) })}</p>
        </li>
      ))}
    </ol>
  );
}

function StatusActions({ student, onChanged }: { student: StudentDetail; onChanged: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const leaveFields: FieldDef[] = [
    {
      name: 'status',
      label: t('students.leave.status'),
      type: 'select',
      required: true,
      initial: 'left',
      options: (['left', 'transferred', 'graduated'] as const).map((s) => ({ value: s, label: t(`students.statuses.${s}`) })),
    },
    { name: 'effectiveOn', label: t('students.leave.effectiveOn'), type: 'date', required: true, initial: todayIso(), half: true },
    {
      name: 'reason',
      label: t('students.leave.reason'),
      type: 'select',
      required: true,
      half: true,
      initial: 'transfer',
      options: STUDENT_LEAVE_REASONS.map((r) => ({ value: r, label: t(`students.reasons.${r}`) })),
    },
    { name: 'note', label: t('students.leave.note'), type: 'textarea', nullable: true, hint: t('students.leave.noteHint') },
  ];
  const readmitFields: FieldDef[] = [
    { name: 'effectiveOn', label: t('students.leave.effectiveOn'), type: 'date', required: true, initial: todayIso() },
    { name: 'note', label: t('students.leave.note'), type: 'textarea', nullable: true },
  ];
  const active = student.status === 'active';
  const fields = active ? leaveFields : readmitFields;
  return (
    <>
      <Button variant={active ? 'danger' : 'primary'} onClick={() => setOpen(true)}>
        {active ? t('students.leave.action') : t('students.readmit')}
      </Button>
      {open && (
        <FormDrawer
          title={active ? t('students.leave.title', { name: student.fullName }) : t('students.readmitTitle', { name: student.fullName })}
          description={active ? t('students.leave.intro') : undefined}
          fields={fields}
          initial={Object.fromEntries(fields.map((f) => [f.name, f.initial ?? '']))}
          path={`/students/${student.id}/${active ? 'leave' : 'readmit'}`}
          mode="create"
          submitLabel={active ? t('students.leave.confirm') : t('students.readmit')}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            toast.success(active ? t('students.leave.done') : t('students.readmitted'));
            onChanged();
          }}
        />
      )}
    </>
  );
}

function AccountAction({ student, onChanged }: { student: StudentDetail; onChanged: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const fields: FieldDef[] = [
    {
      name: 'identifier',
      label: t('students.username'),
      type: 'text',
      required: true,
      hint: t('students.usernameHint'),
      initial: student.admissionNo.toLowerCase().replace(/\//g, '.'),
    },
    {
      name: 'temporaryPassword',
      label: t('students.temporaryPassword'),
      type: 'text',
      required: true,
      hint: t('users.onboardingTemporaryHint'),
    },
  ];
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t('students.createAccount')}</Button>
      {open && (
        <FormDrawer
          title={t('students.createAccountTitle', { name: student.fullName })}
          description={t('students.createAccountHelp')}
          fields={fields}
          initial={Object.fromEntries(fields.map((f) => [f.name, f.initial ?? '']))}
          path={`/students/${student.id}/account`}
          mode="create"
          submitLabel={t('students.createAccount')}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            toast.success(t('students.accountCreated'));
            onChanged();
          }}
        />
      )}
    </>
  );
}
