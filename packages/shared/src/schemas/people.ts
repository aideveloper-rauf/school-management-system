import { z } from 'zod';
import { LOCALES } from '../locales.js';
import {
  ENROLLMENT_END_REASONS,
  GENDERS,
  GUARDIAN_RELATIONSHIPS,
  IMPORT_KINDS,
  STAFF_STATUSES,
  STUDENT_LEAVE_REASONS,
  STUDENT_STATUSES,
  VERIFICATION_METHODS,
} from '../constants.js';
import { isoDateSchema, paginationQuerySchema } from './common.js';

/**
 * Student, staff and guardian records (roadmap C-1…C-6). Field set is minimal and provisional until
 * the data-handling policy (P0-6) is signed off — do not add identity/health/address fields here
 * without a documented purpose and retention rule.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable();
const nonEmpty = <T extends z.ZodRawShape>(s: z.ZodObject<T>) =>
  s.partial().refine((v) => Object.keys(v).length > 0, 'At least one field is required');
/** School-issued numbers: letters, digits and / - . only, so they are safe in CSVs and URLs. */
const refNo = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9/.-]*$/, 'Use letters, digits, / - .');
const phone = z
  .string()
  .trim()
  .max(32)
  .regex(/^\+?[0-9 ()-]{7,}$/, 'Not a valid phone number')
  .or(z.literal('').transform(() => null))
  .nullable();
const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(191)
  .pipe(z.email('Not a valid email address'))
  .or(z.literal('').transform(() => null))
  .nullable();
const idSchema = z.number().int().positive();
const searchQuery = z.string().trim().max(100).optional();

// Students -------------------------------------------------------------------
export const studentFields = z.object({
  admissionNo: refNo,
  fullName: text(191),
  nameWithInitials: optionalText(191),
  dateOfBirth: isoDateSchema.nullable(),
  gender: z.enum(GENDERS).nullable(),
  admittedOn: isoDateSchema,
});
export const createStudentSchema = studentFields.extend({
  nameWithInitials: optionalText(191).default(null),
  dateOfBirth: isoDateSchema.nullable().default(null),
  gender: z.enum(GENDERS).nullable().default(null),
  /** Optionally enrol straight into a class section (from its start date or admittedOn). */
  classSectionId: idSchema.optional(),
});
export const updateStudentSchema = nonEmpty(studentFields);
export const studentListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery,
  status: z.enum(STUDENT_STATUSES).optional(),
  classSectionId: z.coerce.number().int().positive().optional(),
  gradeId: z.coerce.number().int().positive().optional(),
  academicYearId: z.coerce.number().int().positive().optional(),
  /** Students with no open enrolment. */
  unenrolled: z.coerce.boolean().optional(),
});

/** Leave / transfer out / graduate. Ends the open enrolment on `effectiveOn`. */
export const studentLeaveSchema = z.object({
  status: z.enum(['left', 'transferred', 'graduated']),
  effectiveOn: isoDateSchema,
  reason: z.enum(STUDENT_LEAVE_REASONS),
  note: optionalText(500).default(null),
});
/** Re-admit a student who left. */
export const studentReadmitSchema = z.object({
  effectiveOn: isoDateSchema,
  note: optionalText(500).default(null),
});

/** Enrol into a section, or move (ends the open enrolment the day before `startsOn`). */
export const enrollStudentSchema = z.object({
  classSectionId: idSchema,
  startsOn: isoDateSchema,
  rollNo: z.number().int().min(1).max(999).nullable().default(null),
  /** Why the previous enrolment ends, when one is open. */
  endReason: z.enum(ENROLLMENT_END_REASONS).default('section_change'),
});
export const updateEnrollmentSchema = nonEmpty(z.object({ rollNo: z.number().int().min(1).max(999).nullable() }));

/** Bulk promotion: every open enrolment in `fromClassSectionId` moves to `toClassSectionId`. */
export const promoteSectionSchema = z.object({
  fromClassSectionId: idSchema,
  toClassSectionId: idSchema,
  startsOn: isoDateSchema,
  /** Leave these students where they are (e.g. repeating the year). */
  excludeStudentIds: z.array(idSchema).max(500).default([]),
});

