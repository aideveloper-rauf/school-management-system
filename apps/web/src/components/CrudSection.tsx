import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Inbox, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useResource, useSubmit } from '../lib/data';
import {
  Alert,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Drawer,
  EmptyState,
  Field,
  Input,
  Select,
  useToast,
  type Column,
  type MenuItem,
} from './ui';

/**
 * Config-driven list + create/edit/delete for school configuration (grades, rooms, …).
 * Forms hold string/boolean values and convert them to the API's types on submit; edits send
 * only changed fields (PATCH). The API validates everything again and is the source of truth.
 */
export type FieldType = 'text' | 'number' | 'date' | 'time' | 'checkbox' | 'select' | 'email' | 'tel' | 'textarea';

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  hint?: string;
  /** Empty input is sent as null (for optional numbers/selects/text). */
  nullable?: boolean;
  /** Only shown when creating (e.g. a class section's year and grade). */
  createOnly?: boolean;
  /** For selects: options; `numeric` sends Number(value). */
  options?: Array<{ value: string; label: string }>;
  numeric?: boolean;
  /** Default for new items. */
  initial?: string | boolean;
  required?: boolean;
  /** Lay out two short fields side by side. */
  half?: boolean;
}

export interface ColumnDef<T> {
  label: string;
  render: (item: T) => ReactNode;
  /** Secondary information: hidden on narrower desktop widths. */
  wide?: boolean;
}

export type Values = Record<string, string | boolean>;

export function CrudSection<T extends { id: number }>({
  title,
  intro,
  listPath,
  createPath,
  itemPath,
  columns,
  fields,
  toValues,
  canManage,
  noun,
  emptyText,
  emptyHelp,
  filters,
  extraActions,
  searchText,
  onChanged,
}: {
  title: string;
  intro?: string;
  /** GET path returning `{ items: T[] }`; null while a required filter is unset. */
  listPath: string | null;
  createPath: string;
  itemPath: (id: number) => string;
  columns: ColumnDef<T>[];
  fields: FieldDef[];
  /** Existing item → form values (keys = field names). */
  toValues: (item: T) => Values;
  canManage: boolean;
  /** Lower-case noun for labels, already translated ("grade"). */
  noun: string;
  emptyText: string;
  emptyHelp?: string;
  /** Extra controls in the table toolbar (e.g. year filter). */
  filters?: ReactNode;
  /** Extra row actions (e.g. "Set as current"). */
  extraActions?: (item: T) => MenuItem[];
  /** Enables the quick filter box: text to match per row. */
  searchText?: (item: T) => string;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const list = useResource<{ items: T[] }>(listPath);
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);
  const [filter, setFilter] = useState('');
  const del = useSubmit();

  const rows = useMemo(() => {
    const items = list.data?.items ?? null;
    if (!items || !searchText || !filter.trim()) return items;
    const needle = filter.trim().toLowerCase();
    return items.filter((i) => searchText(i).toLowerCase().includes(needle));
  }, [list.data, filter, searchText]);

  const changed = () => {
    list.reload();
    onChanged?.();
  };

  const tableColumns: Column<T>[] = columns.map((c, i) => ({
    key: `${i}-${c.label}`,
    header: c.label,
    cell: c.render,
    hideBelow: c.wide ? 'lg' : undefined,
  }));

  const rowActions =
    canManage || extraActions
      ? (item: T): MenuItem[] => [
          ...(canManage ? [{ label: t('crud.edit'), icon: <Pencil className="size-4" />, onSelect: () => setEditing(item) }] : []),
          ...(extraActions?.(item) ?? []),
          ...(canManage
            ? [{ label: t('crud.delete'), icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setDeleting(item) }]
            : []),
        ]
      : undefined;

  const hasToolbar = !!(searchText || filters);
  const filtered = !!filter.trim();

  return (
    <section aria-label={title} className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 className="text-base font-semibold">{title}</h2>
          {intro && <p className="mt-0.5 text-[0.8125rem] text-fg-muted">{intro}</p>}
        </div>
        {canManage && listPath !== null && (
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            {t('crud.add', { noun })}
          </Button>
        )}
      </div>

      {list.error && <Alert>{t(list.error.message)}</Alert>}

      <DataTable<T>
        label={title}
        columns={tableColumns}
        rows={listPath === null ? [] : rows}
        loading={listPath !== null && list.loading}
        onRowClick={canManage ? (item) => setEditing(item) : undefined}
        rowActions={rowActions}
        toolbar={
          hasToolbar ? (
            <>
              {searchText && (
                <div className="min-w-[12rem] flex-1">
                  <Input
                    type="search"
                    aria-label={t('crud.filter', { title })}
                    placeholder={t('crud.filterPlaceholder')}
                    leading={<Search className="size-4" />}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </div>
              )}
              {filters}
            </>
          ) : undefined
        }
        empty={
          <EmptyState
            icon={filtered ? <Search className="size-5" /> : <Inbox className="size-5" />}
            title={filtered ? t('crud.noMatches') : emptyText}
            description={filtered ? t('table.tryOtherFilters') : emptyHelp}
            action={
              canManage && !filtered && listPath !== null ? (
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                  {t('crud.add', { noun })}
                </Button>
              ) : undefined
            }
          />
        }
      />

      {editing !== null && (
        <FormDrawer
          title={editing === 'new' ? t('crud.addTitle', { noun }) : t('crud.editTitle', { noun })}
          fields={editing === 'new' ? fields : fields.filter((f) => !f.createOnly)}
          initial={editing === 'new' ? initialValues(fields) : toValues(editing)}
          path={editing === 'new' ? createPath : itemPath(editing.id)}
          mode={editing === 'new' ? 'create' : 'edit'}
          submitLabel={editing === 'new' ? t('crud.add', { noun }) : t('common.saveChanges')}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            toast.success(editing === 'new' ? t('crud.created', { noun }) : t('common.saved'));
            changed();
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={t('crud.deleteTitle', { noun })}
        body={t('crud.deleteConfirm', { noun })}
        confirmLabel={t('crud.delete')}
        busy={del.busy}
        error={del.error}
        onClose={() => {
          setDeleting(null);
          del.reset();
        }}
        onConfirm={async () => {
          if (!deleting) return;
          const ok = await del.run(async () => {
            await api(itemPath(deleting.id), { method: 'DELETE' });
            return true;
          });
          if (ok) {
            setDeleting(null);
            toast.success(t('crud.deleted', { noun }));
            changed();
          }
        }}
      />
    </section>
  );
}

export function initialValues(fields: FieldDef[]): Values {
  return Object.fromEntries(fields.map((f) => [f.name, f.initial ?? (f.type === 'checkbox' ? false : '')]));
}

function toBody(fields: FieldDef[], values: Values, initial: Values, mode: 'create' | 'edit'): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.name];
    if (mode === 'edit' && v === initial[f.name]) continue;
    if (f.type === 'checkbox') body[f.name] = Boolean(v);
    else if (v === '' || v === undefined) {
      if (f.nullable) body[f.name] = null;
      else if (mode === 'edit') body[f.name] = '';
    } else if (f.type === 'number' || f.numeric) body[f.name] = Number(v);
    else body[f.name] = v;
  }
  return body;
}

