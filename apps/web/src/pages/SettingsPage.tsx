import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCALES } from '@sms/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useResource, useSubmit } from '../lib/data';
import { Alert, Button, Field, Loading, PageHeader, SelectInput, TextInput } from '../components/ui';

interface School {
  name: string;
  shortName: string | null;
  defaultLocale: string;
  timezone: string;
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const canManage = useAuth().can('school.settings.manage');
  const school = useResource<School>('/school');
  const [form, setForm] = useState<School | null>(null);
  const [saved, setSaved] = useState(false);
  const submit = useSubmit();
  useEffect(() => {
    if (school.data) setForm(school.data);
  }, [school.data]);

  if (school.error) return <Alert>{t(school.error.message)}</Alert>;
  if (!form || !school.data) return <Loading />;
  const original = school.data;
  const dirty = (Object.keys(form) as Array<keyof School>).some((k) => form[k] !== original[k]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const body: Partial<School> = {};
    for (const k of Object.keys(form) as Array<keyof School>) if (form[k] !== original[k]) Object.assign(body, { [k]: form[k] });
    if (body.shortName === '') body.shortName = null;
    setSaved(false);
    if (await submit.run(() => api('/school', { method: 'PATCH', body }))) {
      setSaved(true);
      school.reload();
    }
  }

  return (
    <>
      <PageHeader title={t('settings.title')} intro={t('settings.intro')} />
      <form onSubmit={onSubmit} noValidate className="max-w-md space-y-4">
        {saved && <Alert tone="success">{t('common.saved')}</Alert>}
        {submit.error && <Alert>{submit.error}</Alert>}
        <fieldset disabled={!canManage} className="space-y-4">
          <Field label={t('settings.name')} error={submit.fieldErrors.name}>
            {(id) => <TextInput id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
          </Field>
          <Field label={t('settings.shortName')} hint={t('settings.shortNameHint')} error={submit.fieldErrors.shortName}>
            {(id, d) => (
              <TextInput
                id={id}
                aria-describedby={d}
                value={form.shortName ?? ''}
                onChange={(e) => setForm({ ...form, shortName: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('settings.defaultLanguage')}>
            {(id) => (
              <SelectInput id={id} value={form.defaultLocale} onChange={(e) => setForm({ ...form, defaultLocale: e.target.value })}>
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {t(`language.${l}`)}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <Field label={t('settings.timezone')} hint={t('settings.timezoneHint')} error={submit.fieldErrors.timezone}>
            {(id, d) => (
              <TextInput
                id={id}
                aria-describedby={d}
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              />
            )}
          </Field>
        </fieldset>
        {canManage && (
          <Button type="submit" variant="primary" busy={submit.busy} disabled={!dirty || !form.name.trim()}>
            {t('common.saveChanges')}
          </Button>
        )}
      </form>
    </>
  );
}