// Staff ----------------------------------------------------------------------
export const staffFields = z.object({
  staffNo: refNo,
  fullName: text(191),
  nameWithInitials: optionalText(191),
  designation: optionalText(64),
  workEmail: email,
  workPhone: phone,
  joinedOn: isoDateSchema.nullable(),
  /** Link to a sign-in account (one profile per account). */
  userId: idSchema.nullable(),
});
export const createStaffSchema = staffFields.extend({
  nameWithInitials: optionalText(191).default(null),
  designation: optionalText(64).default(null),
  workEmail: email.default(null),
  workPhone: phone.default(null),
  joinedOn: isoDateSchema.nullable().default(null),
  userId: idSchema.nullable().default(null),
});
export const updateStaffSchema = nonEmpty(staffFields.extend({ status: z.enum(STAFF_STATUSES), leftOn: isoDateSchema.nullable() }));
export const staffListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery,
  status: z.enum(STAFF_STATUSES).optional(),
});

// Guardians ------------------------------------------------------------------
export const guardianFields = z.object({
  fullName: text(191),
  phone,
  email,
  preferredLocale: z.enum(LOCALES),
  notifyEmail: z.boolean(),
  notifySms: z.boolean(),
  userId: idSchema.nullable(),
});
export const createGuardianSchema = guardianFields.extend({
  phone: phone.default(null),
  email: email.default(null),
  preferredLocale: z.enum(LOCALES).default('en'),
  notifyEmail: z.boolean().default(true),
  notifySms: z.boolean().default(false),
  userId: idSchema.nullable().default(null),
});
export const updateGuardianSchema = nonEmpty(guardianFields);
export const guardianListQuerySchema = paginationQuerySchema.extend({ q: searchQuery });

export const linkGuardianSchema = z.object({
  guardianId: idSchema,
  relationship: z.enum(GUARDIAN_RELATIONSHIPS),
  isPrimary: z.boolean().default(false),
});
export const updateGuardianLinkSchema = nonEmpty(z.object({ relationship: z.enum(GUARDIAN_RELATIONSHIPS), isPrimary: z.boolean() }));
/** Registrar decision on a link. Only `verified` links give a guardian access to the student. */
export const verifyGuardianLinkSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('verified'), method: z.enum(VERIFICATION_METHODS) }),
  z.object({ decision: z.literal('rejected') }),
]);
export const guardianLinkQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['pending', 'verified', 'rejected']).optional(),
});

// Teacher assignments --------------------------------------------------------
export const createTeacherAssignmentSchema = z.object({
  staffId: idSchema,
  classSectionId: idSchema,
  subjectId: idSchema,
});
export const teacherAssignmentQuerySchema = z.object({
  academicYearId: z.coerce.number().int().positive().optional(),
  classSectionId: z.coerce.number().int().positive().optional(),
  staffId: z.coerce.number().int().positive().optional(),
});
export const setClassTeacherSchema = z.object({ staffId: idSchema.nullable() });

// CSV import -----------------------------------------------------------------
/** Max upload size for a CSV import (characters). ~2 MB is a few thousand rows. */
export const IMPORT_MAX_CHARS = 2_000_000;
export const IMPORT_MAX_ROWS = 5_000;
export const importUploadSchema = z.object({
  kind: z.enum(IMPORT_KINDS),
  fileName: z.string().trim().min(1).max(191),
  /** File content as UTF-8 text (the browser reads the file; no multipart needed). */
  content: z.string().min(1).max(IMPORT_MAX_CHARS),
});
export const importListQuerySchema = paginationQuerySchema.extend({ kind: z.enum(IMPORT_KINDS).optional() });

export type CreateStudent = z.infer<typeof createStudentSchema>;
export type CreateStaff = z.infer<typeof createStaffSchema>;
export type CreateGuardian = z.infer<typeof createGuardianSchema>;
