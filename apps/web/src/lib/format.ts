import type { UserItem } from '@sms/shared';

export function statusTone(s: UserItem['status']): 'ok' | 'warn' | 'danger' {
  return s === 'active' ? 'ok' : s === 'invited' ? 'warn' : 'danger';
}

export function formatDateTime(iso: string | null, locale: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

/** "3 hours ago", "yesterday" — falls back to the date after a month. */
export function formatRelative(iso: string | null, locale: string): string {
  if (!iso) return '—';
  const diffSec = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diffSec), 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), 'day');
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
}

const parse = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
};

/** `YYYY-MM-DD` (a calendar date, no time zone) → localised date. */
export function formatDate(isoDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(parse(isoDate)));
}

/** Today's date on this device as `YYYY-MM-DD`. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysIso(isoDate: string, days: number): string {
  return new Date(parse(isoDate) + days * 86400000).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (calendar dates). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b) - parse(a)) / 86400000);
}
