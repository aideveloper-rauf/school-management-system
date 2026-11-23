import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';

/** Labelled form field. `children` receives the control id and aria-describedby. Texts are pre-translated. */
export function Field({
  label,
  hint,
  error,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  /** Translated "Optional" marker. */
  optional?: string;
  children: (id: string, describedBy: string | undefined, invalid: boolean) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [errId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-baseline justify-between gap-2 text-[0.8125rem] font-medium text-fg">
        <span>{label}</span>
        {optional && <span className="text-xs font-normal text-fg-faint">{optional}</span>}
      </label>
      {children(id, describedBy, !!error)}
      {error ? (
        <p id={errId} className="flex items-start gap-1.5 text-[0.8125rem] text-danger">
          <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="text-xs text-fg-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

const control =
  'block w-full h-9 rounded-md border border-line-strong bg-surface px-3 text-base text-fg shadow-[var(--shadow-card)] placeholder:text-fg-faint ' +
  'transition-colors hover:border-fg-faint focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-100 ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger-bg disabled:cursor-not-allowed disabled:bg-subtle disabled:text-fg-muted sm:text-sm';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { leading?: ReactNode }>(function Input(
  { leading, className = '', ...props },
  ref,
) {
  if (!leading) return <input ref={ref} {...props} className={`${control} ${className}`} />;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-fg-faint">{leading}</span>
      <input ref={ref} {...props} className={`${control} pl-9 ${className}`} />
    </div>
  );
});

/** Password input with a show/hide toggle (labels are pre-translated). */
export function PasswordInput({
  showLabel,
  hideLabel,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { showLabel: string; hideLabel: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={visible ? 'text' : 'password'} className={`${control} pr-10`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-fg-faint hover:text-fg"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${control} appearance-auto pr-8 ${className}`} />;
}

export function Checkbox({ label, description, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-1.5 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-60">
      <input type="checkbox" {...rest} className="mt-0.5 size-4 shrink-0 rounded accent-brand-600" />
      <span>
        <span className="font-medium text-fg">{label}</span>
        {description && <span className="block text-[0.8125rem] text-fg-muted">{description}</span>}
      </span>
    </label>
  );
}

/** Large selectable option (radio) with a title and explanation. */
export function RadioCard({
  name,
  checked,
  disabled,
  onChange,
  title,
  description,
  icon,
}: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  title: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-lg border p-3.5 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-brand-100 ${
        checked ? 'border-brand-500 bg-brand-50' : 'border-line hover:border-line-strong'
      } ${disabled ? 'cursor-not-allowed opacity-55' : ''}`}
    >
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} className="sr-only" />
      {icon && <span className={`mt-0.5 shrink-0 ${checked ? 'text-brand-600' : 'text-fg-faint'}`}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-fg">{title}</span>
        <span className="block text-[0.8125rem] text-fg-muted">{description}</span>
      </span>
      <span
        aria-hidden
        className={`mt-0.5 size-4 shrink-0 rounded-full border-2 ${checked ? 'border-brand-600 bg-[radial-gradient(circle,var(--color-brand-600)_40%,transparent_45%)]' : 'border-line-strong'}`}
      />
    </label>
  );
}

/** Two-column settings row: title and help on the left, controls on the right (stacks on phones). */
export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="grid gap-4 border-b border-line py-6 first:pt-0 last:border-b-0 last:pb-0 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:gap-8">
      <div>
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {description && <p className="mt-1 text-[0.8125rem] text-fg-muted">{description}</p>}
      </div>
      <div className="max-w-xl space-y-4">{children}</div>
    </div>
  );
}
