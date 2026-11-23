import type { FastifyPluginAsync } from 'fastify';
import type { Updateable } from 'kysely';
import {
  createGradeSchema,
  createRoomSchema,
  createSubjectSchema,
  setGradeSubjectsSchema,
  updateGradeSchema,
  updateRoomSchema,
  updateSubjectSchema,
} from '@sms/shared';
import type { Db } from '../../db/client.js';
import type { Database } from '../../db/types.js';
import { recordAudit } from '../../lib/audit.js';
import { invalid, notFound } from '../../lib/errors.js';
import { canManage, canRead, changedFields, fromDbBool, routeId, setIfPresent, toDbBool } from './common.js';

/**
 * School-wide catalogs: grades, subjects (+ which subjects each grade takes) and rooms.
 * Retire items with isActive=false; delete only works while nothing references them.
 * Unique names/codes are enforced by the database and surface as 409 errors.duplicate.
 */

type GradeRow = { id: number; name: string; level: number; is_active: number };
const toGrade = (r: GradeRow) => ({ id: r.id, name: r.name, level: r.level, isActive: fromDbBool(r.is_active) });

type SubjectRow = { id: number; code: string; name: string; name_si: string | null; name_ta: string | null; is_active: number };
const toSubject = (r: SubjectRow) => ({
  id: r.id,
  code: r.code,
  name: r.name,
  nameSi: r.name_si,
  nameTa: r.name_ta,
  isActive: fromDbBool(r.is_active),
});

type RoomRow = { id: number; name: string; capacity: number | null; is_active: number };
const toRoom = (r: RoomRow) => ({ id: r.id, name: r.name, capacity: r.capacity, isActive: fromDbBool(r.is_active) });

