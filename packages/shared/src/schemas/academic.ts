import { z } from 'zod';
import { LOCALES } from '../locales.js';
import { isoDateSchema } from './common.js';
import { CALENDAR_EVENT_KINDS } from '../constants.js';

/**
 * Request schemas for the academic structure. Everything is school-configurable:
 * no calendar, grade list, subject list or bell schedule is hard-coded.
 * Update schemas are partial; the API re-checks cross-field rules against the stored row.
 */

const label = (max: number) => z.string().trim().min(1).max(max);
const nonEmpty = <T extends z.ZodRawShape>(s: z.ZodObject<T>) =>
  s.partial().refine((v) => Object.keys(v).length > 0, 'At least one field is required');

/** `HH:MM` or `HH:MM:SS`, 00:00–23:59. Normalised to `HH:MM:SS`. */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Use HH:MM')
  .transform((s) => (s.length === 5 ? `${s}:00` : s));

// Academic years -------------------------------------------------------------
export const academicYearFields = z.object({
  label: label(32),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
});
export const createAcademicYearSchema = academicYearFields
  .extend({ isCurrent: z.boolean().default(false) })
  .refine((v) => v.endsOn > v.startsOn, { message: 'endsOn must be after startsOn', path: ['endsOn'] });
export const updateAcademicYearSchema = nonEmpty(academicYearFields);

// Terms ----------------------------------------------------------------------
export const termFields = z.object({
  label: label(64),
  sequence: z.number().int().min(1).max(12),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
});
export const createTermSchema = termFields.refine((v) => v.endsOn > v.startsOn, {
  message: 'endsOn must be after startsOn',
  path: ['endsOn'],
});
export const updateTermSchema = nonEmpty(termFields);

// Grades ---------------------------------------------------------------------
export const gradeFields = z.object({
  name: label(64),
  /** Ordering key (e.g. 1 for Grade 1, 13 for Grade 13). Unique. */
  level: z.number().int().min(0).max(20),
  isActive: z.boolean(),
});
export const createGradeSchema = gradeFields.extend({ isActive: z.boolean().default(true) });
export const updateGradeSchema = nonEmpty(gradeFields);

// Subjects -------------------------------------------------------------------
export const subjectFields = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, dot, dash or underscore'),
  name: label(128),
  nameSi: label(128).nullable(),
  nameTa: label(128).nullable(),
  isActive: z.boolean(),
});
export const createSubjectSchema = subjectFields.extend({
  nameSi: label(128).nullable().default(null),
  nameTa: label(128).nullable().default(null),
  isActive: z.boolean().default(true),
});
export const updateSubjectSchema = nonEmpty(subjectFields);

/** PUT /grades/:id/subjects — replaces the grade's subject list. */
export const setGradeSubjectsSchema = z.object({
  subjects: z
    .array(z.object({ subjectId: z.number().int().positive(), isOptional: z.boolean().default(false) }))
    .max(100)
    .refine((list) => new Set(list.map((s) => s.subjectId)).size === list.length, 'Duplicate subject'),
});

// Rooms ----------------------------------------------------------------------
export const roomFields = z.object({
  name: label(64),
  capacity: z.number().int().min(1).max(10_000).nullable(),
  isActive: z.boolean(),
});
export const createRoomSchema = roomFields.extend({
  capacity: z.number().int().min(1).max(10_000).nullable().default(null),
  isActive: z.boolean().default(true),
});
export const updateRoomSchema = nonEmpty(roomFields);

// Class sections -------------------------------------------------------------
export const classSectionFields = z.object({
  academicYearId: z.number().int().positive(),
  gradeId: z.number().int().positive(),
  /** Section name within the grade, e.g. "A" or "Science". */
  name: label(32),
  /** Medium of instruction, if the school runs parallel mediums. */
  medium: z.enum(LOCALES).nullable(),
  capacity: z.number().int().min(1).max(1_000).nullable(),
  homeRoomId: z.number().int().positive().nullable(),
});
export const createClassSectionSchema = classSectionFields.extend({
  medium: z.enum(LOCALES).nullable().default(null),
  capacity: z.number().int().min(1).max(1_000).nullable().default(null),
  homeRoomId: z.number().int().positive().nullable().default(null),
});
/** Year and grade are fixed once created (later records will hang off the section). */
export const updateClassSectionSchema = nonEmpty(classSectionFields.omit({ academicYearId: true, gradeId: true }));
export const classSectionQuerySchema = z.object({
  academicYearId: z.coerce.number().int().positive().optional(),
  gradeId: z.coerce.number().int().positive().optional(),
});

// Bell schedule periods ------------------------------------------------------
export const periodFields = z.object({
  label: label(32),
  sequence: z.number().int().min(1).max(30),
  startsAt: timeOfDaySchema,
  endsAt: timeOfDaySchema,
  isBreak: z.boolean(),
});
export const createPeriodSchema = periodFields
  .extend({ isBreak: z.boolean().default(false) })
  .refine((v) => v.endsAt > v.startsAt, { message: 'endsAt must be after startsAt', path: ['endsAt'] });
export const updatePeriodSchema = nonEmpty(periodFields);

// School calendar ------------------------------------------------------------

export const calendarEventFields = z.object({
  academicYearId: z.number().int().positive().nullable(),
  title: label(191),
  kind: z.enum(CALENDAR_EVENT_KINDS),
  startsOn: isoDateSchema,
  /** Inclusive; equal to startsOn for a one-day event. */
  endsOn: isoDateSchema,
  /** False for holidays/closures; attendance is not expected on those days. */
  isSchoolDay: z.boolean(),
});
export const createCalendarEventSchema = calendarEventFields
  .extend({ academicYearId: z.number().int().positive().nullable().default(null) })
  .refine((v) => v.endsOn >= v.startsOn, { message: 'endsOn must not be before startsOn', path: ['endsOn'] });
export const updateCalendarEventSchema = nonEmpty(calendarEventFields);
export const calendarQuerySchema = z
  .object({ from: isoDateSchema.optional(), to: isoDateSchema.optional(), academicYearId: z.coerce.number().int().positive().optional() })
  .refine((v) => !v.from || !v.to || v.to >= v.from, { message: 'to must not be before from', path: ['to'] });

export type CreateAcademicYear = z.infer<typeof createAcademicYearSchema>;
export type CreateTerm = z.infer<typeof createTermSchema>;
export type CreateGrade = z.infer<typeof createGradeSchema>;
export type CreateSubject = z.infer<typeof createSubjectSchema>;
export type CreateRoom = z.infer<typeof createRoomSchema>;
export type CreateClassSection = z.infer<typeof createClassSectionSchema>;
export type CreatePeriod = z.infer<typeof createPeriodSchema>;
export type CreateCalendarEvent = z.infer<typeof createCalendarEventSchema>;
