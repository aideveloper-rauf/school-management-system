import type { FastifyPluginAsync } from 'fastify';
import type { Kysely, Updateable } from 'kysely';
import { createTimetableEntrySchema, timetableQuerySchema, updateTimetableEntrySchema } from '@sms/shared';
import type { Db } from '../../db/client.js';
import type { Database } from '../../db/types.js';
import { recordAudit } from '../../lib/audit.js';
import { AppError, invalid, notFound } from '../../lib/errors.js';
import { requirePermission } from '../../plugins/auth.js';
import { routeId } from '../people/common.js';
import { staffIdOf } from '../people/scope.js';

/**
 * Timetable (roadmap C-11). Read: `timetable.read` (every role — a timetable holds no personal data
 * beyond staff names). Change: `timetable.manage`.
 *
 * Checks before writing, each with its own error so the screen can say what clashes:
 * class busy (errors.timetableClassBusy), teacher busy (errors.timetableTeacherBusy), room busy
 * (errors.timetableRoomBusy). Unique keys in migration 0007 back these up against races.
 * A teacher must be assigned to teach that subject to that class (teacher_assignments), so the timetable
 * never grants scope the assignments do not.
 */
type Trx = Kysely<Database>;

async function assertSlotFree(
  trx: Trx,
  e: { academicYearId: number; classSectionId: number; dayOfWeek: number; periodId: number; staffId: number | null; roomId: number | null },
  exceptId?: number,
): Promise<void> {
  const slot = (q: ReturnType<typeof base>) => q.where('day_of_week', '=', e.dayOfWeek).where('period_id', '=', e.periodId);
  const base = () => {
    let q = trx.selectFrom('timetable_entries').select('id');
    if (exceptId) q = q.where('id', '!=', exceptId);
    return q;
  };
  if (await slot(base()).where('class_section_id', '=', e.classSectionId).executeTakeFirst()) {
    throw new AppError('CONFLICT', 'errors.timetableClassBusy', [{ path: 'periodId', message: 'errors.timetableClassBusy' }]);
  }
  if (
    e.staffId &&
    (await slot(base()).where('academic_year_id', '=', e.academicYearId).where('staff_id', '=', e.staffId).executeTakeFirst())
  ) {
    throw new AppError('CONFLICT', 'errors.timetableTeacherBusy', [{ path: 'staffId', message: 'errors.timetableTeacherBusy' }]);
  }
  if (
    e.roomId &&
    (await slot(base()).where('academic_year_id', '=', e.academicYearId).where('room_id', '=', e.roomId).executeTakeFirst())
  ) {
    throw new AppError('CONFLICT', 'errors.timetableRoomBusy', [{ path: 'roomId', message: 'errors.timetableRoomBusy' }]);
  }
}

async function assertRefs(
  trx: Trx,
  classSectionId: number,
  subjectId: number,
  staffId: number | null,
  roomId: number | null,
  periodId?: number,
): Promise<void> {
  if (periodId !== undefined) {
    const period = await trx.selectFrom('period_definitions').select('is_break').where('id', '=', periodId).executeTakeFirst();
    if (!period) throw invalid('periodId', 'Period not found');
    if (period.is_break) throw invalid('periodId', 'Lessons cannot be placed in a break');
  }
  const section = await trx.selectFrom('class_sections').select('grade_id').where('id', '=', classSectionId).executeTakeFirst();
  if (!section) throw invalid('classSectionId', 'Class not found');
  const taught = await trx
    .selectFrom('grade_subjects')
    .select('subject_id')
    .where('grade_id', '=', section.grade_id)
    .where('subject_id', '=', subjectId)
    .executeTakeFirst();
  if (!taught) throw invalid('subjectId', 'This grade does not take that subject');
  if (staffId) {
    const assigned = await trx
      .selectFrom('teacher_assignments')
      .select('id')
      .where('staff_id', '=', staffId)
      .where('class_section_id', '=', classSectionId)
      .where('subject_id', '=', subjectId)
      .executeTakeFirst();
    if (!assigned) throw invalid('staffId', 'errors.timetableTeacherNotAssigned');
  }
  if (roomId) {
    const room = await trx.selectFrom('rooms').select('is_active').where('id', '=', roomId).executeTakeFirst();
    if (!room || !room.is_active) throw invalid('roomId', 'Room not found or inactive');
  }
}

