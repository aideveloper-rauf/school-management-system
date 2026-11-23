import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DropdownMenu, type MenuItem } from './Overlay';
import { Skeleton } from './Feedback';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Hide on narrower desktops (still shown in the phone card layout unless `phone: false`). */
  hideBelow?: 'lg' | 'xl';
  phone?: boolean;
  align?: 'right';
  className?: string;
}

/**
 * Data table: sticky header, row hover/click, per-row action menu, skeleton loading and
 * an empty state. Below `md` the rows render as stacked cards (first column = title).
 */
export function DataTable<T extends { id: number }>({
  label,
  columns,
  rows,
  loading,
  empty,
  onRowClick,
  rowActions,
  toolbar,
  footer,
}: {
  /** Accessible name of the table. */
  label: string;
  columns: Column<T>[];
  rows: T[] | null;
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => MenuItem[];
  toolbar?: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const hide = (c: Column<T>) => (c.hideBelow === 'xl' ? 'hidden xl:table-cell' : c.hideBelow === 'lg' ? 'hidden lg:table-cell' : '');
  const showSkeleton = loading && !rows;
  const [first, ...rest] = columns;

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--shadow-card)]">
      {toolbar && <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4">{toolbar}</div>}

      {/* Desktop / tablet table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm" aria-label={label} aria-busy={loading || undefined}>
          <thead className="sticky top-0 z-10 bg-subtle text-xs font-medium text-fg-muted">
            <tr className="border-b border-line">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`h-9 px-4 font-medium whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${hide(c)}`}
                >
                  {c.header}
                </th>
              ))}
              {rowActions && (
                <th scope="col" className="w-12 px-2">
                  <span className="sr-only">{t('crud.actions')}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {showSkeleton &&
              Array.from({ length: 5 }, (_, i) => (
                <tr key={`s${i}`}>
                  {columns.map((c) => (
                    <td key={c.key} className={`px-4 py-3.5 ${hide(c)}`}>
                      <Skeleton className={i % 2 ? 'w-2/3' : 'w-1/2'} />
                    </td>
                  ))}
                  {rowActions && <td />}
                </tr>
              ))}
            {rows?.map((row) => (
              <tr
                key={row.id}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(row);
                      }
                    : undefined
                }
                className={`group transition-colors hover:bg-subtle/70 ${onRowClick ? 'cursor-pointer focus-visible:bg-brand-50 focus-visible:outline-none' : ''}`}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-4 py-3 align-middle ${c.align === 'right' ? 'text-right' : ''} ${hide(c)} ${c.className ?? ''}`}
                  >
                    {c.cell(row)}
                  </td>
                ))}
                {rowActions && (
                  <td className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu label={t('crud.actions')} items={rowActions(row)} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone cards */}
      <ul className="divide-y divide-line md:hidden" aria-label={label}>
        {showSkeleton &&
          Array.from({ length: 4 }, (_, i) => (
            <li key={`s${i}`} className="space-y-2 px-4 py-3.5">
              <Skeleton className="w-1/2" />
              <Skeleton className="w-3/4" />
            </li>
          ))}
        {rows?.map((row) => (
          <li key={row.id} className="flex items-start gap-2 px-4 py-3">
            <div
              className={`min-w-0 flex-1 ${onRowClick ? 'cursor-pointer' : ''}`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              role={onRowClick ? 'button' : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
            >
              {first && <div className="font-medium text-fg">{first.cell(row)}</div>}
              <dl className="mt-1 space-y-0.5 text-[0.8125rem]">
                {rest
                  .filter((c) => c.phone !== false)
                  .map((c) => (
                    <div key={c.key} className="flex flex-wrap gap-x-1.5">
                      <dt className="text-fg-muted">{c.header}:</dt>
                      <dd className="text-fg">{c.cell(row)}</dd>
                    </div>
                  ))}
              </dl>
            </div>
            {rowActions && <DropdownMenu label={t('crud.actions')} items={rowActions(row)} />}
          </li>
        ))}
      </ul>

      {rows && rows.length === 0 && !loading && empty}
      {footer && <div className="border-t border-line px-3 py-2.5 sm:px-4">{footer}</div>}
    </div>
  );
}

/** Footer row: "1–25 of 132" + page size + previous/next. */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize?: (n: number) => void;
}) {
  const { t } = useTranslation();
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-[0.8125rem] text-fg-muted">
      <p aria-live="polite" className="tabular">
        {t('table.range', { from, to, total })}
      </p>
      <div className="flex items-center gap-3">
        {onPageSize && (
          <label className="flex items-center gap-2">
            <span className="hidden sm:inline">{t('table.rowsPerPage')}</span>
            <select
              className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[0.8125rem]"
              value={pageSize}
              onChange={(e) => onPageSize(Number(e.target.value))}
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="tabular hidden sm:inline">{t('table.pageOf', { page, pages })}</span>
        <div className="flex gap-1">
          <button
            type="button"
            className="h-8 rounded-md border border-line-strong bg-surface px-2.5 text-fg hover:bg-subtle disabled:opacity-40"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            {t('common.previous')}
          </button>
          <button
            type="button"
            className="h-8 rounded-md border border-line-strong bg-surface px-2.5 text-fg hover:bg-subtle disabled:opacity-40"
            disabled={page >= pages}
            onClick={() => onPage(page + 1)}
          >
            {t('common.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
