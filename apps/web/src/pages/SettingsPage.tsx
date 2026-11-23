import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCALES } from '@sms/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useResource, useSubmit } from '../lib/data';
import { Alert, Button, Card, Field, FormSection, Input, Loading, PageHeader, Select, useToast } from '../components/ui';

interface School {
  name: string;
  shortName: string | null;
  defaultLocale: string;
  timezone: string;
}

/** Time zones offered first; any IANA name can still be typed. */
const COMMON_ZONES = ['Asia/Colombo', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'UTC'];

export default function SettingsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const canManage = useAuth().can('school.settings.manage');
  const school = useResource<School>('/school');
  const [form, setForm] = useState<School | null>(null);
  const submit = useSubmit();
  useEffect(() => {
    if (school.data) setForm(school.data);
  }, [school.data]);

  const header = (
    <PageHeader
      crumbs={[{ label: t('nav.dashboard'), to: '/' }, { label: t('settings.title') }]}
      title={t('settings.title')}
      description={t('settings.intro')}
    />
  );
  if (school.error)
    return (
      <>
        {header}
        <Alert>{t(school.error.message)}</Alert>
      </>
    );
  if (!form || !school.data)
    return (
      <>
        {header}
        <Loading />
      </>
    );
  const original = school.data;
  const dirty = (Object.keys(form) as Array<keyof School>).some((k) => (form[k] ?? '') !== (original[k] ?? ''));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const body: Partial<School> = {};
    for (const k of Object.keys(form) as Array<keyof School>)
      if ((form[k] ?? '') !== (original[k] ?? '')) Object.assign(body, { [k]: form[k] });
    if (body.shortName === '') body.shortName = null;
    if (await submit.run(() => api('/school', { method: 'PATCH', body }))) {
      toast.success(t('settings.saved'));
      school.reload();
    }
  }

  const fe = submit.fieldErrors;
  return (
    <>
      {header}
      <form onSubmit={onSubmit} noValidate className="pb-20">
        {submit.error && (
          <div className="mb-4">
            <Alert>{submit.error}</Alert>
          </div>
        )}
        {!canManage && (
          <div className="mb-4">
            <Alert tone="info">{t('settings.readOnly')}</Alert>
          </div>
        )}
        <Card>
          <fieldset disabled={!canManage}>
            <FormSection title={t('settings.profileTitle')} description={t('settings.profileHelp')}>
              <Field label={t('settings.name')} error={fe.name}>
                {(id, d, invalid) => (
                  <Input
                    id={id}
                    aria-describedby={d}
                    aria-invalid={invalid || undefined}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                )}
              </Field>
              <Field
                label={t('settings.shortName')}
                hint={t('settings.shortNameHint')}
                error={fe.shortName}
                optional={t('common.optional')}
              >
                {(id, d, invalid) => (
                  <Input
                    id={id}
                    aria-describedby={d}
                    aria-invalid={invalid || undefined}
                    value={form.shortName ?? ''}
                    onChange={(e) => setForm({ ...form, shortName: e.target.value })}
                  />
                )}
              </Field>
            </FormSection>
            <FormSection title={t('settings.regionalTitle')} description={t('settings.regionalHelp')}>
              <Field label={t('settings.defaultLanguage')} hint={t('settings.defaultLanguageHint')}>
                {(id, d) => (
                  <Select
                    id={id}
                    aria-describedby={d}
                    value={form.defaultLocale}
                    onChange={(e) => setForm({ ...form, defaultLocale: e.target.value })}
                  >
                    {LOCALES.map((l) => (
                      <option key={l} value={l}>
                        {t(`language.${l}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('settings.timezone')} hint={t('settings.timezoneHint')} error={fe.timezone}>
                {(id, d, invalid) => (
                  <>
                    <Input
                      id={id}
                      list="tz-options"
                      aria-describedby={d}
                      aria-invalid={invalid || undefined}
                      value={form.timezone}
                      onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                    />
                    <datalist id="tz-options">
                      {COMMON_ZONES.map((z) => (
                        <option key={z} value={z} />
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
            </FormSection>
          </fieldset>
        </Card>

        {/* Unsaved-changes bar: only appears when something changed. */}
        {canManage && dirty && (
          <div
            className="fixed right-0 bottom-0 left-0 z-20 border-t border-line bg-surface/95 px-4 py-3 shadow-[var(--shadow-pop)] backdrop-blur md:left-[var(--sidebar-w)]"
            role="region"
            aria-label={t('settings.unsaved')}
          >
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 sm:px-2 lg:px-4">
              <p className="text-sm text-fg-muted">{t('settings.unsaved')}</p>
              <div className="flex gap-2">
                <Button onClick={() => setForm(original)}>{t('common.discard')}</Button>
                <Button type="submit" variant="primary" busy={submit.busy} disabled={!form.name.trim()}>
                  {t('common.saveChanges')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </form>
    </>
  );
}