export const timetableRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const entries = () =>
    db
      .selectFrom('timetable_entries as t')
      .innerJoin('class_sections as c', 'c.id', 't.class_section_id')
      .innerJoin('grades as g', 'g.id', 'c.grade_id')
      .innerJoin('period_definitions as p', 'p.id', 't.period_id')
      .innerJoin('subjects as sub', 'sub.id', 't.subject_id')
      .leftJoin('staff_profiles as sp', 'sp.id', 't.staff_id')
      .leftJoin('rooms as r', 'r.id', 't.room_id')
      .select([
        't.id',
        't.academic_year_id',
        't.day_of_week',
        'p.id as period_id',
        'p.label as period_label',
        'p.sequence as period_sequence',
        'p.starts_at',
        'p.ends_at',
        'c.id as class_id',
        'c.name as class_name',
        'g.name as grade_name',
        'sub.id as subject_id',
        'sub.name as subject_name',
        'sub.code as subject_code',
        'sp.id as staff_id',
        'sp.full_name as staff_name',
        'r.id as room_id',
        'r.name as room_name',
      ]);
  type Row = Awaited<ReturnType<ReturnType<typeof entries>['execute']>>[number];
  const toEntry = (r: Row) => ({
    id: r.id,
    academicYearId: r.academic_year_id,
    dayOfWeek: r.day_of_week,
    period: {
      id: r.period_id,
      label: r.period_label,
      sequence: r.period_sequence,
      startsAt: r.starts_at.slice(0, 5),
      endsAt: r.ends_at.slice(0, 5),
    },
    classSection: { id: r.class_id, name: r.class_name, gradeName: r.grade_name },
    subject: { id: r.subject_id, name: r.subject_name, code: r.subject_code },
    teacher: r.staff_id === null ? null : { id: r.staff_id, fullName: r.staff_name },
    room: r.room_id === null ? null : { id: r.room_id, name: r.room_name },
  });

  app.get('/timetable', { preHandler: requirePermission('timetable.read') }, async (req) => {
    const q = timetableQuerySchema.parse(req.query);
    let query = entries();
    if (q.classSectionId) query = query.where('t.class_section_id', '=', q.classSectionId);
    if (q.staffId) query = query.where('t.staff_id', '=', q.staffId);
    if (q.roomId) query = query.where('t.room_id', '=', q.roomId);
    if (q.academicYearId) query = query.where('t.academic_year_id', '=', q.academicYearId);
    const rows = await query.orderBy('t.day_of_week').orderBy('p.sequence').execute();
    return { items: rows.map(toEntry) };
  });

  /** My week: a teacher's lessons, or the class timetable of a student (current year). */
  app.get('/me/timetable', { preHandler: requirePermission('timetable.read') }, async (req) => {
    const userId = req.auth!.user.id;
    const year = await db.selectFrom('academic_years').select('id').where('is_current', '=', 1).executeTakeFirst();
    if (!year) return { kind: 'none', items: [] };
    const staffId = await staffIdOf(db, userId);
    if (staffId) {
      const rows = await entries()
        .where('t.staff_id', '=', staffId)
        .where('t.academic_year_id', '=', year.id)
        .orderBy('t.day_of_week')
        .orderBy('p.sequence')
        .execute();
      return { kind: 'teacher', items: rows.map(toEntry) };
    }
    const enrolment = await db
      .selectFrom('enrollments as e')
      .innerJoin('student_profiles as s', 's.id', 'e.student_id')
      .select('e.class_section_id')
      .where('s.user_id', '=', userId)
      .where('e.ends_on', 'is', null)
      .where('e.academic_year_id', '=', year.id)
      .executeTakeFirst();
    if (!enrolment) return { kind: 'none', items: [] };
    const rows = await entries()
      .where('t.class_section_id', '=', enrolment.class_section_id)
      .orderBy('t.day_of_week')
      .orderBy('p.sequence')
      .execute();
    return { kind: 'class', items: rows.map(toEntry) };
  });

  app.post('/timetable-entries', { preHandler: requirePermission('timetable.manage') }, async (req, reply) => {
    const input = createTimetableEntrySchema.parse(req.body);
    const id = await db.transaction().execute(async (trx) => {
      const section = await trx
        .selectFrom('class_sections')
        .select(['academic_year_id'])
        .where('id', '=', input.classSectionId)
        .forUpdate()
        .executeTakeFirst();
      if (!section) throw invalid('classSectionId', 'Class not found');
      await assertRefs(trx, input.classSectionId, input.subjectId, input.staffId, input.roomId, input.periodId);
      await assertSlotFree(trx, { ...input, academicYearId: section.academic_year_id });
      const res = await trx
        .insertInto('timetable_entries')
        .values({
          academic_year_id: section.academic_year_id,
          class_section_id: input.classSectionId,
          day_of_week: input.dayOfWeek,
          period_id: input.periodId,
          subject_id: input.subjectId,
          staff_id: input.staffId,
          room_id: input.roomId,
          created_by: req.auth!.user.id,
        })
        .executeTakeFirstOrThrow();
      const newId = Number(res.insertId);
      await recordAudit(trx, req, {
        action: 'timetable.entry_created',
        entityType: 'class_section',
        entityId: input.classSectionId,
        metadata: { entryId: newId, dayOfWeek: input.dayOfWeek, periodId: input.periodId },
      });
      return newId;
    });
    return reply.status(201).send({ id });
  });

  app.patch('/timetable-entries/:id', { preHandler: requirePermission('timetable.manage') }, async (req) => {
    const id = routeId(req);
    const input = updateTimetableEntrySchema.parse(req.body);
    await db.transaction().execute(async (trx) => {
      const cur = await trx.selectFrom('timetable_entries').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!cur) throw notFound();
      const next = {
        subjectId: input.subjectId ?? cur.subject_id,
        staffId: input.staffId !== undefined ? input.staffId : cur.staff_id,
        roomId: input.roomId !== undefined ? input.roomId : cur.room_id,
      };
      await assertRefs(trx, cur.class_section_id, next.subjectId, next.staffId, next.roomId);
      await assertSlotFree(
        trx,
        {
          academicYearId: cur.academic_year_id,
          classSectionId: cur.class_section_id,
          dayOfWeek: cur.day_of_week,
          periodId: cur.period_id,
          staffId: next.staffId,
          roomId: next.roomId,
        },
        id,
      );
      const row: Updateable<Database['timetable_entries']> = { subject_id: next.subjectId, staff_id: next.staffId, room_id: next.roomId };
      await trx.updateTable('timetable_entries').set(row).where('id', '=', id).execute();
      await recordAudit(trx, req, {
        action: 'timetable.entry_updated',
        entityType: 'class_section',
        entityId: cur.class_section_id,
        metadata: { entryId: id, fields: Object.keys(input).sort() },
      });
    });
    return { ok: true };
  });

  app.delete('/timetable-entries/:id', { preHandler: requirePermission('timetable.manage') }, async (req, reply) => {
    const id = routeId(req);
    await db.transaction().execute(async (trx) => {
      const cur = await trx.selectFrom('timetable_entries').select(['class_section_id']).where('id', '=', id).executeTakeFirst();
      if (!cur) throw notFound();
      await trx.deleteFrom('timetable_entries').where('id', '=', id).execute();
      await recordAudit(trx, req, {
        action: 'timetable.entry_deleted',
        entityType: 'class_section',
        entityId: cur.class_section_id,
        metadata: { entryId: id },
      });
    });
    return reply.status(204).send();
  });
};
