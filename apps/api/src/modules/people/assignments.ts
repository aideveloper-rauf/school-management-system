import type { FastifyPluginAsync } from 'fastify';
import { createTeacherAssignmentSchema, setClassTeacherSchema, teacherAssignmentQuerySchema } from '@sms/shared';
import type { Db } from '../../db/client.js';
import { recordAudit } from '../../lib/audit.js';
import { invalid, notFound } from '../../lib/errors.js';
import { requirePermission } from '../../plugins/auth.js';
import { routeId } from './common.js';
import { staffIdOf } from './scope.js';

/**
 * Teacher assignments (roadmap C-6): staff ↔ class section ↔ subject, plus the class teacher.
 * These rows ARE the teacher's record scope (students, attendance, marks), so every change is audited.
 * Read: academic.structure.read. Change: academic.structure.manage.
 */
export const assignmentRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const canRead = requirePermission('academic.structure.read');
  const canManage = requirePermission('academic.structure.manage');

  app.get('/teacher-assignments', { preHandler: canRead }, async (req) => {
    const q = teacherAssignmentQuerySchema.parse(req.query);
    let query = db
      .selectFrom('teacher_assignments as ta')
      .innerJoin('staff_profiles as sp', 'sp.id', 'ta.staff_id')
      .innerJoin('class_sections as c', 'c.id', 'ta.class_section_id')
      .innerJoin('grades as g', 'g.id', 'c.grade_id')
      .innerJoin('subjects as sub', 'sub.id', 'ta.subject_id')
      .select([
        'ta.id',
        'sp.id as staff_id',
        'sp.full_name as staff_name',
        'c.id as class_id',
        'c.name as class_name',
        'c.academic_year_id',
        'g.name as grade_name',
        'sub.id as subject_id',
        'sub.name as subject_name',
        'sub.code as subject_code',
      ]);
    if (q.academicYearId) query = query.where('c.academic_year_id', '=', q.academicYearId);
    if (q.classSectionId) query = query.where('c.id', '=', q.classSectionId);
    if (q.staffId) query = query.where('sp.id', '=', q.staffId);
    const rows = await query.orderBy('g.level').orderBy('c.name').orderBy('sub.name').orderBy('sp.full_name').execute();
    return {
      items: rows.map((r) => ({
        id: r.id,
        staff: { id: r.staff_id, fullName: r.staff_name },
        class: { id: r.class_id, name: r.class_name, gradeName: r.grade_name, academicYearId: r.academic_year_id },
        subject: { id: r.subject_id, name: r.subject_name, code: r.subject_code },
      })),
    };
  });

  /** The signed-in teacher's own classes and subjects (any role; empty without a staff profile). */
  app.get('/me/teaching', { preHandler: requirePermission('timetable.read') }, async (req) => {
    const staffId = await staffIdOf(db, req.auth!.user.id);
    if (!staffId) return { staffId: null, assignments: [], classTeacherOf: [] };
    const assignments = await db
      .selectFrom('teacher_assignments as ta')
      .innerJoin('class_sections as c', 'c.id', 'ta.class_section_id')
      .innerJoin('grades as g', 'g.id', 'c.grade_id')
      .innerJoin('academic_years as y', 'y.id', 'c.academic_year_id')
      .innerJoin('subjects as sub', 'sub.id', 'ta.subject_id')
      .select([
        'ta.id',
        'c.id as class_id',
        'c.name as class_name',
        'g.name as grade_name',
        'y.id as year_id',
        'y.is_current',
        'sub.id as subject_id',
        'sub.name as subject_name',
      ])
      .where('ta.staff_id', '=', staffId)
      .orderBy('g.level')
      .orderBy('c.name')
      .execute();
    const classTeacherOf = await db
      .selectFrom('class_sections as c')
      .innerJoin('grades as g', 'g.id', 'c.grade_id')
      .innerJoin('academic_years as y', 'y.id', 'c.academic_year_id')
      .select(['c.id', 'c.name', 'g.name as grade_name', 'y.id as year_id', 'y.is_current'])
      .where('c.class_teacher_id', '=', staffId)
      .execute();
    return {
      staffId,
      assignments: assignments.map((a) => ({
        id: a.id,
        class: {
          id: a.class_id,
          name: a.class_name,
          gradeName: a.grade_name,
          academicYearId: a.year_id,
          isCurrentYear: Boolean(a.is_current),
        },
        subject: { id: a.subject_id, name: a.subject_name },
      })),
      classTeacherOf: classTeacherOf.map((c) => ({
        id: c.id,
        name: c.name,
        gradeName: c.grade_name,
        academicYearId: c.year_id,
        isCurrentYear: Boolean(c.is_current),
      })),
    };
  });

  app.post('/teacher-assignments', { preHandler: canManage }, async (req, reply) => {
    const input = createTeacherAssignmentSchema.parse(req.body);
    const id = await db.transaction().execute(async (trx) => {
      const staff = await trx.selectFrom('staff_profiles').select('status').where('id', '=', input.staffId).executeTakeFirst();
      if (!staff || staff.status !== 'active') throw invalid('staffId', 'Staff member not found or has left');
      const section = await trx.selectFrom('class_sections').select('grade_id').where('id', '=', input.classSectionId).executeTakeFirst();
      if (!section) throw invalid('classSectionId', 'Class not found');
      const subject = await trx.selectFrom('subjects').select('is_active').where('id', '=', input.subjectId).executeTakeFirst();
      if (!subject || !subject.is_active) throw invalid('subjectId', 'Subject not found or retired');
      const taught = await trx
        .selectFrom('grade_subjects')
        .select('subject_id')
        .where('grade_id', '=', section.grade_id)
        .where('subject_id', '=', input.subjectId)
        .executeTakeFirst();
      if (!taught) throw invalid('subjectId', 'This grade does not take that subject');
      const res = await trx
        .insertInto('teacher_assignments')
        .values({
          staff_id: input.staffId,
          class_section_id: input.classSectionId,
          subject_id: input.subjectId,
          created_by: req.auth!.user.id,
        })
        .executeTakeFirstOrThrow(); // duplicate → 409
      const newId = Number(res.insertId);
      await recordAudit(trx, req, {
        action: 'teacher_assignment.created',
        entityType: 'teacher_assignment',
        entityId: newId,
        metadata: input,
      });
      return newId;
    });
    return reply.status(201).send({ id });
  });

  app.delete('/teacher-assignments/:id', { preHandler: canManage }, async (req, reply) => {
    const id = routeId(req);
    await db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('teacher_assignments')
        .select(['staff_id', 'class_section_id', 'subject_id'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) throw notFound();
      await trx.deleteFrom('teacher_assignments').where('id', '=', id).execute();
      await recordAudit(trx, req, {
        action: 'teacher_assignment.deleted',
        entityType: 'teacher_assignment',
        entityId: id,
        metadata: { staffId: row.staff_id, classSectionId: row.class_section_id, subjectId: row.subject_id },
      });
    });
    return reply.status(204).send();
  });

  app.put('/class-sections/:id/class-teacher', { preHandler: canManage }, async (req) => {
    const id = routeId(req);
    const input = setClassTeacherSchema.parse(req.body);
    await db.transaction().execute(async (trx) => {
      const section = await trx.selectFrom('class_sections').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!section) throw notFound();
      if (input.staffId !== null) {
        const staff = await trx.selectFrom('staff_profiles').select('status').where('id', '=', input.staffId).executeTakeFirst();
        if (!staff || staff.status !== 'active') throw invalid('staffId', 'Staff member not found or has left');
      }
      await trx.updateTable('class_sections').set({ class_teacher_id: input.staffId }).where('id', '=', id).execute();
      await recordAudit(trx, req, {
        action: 'class_section.class_teacher_set',
        entityType: 'class_section',
        entityId: id,
        metadata: { staffId: input.staffId },
      });
    });
    return { ok: true };
  });
};
