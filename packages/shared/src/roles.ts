/**
 * Role → permission map.
 *
 * IMPORTANT: a permission only says what *kind* of action a role may attempt.
 * The API must still apply record scope (school, class/subject assignment,
 * guardian–student link) before returning or changing data.
 * UI visibility derived from these values is a convenience, not security.
 */
export const ROLES = ['school_admin', 'principal', 'academic_coordinator', 'teacher', 'registrar', 'student', 'guardian'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // Operations / settings
  'school.settings.read',
  'school.settings.manage',
  'users.read',
  'users.manage',
  'roles.assign',
  'audit.read',
  'ops.status.read',
  'ops.backup.manage',
  // Academic structure
  'academic.structure.read',
  'academic.structure.manage',
  // People
  'students.read.scoped',
  'students.read.all',
  'students.manage',
  'staff.read',
  'staff.manage',
  'guardians.link.manage',
  // Attendance & timetable
  'attendance.record.scoped',
  'attendance.correct',
  'timetable.read',
  'timetable.manage',
  // Assessment
  'marks.enter.scoped',
  'marks.moderate',
  'results.approve',
  'results.publish',
  'results.read.own',
  // Communication
  'announcements.publish',
  'announcements.read',
  // Self-service
  'self.profile.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ_BASICS: Permission[] = ['announcements.read', 'self.profile.read', 'timetable.read'];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  school_admin: [
    ...READ_BASICS,
    'school.settings.read',
    'school.settings.manage',
    'users.read',
    'users.manage',
    'roles.assign',
    'audit.read',
    'ops.status.read',
    'ops.backup.manage',
    'academic.structure.read',
    'academic.structure.manage',
    'staff.read',
    'staff.manage',
    'timetable.manage',
    'announcements.publish',
    // Admin can manage accounts but does not get marks/results powers by default.
  ],
  principal: [
    ...READ_BASICS,
    'school.settings.read',
    'users.read',
    'audit.read',
    'ops.status.read',
    'academic.structure.read',
    'students.read.all',
    'staff.read',
    'attendance.correct',
    'marks.moderate',
    'results.approve',
    'results.publish',
    'announcements.publish',
  ],
  academic_coordinator: [
    ...READ_BASICS,
    'academic.structure.read',
    'academic.structure.manage',
    'students.read.scoped',
    'staff.read',
    'timetable.manage',
    'marks.moderate',
    'announcements.publish',
  ],
  teacher: [...READ_BASICS, 'academic.structure.read', 'students.read.scoped', 'attendance.record.scoped', 'marks.enter.scoped'],
  registrar: [...READ_BASICS, 'academic.structure.read', 'students.read.all', 'students.manage', 'guardians.link.manage'],
  student: [...READ_BASICS, 'results.read.own'],
  guardian: [...READ_BASICS, 'results.read.own'],
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Union of permissions granted by a set of roles. Unknown roles grant nothing. */
export function permissionsFor(roles: readonly string[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) {
    if (!isRole(r)) continue;
    for (const p of ROLE_PERMISSIONS[r]) out.add(p);
  }
  return out;
}

export function hasPermission(roles: readonly string[], permission: Permission): boolean {
  return permissionsFor(roles).has(permission);
}
