import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import type { Db } from '../../db/client.js';
import { currentSchemaVersion } from '../../db/migrator.js';
import { requirePermission } from '../../plugins/auth.js';
import { APP_VERSION } from '../../version.js';

export const healthRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  /** Public liveness/readiness probe. Reveals no school data. */
  app.get('/health', async (_req, reply) => {
    try {
      await sql`SELECT 1`.execute(db);
      return { status: 'ok' };
    } catch {
      return reply.status(503).send({ status: 'degraded' });
    }
  });

  /** Operational status for administrators (version, schema, queue). */
  app.get('/ops/status', { preHandler: requirePermission('ops.status.read') }, async () => {
    const [schemaVersion, queue, school] = await Promise.all([
      currentSchemaVersion(db),
      db.selectFrom('jobs').select(['status', db.fn.countAll<number>().as('count')]).groupBy('status').execute(),
      db.selectFrom('schools').select('id').executeTakeFirst(),
    ]);
    return {
      appVersion: APP_VERSION,
      schemaVersion,
      setupComplete: Boolean(school),
      queue: Object.fromEntries(queue.map((q) => [q.status, Number(q.count)])),
      // TODO(phase 1): last successful backup and last update, from app_meta.
    };
  });
};
