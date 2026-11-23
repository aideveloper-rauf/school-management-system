import type { Permission } from '@sms/shared';

export interface NavItem {
  path: string;
  labelKey: string;
  /** Shown if the user has ANY of these. Empty = every signed-in user. */
  anyOf: Permission[];
}

/** Role-aware navigation. Visibility is a UX hint; the API is the security boundary. */
export const NAV: NavItem[] = [
  { path: '/', labelKey: 'nav.dashboard', anyOf: [] },
  { path: '/announcements', labelKey: 'nav.announcements', anyOf: ['announcements.read'] },
  { path: '/timetable', labelKey: 'nav.timetable', anyOf: ['timetable.read'] },
  { path: '/attendance', labelKey: 'nav.attendance', anyOf: ['attendance.record.scoped', 'attendance.correct'] },
  { path: '/students', labelKey: 'nav.students', anyOf: ['students.read.scoped', 'students.read.all'] },
  { path: '/exams', labelKey: 'nav.exams', anyOf: ['marks.enter.scoped', 'marks.moderate', 'results.approve'] },
  { path: '/results', labelKey: 'nav.results', anyOf: ['results.read.own'] },
  { path: '/academic', labelKey: 'nav.academic', anyOf: ['academic.structure.read'] },
  { path: '/users', labelKey: 'nav.users', anyOf: ['users.read'] },
  { path: '/audit', labelKey: 'nav.audit', anyOf: ['audit.read'] },
  { path: '/settings', labelKey: 'nav.settings', anyOf: ['school.settings.read'] },
  { path: '/status', labelKey: 'nav.status', anyOf: ['ops.status.read'] },
];
