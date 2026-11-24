import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Kysely, Updateable } from 'kysely';
import {
  createStudentSchema,
  enrollStudentSchema,
  pageWindow,
  promoteSectionSchema,
  studentLeaveSchema,
  studentListQuerySchema,
  studentReadmitSchema,
  toPaginated,
  updateEnrollmentSchema,
  updateStudentSchema,
  type EnrollmentEndReason,
} from '@sms/shared';
import type { Db } from '../../db/client.js';
import type { Database } from '../../db/types.js';
import { recordAudit } from '../../lib/audit.js';
import { AppError, invalid, notFound } from '../../lib/errors.js';
import { requirePermission } from '../../plugins/auth.js';
import { actorId, changedFields, dayBefore, likePattern, routeId } from './common.js';
import { assertCanAccessClass, assertCanAccessStudent, studentScope } from './scope.js';

type Trx = Kysely<Database>;

const canReadStudents = requirePermission('students.read.all', 'students.read.scoped');
const canManageStudents = requirePermission('students.manage');

/**
 * Enrol a student into a class section, closing any open enrolment the day before.
 * Locks the student row so concurrent enrolments cannot leave two open rows.
 * Returns the new enrolment id. Callers audit (so bulk operations can audit once).
 */
export async function enrollStudent(
  trx: Trx,
  req: FastifyRequest,
  studentId: number,
  opts: { classSectionId: number; startsOn: string; rollNo: number | null; endReason: EnrollmentEndReason },
): Promise<{ enrollmentId: number; fromClassSectionId: number | null }> {
  const student = await trx
    .selectFrom('student_profiles')
    .select(['id', 'status'])
    .where('id', '=', studentId)
    .forUpdate()
    .executeTakeFirst();
  if (!student) throw notFound();
  if (student.status !== 'active') throw new AppError('CONFLICT', 'errors.studentNotActive');

  const section = await trx
    .selectFrom('class_sections as c')
    .innerJoin('academic_years as y', 'y.id', 'c.academic_year_id')
    .select(['c.id', 'c.academic_year_id', 'y.starts_on', 'y.ends_on'])
    .where('c.id', '=', opts.classSectionId)
    .executeTakeFirst();
  if (!section) throw invalid('classSectionId', 'Class not found');
  if (opts.startsOn < section.starts_on || opts.startsOn > section.ends_on) {
    throw invalid('startsOn', 'Start date must fall inside the class’s academic year');
  }

  const open = await trx
    .selectFrom('enrollments as e')
    .innerJoin('academic_years as oy', 'oy.id', 'e.academic_year_id')
    .select(['e.id', 'e.class_section_id', 'e.starts_on', 'oy.ends_on as year_ends_on'])
    .where('e.student_id', '=', studentId)
    .where('e.ends_on', 'is', null)
    .executeTakeFirst();
  if (open) {
    if (open.class_section_id === opts.classSectionId) throw new AppError('CONFLICT', 'errors.alreadyEnrolled');
    if (opts.startsOn <= open.starts_on) throw invalid('startsOn', 'Start date must be after the current enrolment began');
    // Close the old enrolment the day before, but never after its own year ended (year-end promotion).
    const before = dayBefore(opts.startsOn);
    await trx
      .updateTable('enrollments')
      .set({ ends_on: before < open.year_ends_on ? before : open.year_ends_on, end_reason: opts.endReason })
      .where('id', '=', open.id)
      .execute();
  }
  const res = await trx
    .insertInto('enrollments')
    .values({
      student_id: studentId,
      class_section_id: opts.classSectionId,
      academic_year_id: section.academic_year_id,
      roll_no: opts.rollNo,
      starts_on: opts.startsOn,
      created_by: actorId(req),
    })
    .executeTakeFirstOrThrow();
  return { enrollmentId: Number(res.insertId), fromClassSectionId: open?.class_section_id ?? null };
}

