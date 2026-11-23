import type { UserItem } from '@sms/shared';

export function statusTone(s: UserItem['status']): 'ok' | 'warn' | 'bad' {
  return s === 'active' ? 'ok' : s === 'invited' ? 'warn' : 'bad';
}

export function formatDateTime(iso: string | null, locale: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

/** `YYYY-MM-DD` (a calendar date, no time zone) → localised date. */
export function formatDate(isoDate: string, locale: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}
