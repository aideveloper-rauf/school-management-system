import { z } from 'zod';
import { ANNOUNCEMENT_AUDIENCES } from '../constants.js';
import { ROLES } from '../roles.js';
import { isoDateSchema, paginationQuerySchema } from './common.js';

const idSchema = z.number().int().positive();
const nonEmpty = <T extends z.ZodRawShape>(s: z.ZodObject<T>) =>
  s.partial().refine((v) => Object.keys(v).length > 0, 'At least one field is required');

// Timetable (roadmap C-11) ---------------------------------------------------
export const timetableEntryFields = z.object({
  classSectionId: idSchema,
  dayOfWeek: z.number().int().min(1).max(7),
  periodId: idSchema,
  subjectId: idSchema,
  staffId: idSchema.nullable(),
  roomId: idSchema.nullable(),
});
export const createTimetableEntrySchema = timetableEntryFields.extend({
  staffId: idSchema.nullable().default(null),
  roomId: idSchema.nullable().default(null),
});
/** Class and slot are fixed; move a lesson by deleting and re-creating it. */
export const updateTimetableEntrySchema = nonEmpty(timetableEntryFields.pick({ subjectId: true, staffId: true, roomId: true }));
export const timetableQuerySchema = z
  .object({
    academicYearId: z.coerce.number().int().positive().optional(),
    classSectionId: z.coerce.number().int().positive().optional(),
    staffId: z.coerce.number().int().positive().optional(),
    roomId: z.coerce.number().int().positive().optional(),
  })
  .refine((v) => v.classSectionId || v.staffId || v.roomId, 'Choose a class, teacher or room');

// Announcements (roadmap C-12) -----------------------------------------------
const audienceFields = {
  audience: z.enum(ANNOUNCEMENT_AUDIENCES),
  audienceRole: z.enum(ROLES).nullable().default(null),
  audienceGradeId: idSchema.nullable().default(null),
  audienceClassSectionId: idSchema.nullable().default(null),
};
const audienceRefine = <T extends { audience: string; audienceRole: unknown; audienceGradeId: unknown; audienceClassSectionId: unknown }>(
  v: T,
  ctx: z.RefinementCtx,
) => {
  const need: Record<string, keyof T | null> = {
    school: null,
    role: 'audienceRole',
    grade: 'audienceGradeId',
    class: 'audienceClassSectionId',
    guardians_of_class: 'audienceClassSectionId',
  };
  const key = need[v.audience];
  if (key && (v[key] === null || v[key] === undefined))
    ctx.addIssue({ code: 'custom', path: [String(key)], message: 'Required for this audience' });
};
export const createAnnouncementSchema = z
  .object({
    title: z.string().trim().min(1).max(191),
    body: z.string().trim().min(1).max(10_000),
    ...audienceFields,
    expiresOn: isoDateSchema.nullable().default(null),
    publish: z.boolean().default(false),
  })
  .superRefine(audienceRefine);
export const updateAnnouncementSchema = z
  .object({
    title: z.string().trim().min(1).max(191),
    body: z.string().trim().min(1).max(10_000),
    ...audienceFields,
    expiresOn: isoDateSchema.nullable().default(null),
  })
  .superRefine(audienceRefine);
export const announcementListQuerySchema = paginationQuerySchema.extend({
  /** Publisher view: drafts, published, withdrawn. */
  state: z.enum(['draft', 'published', 'withdrawn']).optional(),
});

// Learning (roadmap L-2, L-3) ------------------------------------------------
const score = z.number().min(0).max(1000).multipleOf(0.01);
export const learningItemFields = z.object({
  kind: z.enum(['resource', 'assignment']),
  classSectionId: idSchema,
  subjectId: idSchema,
  title: z.string().trim().min(1).max(191),
  instructions: z.string().trim().max(10_000).nullable().default(null),
  /** ISO date-time; assignments only. */
  dueAt: z.iso.datetime({ offset: true }).nullable().default(null),
  allowLate: z.boolean().default(true),
  maxScore: score.nullable().default(null),
  fileIds: z.array(idSchema).max(10).default([]),
});
export const createLearningItemSchema = learningItemFields
  .extend({ publish: z.boolean().default(false) })
  .refine((v) => v.kind === 'assignment' || (v.dueAt === null && v.maxScore === null), {
    message: 'Only assignments have a due date or score',
    path: ['dueAt'],
  });
/** Full replacement of the editable fields (class and subject stay fixed). */
export const updateLearningItemSchema = learningItemFields.omit({ kind: true, classSectionId: true, subjectId: true });
export const learningListQuerySchema = paginationQuerySchema.extend({
  classSectionId: z.coerce.number().int().positive().optional(),
  subjectId: z.coerce.number().int().positive().optional(),
  kind: z.enum(['resource', 'assignment']).optional(),
  /** Guardian view: one linked child. */
  studentId: z.coerce.number().int().positive().optional(),
});
export const submitWorkSchema = z
  .object({
    textAnswer: z.string().trim().max(20_000).nullable().default(null),
    fileIds: z.array(idSchema).max(5).default([]),
  })
  .refine((v) => v.textAnswer || v.fileIds.length > 0, { message: 'Add an answer or a file', path: ['textAnswer'] });
export const returnSubmissionSchema = z.object({
  feedback: z.string().trim().max(5_000).nullable().default(null),
  score: score.nullable().default(null),
});
