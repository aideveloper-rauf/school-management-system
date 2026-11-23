import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import {
  acceptInvitationSchema,
  changePasswordSchema,
  isEmailIdentifier,
  loginRequestSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
} from '@sms/shared';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { recordAudit } from '../../lib/audit.js';
import { AppError, invalid } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { SESSION_COOKIE, requireAuth, revokeSessions, sessionCookieOptions } from '../../plugins/auth.js';
import { consumeUserToken, recentResetRequests, requestUserToken, revokeUserTokens } from '../users/tokens.js';
import { buildSessionResponse, createSession, isThrottled, normalizeIdentifier, recordAttempt, verifyCredentials } from './service.js';

/** Max reset emails per account per hour; further requests are silently ignored. */
const MAX_RESET_REQUESTS_PER_HOUR = 3;
/** Public token endpoints: slow down guessing and email flooding per IP. */
const PUBLIC_TOKEN_LIMIT = { max: 10, timeWindow: '15 minutes' };

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

  app.get('/auth/session', { preHandler: requireAuth, config: { allowDuringPasswordChange: true } }, async (req) => {
    return buildSessionResponse(db, req.auth!.user.id, req.auth!.csrfToken);
  });

  app.post('/auth/logout', { preHandler: requireAuth, config: { allowDuringPasswordChange: true } }, async (req, reply) => {
    await db.deleteFrom('sessions').where('id_hash', '=', req.auth!.sessionHash).execute();
    await recordAudit(db, req, { action: 'auth.logout' });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /** Change own password. Signs out every other session; keeps this one. */
  app.post(
    '/auth/password',
    { preHandler: requireAuth, config: { allowDuringPasswordChange: true, rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req) => {
      const input = changePasswordSchema.parse(req.body);
      const userId = req.auth!.user.id;
      const user = await db.selectFrom('users').select('password_hash').where('id', '=', userId).executeTakeFirstOrThrow();
      if (!(await verifyPassword(input.currentPassword, user.password_hash))) {
        throw invalid('currentPassword', 'errors.wrongCurrentPassword');
      }
      const passwordHash = await hashPassword(input.newPassword);
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('users')
          .set({ password_hash: passwordHash, password_changed_at: sql<Date>`CURRENT_TIMESTAMP`, must_change_password: 0 })
          .where('id', '=', userId)
          .execute();
        await revokeSessions(trx, userId, req.auth!.sessionHash);
        await revokeUserTokens(trx, userId, 'reset');
        await recordAudit(trx, req, { action: 'user.password_changed', entityType: 'user', entityId: userId });
      });
      return { ok: true };
    },
  );

  /**
   * Request a reset link. Always answers 202 with the same body so it cannot be used to discover
   * accounts. Only active accounts whose identifier is an email get a message.
   */
  app.post('/auth/password-reset/request', { config: { public: true, rateLimit: PUBLIC_TOKEN_LIMIT } }, async (req, reply) => {
    const { identifier } = passwordResetRequestSchema.parse(req.body);
    const user = await db.selectFrom('users').select(['id', 'status']).where('identifier', '=', identifier).executeTakeFirst();
    if (
      user &&
      user.status === 'active' &&
      isEmailIdentifier(identifier) &&
      (await recentResetRequests(db, user.id)) < MAX_RESET_REQUESTS_PER_HOUR
    ) {
      await db.transaction().execute(async (trx) => {
        await requestUserToken(trx, { userId: user.id, purpose: 'reset', createdBy: null });
        await recordAudit(trx, req, { action: 'user.password_reset_requested', actorUserId: null, entityType: 'user', entityId: user.id });
      });
    }
    return reply.status(202).send({ ok: true });
  });

  /** Set a new password from an emailed link. Signs the user out everywhere. */
  app.post('/auth/password-reset/confirm', { config: { public: true, rateLimit: PUBLIC_TOKEN_LIMIT } }, async (req) => {
    const input = passwordResetConfirmSchema.parse(req.body);
    const passwordHash = await hashPassword(input.newPassword);
    await db.transaction().execute(async (trx) => {
      const userId = await consumeUserToken(trx, input.token, 'reset');
      await trx
        .updateTable('users')
        .set({ password_hash: passwordHash, password_changed_at: sql<Date>`CURRENT_TIMESTAMP`, must_change_password: 0 })
        .where('id', '=', userId)
        .execute();
      await revokeSessions(trx, userId);
      await revokeUserTokens(trx, userId, 'reset');
      await recordAudit(trx, req, { action: 'user.password_reset', actorUserId: userId, entityType: 'user', entityId: userId });
    });
    return { ok: true };
  });

  /** Accept an invitation: choose a password and activate the account. The user then signs in. */
  app.post('/auth/invitations/accept', { config: { public: true, rateLimit: PUBLIC_TOKEN_LIMIT } }, async (req) => {
    const input = acceptInvitationSchema.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    await db.transaction().execute(async (trx) => {
      const userId = await consumeUserToken(trx, input.token, 'invite');
      await trx
        .updateTable('users')
        .set({ password_hash: passwordHash, password_changed_at: sql<Date>`CURRENT_TIMESTAMP`, status: 'active', must_change_password: 0 })
        .where('id', '=', userId)
        .execute();
      await revokeUserTokens(trx, userId, 'invite');
      await recordAudit(trx, req, { action: 'user.invitation_accepted', actorUserId: userId, entityType: 'user', entityId: userId });
    });
    return { ok: true };
  });
};
