import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger';

const ALERT = {
  error: { cls: 'border-danger/25 bg-danger-bg text-danger', Icon: AlertCircle },
  success: { cls: 'border-ok/25 bg-ok-bg text-ok', Icon: CheckCircle2 },
  warning: { cls: 'border-warn/25 bg-warn-bg text-warn', Icon: TriangleAlert },
  info: { cls: 'border-brand-200 bg-info-bg text-info', Icon: Info },
} as const;

export function Alert({ tone = 'error', title, children }: { tone?: keyof typeof ALERT; title?: string; children?: ReactNode }) {
  const { cls, Icon } = ALERT[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-2.5 rounded-md border px-3.5 py-3 text-sm ${cls}`}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? 'mt-0.5 text-fg-muted' : ''}>{children}</div>}
      </div>
    </div>
  );
}

const BADGE: Record<Tone, string> = {
  neutral: 'bg-subtle text-fg-muted ring-line',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
  ok: 'bg-ok-bg text-ok ring-ok/20',
  warn: 'bg-warn-bg text-warn ring-warn/20',
  danger: 'bg-danger-bg text-danger ring-danger/20',
};

/** Small status label. `dot` adds a coloured dot for at-a-glance scanning in tables. */
export function Badge({ tone = 'neutral', dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${BADGE[tone]}`}
    >
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`skeleton block h-3.5 ${className}`} />;
}

export function Loading({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div role="status" className="space-y-3 py-6" aria-label={label ?? t('common.loading')}>
      <Skeleton className="w-1/3" />
      <Skeleton className="w-2/3" />
      <Skeleton className="w-1/2" />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-subtle text-fg-muted">{icon}</div>}
      <p className="font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[0.8125rem] text-fg-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
