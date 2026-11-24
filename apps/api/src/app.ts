import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { API_PREFIX } from '@sms/shared';
import type { AppConfig } from './config/env.js';
import type { Db } from './db/client.js';
import { assertRouteDeclaresAuth, authPlugin } from './plugins/auth.js';
import { registerErrorHandling } from './plugins/errors.js';
import { healthRoutes } from './modules/health/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { schoolRoutes } from './modules/school/routes.js';
import { academicRoutes } from './modules/academic/routes.js';
import { auditRoutes } from './modules/audit/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { peopleRoutes } from './modules/people/routes.js';
import { attendanceRoutes } from './modules/attendance/routes.js';
import { timetableRoutes } from './modules/timetable/routes.js';
import { announcementRoutes } from './modules/announcements/routes.js';
import { learningRoutes } from './modules/learning/routes.js';
import { questionRoutes } from './modules/questions/routes.js';
import { examRoutes } from './modules/exams/routes.js';

export interface BuildAppOptions {
  config: AppConfig;
  db: Db;
  logger?: boolean;
}

export async function buildApp({ config, db, logger = true }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger
      ? {
          level: config.LOG_LEVEL,
          // Never log cookies, auth headers or CSRF tokens.
          redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
        }
      : false,
    // Passenger/Apache proxy from loopback; trust only that hop for req.ip.
    trustProxy: 'loopback',
    bodyLimit: 1_048_576,
    genReqId: () => crypto.randomUUID(),
  });

  registerErrorHandling(app);

  // Many HTTP clients send `content-type: application/json` on bodiless DELETE/POST requests.
  // Treat an empty JSON body as "no body" instead of a 400; keep Fastify's prototype-poisoning checks.
  const defaultJsonParser = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text === '') return done(null, undefined);
    return defaultJsonParser(req, text, done);
  });
  await app.register(helmet, { contentSecurityPolicy: false }); // CSP is set for the static web app by Apache.
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
  await app.register(authPlugin, { db, config });

  await app.register(
    async (v1) => {
      // Fail fast at startup if any API route forgets to declare its authorization.
      v1.addHook('onRoute', assertRouteDeclaresAuth);
      await v1.register(healthRoutes, { db, config });
      await v1.register(authRoutes, { db, config });
      await v1.register(schoolRoutes, { db });
      await v1.register(academicRoutes, { db });
      await v1.register(auditRoutes, { db });
      await v1.register(userRoutes, { db });
      await v1.register(peopleRoutes, { db });
      await v1.register(attendanceRoutes, { db });
      await v1.register(timetableRoutes, { db });
      await v1.register(announcementRoutes, { db });
      await v1.register(learningRoutes, { db, config });
      await v1.register(questionRoutes, { db });
      await v1.register(examRoutes, { db });
    },
    { prefix: API_PREFIX },
  );

  return app;
}
