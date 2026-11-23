import type { FastifyPluginAsync } from 'fastify';
import type { Transaction, Updateable } from 'kysely';
import { createTermSchema, updateTermSchema } from '@sms/shared';
import type { Db } from '../../db/client.js';
import type { Database } from '../../db/types.js';
import { recordAudit } from '../../lib/audit.js';
import { conflict, invalid, notFound } from '../../lib/errors.js';
import { canManage, canRead, changedFields, routeId, setIfPresent } from './common.js';

type TermRow = { id: number; academic_year_id: number; label: string; sequence: number; starts_on: string; ends_on: string };
const TERM_COLUMNS = ['id', 'academic_year_id', 'label', 'sequence', 'starts_on', 'ends_on'] as const;
const toTerm = (r: TermRow) => ({
  id: r.id,
  academicYearId: r.academic_year_id,
  label: r.label,
  sequence: r.sequence,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
});

/**
 * Check a term against its year and sibling terms. The year row is locked FOR UPDATE first,
 * so concurrent term writes in one year are serialised and cannot create overlaps.
 */
async function assertValidTerm(
  trx: Transaction<Database>,
  yearId: number,
  term: { sequence: number; startsOn: string; endsOn: string },
  excludeId?: number,
): Promise<void> {
  const year = await trx
    .selectFrom('academic_years')
    .select(['starts_on', 'ends_on'])
    .where('id', '=', yearId)
    .forUpdate()
    .executeTakeFirst();
  if (!year) throw notFound();
  if (term.endsOn <= term.startsOn) throw invalid('endsOn', 'endsOn must be after startsOn');
  if (term.startsOn < year.starts_on || term.endsOn > year.ends_on) throw invalid('startsOn', 'Term must be within the academic year');

  let siblings = trx.selectFrom('terms').select(['id', 'sequence', 'starts_on', 'ends_on']).where('academic_year_id', '=', yearId);
  if (excludeId !== undefined) siblings = siblings.where('id', '!=', excludeId);
  for (const s of await siblings.execute()) {
    if (s.sequence === term.sequence) throw conflict();
    if (s.starts_on <= term.endsOn && s.ends_on >= term.startsOn) throw invalid('startsOn', 'Term overlaps another term');
  }
}

export const termRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.get('/academic-years/:id/terms', { preHandler: canRead }, async (req) => {
    const yearId = routeId(req);
    const year = await db.selectFrom('academic_years').select('id').where('id', '=', yearId).executeTakeFirst();
    if (!year) throw notFound();
    const rows = await db.selectFrom('terms').select(TERM_COLUMNS).where('academic_year_id', '=', yearId).orderBy('sequence').execute();
    return { items: rows.map(toTerm) };
  });

  app.post('/academic-years/:id/terms', { preHandler: canManage }, async (req, reply) => {
    const yearId = routeId(req);
    const input = createTermSchema.parse(req.body);
    const id = await db.transaction().execute(async (trx) => {
      await assertValidTerm(trx, yearId, input);
      const res = await trx
        .insertInto('terms')
        .values({
          academic_year_id: yearId,
          label: input.label,
          sequence: input.sequence,
          starts_on: input.startsOn,
          ends_on: input.endsOn,
        })
        .executeTakeFirstOrThrow();
      const newId = Number(res.insertId);
      await recordAudit(trx, req, { action: 'term.created', entityType: 'term', entityId: newId, metadata: { academicYearId: yearId } });
      return newId;
    });
    return reply.status(201).send({ id });
  });

  app.patch('/terms/:id', { preHandler: canManage }, async (req) => {
    const id = routeId(req);
    const input = updateTermSchema.parse(req.body);
    return db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom('terms').select(TERM_COLUMNS).where('id', '=', id).executeTakeFirst();
      if (!current) throw notFound();
      const merged = {
        sequence: input.sequence ?? current.sequence,
        startsOn: input.startsOn ?? current.starts_on,
        endsOn: input.endsOn ?? current.ends_on,
      };
      await assertValidTerm(trx, current.academic_year_id, merged, id);

      const row: Updateable<Database['terms']> = {};
      setIfPresent(row, input, 'label', 'label');
      setIfPresent(row, input, 'sequence', 'sequence');
      setIfPresent(row, input, 'startsOn', 'starts_on');
      setIfPresent(row, input, 'endsOn', 'ends_on');
      await trx.updateTable('terms').set(row).where('id', '=', id).execute();
      await recordAudit(trx, req, { action: 'term.updated', entityType: 'term', entityId: id, metadata: { fields: changedFields(input) } });
      return toTerm({ ...current, ...row } as TermRow);
    });
  });

  app.delete('/terms/:id', { preHandler: canManage }, async (req, reply) => {
    const id = routeId(req);
    await db.transaction().execute(async (trx) => {
      const res = await trx.deleteFrom('terms').where('id', '=', id).executeTakeFirst();
      if (Number(res.numDeletedRows) === 0) throw notFound();
      await recordAudit(trx, req, { action: 'term.deleted', entityType: 'term', entityId: id });
    });
    return reply.status(204).send();
  });
};
