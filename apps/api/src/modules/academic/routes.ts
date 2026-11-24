import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../../db/client.js';
import { yearRoutes } from './years.js';
import { termRoutes } from './terms.js';
import { catalogRoutes } from './catalog.js';
import { classSectionRoutes } from './class-sections.js';
import { scheduleRoutes } from './schedule.js';
import { rolloverRoutes } from './rollover.js';

/**
 * Academic structure module. Each file follows the module pattern:
 * validate (zod, from @sms/shared) → authorize (preHandler) → transaction → audit → typed response.
 */
export const academicRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  await app.register(yearRoutes, { db });
  await app.register(termRoutes, { db });
  await app.register(catalogRoutes, { db });
  await app.register(classSectionRoutes, { db });
  await app.register(scheduleRoutes, { db });
  await app.register(rolloverRoutes, { db });
};
