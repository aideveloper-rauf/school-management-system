import type { FastifyPluginAsync } from 'fastify';
import type { Transaction, Updateable } from 'kysely';
import { classSectionQuerySchema, createClassSectionSchema, updateClassSectionSchema } from '@sms/shared';
import type { Db } from '../../db/client.js';
import type { Database } from '../../db/types.js';
import { recordAudit } from '../../lib/audit.js';
import { invalid, notFound } from '../../lib/errors.js';
import { canManage, canRead, changedFields, routeId, setIfPresent } from './common.js';

/**
 * Class sections (e.g. Grade 6 / A) exist per academic year. Year and grade are fixed
 * after creation because enrolments, timetables and marks will reference the section.
 * Record scope (teacher ↔ class) arrives with teacher assignments (roadmap C-6/C-7); the
 * list is school-wide configuration and readable by anyone with academic.structure.read.
 */
async function assertActiveRoom(trx: Transaction<Database>, roomId: number | null | undefined): Promise<void> {
  if (roomId === null || roomId === undefined) return;
  const room = await trx.selectFrom('rooms').select('is_active').where('id', '=', roomId).executeTakeFirst();
  if (!room || !room.is_active) throw invalid('homeRoomId', 'Room not found or inactive');
}

export const classSectionRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const listQuery = () =>
    db
      .selectFrom('class_sections as c')
      .innerJoin('grades as g', 'g.id', 'c.grade_id')
      .innerJoin('academic_years as y', 'y.id', 'c.academic_year_id')
      .leftJoin('rooms as r', 'r.id', 'c.home_room_id')
      .select([
        'c.id',
        'c.academic_year_id',
        'y.label as year_label',
        'c.grade_id',
        'g.name as grade_name',
        'g.level as grade_level',
        'c.name',
        'c.medium',
        'c.capacity',
        'c.home_room_id',
        'r.name as home_room_name',
      ]);
  type Row = Awaited<ReturnType<ReturnType<typeof listQuery>['executeTakeFirstOrThrow']>>;
  const toSection = (r: Row) => ({
    id: r.id,
    academicYear: { id: r.academic_year_id, label: r.year_label },
    grade: { id: r.grade_id, name: r.grade_name, level: r.grade_level },
    name: r.name,
    medium: r.medium,
    capacity: r.capacity,
    homeRoom: r.home_room_id === null ? null : { id: r.home_room_id, name: r.home_room_name },
  });
  const loadSection = async (id: number) => {
    const row = await listQuery().where('c.id', '=', id).executeTakeFirst();
    if (!row) throw notFound();
    return toSection(row);
  };

  app.get('/class-sections', { preHandler: canRead }, async (req) => {
    const q = classSectionQuerySchema.parse(req.query);
    let query = listQuery();
    if (q.academicYearId) query = query.where('c.academic_year_id', '=', q.academicYearId);
    if (q.gradeId) query = query.where('c.grade_id', '=', q.gradeId);
    const rows = await query.orderBy('y.starts_on', 'desc').orderBy('g.level').orderBy('c.name').execute();
    return { items: rows.map(toSection) };
  });

  app.get('/class-sections/:id', { preHandler: canRead }, async (req) => loadSection(routeId(req)));

  app.post('/class-sections', { preHandler: canManage }, async (req, reply) => {
    const input = createClassSectionSchema.parse(req.body);
    const id = await db.transaction().execute(async (trx) => {
      const year = await trx.selectFrom('academic_years').select('id').where('id', '=', input.academicYearId).executeTakeFirst();
      if (!year) throw invalid('academicYearId', 'Academic year not found');
      const grade = await trx.selectFrom('grades').select('is_active').where('id', '=', input.gradeId).executeTakeFirst();
      if (!grade || !grade.is_active) throw invalid('gradeId', 'Grade not found or inactive');
      await assertActiveRoom(trx, input.homeRoomId);
      const res = await trx
        .insertInto('class_sections')
        .values({
          academic_year_id: input.academicYearId,
          grade_id: input.gradeId,
          name: input.name,
          medium: input.medium,
          capacity: input.capacity,
          home_room_id: input.homeRoomId,
        })
        .executeTakeFirstOrThrow(); // duplicate (year, grade, name) → 409 errors.duplicate
      const newId = Number(res.insertId);
      await recordAudit(trx, req, { action: 'class_section.created', entityType: 'class_section', entityId: newId });
      return newId;
    });
    return reply.status(201).send({ id });
  });

  app.patch('/class-sections/:id', { preHandler: canManage }, async (req) => {
    const id = routeId(req);
    const input = updateClassSectionSchema.parse(req.body);
    await db.transaction().execute(async (trx) => {
      const exists = await trx.selectFrom('class_sections').select('id').where('id', '=', id).executeTakeFirst();
      if (!exists) throw notFound();
      await assertActiveRoom(trx, input.homeRoomId);
      const row: Updateable<Database['class_sections']> = {};
      setIfPresent(row, input, 'name', 'name');
      setIfPresent(row, input, 'medium', 'medium');
      setIfPresent(row, input, 'capacity', 'capacity');
      setIfPresent(row, input, 'homeRoomId', 'home_room_id');
      await trx.updateTable('class_sections').set(row).where('id', '=', id).execute();
      await recordAudit(trx, req, {
        action: 'class_section.updated',
        entityType: 'class_section',
        entityId: id,
        metadata: { fields: changedFields(input) },
      });
    });
    return loadSection(id);
  });

  app.delete('/class-sections/:id', { preHandler: canManage }, async (req, reply) => {
    const id = routeId(req);
    await db.transaction().execute(async (trx) => {
      const res = await trx.deleteFrom('class_sections').where('id', '=', id).executeTakeFirst();
      if (Number(res.numDeletedRows) === 0) throw notFound();
      await recordAudit(trx, req, { action: 'class_section.deleted', entityType: 'class_section', entityId: id });
    });
    return reply.status(204).send();
  });
};
