import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useResource, useSubmit } from '../lib/data';
import { Alert, Button, Checkbox, Dialog, EmptyState, Field, FormActions, Loading, SelectInput, TextInput } from './ui';

/**
 * Config-driven list + create/edit/delete for simple school configuration (grades, rooms, …).
 * Forms hold string/boolean values and convert them to the API's types on submit; edits send
 * only changed fields (PATCH). The API validates everything again and is the source of truth.
 */
export type FieldType = 'text' | 'number' | 'date' | 'time' | 'checkbox' | 'select';

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
}

export interface ColumnDef<T> {
  label: string;
  render: (item: T) => ReactNode;
  /** Hide on phones (secondary info). */
  wide?: boolean;
}

type Values = Record<string, string | boolean>;

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
  filters,
  rowExtra,
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
  /** Lower-case noun for button labels, already translated ("grade"). */
  noun: string;
  emptyText: string;
  filters?: ReactNode;
  /** Extra per-row action (e.g. "Subjects" for a grade). */
  rowExtra?: (item: T) => ReactNode;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const list = useResource<{ items: T[] }>(listPath);
  const [editing, setEditing] = useState<T | 'new' | null>(null);

  const changed = () => {
    setEditing(null);
    list.reload();
    onChanged?.();
  };

  return (
    <section aria-label={title} className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-xl font-semibold">{title}</h2>
          {intro && <p className="mt-1 text-sm text-ink-soft">{intro}</p>}
        </div>
        {canManage && listPath !== null && (
          <Button variant="primary" onClick={() => setEditing('new')}>
            {t('crud.add', { noun })}
          </Button>
        )}
      </div>
      {filters}
      {list.error && <Alert>{t(list.error.message)}</Alert>}
      {listPath !== null && list.loading && !list.data && <Loading />}
      {list.data && list.data.items.length === 0 && <EmptyState title={emptyText} />}
      {list.data && list.data.items.length > 0 && (
        // Phones: each row stacks into a labelled block with actions underneath (no hidden overflow).
        <div className="overflow-x-auto rounded-md border border-rule bg-sheet">
          <table className="w-full text-left text-sm">
            <thead className="hidden border-b border-rule bg-paper text-ink-soft sm:table-header-group">
              <tr>
                {columns.map((c) => (
                  <th key={c.label} scope="col" className={`px-4 py-2.5 font-medium ${c.wide ? 'hidden sm:table-cell' : ''}`}>
                    {c.label}
                  </th>
                ))}
                {(canManage || rowExtra) && (
                  <th scope="col" className="px-4 py-2.5">
                    <span className="sr-only">{t('crud.actions')}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {list.data.items.map((item) => (
                <tr key={item.id} className="block px-4 py-3 sm:table-row sm:p-0">
                  {columns.map((c, i) => (
                    <td
                      key={c.label}
                      className={`py-0.5 align-top sm:px-4 sm:py-3 ${c.wide ? 'hidden sm:table-cell' : 'block sm:table-cell'}`}
                    >
                      {i > 0 && <span className="text-ink-soft sm:hidden">{c.label}: </span>}
                      {c.render(item)}
                    </td>
                  ))}
                  {(canManage || rowExtra) && (
                    <td className="-ml-4 flex flex-wrap gap-1 pt-1 sm:ml-0 sm:table-cell sm:px-2 sm:py-2 sm:text-right sm:whitespace-nowrap">
                      {rowExtra?.(item)}
                      {canManage && (
                        <Button variant="ghost" onClick={() => setEditing(item)}>
                          {t('crud.edit')}
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing !== null && (
        <CrudDialog
          title={editing === 'new' ? t('crud.addTitle', { noun }) : t('crud.editTitle', { noun })}
          fields={editing === 'new' ? fields : fields.filter((f) => !f.createOnly)}
          initial={editing === 'new' ? initialValues(fields) : toValues(editing)}
          path={editing === 'new' ? createPath : itemPath(editing.id)}
          mode={editing === 'new' ? 'create' : 'edit'}
          noun={noun}
          onClose={() => setEditing(null)}
          onDone={changed}
        />
      )}
    </section>
  );
}

function initialValues(fields: FieldDef[]): Values {
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

function CrudDialog({
  title,
  fields,
  initial,
  path,
  mode,
  noun,
  onClose,
  onDone,
}: {
  title: string;
  fields: FieldDef[];
  initial: Values;
  path: string;
  mode: 'create' | 'edit';
  noun: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Values>(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const submit = useSubmit();
  const set = (name: string, v: string | boolean) => setValues((cur) => ({ ...cur, [name]: v }));
  const dirty = fields.some((f) => values[f.name] !== initial[f.name]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = toBody(fields, values, initial, mode);
    const ok = await submit.run(() => api(path, { method: mode === 'create' ? 'POST' : 'PATCH', body }));
    if (ok !== undefined) onDone();
  }

  async function onDelete() {
    // DELETE returns 204 → api() resolves undefined, so use a sentinel to detect success.
    const ok = await submit.run(async () => {
      await api(path, { method: 'DELETE' });
      return true;
    });
    if (ok) onDone();
  }

  return (
    <Dialog open title={title} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {submit.error && <Alert>{submit.error}</Alert>}
        {fields.map((f) =>
          f.type === 'checkbox' ? (
            <Checkbox key={f.name} label={f.label} checked={Boolean(values[f.name])} onChange={(e) => set(f.name, e.target.checked)} />
          ) : (
            <Field key={f.name} label={f.label} hint={f.hint} error={submit.fieldErrors[f.name]}>
              {(id, d) =>
                f.type === 'select' ? (
                  <SelectInput
                    id={id}
                    aria-describedby={d}
                    value={String(values[f.name] ?? '')}
                    onChange={(e) => set(f.name, e.target.value)}
                  >
                    {(f.nullable || !f.required) && <option value="">{t('crud.none')}</option>}
                    {f.required && !f.nullable && values[f.name] === '' && <option value="">{t('crud.choose')}</option>}
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </SelectInput>
                ) : (
                  <TextInput
                    id={id}
                    aria-describedby={d}
                    aria-invalid={!!submit.fieldErrors[f.name] || undefined}
                    type={f.type}
                    inputMode={f.type === 'number' ? 'numeric' : undefined}
                    value={String(values[f.name] ?? '')}
                    onChange={(e) => set(f.name, e.target.value)}
                  />
                )
              }
            </Field>
          ),
        )}

        {mode === 'edit' && confirmDelete && (
          <div className="rounded-md border border-maroon/40 bg-maroon-soft p-3 text-sm">
            <p className="mb-3 text-maroon">{t('crud.deleteConfirm', { noun })}</p>
            <div className="flex gap-2">
              <Button onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</Button>
              <Button variant="danger" busy={submit.busy} onClick={() => void onDelete()}>
                {t('crud.delete')}
              </Button>
            </div>
          </div>
        )}

        <FormActions>
          {mode === 'edit' && !confirmDelete && (
            <Button variant="danger" className="mr-auto" onClick={() => setConfirmDelete(true)}>
              {t('crud.delete')}
            </Button>
          )}
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" busy={submit.busy} disabled={mode === 'edit' && !dirty}>
            {mode === 'create' ? t('crud.add', { noun }) : t('common.saveChanges')}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