/**
 * Drawer with a config-driven form. `create` sends every field (POST by default); `edit` sends only
 * changed fields (PATCH by default). `onDone` receives the API response.
 */
export function FormDrawer({
  title,
  description,
  fields,
  initial,
  path,
  mode,
  method,
  submitLabel,
  extraBody,
  intro,
  onClose,
  onDone,
}: {
  title: string;
  description?: string;
  fields: FieldDef[];
  initial: Values;
  path: string;
  mode: 'create' | 'edit';
  method?: 'POST' | 'PATCH' | 'PUT';
  submitLabel: string;
  /** Merged into the request body (e.g. fixed ids). */
  extraBody?: Record<string, unknown>;
  /** Content above the fields (help text, warnings). */
  intro?: ReactNode;
  onClose: () => void;
  onDone: (result: unknown) => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Values>(initial);
  const submit = useSubmit();
  const set = (name: string, v: string | boolean) => setValues((cur) => ({ ...cur, [name]: v }));
  const dirty = fields.some((f) => values[f.name] !== initial[f.name]);
  const missing = fields.some((f) => f.required && f.type !== 'checkbox' && values[f.name] === '');
  const formId = useId();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = { ...toBody(fields, values, initial, mode), ...extraBody };
    const res = await submit.run(async () => (await api(path, { method: method ?? (mode === 'create' ? 'POST' : 'PATCH'), body })) ?? null);
    if (res !== undefined) onDone(res);
  }

  const text = fields.filter((f) => f.type !== 'checkbox');
  const checks = fields.filter((f) => f.type === 'checkbox');

  return (
    <Drawer
      open
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form={formId} variant="primary" busy={submit.busy} disabled={(mode === 'edit' && !dirty) || missing}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="space-y-5">
        {intro}
        {submit.error && <Alert>{submit.error}</Alert>}
        <div className="grid grid-cols-2 gap-x-4 gap-y-5">
          {text.map((f) => (
            <div key={f.name} className={f.half ? 'col-span-2 sm:col-span-1' : 'col-span-2'}>
              <Field
                label={f.label}
                hint={f.hint}
                error={submit.fieldErrors[f.name]}
                optional={!f.required && f.nullable ? t('common.optional') : undefined}
              >
                {(id, d, invalid) =>
                  f.type === 'select' ? (
                    <Select
                      id={id}
                      aria-describedby={d}
                      aria-invalid={invalid || undefined}
                      value={String(values[f.name] ?? '')}
                      onChange={(e) => set(f.name, e.target.value)}
                    >
                      {!f.required && <option value="">{t('crud.none')}</option>}
                      {f.required && values[f.name] === '' && (
                        <option value="" disabled>
                          {t('crud.choose')}
                        </option>
                      )}
                      {f.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  ) : f.type === 'textarea' ? (
                    <textarea
                      id={id}
                      aria-describedby={d}
                      aria-invalid={invalid || undefined}
                      rows={3}
                      maxLength={500}
                      className="block w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-fg focus:border-brand-500 focus:ring-3 focus:ring-brand-100 focus:outline-none"
                      value={String(values[f.name] ?? '')}
                      onChange={(e) => set(f.name, e.target.value)}
                    />
                  ) : (
                    <Input
                      id={id}
                      aria-describedby={d}
                      aria-invalid={invalid || undefined}
                      type={f.type}
                      inputMode={f.type === 'number' ? 'numeric' : undefined}
                      value={String(values[f.name] ?? '')}
                      onChange={(e) => set(f.name, e.target.value)}
                    />
                  )
                }
              </Field>
            </div>
          ))}
        </div>
        {checks.length > 0 && (
          <div className="rounded-lg border border-line px-3.5 py-1">
            {checks.map((f) => (
              <Checkbox
                key={f.name}
                label={f.label}
                description={f.hint}
                checked={Boolean(values[f.name])}
                onChange={(e) => set(f.name, e.target.checked)}
              />
            ))}
          </div>
        )}
      </form>
    </Drawer>
  );
}
