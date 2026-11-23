import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import type { Db } from '../../db/client.js';
import { currentSchemaVersion } from '../../db/migrator.js';
import { requirePermission } from '../../plugins/auth.js';
import { APP_VERSION } from '../../version.js';

export const healthRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
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
    const [schemaVersion, queue, school, meta] = await Promise.all([
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
    };
  });
};
