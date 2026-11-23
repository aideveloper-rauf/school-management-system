import type { FastifyPluginAsync } from 'fastify';
import type { Transaction, Updateable } from 'kysely';
import {
  calendarQuerySchema,
  createCalendarEventSchema,
  createPeriodSchema,
  updateCalendarEventSchema,
  updatePeriodSchema,
  type CalendarEventKind,
} from '@sms/shared';
import type { Db } from '../../db/client.js';
import type { Database } from '../../db/types.js';
import { recordAudit } from '../../lib/audit.js';
import { conflict, invalid, notFound } from '../../lib/errors.js';
import { canManage, canRead, changedFields, fromDbBool, routeId, setIfPresent, toDbBool } from './common.js';

/**
 * Bell schedule (period definitions) and the school calendar (holidays, term breaks,
 * exam weeks, events). One bell schedule per installation for now; per-day variants
 * are a known limitation to revisit with the pilot school's timetable.
 */

type PeriodRow = { id: number; label: string; sequence: number; starts_at: string; ends_at: string; is_break: number };
const PERIOD_COLUMNS = ['id', 'label', 'sequence', 'starts_at', 'ends_at', 'is_break'] as const;
const hhmm = (t: string) => t.slice(0, 5);
const toPeriod = (r: PeriodRow) => ({
  id: r.id,
  label: r.label,
  sequence: r.sequence,
  startsAt: hhmm(r.starts_at),
  endsAt: hhmm(r.ends_at),
  isBreak: fromDbBool(r.is_break),
});

async function assertValidPeriod(
  trx: Transaction<Database>,
  p: { sequence: number; startsAt: string; endsAt: string },
  excludeId?: number,
): Promise<void> {
  if (p.endsAt <= p.startsAt) throw invalid('endsAt', 'endsAt must be after startsAt');
  let others = trx.selectFrom('period_definitions').select(['id', 'sequence', 'starts_at', 'ends_at']).forUpdate();
  if (excludeId !== undefined) others = others.where('id', '!=', excludeId);
  for (const o of await others.execute()) {
    if (o.sequence === p.sequence) throw conflict();
    if (o.starts_at < p.endsAt && o.ends_at > p.startsAt) throw invalid('startsAt', 'Period overlaps another period');
  }
}

type EventRow = {
  id: number;
  academic_year_id: number | null;
  title: string;
  kind: string;
  starts_on: string;
  ends_on: string;
  is_school_day: number;
};
const EVENT_COLUMNS = ['id', 'academic_year_id', 'title', 'kind', 'starts_on', 'ends_on', 'is_school_day'] as const;
const toEvent = (r: EventRow) => ({
  id: r.id,
  academicYearId: r.academic_year_id,
  title: r.title,
  kind: r.kind as CalendarEventKind,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
  isSchoolDay: fromDbBool(r.is_school_day),
});

async function assertWithinYear(trx: Transaction<Database>, yearId: number | null, startsOn: string, endsOn: string): Promise<void> {
  if (endsOn < startsOn) throw invalid('endsOn', 'endsOn must not be before startsOn');
  if (yearId === null) return;
  const year = await trx.selectFrom('academic_years').select(['starts_on', 'ends_on']).where('id', '=', yearId).executeTakeFirst();
  if (!year) throw invalid('academicYearId', 'Academic year not found');
  if (startsOn < year.starts_on || endsOn > year.ends_on) throw invalid('startsOn', 'Event must be within the academic year');
}

