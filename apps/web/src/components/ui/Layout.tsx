import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface Crumb {
  label: string;
  to?: string;
}

/** Page title block: breadcrumbs, title, description and primary actions. */
export function PageHeader({
  title,
  description,
  crumbs,
  actions,
}: {
  title: string;
  description?: string;
  crumbs?: Crumb[];
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-6">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label={t('common.breadcrumb')} className="mb-2">
          <ol className="flex flex-wrap items-center gap-1 text-[0.8125rem] text-fg-muted">
            {crumbs.map((c, i) => (
              <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                {i > 0 && <ChevronRight aria-hidden className="size-3.5 text-fg-faint" />}
                {c.to ? (
                  <Link to={c.to} className="hover:text-fg hover:underline">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current="page">{c.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-[1.375rem] leading-tight font-semibold tracking-[-0.01em] text-fg">{title}</h1>
          {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** Bordered panel. Header (title/description/actions) is optional; `flush` removes body padding for tables. */
export function Card({
  title,
  description,
  actions,
  flush,
  footer,
  children,
  className = '',
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  flush?: boolean;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--shadow-card)] ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-[0.9375rem] font-semibold text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-[0.8125rem] text-fg-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? '' : 'p-5'}>{children}</div>
      {footer && <footer className="border-t border-line bg-subtle/60 px-5 py-3">{footer}</footer>}
    </section>
  );
}

export interface TabItem<K extends string> {
  key: K;
  label: string;
  icon?: ReactNode;
}

/** Underline tabs. Scrolls horizontally on phones and keeps the selected tab in view. */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (k: K) => void;
  label: string;
}) {
  return (
    <div className="scroll-strip -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div role="tablist" aria-label={label} className="flex min-w-max gap-1 border-b border-line">
        {items.map((it) => {
          const selected = it.key === value;
          return (
            <button
              key={it.key}
              type="button"
              role="tab"
              aria-selected={selected}
              ref={selected ? (el) => el?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) : undefined}
              onClick={() => onChange(it.key)}
              className={`-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap transition-colors ${
                selected
                  ? 'border-brand-600 font-medium text-fg'
                  : 'border-transparent text-fg-muted hover:border-line-strong hover:text-fg'
              }`}
            >
              {it.icon && <span className={selected ? 'text-brand-600' : 'text-fg-faint'}>{it.icon}</span>}
              {it.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Initials avatar with a stable colour per name (no photos stored). */
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => [...p][0] ?? '')
      .join('')
      .toUpperCase() || '?';
  const palette = [
    'bg-brand-100 text-brand-700',
    'bg-ok-bg text-ok',
    'bg-warn-bg text-warn',
    'bg-danger-bg text-danger',
    'bg-muted text-fg-muted',
  ];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const dim = { sm: 'size-7 text-[0.6875rem]', md: 'size-8 text-xs', lg: 'size-11 text-sm' }[size];
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${palette[h % palette.length]} ${dim}`}
    >
      {initials}
    </span>
  );
}

/** Label/value list for read-only details. */
export function DescriptionList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="divide-y divide-line">
      {items.map((it) => (
        <div key={it.label} className="grid grid-cols-[minmax(6.5rem,32%)_minmax(0,1fr)] gap-4 py-2.5 text-sm">
          <dt className="text-fg-muted">{it.label}</dt>
          <dd className="min-w-0 text-fg">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
