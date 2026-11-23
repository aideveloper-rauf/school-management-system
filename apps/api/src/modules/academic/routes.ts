import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { isoDateSchema as isoDate } from '@sms/shared';
import type { Db } from '../../db/client.js';
import { recordAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { requirePermission } from '../../plugins/auth.js';

const createYearSchema = z
  .object({
    label: z.string().trim().min(1).max(32),
    startsOn: isoDate,
    endsOn: isoDate,
    isCurrent: z.boolean().default(false),
  })
  .refine((v) => v.endsOn > v.startsOn, { message: 'endsOn must be after startsOn', path: ['endsOn'] });

/**
 * Reference implementation of the module pattern:
 * validate → authorize → transaction → audit → typed response.
 */
export const academicRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.get('/academic-years', { preHandler: requirePermission('academic.structure.read') }, async () => {
    const rows = await db
      .selectFrom('academic_years')
      .select(['id', 'label', 'starts_on', 'ends_on', 'is_current'])
      .orderBy('starts_on', 'desc')
      .execute();
    return {
      items: rows.map((r) => ({ id: r.id, label: r.label, startsOn: r.starts_on, endsOn: r.ends_on, isCurrent: Boolean(r.is_current) })),
    };
  });

  app.post('/academic-years', { preHandler: requirePermission('academic.structure.manage') }, async (req, reply) => {
    const input = createYearSchema.parse(req.body);
    const id = await db.transaction().execute(async (trx) => {
      const exists = await trx.selectFrom('academic_years').select('id').where('label', '=', input.label).executeTakeFirst();
      if (exists) throw new AppError('CONFLICT', 'errors.duplicate');
      if (input.isCurrent) await trx.updateTable('academic_years').set({ is_current: 0 }).execute();
      const res = await trx
        .insertInto('academic_years')
        .values({
          label: input.label,
          starts_on: input.startsOn,
          ends_on: input.endsOn,
          is_current: input.isCurrent ? 1 : 0,
        })
        .executeTakeFirstOrThrow();
      const newId = Number(res.insertId);
      await recordAudit(trx, req, { action: 'academic_year.created', entityType: 'academic_year', entityId: newId });
      return newId;
    });
    return reply.status(201).send({ id });
  });
};