/** Clamp an admission date into a section's year: admitted before the year → its first day. */
async function enrolmentStartFor(trx: Trx, classSectionId: number, admittedOn: string): Promise<string> {
  const y = await trx
    .selectFrom('class_sections as c')
    .innerJoin('academic_years as y', 'y.id', 'c.academic_year_id')
    .select(['y.starts_on'])
    .where('c.id', '=', classSectionId)
    .executeTakeFirst();
  if (!y) throw invalid('classSectionId', 'Class not found');
  return admittedOn < y.starts_on ? y.starts_on : admittedOn;
}

export const studentRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  /** Students with their current (open) enrolment. */
  const baseQuery = () =>
    db
      .selectFrom('student_profiles as s')
      .leftJoin('enrollments as e', (j) => j.onRef('e.student_id', '=', 's.id').on('e.ends_on', 'is', null))
      .leftJoin('class_sections as c', 'c.id', 'e.class_section_id')
      .leftJoin('grades as g', 'g.id', 'c.grade_id')
      .leftJoin('academic_years as y', 'y.id', 'c.academic_year_id');
  const LIST_COLUMNS = [
    's.id',
    's.admission_no',
    's.full_name',
    's.name_with_initials',
    's.status',
    'e.id as enrollment_id',
    'e.roll_no',
    'c.id as class_id',
    'c.name as class_name',
    'g.id as grade_id',
    'g.name as grade_name',
    'y.id as year_id',
    'y.label as year_label',
  ] as const;
  type ListRow = {
    id: number;
    admission_no: string;
    full_name: string;
    name_with_initials: string | null;
    status: string;
    enrollment_id: number | null;
    roll_no: number | null;
    class_id: number | null;
    class_name: string | null;
    grade_id: number | null;
    grade_name: string | null;
    year_id: number | null;
    year_label: string | null;
  };
  const toListItem = (r: ListRow) => ({
    id: r.id,
    admissionNo: r.admission_no,
    fullName: r.full_name,
    nameWithInitials: r.name_with_initials,
    status: r.status,
    currentClass:
      r.class_id === null
        ? null
        : {
            id: r.class_id,
            name: r.class_name,
            grade: { id: r.grade_id, name: r.grade_name },
            academicYear: { id: r.year_id, label: r.year_label },
            rollNo: r.roll_no,
          },
  });

  app.get('/students', { preHandler: canReadStudents }, async (req) => {
    const q = studentListQuerySchema.parse(req.query);
    let base = baseQuery();
    const scope = studentScope(db, req.auth!);
    if (scope) base = base.where(scope);
    if (q.status) base = base.where('s.status', '=', q.status);
    if (q.classSectionId) base = base.where('c.id', '=', q.classSectionId);
    if (q.gradeId) base = base.where('c.grade_id', '=', q.gradeId);
    if (q.academicYearId) base = base.where('c.academic_year_id', '=', q.academicYearId);
    if (q.unenrolled) base = base.where('e.id', 'is', null);
    if (q.q) {
      const like = likePattern(q.q);
      base = base.where((eb) =>
        eb.or([eb('s.full_name', 'like', like), eb('s.name_with_initials', 'like', like), eb('s.admission_no', 'like', like)]),
      );
    }
    const { limit, offset } = pageWindow(q);
    const [rows, total] = await Promise.all([
      base.select(LIST_COLUMNS).orderBy('s.full_name').orderBy('s.id').limit(limit).offset(offset).execute(),
      base.select(db.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    return toPaginated(
      rows.map((r) => toListItem(r as ListRow)),
      total.n,
      q,
    );
  });

  app.get('/students/:id', { preHandler: canReadStudents }, async (req) => {
    const id = routeId(req);
    const auth = req.auth!;
    await assertCanAccessStudent(db, auth, id);
    const s = await db.selectFrom('student_profiles').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    const current = await baseQuery().select(LIST_COLUMNS).where('s.id', '=', id).executeTakeFirstOrThrow();
    const enrollments = await db
      .selectFrom('enrollments as e')
      .innerJoin('class_sections as c', 'c.id', 'e.class_section_id')
      .innerJoin('grades as g', 'g.id', 'c.grade_id')
      .innerJoin('academic_years as y', 'y.id', 'e.academic_year_id')
      .select([
        'e.id',
        'e.starts_on',
        'e.ends_on',
        'e.end_reason',
        'e.roll_no',
        'c.id as class_id',
        'c.name as class_name',
        'g.name as grade_name',
        'y.label as year_label',
      ])
      .where('e.student_id', '=', id)
      .orderBy('e.starts_on', 'desc')
      .execute();
    const seesHistory = auth.permissions.has('students.read.all') || auth.permissions.has('students.manage');
    const events = seesHistory
      ? await db
          .selectFrom('student_status_events')
          .select(['id', 'from_status', 'to_status', 'effective_on', 'reason', 'note', 'created_at'])
          .where('student_id', '=', id)
          .orderBy('effective_on', 'desc')
          .orderBy('id', 'desc')
          .execute()
      : [];
    const seesGuardians = seesHistory || auth.permissions.has('guardians.link.manage');
    const guardians = seesGuardians
      ? await db
          .selectFrom('student_guardians as sg')
          .innerJoin('guardian_profiles as gp', 'gp.id', 'sg.guardian_id')
          .select(['gp.id', 'gp.full_name', 'gp.phone', 'gp.email', 'sg.relationship', 'sg.is_primary', 'sg.verification_status'])
          .where('sg.student_id', '=', id)
          .orderBy('sg.is_primary', 'desc')
          .orderBy('gp.full_name')
          .execute()
      : null;

    // Sensitive-read audit (C-16): record who opened a student profile.
    await recordAudit(db, req, { action: 'student.viewed', entityType: 'student', entityId: id });

    return {
      ...toListItem(current as ListRow),
      dateOfBirth: s.date_of_birth,
      gender: s.gender,
      admittedOn: s.admitted_on,
      leftOn: s.left_on,
      hasAccount: s.user_id !== null,
      enrollments: enrollments.map((e) => ({
        id: e.id,
        startsOn: e.starts_on,
        endsOn: e.ends_on,
        endReason: e.end_reason,
        rollNo: e.roll_no,
        class: { id: e.class_id, name: e.class_name, gradeName: e.grade_name, yearLabel: e.year_label },
      })),
      statusHistory: events.map((ev) => ({
        id: ev.id,
        fromStatus: ev.from_status,
        toStatus: ev.to_status,
        effectiveOn: ev.effective_on,
        reason: ev.reason,
        note: ev.note,
        recordedAt: new Date(ev.created_at).toISOString(),
      })),
      guardians:
        guardians?.map((g) => ({
          id: g.id,
          fullName: g.full_name,
          phone: g.phone,
          email: g.email,
          relationship: g.relationship,
          isPrimary: Boolean(g.is_primary),
          verificationStatus: g.verification_status,
        })) ?? null,
    };
  });

  app.post('/students', { preHandler: canManageStudents }, async (req, reply) => {
    const input = createStudentSchema.parse(req.body);
    const id = await db.transaction().execute(async (trx) => {
      const res = await trx
        .insertInto('student_profiles')
        .values({
          admission_no: input.admissionNo,
          full_name: input.fullName,
          name_with_initials: input.nameWithInitials,
          date_of_birth: input.dateOfBirth,
          gender: input.gender,
          admitted_on: input.admittedOn,
        })
        .executeTakeFirstOrThrow(); // duplicate admission number → 409 errors.duplicate
      const newId = Number(res.insertId);
      await trx
        .insertInto('student_status_events')
        .values({
          student_id: newId,
          from_status: null,
          to_status: 'active',
          effective_on: input.admittedOn,
          reason: 'admitted',
          recorded_by: actorId(req),
        })
        .execute();
      await recordAudit(trx, req, { action: 'student.created', entityType: 'student', entityId: newId });
      if (input.classSectionId) {
        const startsOn = await enrolmentStartFor(trx, input.classSectionId, input.admittedOn);
        const { enrollmentId } = await enrollStudent(trx, req, newId, {
          classSectionId: input.classSectionId,
          startsOn,
          rollNo: null,
          endReason: 'section_change',
        });
        await recordAudit(trx, req, {
          action: 'enrollment.created',
          entityType: 'student',
          entityId: newId,
          metadata: { enrollmentId, classSectionId: input.classSectionId },
        });
      }
      return newId;
    });
    return reply.status(201).send({ id });
  });

  app.patch('/students/:id', { preHandler: canManageStudents }, async (req) => {
    const id = routeId(req);
    const input = updateStudentSchema.parse(req.body);
    await db.transaction().execute(async (trx) => {
      const exists = await trx.selectFrom('student_profiles').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!exists) throw notFound();
      const row: Updateable<Database['student_profiles']> = {};
      if (input.admissionNo !== undefined) row.admission_no = input.admissionNo;
      if (input.fullName !== undefined) row.full_name = input.fullName;
      if (input.nameWithInitials !== undefined) row.name_with_initials = input.nameWithInitials;
      if (input.dateOfBirth !== undefined) row.date_of_birth = input.dateOfBirth;
      if (input.gender !== undefined) row.gender = input.gender;
      if (input.admittedOn !== undefined) row.admitted_on = input.admittedOn;
      await trx.updateTable('student_profiles').set(row).where('id', '=', id).execute();
      await recordAudit(trx, req, {
        action: 'student.updated',
        entityType: 'student',
        entityId: id,
        metadata: { fields: changedFields(input) },
      });
    });
    return { ok: true };
  });

  app.post('/students/:id/leave', { preHandler: canManageStudents }, async (req) => {
    const id = routeId(req);
    const input = studentLeaveSchema.parse(req.body);
    await db.transaction().execute(async (trx) => {
      const s = await trx
        .selectFrom('student_profiles')
        .select(['id', 'status', 'admitted_on'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!s) throw notFound();
      if (s.status !== 'active') throw new AppError('CONFLICT', 'errors.studentNotActive');
      if (input.effectiveOn < s.admitted_on) throw invalid('effectiveOn', 'Date is before the admission date');
      const open = await trx
        .selectFrom('enrollments')
        .select(['id', 'starts_on'])
        .where('student_id', '=', id)
        .where('ends_on', 'is', null)
        .executeTakeFirst();
      if (open) {
        if (input.effectiveOn < open.starts_on) throw invalid('effectiveOn', 'Date is before the current enrolment began');
        await trx.updateTable('enrollments').set({ ends_on: input.effectiveOn, end_reason: 'left' }).where('id', '=', open.id).execute();
      }
      await trx.updateTable('student_profiles').set({ status: input.status, left_on: input.effectiveOn }).where('id', '=', id).execute();
      await trx
        .insertInto('student_status_events')
        .values({
          student_id: id,
          from_status: 'active',
          to_status: input.status,
          effective_on: input.effectiveOn,
          reason: input.reason,
          note: input.note,
          recorded_by: actorId(req),
        })
        .execute();
      // Reason code only; the free-text note stays in the student's history, not in the audit log.
      await recordAudit(trx, req, {
        action: 'student.left',
        entityType: 'student',
        entityId: id,
        metadata: { status: input.status, reason: input.reason },
      });
    });
    return { ok: true };
  });

  app.post('/students/:id/readmit', { preHandler: canManageStudents }, async (req) => {
    const id = routeId(req);
    const input = studentReadmitSchema.parse(req.body);
    await db.transaction().execute(async (trx) => {
      const s = await trx
        .selectFrom('student_profiles')
        .select(['id', 'status', 'left_on'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!s) throw notFound();
      if (s.status === 'active') throw new AppError('CONFLICT', 'errors.studentAlreadyActive');
      if (s.left_on && input.effectiveOn < s.left_on) throw invalid('effectiveOn', 'Date is before the student left');
      await trx.updateTable('student_profiles').set({ status: 'active', left_on: null }).where('id', '=', id).execute();
      await trx
        .insertInto('student_status_events')
        .values({
          student_id: id,
          from_status: s.status,
          to_status: 'active',
          effective_on: input.effectiveOn,
          reason: 'readmitted',
          note: input.note,
          recorded_by: actorId(req),
        })
        .execute();
      await recordAudit(trx, req, { action: 'student.readmitted', entityType: 'student', entityId: id });
    });
    return { ok: true };
  });

  // Enrolment ----------------------------------------------------------------
  app.post('/students/:id/enrollments', { preHandler: canManageStudents }, async (req, reply) => {
    const id = routeId(req);
    const input = enrollStudentSchema.parse(req.body);
    const result = await db.transaction().execute(async (trx) => {
      const r = await enrollStudent(trx, req, id, input);
      await recordAudit(trx, req, {
        action: 'enrollment.created',
        entityType: 'student',
        entityId: id,
        metadata: {
          enrollmentId: r.enrollmentId,
          classSectionId: input.classSectionId,
          fromClassSectionId: r.fromClassSectionId,
          endReason: input.endReason,
        },
      });
      return r;
    });
    return reply.status(201).send({ id: result.enrollmentId });
  });

  app.patch('/enrollments/:id', { preHandler: canManageStudents }, async (req) => {
    const id = routeId(req);
    const input = updateEnrollmentSchema.parse(req.body);
    await db.transaction().execute(async (trx) => {
      const e = await trx.selectFrom('enrollments').select(['id', 'student_id']).where('id', '=', id).executeTakeFirst();
      if (!e) throw notFound();
      await trx
        .updateTable('enrollments')
        .set({ roll_no: input.rollNo ?? null })
        .where('id', '=', id)
        .execute();
      await recordAudit(trx, req, {
        action: 'enrollment.updated',
        entityType: 'student',
        entityId: e.student_id,
        metadata: { enrollmentId: id, fields: changedFields(input) },
      });
    });
    return { ok: true };
  });

  /** Move every open enrolment of one section into another (year-end promotion). */
  app.post('/enrollments/promote', { preHandler: canManageStudents }, async (req) => {
    const input = promoteSectionSchema.parse(req.body);
    if (input.fromClassSectionId === input.toClassSectionId) throw invalid('toClassSectionId', 'Choose a different class');
    return db.transaction().execute(async (trx) => {
      const from = await trx.selectFrom('class_sections').select('id').where('id', '=', input.fromClassSectionId).executeTakeFirst();
      if (!from) throw invalid('fromClassSectionId', 'Class not found');
      const exclude = new Set(input.excludeStudentIds);
      const rows = await trx
        .selectFrom('enrollments as e')
        .innerJoin('student_profiles as s', 's.id', 'e.student_id')
        .select(['e.student_id'])
        .where('e.class_section_id', '=', input.fromClassSectionId)
        .where('e.ends_on', 'is', null)
        .where('s.status', '=', 'active')
        .orderBy('e.student_id')
        .execute();
      let moved = 0;
      for (const r of rows) {
        if (exclude.has(r.student_id)) continue;
        await enrollStudent(trx, req, r.student_id, {
          classSectionId: input.toClassSectionId,
          startsOn: input.startsOn,
          rollNo: null,
          endReason: 'promoted',
        });
        moved++;
      }
      if (moved > 0) {
        await recordAudit(trx, req, {
          action: 'enrollment.promoted',
          entityType: 'class_section',
          entityId: input.toClassSectionId,
          metadata: { fromClassSectionId: input.fromClassSectionId, moved, kept: rows.length - moved },
        });
      }
      return { moved, kept: rows.length - moved };
    });
  });

  /** Current roster of a class section. Teachers see only classes they teach. */
  app.get(
    '/class-sections/:id/students',
    { preHandler: requirePermission('students.read.all', 'students.read.scoped', 'attendance.record.scoped') },
    async (req) => {
      const id = routeId(req);
      await assertCanAccessClass(db, req.auth!, id);
      const rows = await db
        .selectFrom('enrollments as e')
        .innerJoin('student_profiles as s', 's.id', 'e.student_id')
        .select(['s.id', 's.admission_no', 's.full_name', 's.name_with_initials', 'e.id as enrollment_id', 'e.roll_no', 'e.starts_on'])
        .where('e.class_section_id', '=', id)
        .where('e.ends_on', 'is', null)
        .orderBy('e.roll_no')
        .orderBy('s.full_name')
        .execute();
      return {
        items: rows.map((r) => ({
          id: r.id,
          admissionNo: r.admission_no,
          fullName: r.full_name,
          nameWithInitials: r.name_with_initials,
          enrollmentId: r.enrollment_id,
          rollNo: r.roll_no,
          startsOn: r.starts_on,
        })),
      };
    },
  );
};
