import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'link';
export type ButtonSize = 'sm' | 'md';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white shadow-[var(--shadow-card)] hover:bg-brand-700 border border-brand-600 hover:border-brand-700',
  secondary: 'bg-surface text-fg border border-line-strong shadow-[var(--shadow-card)] hover:bg-subtle',
  danger: 'bg-danger text-white border border-danger hover:brightness-95 shadow-[var(--shadow-card)]',
  ghost: 'text-fg-muted hover:bg-subtle hover:text-fg border border-transparent',
  link: 'text-brand-600 hover:text-brand-700 hover:underline border border-transparent px-0!',
};
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[0.8125rem] gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', busy, icon, className = '', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    >
      {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

/** Square icon-only button; `label` is required for screen readers and the tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: ButtonSize }>(
  function IconButton({ label, size = 'md', className = '', children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        {...rest}
        className={`inline-flex shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-subtle hover:text-fg disabled:opacity-50 ${size === 'sm' ? 'size-8' : 'size-9'} ${className}`}
      >
        {children}
      </button>
    );
  },
);
