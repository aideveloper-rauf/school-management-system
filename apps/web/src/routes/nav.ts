import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Award,
  BookOpenCheck,
  Briefcase,
  CalendarClock,
  ClipboardCheck,
  Contact,
  FileUp,
  GraduationCap,
  LayoutDashboard,
  Megaphone,
  ScrollText,
  Settings,
  SquarePen,
  Users,
} from 'lucide-react';
import type { Permission } from '@sms/shared';

export interface NavItem {
  path: string;
  labelKey: string;
  icon: LucideIcon;
  /** Shown if the user has ANY of these. Empty = every signed-in user. */
  anyOf: Permission[];
  /** Not built yet: shown with a "Soon" label so the roadmap is visible but honest. */
  soon?: boolean;
}

export interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

/** Role-aware navigation, grouped by area. Visibility is a UX hint; the API is the security boundary. */
export const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'navGroups.overview',
    items: [
      { path: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard, anyOf: [] },
      { path: '/announcements', labelKey: 'nav.announcements', icon: Megaphone, anyOf: ['announcements.read'] },
    ],
  },
  {
    labelKey: 'navGroups.teaching',
    items: [
      { path: '/timetable', labelKey: 'nav.timetable', icon: CalendarClock, anyOf: ['timetable.read'] },
      {
        path: '/attendance',
        labelKey: 'nav.attendance',
        icon: ClipboardCheck,
        anyOf: ['attendance.record.scoped', 'attendance.correct', 'students.read.all'],
      },
      {
        path: '/students',
        labelKey: 'nav.students',
        icon: GraduationCap,
        anyOf: ['students.read.scoped', 'students.read.all'],
      },
      {
        path: '/exams',
        labelKey: 'nav.exams',
        icon: SquarePen,
        anyOf: ['marks.enter.scoped', 'marks.moderate', 'results.approve'],
        soon: true,
      },
      { path: '/results', labelKey: 'nav.results', icon: Award, anyOf: ['results.read.own'], soon: true },
    ],
  },
  {
    labelKey: 'navGroups.people',
    items: [
      { path: '/staff', labelKey: 'nav.staff', icon: Briefcase, anyOf: ['staff.read'] },
      { path: '/guardians', labelKey: 'nav.guardians', icon: Contact, anyOf: ['guardians.link.manage'] },
      { path: '/imports', labelKey: 'nav.imports', icon: FileUp, anyOf: ['students.manage', 'staff.manage', 'guardians.link.manage'] },
    ],
  },
  {
    labelKey: 'navGroups.administration',
    items: [
      { path: '/academic', labelKey: 'nav.academic', icon: BookOpenCheck, anyOf: ['academic.structure.read'] },
      { path: '/users', labelKey: 'nav.users', icon: Users, anyOf: ['users.read'] },
      { path: '/settings', labelKey: 'nav.settings', icon: Settings, anyOf: ['school.settings.read'] },
      { path: '/audit', labelKey: 'nav.audit', icon: ScrollText, anyOf: ['audit.read'] },
      { path: '/status', labelKey: 'nav.status', icon: Activity, anyOf: ['ops.status.read'] },
    ],
  },
];

/** Flat list (routing, breadcrumbs). */
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
