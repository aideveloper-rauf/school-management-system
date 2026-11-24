import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { pageWindow, paginationQuerySchema, toPaginated } from '@sms/shared';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { currentSchemaVersion } from '../../db/migrator.js';
import { requirePermission } from '../../plugins/auth.js';
import { APP_VERSION } from '../../version.js';

const deliveryQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['sent', 'failed', 'skipped']).optional(),
  channel: z.enum(['email', 'sms']).optional(),
});

/** Jobs due longer than this mean the cron job is probably not running. */
const OVERDUE_MINUTES = 15;

export const healthRoutes: FastifyPluginAsync<{ db: Db; config: AppConfig }> = async (app, { db, config }) => {
  /** Public liveness/readiness probe. Reveals no school data. */
  app.get('/health', { config: { public: true } }, async (_req, reply) => {
    try {
      await sql`SELECT 1`.execute(db);
      return { status: 'ok' };
    } catch {
      return reply.status(503).send({ status: 'degraded' });
    }
  });

  /** Notification delivery log (masked addresses; no message text). */
  app.get('/ops/deliveries', { preHandler: requirePermission('ops.status.read') }, async (req) => {
    const q = deliveryQuerySchema.parse(req.query);
    let base = db.selectFrom('notification_deliveries');
    if (q.status) base = base.where('status', '=', q.status);
    if (q.channel) base = base.where('channel', '=', q.channel);
    const { limit, offset } = pageWindow(q);
    const [rows, total] = await Promise.all([
      base.selectAll().orderBy('id', 'desc').limit(limit).offset(offset).execute(),
      base.select(db.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    return toPaginated(
      rows.map((r) => ({
        id: Number(r.id),
        channel: r.channel,
        purpose: r.purpose,
        to: r.to_masked,
        status: r.status,
        error: r.error,
        entityType: r.entity_type,
        entityRef: r.entity_ref,
        createdAt: new Date(r.created_at).toISOString(),
      })),
      total.n,
      q,
    );
  });

  /** Operational status for administrators (version, schema, queue). */
  app.get('/ops/status', { preHandler: requirePermission('ops.status.read') }, async () => {
    const [schemaVersion, queue, school, meta, overdue, failures] = await Promise.all([
      currentSchemaVersion(db),
      db
        .selectFrom('jobs')
        .select(['status', db.fn.countAll<number>().as('count')])
        .groupBy('status')
        .execute(),
      db.selectFrom('schools').select('id').executeTakeFirst(),
      db
        .selectFrom('app_meta')
        .select(['meta_key', 'meta_value'])
        .where('meta_key', 'in', ['last_backup_at', 'last_backup_file', 'last_backup_bytes', 'restored_at', 'restored_from'])
        .execute(),
      sql<{ n: number; oldest: Date | null }>`
        SELECT COUNT(*) AS n, MIN(run_after) AS oldest FROM jobs
        WHERE status = 'pending' AND run_after < CURRENT_TIMESTAMP - INTERVAL ${sql.lit(OVERDUE_MINUTES)} MINUTE`.execute(db),
      db
        .selectFrom('notification_deliveries')
        .select(db.fn.countAll<number>().as('n'))
        .where('status', '=', 'failed')
        .where('created_at', '>', sql<Date>`CURRENT_TIMESTAMP - INTERVAL 1 DAY`)
        .executeTakeFirstOrThrow(),
    ]);
    const m = Object.fromEntries(meta.map((r) => [r.meta_key, r.meta_value]));
    return {
      appVersion: APP_VERSION,
      schemaVersion,
      setupComplete: Boolean(school),
      queue: Object.fromEntries(queue.map((q) => [q.status, Number(q.count)])),
      // File name and time only: the backup's location on disk is not exposed.
      lastBackup: m.last_backup_at
        ? { at: m.last_backup_at, file: m.last_backup_file ?? null, bytes: Number(m.last_backup_bytes ?? 0) }
        : null,
      lastRestore: m.restored_at ? { at: m.restored_at, from: m.restored_from ?? null } : null,
      // Jobs (emails) waiting well past their time: the cron job is missing or failing.
      jobsOverdue: {
        count: Number(overdue.rows[0]?.n ?? 0),
        oldestDueAt: overdue.rows[0]?.oldest ? new Date(overdue.rows[0].oldest).toISOString() : null,
      },
      mailTransport: config.MAIL_TRANSPORT,
      smsTransport: config.SMS_TRANSPORT,
      deliveryFailures24h: Number(failures.n),
      environment: config.NODE_ENV,
      serverTime: new Date().toISOString(),
    };
  });
};
