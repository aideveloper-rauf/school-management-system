import type { FastifyPluginAsync } from 'fastify';
import { createAcademicYearSchema, updateAcademicYearSchema } from '@sms/shared';
import type { Db } from '../../db/client.js';
import type { Database } from '../../db/types.js';
import type { Updateable } from 'kysely';
import { recordAudit } from '../../lib/audit.js';
import { conflict, invalid, notFound } from '../../lib/errors.js';
import { canManage, canRead, changedFields, fromDbBool, routeId, setIfPresent } from './common.js';

type YearRow = { id: number; label: string; starts_on: string; ends_on: string; is_current: number };
const toYear = (r: YearRow) => ({
  id: r.id,
  label: r.label,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
  isCurrent: fromDbBool(r.is_current),
});
const YEAR_COLUMNS = ['id', 'label', 'starts_on', 'ends_on', 'is_current'] as const;

/**
 * Academic years. One year may be marked current. Dates cannot shrink past the terms or
 * calendar events already inside the year. Delete is refused while anything references it.
 */
export const yearRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.get('/academic-years', { preHandler: canRead }, async () => {
    const rows = await db.selectFrom('academic_years').select(YEAR_COLUMNS).orderBy('starts_on', 'desc').execute();
    return { items: rows.map(toYear) };
  });

  app.get('/academic-years/:id', { preHandler: canRead }, async (req) => {
    const row = await db.selectFrom('academic_years').select(YEAR_COLUMNS).where('id', '=', routeId(req)).executeTakeFirst();
    if (!row) throw notFound();
    return toYear(row);
  });

  app.post('/academic-years', { preHandler: canManage }, async (req, reply) => {
    const input = createAcademicYearSchema.parse(req.body);
    const id = await db.transaction().execute(async (trx) => {
      const exists = await trx.selectFrom('academic_years').select('id').where('label', '=', input.label).executeTakeFirst();
      if (exists) throw conflict();
      if (input.isCurrent) await trx.updateTable('academic_years').set({ is_current: 0 }).execute();
      const res = await trx
        .insertInto('academic_years')
        .values({ label: input.label, starts_on: input.startsOn, ends_on: input.endsOn, is_current: input.isCurrent ? 1 : 0 })
        .executeTakeFirstOrThrow();
      const newId = Number(res.insertId);
      await recordAudit(trx, req, { action: 'academic_year.created', entityType: 'academic_year', entityId: newId });
      return newId;
    });
    return reply.status(201).send({ id });
  });

  app.patch('/academic-years/:id', { preHandler: canManage }, async (req) => {
    const id = routeId(req);
    const input = updateAcademicYearSchema.parse(req.body);
    return db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom('academic_years').select(YEAR_COLUMNS).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!current) throw notFound();
      const startsOn = input.startsOn ?? current.starts_on;
      const endsOn = input.endsOn ?? current.ends_on;
      if (endsOn <= startsOn) throw invalid('endsOn', 'endsOn must be after startsOn');

      if (input.label !== undefined) {
        const dup = await trx
          .selectFrom('academic_years')
          .select('id')
          .where('label', '=', input.label)
          .where('id', '!=', id)
          .executeTakeFirst();
        if (dup) throw conflict();
      }
      if (input.startsOn !== undefined || input.endsOn !== undefined) {
        const outside = (table: 'terms' | 'calendar_events') =>
          trx
            .selectFrom(table)
            .select('id')
            .where('academic_year_id', '=', id)
            .where((eb) => eb.or([eb('starts_on', '<', startsOn), eb('ends_on', '>', endsOn)]))
            .executeTakeFirst();
        if (await outside('terms')) throw invalid('startsOn', 'Some terms fall outside these dates');
        if (await outside('calendar_events')) throw invalid('startsOn', 'Some calendar events fall outside these dates');
      }

      const row: Updateable<Database['academic_years']> = {};
      setIfPresent(row, input, 'label', 'label');
      setIfPresent(row, input, 'startsOn', 'starts_on');
      setIfPresent(row, input, 'endsOn', 'ends_on');
      await trx.updateTable('academic_years').set(row).where('id', '=', id).execute();
      await recordAudit(trx, req, {
        action: 'academic_year.updated',
        entityType: 'academic_year',
        entityId: id,
        metadata: { fields: changedFields(input) },
      });
      return toYear({ ...current, ...row } as YearRow);
    });
  });

  /** Make this the current year (exactly one current year at a time). */
  app.post('/academic-years/:id/current', { preHandler: canManage }, async (req) => {
    const id = routeId(req);
    await db.transaction().execute(async (trx) => {
      const exists = await trx.selectFrom('academic_years').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!exists) throw notFound();
      await trx.updateTable('academic_years').set({ is_current: 0 }).where('id', '!=', id).execute();
      await trx.updateTable('academic_years').set({ is_current: 1 }).where('id', '=', id).execute();
      await recordAudit(trx, req, { action: 'academic_year.set_current', entityType: 'academic_year', entityId: id });
    });
    return { ok: true };
  });

  app.delete('/academic-years/:id', { preHandler: canManage }, async (req, reply) => {
    const id = routeId(req);
    await db.transaction().execute(async (trx) => {
      // Foreign keys (terms, class sections, calendar events) reject the delete while in use → 409 errors.inUse.
      const res = await trx.deleteFrom('academic_years').where('id', '=', id).executeTakeFirst();
      if (Number(res.numDeletedRows) === 0) throw notFound();
      await recordAudit(trx, req, { action: 'academic_year.deleted', entityType: 'academic_year', entityId: id });
    });
    return reply.status(204).send();
  });
};
