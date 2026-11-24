import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useResource, useSubmit } from '../../lib/data';
import { sectionLabel, useSections } from '../../lib/academic';
import { Alert, Button, Checkbox, Drawer, Field, Input, Loading, Select, useToast } from '../../components/ui';
import type { Year } from './types';

interface RosterItem {
  id: number;
  admissionNo: string;
  fullName: string;
  rollNo: number | null;
}

/** Year-end promotion: move a whole class into a class of another year, untick students who repeat. */
export function PromoteDrawer({ years, onClose, onDone }: { years: Year[]; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const current = years.find((y) => y.isCurrent) ?? years[0];
  const next = years.filter((y) => current && y.startsOn > current.startsOn).sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0];
  const [fromYear, setFromYear] = useState(String(current?.id ?? ''));
  const [toYear, setToYear] = useState(String(next?.id ?? current?.id ?? ''));
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [startsOn, setStartsOn] = useState(next?.startsOn ?? '');
  const [kept, setKept] = useState<Set<number>>(new Set());
  const from = useSections(fromYear || null);
  const to = useSections(toYear || null);
  const roster = useResource<{ items: RosterItem[] }>(fromId ? `/class-sections/${fromId}/students` : null);
  const submit = useSubmit();

  useEffect(() => setKept(new Set()), [fromId]);
  useEffect(() => {
    const y = years.find((x) => String(x.id) === toYear);
    if (y) setStartsOn(y.startsOn);
  }, [toYear, years]);

  const students = roster.data?.items ?? [];
  const moving = students.filter((s) => !kept.has(s.id)).length;

  async function run() {
    const res = await submit.run(() =>
      api<{ moved: number; kept: number }>('/enrollments/promote', {
        method: 'POST',
        body: { fromClassSectionId: Number(fromId), toClassSectionId: Number(toId), startsOn, excludeStudentIds: [...kept] },
      }),
    );
    if (res) {
      toast.success(t('students.promote.done', { count: res.moved }));
      onDone();
    }
  }

  const yearSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <Field label={label}>
      {(id) => (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {years.map((y) => (
            <option key={y.id} value={y.id}>
              {y.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );

  return (
    <Drawer
      open
      title={t('students.promote.title')}
      description={t('students.promote.intro')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" busy={submit.busy} disabled={!fromId || !toId || !startsOn || moving === 0} onClick={() => void run()}>
            {t('students.promote.confirm', { count: moving })}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {submit.error && <Alert>{submit.error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          {yearSelect(fromYear, (v) => (setFromYear(v), setFromId('')), t('students.promote.fromYear'))}
          <Field label={t('students.promote.fromClass')}>
            {(id) => (
              <Select id={id} value={fromId} onChange={(e) => setFromId(e.target.value)}>
                <option value="" disabled>
                  {t('crud.choose')}
                </option>
                {from.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {sectionLabel(s)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {yearSelect(toYear, (v) => (setToYear(v), setToId('')), t('students.promote.toYear'))}
          <Field label={t('students.promote.toClass')}>
            {(id) => (
              <Select id={id} value={toId} onChange={(e) => setToId(e.target.value)}>
                <option value="" disabled>
                  {t('crud.choose')}
                </option>
                {to.sections
                  .filter((s) => String(s.id) !== fromId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {sectionLabel(s)}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label={t('students.startsOn')} hint={t('students.promote.startsOnHint')} error={submit.fieldErrors.startsOn}>
            {(id) => <Input id={id} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />}
          </Field>
        </div>
        {fromId &&
          (roster.loading ? (
            <Loading />
          ) : students.length === 0 ? (
            <Alert tone="info">{t('students.promote.emptyClass')}</Alert>
          ) : (
            <div className="space-y-2">
              <p className="text-[0.8125rem] text-fg-muted">{t('students.promote.untickHelp')}</p>
              <ul className="divide-y divide-line rounded-lg border border-line px-3.5">
                {students.map((s) => (
                  <li key={s.id}>
                    <Checkbox
                      label={s.fullName}
                      description={s.admissionNo}
                      checked={!kept.has(s.id)}
                      onChange={(e) =>
                        setKept((cur) => {
                          const n = new Set(cur);
                          if (e.target.checked) n.delete(s.id);
                          else n.add(s.id);
                          return n;
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>
    </Drawer>
  );
}
