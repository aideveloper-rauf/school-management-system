import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../../db/client.js';
import { studentRoutes } from './students.js';
import { staffRoutes } from './staff.js';
import { guardianRoutes } from './guardians.js';
import { assignmentRoutes } from './assignments.js';
import { importRoutes } from './imports.js';
import { onboardingRoutes } from './onboarding.js';

/** People module: students, staff, guardians, teacher assignments, CSV import. Scope rules: scope.ts. */
export const peopleRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  await app.register(studentRoutes, { db });
  await app.register(staffRoutes, { db });
  await app.register(guardianRoutes, { db });
  await app.register(assignmentRoutes, { db });
  await app.register(importRoutes, { db });
  await app.register(onboardingRoutes, { db });
};
