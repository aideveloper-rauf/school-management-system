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

// People records (migration 0005). Provisional minimal field set until the data policy (P0-6) is signed off.
export const STUDENT_STATUSES = ['active', 'left', 'transferred', 'graduated'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];
export const GENDERS = ['female', 'male', 'other'] as const;
export type Gender = (typeof GENDERS)[number];
export const STAFF_STATUSES = ['active', 'left'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];
/** Reason codes for a student leaving / changing status. Free-text detail goes in `note`, never in audit. */
export const STUDENT_LEAVE_REASONS = ['transfer', 'completed', 'family_move', 'withdrawn', 'other'] as const;
export type StudentLeaveReason = (typeof STUDENT_LEAVE_REASONS)[number];
export const ENROLLMENT_END_REASONS = ['section_change', 'promoted', 'left', 'correction'] as const;
export type EnrollmentEndReason = (typeof ENROLLMENT_END_REASONS)[number];
export const GUARDIAN_RELATIONSHIPS = ['mother', 'father', 'guardian', 'other'] as const;
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];
export const LINK_VERIFICATION_STATUSES = ['pending', 'verified', 'rejected'] as const;
export type LinkVerificationStatus = (typeof LINK_VERIFICATION_STATUSES)[number];
/** How the registrar confirmed a guardian link (P0-6 decides which methods the school accepts). */
export const VERIFICATION_METHODS = ['in_person', 'birth_certificate', 'school_records', 'other'] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];
export const IMPORT_KINDS = ['students', 'staff', 'guardians'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
/** CSV columns per import kind (header names, case/space-insensitive). Shared so the web can offer templates. */
export const IMPORT_COLUMNS: Record<ImportKind, { required: readonly string[]; optional: readonly string[] }> = {
  students: {
    required: ['admission_no', 'full_name', 'admitted_on'],
    optional: ['name_with_initials', 'date_of_birth', 'gender', 'grade', 'class'],
  },
  staff: { required: ['staff_no', 'full_name'], optional: ['name_with_initials', 'designation', 'work_email', 'work_phone', 'joined_on'] },
  guardians: { required: ['student_admission_no', 'full_name', 'relationship'], optional: ['phone', 'email', 'is_primary'] },
};

/**
 * Audit log categories → action prefixes. Shared so the API filter and the web filter agree.
 * Every audited action must start with one of these prefixes (a test checks the API's actions).
 */
export const AUDIT_CATEGORIES = {
  signIn: ['auth.'],
  people: ['user.', 'role.', 'setup.'],
  records: ['student.', 'staff.', 'guardian.', 'enrollment.', 'teacher_assignment.', 'import.'],
  academic: ['academic_year.', 'term.', 'grade.', 'subject.', 'room.', 'class_section.', 'period.', 'calendar_event.'],
  settings: ['school.'],
  backups: ['backup.'],
} as const;
export type AuditCategory = keyof typeof AUDIT_CATEGORIES;
export const AUDIT_CATEGORY_KEYS = Object.keys(AUDIT_CATEGORIES) as AuditCategory[];
