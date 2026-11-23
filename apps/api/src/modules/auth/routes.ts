import type { FastifyPluginAsync } from 'fastify';
import { loginRequestSchema } from '@sms/shared';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { recordAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { SESSION_COOKIE, requireAuth, sessionCookieOptions } from '../../plugins/auth.js';
import { buildSessionResponse, createSession, isThrottled, normalizeIdentifier, recordAttempt, verifyCredentials } from './service.js';

export const authRoutes: FastifyPluginAsync<{ db: Db; config: AppConfig }> = async (app, { db, config }) => {
  app.post('/auth/login', { config: { public: true, rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = loginRequestSchema.parse(req.body);
    const identifier = normalizeIdentifier(body.identifier);

    if (await isThrottled(db, identifier, req.ip)) {
      throw new AppError('RATE_LIMITED', 'errors.tooManyAttempts');
    }

    const userId = await verifyCredentials(db, identifier, body.password);
    await recordAttempt(db, identifier, req.ip, userId !== null);
    if (userId === null) {
      await recordAudit(db, req, { action: 'auth.login.failed' });
      // Same message for unknown user, wrong password, or disabled account.
      throw new AppError('UNAUTHENTICATED', 'errors.invalidCredentials');
    }

    // Rotate: a new session on every login (prevents session fixation).
    const { token, csrfToken } = await createSession(db, config, userId, req.headers['user-agent']);
    await recordAudit(db, req, { action: 'auth.login.succeeded', actorUserId: userId, entityType: 'user', entityId: userId });
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(config));
    return buildSessionResponse(db, userId, csrfToken);
  });

  app.get('/auth/session', { preHandler: requireAuth }, async (req) => {
    return buildSessionResponse(db, req.auth!.user.id, req.auth!.csrfToken);
  });

  app.post('/auth/logout', { preHandler: requireAuth }, async (req, reply) => {
    await db.deleteFrom('sessions').where('id_hash', '=', req.auth!.sessionHash).execute();
    await recordAudit(db, req, { action: 'auth.logout' });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
};
