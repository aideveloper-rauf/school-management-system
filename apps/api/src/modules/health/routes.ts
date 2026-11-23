import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { currentSchemaVersion } from '../../db/migrator.js';
import { requirePermission } from '../../plugins/auth.js';
import { APP_VERSION } from '../../version.js';

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

  /** Operational status for administrators (version, schema, queue). */
  app.get('/ops/status', { preHandler: requirePermission('ops.status.read') }, async () => {
    const [schemaVersion, queue, school, meta, overdue] = await Promise.all([
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
      environment: config.NODE_ENV,
      serverTime: new Date().toISOString(),
    };
  });
};
