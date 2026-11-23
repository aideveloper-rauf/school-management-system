import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, TriangleAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from './Button';

/**
 * React delivers a nested dialog's `close` event to ancestor handlers too, so a confirmation
 * closing inside a drawer would also close the drawer. Only react to our own dialog closing.
 */
const ownClose = (onClose: () => void) => (e: SyntheticEvent<HTMLDialogElement>) => {
  if (e.target === e.currentTarget) onClose();
};

/** Keep a native <dialog> in sync with `open` (focus trap, Esc and backdrop come from the browser). */
function useDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return ref;
}

/**
 * Side drawer for create/edit forms. Full screen on phones. `footer` stays pinned to the bottom;
 * put the form's submit button there with `form="<id>"`.
 */
export function Drawer({
  open,
  title,
  description,
  header,
  onClose,
  footer,
  wide,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  /** Replaces the title block (e.g. avatar + name). */
  header?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useDialog(open);
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      className={`drawer bg-surface p-0 text-fg ${wide ? 'wide' : ''}`}
      aria-labelledby={titleId}
      onClose={ownClose(onClose)}
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0" id={titleId}>
              {header ?? (
                <>
                  <h2 className="text-base font-semibold">{title}</h2>
                  {description && <p className="mt-0.5 text-[0.8125rem] text-fg-muted">{description}</p>}
                </>
              )}
            </div>
            <IconButton label={t('common.close')} onClick={onClose} className="-mr-1.5 -mt-1">
              <X className="size-4.5" />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-subtle/60 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** Confirmation for destructive or significant actions. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  tone = 'danger',
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useDialog(open);
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <dialog ref={ref} className="modal bg-surface p-0 text-fg" aria-labelledby={titleId} onClose={ownClose(onClose)}>
      {open && (
        <div className="p-5">
          <div className="flex gap-4">
            {tone === 'danger' && (
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-bg text-danger">
                <TriangleAlert aria-hidden className="size-5" />
              </span>
            )}
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold">
                {title}
              </h2>
              <div className="mt-1.5 text-sm text-fg-muted">{body}</div>
              {error && <p className="mt-3 text-sm text-danger">{error}</p>}
            </div>
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button variant={tone === 'danger' ? 'danger' : 'primary'} busy={busy} onClick={onConfirm} autoFocus>
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * Accessible dropdown menu (menu button pattern): arrow keys move, Esc closes and returns focus,
 * clicking outside closes. Used for row actions and the user menu.
 */
export function DropdownMenu({
  label,
  items,
  trigger,
  align = 'end',
  header,
}: {
  label: string;
  items: MenuItem[];
  /** Custom trigger content; defaults to a "…" icon button. */
  trigger?: ReactNode;
  align?: 'start' | 'end';
  header?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const enabled = items.filter((i) => !i.disabled);

  // The menu is portalled out of any scroll/overflow container (tables) and positioned from the
  // button; it flips above the button when there is no room below.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const b = btn.current?.getBoundingClientRect();
      const m = menu.current;
      if (!b || !m) return;
      const w = m.offsetWidth;
      const h = m.offsetHeight;
      const below = b.bottom + 4;
      const top = below + h > window.innerHeight - 8 && b.top - h - 4 > 8 ? b.top - h - 4 : below;
      const rawLeft = align === 'end' ? b.right - w : b.left;
      setPos({ top, left: Math.min(Math.max(8, rawLeft), window.innerWidth - w - 8) });
    };
    place();
    const close = () => setOpen(false);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!wrap.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Move focus into the menu once it is positioned and visible (hidden elements cannot take focus).
  useEffect(() => {
    if (open && pos) menu.current?.querySelector<HTMLElement>('[role=menuitem]:not([disabled])')?.focus();
  }, [open, pos]);

  const onKey = (e: KeyboardEvent) => {
    const els = [...(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus();
    } else if (e.key === 'Tab') setOpen(false);
  };

  if (enabled.length === 0 && !header) return null;
  return (
    <div
      ref={wrap}
      className="relative inline-block text-left"
      // Esc while focus is still on the button closes the menu too.
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open && e.target === btn.current) setOpen(false);
      }}
    >
      {trigger ? (
        <button
          ref={btn}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-subtle"
        >
          {trigger}
        </button>
      ) : (
        <IconButton
          ref={btn}
          label={label}
          size="sm"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          <MoreHorizontal className="size-4" />
        </IconButton>
      )}
      {open &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            role="menu"
            aria-label={label}
            style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
            className="z-50 min-w-48 rounded-lg border border-line bg-surface py-1 shadow-[var(--shadow-pop)]"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onKey}
          >
            {header && <div className="border-b border-line px-3 py-2.5">{header}</div>}
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm outline-none hover:bg-subtle focus:bg-subtle disabled:opacity-50 ${
                  it.danger ? 'text-danger' : 'text-fg'
                }`}
              >
                {it.icon && <span className={it.danger ? '' : 'text-fg-faint'}>{it.icon}</span>}
                {it.label}
              </button>
            ))}
          </div>,
          // Inside a modal <dialog> (top layer) the menu must stay within it to be visible.
          (wrap.current?.closest('dialog') as HTMLElement | null) ?? document.body,
        )}
    </div>
  );
}