export const scheduleRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  // Periods ------------------------------------------------------------------
  app.get('/periods', { preHandler: canRead }, async () => {
    const rows = await db.selectFrom('period_definitions').select(PERIOD_COLUMNS).orderBy('sequence').execute();
    return { items: rows.map(toPeriod) };
  });

  app.post('/periods', { preHandler: canManage }, async (req, reply) => {
    const input = createPeriodSchema.parse(req.body);
    const id = await db.transaction().execute(async (trx) => {
      await assertValidPeriod(trx, input);
      const res = await trx
        .insertInto('period_definitions')
        .values({
          label: input.label,
          sequence: input.sequence,
          starts_at: input.startsAt,
          ends_at: input.endsAt,
          is_break: toDbBool(input.isBreak),
        })
        .executeTakeFirstOrThrow();
      const newId = Number(res.insertId);
      await recordAudit(trx, req, { action: 'period.created', entityType: 'period', entityId: newId });
      return newId;
    });
    return reply.status(201).send({ id });
  });

  app.patch('/periods/:id', { preHandler: canManage }, async (req) => {
    const id = routeId(req);
    const input = updatePeriodSchema.parse(req.body);
    return db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom('period_definitions').select(PERIOD_COLUMNS).where('id', '=', id).executeTakeFirst();
      if (!current) throw notFound();
      await assertValidPeriod(
        trx,
        {
          sequence: input.sequence ?? current.sequence,
          startsAt: input.startsAt ?? current.starts_at,
          endsAt: input.endsAt ?? current.ends_at,
        },
        id,
      );
      const row: Updateable<Database['period_definitions']> = {};
      setIfPresent(row, input, 'label', 'label');
      setIfPresent(row, input, 'sequence', 'sequence');
      setIfPresent(row, input, 'startsAt', 'starts_at');
      setIfPresent(row, input, 'endsAt', 'ends_at');
      setIfPresent(row, input, 'isBreak', 'is_break', toDbBool);
      await trx.updateTable('period_definitions').set(row).where('id', '=', id).execute();
      await recordAudit(trx, req, {
        action: 'period.updated',
        entityType: 'period',
        entityId: id,
        metadata: { fields: changedFields(input) },
      });
      return toPeriod({ ...current, ...row } as PeriodRow);
    });
  });

  app.delete('/periods/:id', { preHandler: canManage }, async (req, reply) => {
    const id = routeId(req);
    await db.transaction().execute(async (trx) => {
      const res = await trx.deleteFrom('period_definitions').where('id', '=', id).executeTakeFirst();
      if (Number(res.numDeletedRows) === 0) throw notFound();
      await recordAudit(trx, req, { action: 'period.deleted', entityType: 'period', entityId: id });
    });
    return reply.status(204).send();
  });

  // Calendar -----------------------------------------------------------------
  app.get('/calendar-events', { preHandler: canRead }, async (req) => {
    const q = calendarQuerySchema.parse(req.query);
    let query = db.selectFrom('calendar_events').select(EVENT_COLUMNS);
    if (q.academicYearId) query = query.where('academic_year_id', '=', q.academicYearId);
    // Events overlapping [from, to].
    if (q.from) query = query.where('ends_on', '>=', q.from);
    if (q.to) query = query.where('starts_on', '<=', q.to);
    const rows = await query.orderBy('starts_on').orderBy('id').limit(1000).execute();
    return { items: rows.map(toEvent) };
  });

  app.post('/calendar-events', { preHandler: canManage }, async (req, reply) => {
    const input = createCalendarEventSchema.parse(req.body);
    const id = await db.transaction().execute(async (trx) => {
      await assertWithinYear(trx, input.academicYearId, input.startsOn, input.endsOn);
      const res = await trx
        .insertInto('calendar_events')
        .values({
          academic_year_id: input.academicYearId,
          title: input.title,
          kind: input.kind,
          starts_on: input.startsOn,
          ends_on: input.endsOn,
          is_school_day: toDbBool(input.isSchoolDay),
        })
        .executeTakeFirstOrThrow();
      const newId = Number(res.insertId);
      await recordAudit(trx, req, { action: 'calendar_event.created', entityType: 'calendar_event', entityId: newId });
      return newId;
    });
    return reply.status(201).send({ id });
  });

  app.patch('/calendar-events/:id', { preHandler: canManage }, async (req) => {
    const id = routeId(req);
    const input = updateCalendarEventSchema.parse(req.body);
    return db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom('calendar_events').select(EVENT_COLUMNS).where('id', '=', id).executeTakeFirst();
      if (!current) throw notFound();
      await assertWithinYear(
        trx,
        input.academicYearId !== undefined ? input.academicYearId : current.academic_year_id,
        input.startsOn ?? current.starts_on,
        input.endsOn ?? current.ends_on,
      );
      const row: Updateable<Database['calendar_events']> = {};
      setIfPresent(row, input, 'academicYearId', 'academic_year_id');
      setIfPresent(row, input, 'title', 'title');
      setIfPresent(row, input, 'kind', 'kind');
      setIfPresent(row, input, 'startsOn', 'starts_on');
      setIfPresent(row, input, 'endsOn', 'ends_on');
      setIfPresent(row, input, 'isSchoolDay', 'is_school_day', toDbBool);
      await trx.updateTable('calendar_events').set(row).where('id', '=', id).execute();
      await recordAudit(trx, req, {
        action: 'calendar_event.updated',
        entityType: 'calendar_event',
        entityId: id,
        metadata: { fields: changedFields(input) },
      });
      return toEvent({ ...current, ...row } as EventRow);
    });
  });

  app.delete('/calendar-events/:id', { preHandler: canManage }, async (req, reply) => {
    const id = routeId(req);
    await db.transaction().execute(async (trx) => {
      const res = await trx.deleteFrom('calendar_events').where('id', '=', id).executeTakeFirst();
      if (Number(res.numDeletedRows) === 0) throw notFound();
      await recordAudit(trx, req, { action: 'calendar_event.deleted', entityType: 'calendar_event', entityId: id });
    });
    return reply.status(204).send();
  });
};
