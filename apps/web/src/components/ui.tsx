import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Small UI kit for the school app. Plain Tailwind + native elements (dialog, select) to keep
 * the bundle small. All visible text comes from callers via i18n keys or translated strings.
 */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
const BUTTON: Record<ButtonVariant, string> = {
  primary: 'bg-register text-white hover:bg-spine border border-register',
  secondary: 'bg-sheet text-ink border border-rule hover:border-ink-soft',
  danger: 'bg-sheet text-maroon border border-maroon/40 hover:bg-maroon-soft',
  ghost: 'text-register hover:bg-register-soft border border-transparent',
};

export function Button({
  variant = 'secondary',
  busy,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-55 ${BUTTON[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/** Labelled form field. `error` is already-translated text. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string, describedBy?: string) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children(id, describedBy)}
      {hint && (
        <p id={hintId} className="text-xs text-ink-soft">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="text-sm text-maroon">
          {error}
        </p>
      )}
    </div>
  );
}

const control =
  'w-full min-h-10 rounded-md border border-rule bg-sheet px-3 py-2 text-base sm:text-sm aria-[invalid=true]:border-maroon disabled:bg-paper';

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${control} ${props.className ?? ''}`} />;
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${control} ${props.className ?? ''}`} />;
}

export function Checkbox({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex min-h-10 items-center gap-3 text-sm">
      <input type="checkbox" {...rest} className="size-5 accent-register" />
      <span>{label}</span>
    </label>
  );
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'success' | 'info'; children: ReactNode }) {
  const style = {
    error: 'border-maroon/30 bg-maroon-soft text-maroon',
    success: 'border-register/30 bg-register-soft text-spine',
    info: 'border-rule bg-amber-soft text-ink',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-md border px-4 py-3 text-sm ${style}`}>
      {children}
    </div>
  );
}

/** Page title row: title left, actions right; wraps on phones. */
export function PageHeader({ title, intro, actions }: { title: string; intro?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-4">
      <div className="max-w-2xl">
        <h1 className="text-[1.625rem] leading-tight font-semibold tracking-tight">{title}</h1>
        {intro && <p className="mt-1 text-ink-soft">{intro}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatusBadge({ tone, children }: { tone: 'ok' | 'muted' | 'warn' | 'bad'; children: ReactNode }) {
  const style = {
    ok: 'bg-register-soft text-spine',
    muted: 'bg-paper text-ink-soft border border-rule',
    warn: 'bg-amber-soft text-ink',
    bad: 'bg-maroon-soft text-maroon',
  }[tone];
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${style}`}>{children}</span>;
}

/** Native modal dialog (focus trap, Esc to close, backdrop) that becomes a bottom sheet on phones. */
export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="sheet bg-sheet p-0 text-ink shadow-xl" onClose={onClose} aria-label={title}>
      {open && (
        <div className="flex max-h-[92vh] flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-rule px-5 py-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <Button variant="ghost" onClick={onClose} aria-label={t('common.close')} className="px-3">
              <span aria-hidden>×</span>
            </Button>
          </div>
          <div className="overflow-y-auto px-5 py-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-rule bg-sheet px-6 py-10 text-center">
      <p className="text-ink-soft">{title}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Loading() {
  const { t } = useTranslation();
  return (
    <p role="status" className="py-8 text-ink-soft">
      {t('common.loading')}
    </p>
  );
}

/** Buttons at the foot of a form. */
export function FormActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-2 border-t border-rule pt-4">{children}</div>;
}