export const catalogRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  // Grades -------------------------------------------------------------------
  app.get('/grades', { preHandler: canRead }, async () => {
    const rows = await db.selectFrom('grades').select(['id', 'name', 'level', 'is_active']).orderBy('level').execute();
    return { items: rows.map(toGrade) };
  });

  app.post('/grades', { preHandler: canManage }, async (req, reply) => {
    const input = createGradeSchema.parse(req.body);
    const id = await db.transaction().execute(async (trx) => {
      const res = await trx
        .insertInto('grades')
        .values({ name: input.name, level: input.level, is_active: toDbBool(input.isActive) })
        .executeTakeFirstOrThrow();
      const newId = Number(res.insertId);
      await recordAudit(trx, req, { action: 'grade.created', entityType: 'grade', entityId: newId });
      return newId;
    });
    return reply.status(201).send({ id });
  });

  app.patch('/grades/:id', { preHandler: canManage }, async (req) => {
    const id = routeId(req);
    const input = updateGradeSchema.parse(req.body);
    return db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom('grades').select(['id', 'name', 'level', 'is_active']).where('id', '=', id).executeTakeFirst();
      if (!current) throw notFound();
      const row: Updateable<Database['grades']> = {};
      setIfPresent(row, input, 'name', 'name');
      setIfPresent(row, input, 'level', 'level');
      setIfPresent(row, input, 'isActive', 'is_active', toDbBool);
      await trx.updateTable('grades').set(row).where('id', '=', id).execute();
      await recordAudit(trx, req, {
        action: 'grade.updated',
        entityType: 'grade',
        entityId: id,
        metadata: { fields: changedFields(input) },
      });
      return toGrade({ ...current, ...row } as GradeRow);
    });
  });

  app.delete('/grades/:id', { preHandler: canManage }, async (req, reply) => {
    const id = routeId(req);
    await db.transaction().execute(async (trx) => {
      // The grade's own curriculum map goes with it; class sections block the delete (409 errors.inUse).
      await trx.deleteFrom('grade_subjects').where('grade_id', '=', id).execute();
      const res = await trx.deleteFrom('grades').where('id', '=', id).executeTakeFirst();
      if (Number(res.numDeletedRows) === 0) throw notFound();
      await recordAudit(trx, req, { action: 'grade.deleted', entityType: 'grade', entityId: id });
    });
    return reply.status(204).send();
  });

  // Grade curriculum ---------------------------------------------------------
  app.get('/grades/:id/subjects', { preHandler: canRead }, async (req) => {
    const id = routeId(req);
    const grade = await db.selectFrom('grades').select('id').where('id', '=', id).executeTakeFirst();
    if (!grade) throw notFound();
    const rows = await db
      .selectFrom('grade_subjects as gs')
      .innerJoin('subjects as s', 's.id', 'gs.subject_id')
      .select(['s.id', 's.code', 's.name', 's.name_si', 's.name_ta', 's.is_active', 'gs.is_optional'])
      .where('gs.grade_id', '=', id)
      .orderBy('s.name')
      .execute();
    return { items: rows.map((r) => ({ subject: toSubject(r), isOptional: fromDbBool(r.is_optional) })) };
  });

  /** Replace the full subject list for a grade in one transaction. */
  app.put('/grades/:id/subjects', { preHandler: canManage }, async (req) => {
    const id = routeId(req);
    const input = setGradeSubjectsSchema.parse(req.body);
    await db.transaction().execute(async (trx) => {
      const grade = await trx.selectFrom('grades').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!grade) throw notFound();
      const ids = input.subjects.map((s) => s.subjectId);
      if (ids.length > 0) {
        const found = await trx.selectFrom('subjects').select('id').where('id', 'in', ids).execute();
        if (found.length !== ids.length) throw invalid('subjects', 'Unknown subject');
      }
      await trx.deleteFrom('grade_subjects').where('grade_id', '=', id).execute();
      if (ids.length > 0) {
        await trx
          .insertInto('grade_subjects')
          .values(input.subjects.map((s) => ({ grade_id: id, subject_id: s.subjectId, is_optional: toDbBool(s.isOptional) })))
          .execute();
      }
      await recordAudit(trx, req, {
        action: 'grade.subjects_set',
        entityType: 'grade',
        entityId: id,
        metadata: { subjectIds: [...ids].sort((a, b) => a - b) },
      });
    });
    return { ok: true };
  });

  // Subjects -----------------------------------------------------------------
  const SUBJECT_COLUMNS = ['id', 'code', 'name', 'name_si', 'name_ta', 'is_active'] as const;

  app.get('/subjects', { preHandler: canRead }, async () => {
    const rows = await db.selectFrom('subjects').select(SUBJECT_COLUMNS).orderBy('name').execute();
    return { items: rows.map(toSubject) };
  });

  app.post('/subjects', { preHandler: canManage }, async (req, reply) => {
    const input = createSubjectSchema.parse(req.body);
    const id = await db.transaction().execute(async (trx) => {
      const res = await trx
        .insertInto('subjects')
        .values({
          code: input.code,
          name: input.name,
          name_si: input.nameSi,
          name_ta: input.nameTa,
          is_active: toDbBool(input.isActive),
        })
        .executeTakeFirstOrThrow();
      const newId = Number(res.insertId);
      await recordAudit(trx, req, { action: 'subject.created', entityType: 'subject', entityId: newId });
      return newId;
    });
    return reply.status(201).send({ id });
  });

  app.patch('/subjects/:id', { preHandler: canManage }, async (req) => {
    const id = routeId(req);
    const input = updateSubjectSchema.parse(req.body);
    return db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom('subjects').select(SUBJECT_COLUMNS).where('id', '=', id).executeTakeFirst();
      if (!current) throw notFound();
      const row: Updateable<Database['subjects']> = {};
      setIfPresent(row, input, 'code', 'code');
      setIfPresent(row, input, 'name', 'name');
      setIfPresent(row, input, 'nameSi', 'name_si');
      setIfPresent(row, input, 'nameTa', 'name_ta');
      setIfPresent(row, input, 'isActive', 'is_active', toDbBool);
      await trx.updateTable('subjects').set(row).where('id', '=', id).execute();
      await recordAudit(trx, req, {
        action: 'subject.updated',
        entityType: 'subject',
        entityId: id,
        metadata: { fields: changedFields(input) },
      });
      return toSubject({ ...current, ...row } as SubjectRow);
    });
  });

  app.delete('/subjects/:id', { preHandler: canManage }, async (req, reply) => {
    const id = routeId(req);
    await db.transaction().execute(async (trx) => {
      // Refused (409 errors.inUse) while any grade still takes this subject.
      const res = await trx.deleteFrom('subjects').where('id', '=', id).executeTakeFirst();
      if (Number(res.numDeletedRows) === 0) throw notFound();
      await recordAudit(trx, req, { action: 'subject.deleted', entityType: 'subject', entityId: id });
    });
    return reply.status(204).send();
  });

  // Rooms --------------------------------------------------------------------
  app.get('/rooms', { preHandler: canRead }, async () => {
    const rows = await db.selectFrom('rooms').select(['id', 'name', 'capacity', 'is_active']).orderBy('name').execute();
    return { items: rows.map(toRoom) };
  });

  app.post('/rooms', { preHandler: canManage }, async (req, reply) => {
    const input = createRoomSchema.parse(req.body);
    const id = await db.transaction().execute(async (trx) => {
      const res = await trx
        .insertInto('rooms')
        .values({ name: input.name, capacity: input.capacity, is_active: toDbBool(input.isActive) })
        .executeTakeFirstOrThrow();
      const newId = Number(res.insertId);
      await recordAudit(trx, req, { action: 'room.created', entityType: 'room', entityId: newId });
      return newId;
    });
    return reply.status(201).send({ id });
  });

  app.patch('/rooms/:id', { preHandler: canManage }, async (req) => {
    const id = routeId(req);
    const input = updateRoomSchema.parse(req.body);
    return db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom('rooms').select(['id', 'name', 'capacity', 'is_active']).where('id', '=', id).executeTakeFirst();
      if (!current) throw notFound();
      const row: Updateable<Database['rooms']> = {};
      setIfPresent(row, input, 'name', 'name');
      setIfPresent(row, input, 'capacity', 'capacity');
      setIfPresent(row, input, 'isActive', 'is_active', toDbBool);
      await trx.updateTable('rooms').set(row).where('id', '=', id).execute();
      await recordAudit(trx, req, { action: 'room.updated', entityType: 'room', entityId: id, metadata: { fields: changedFields(input) } });
      return toRoom({ ...current, ...row } as RoomRow);
    });
  });

  app.delete('/rooms/:id', { preHandler: canManage }, async (req, reply) => {
    const id = routeId(req);
    await db.transaction().execute(async (trx) => {
      // Class sections that used it as a home room fall back to none (ON DELETE SET NULL).
      const res = await trx.deleteFrom('rooms').where('id', '=', id).executeTakeFirst();
      if (Number(res.numDeletedRows) === 0) throw notFound();
      await recordAudit(trx, req, { action: 'room.deleted', entityType: 'room', entityId: id });
    });
    return reply.status(204).send();
  });
};
