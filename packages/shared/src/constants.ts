/**
 * Plain constants and helpers with no zod dependency. The web app imports these, so they
 * must stay free of schema code: importing a module that builds zod schemas at load time
 * pulls the whole validator (~85 kB) into the browser bundle.
 */

export const USER_STATUSES = ['active', 'disabled', 'invited'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const isEmailIdentifier = (identifier: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);

export const CALENDAR_EVENT_KINDS = ['holiday', 'term_break', 'exam', 'event'] as const;
export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number];

/**
 * Audit log categories → action prefixes. Shared so the API filter and the web filter agree.
 * Every audited action must start with one of these prefixes (a test checks the API's actions).
 */
export const AUDIT_CATEGORIES = {
  signIn: ['auth.'],
  people: ['user.', 'role.', 'setup.'],
  academic: ['academic_year.', 'term.', 'grade.', 'subject.', 'room.', 'class_section.', 'period.', 'calendar_event.'],
  settings: ['school.'],
  backups: ['backup.'],
} as const;
export type AuditCategory = keyof typeof AUDIT_CATEGORIES;
export const AUDIT_CATEGORY_KEYS = Object.keys(AUDIT_CATEGORIES) as AuditCategory[];
