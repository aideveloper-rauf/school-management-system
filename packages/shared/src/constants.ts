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
