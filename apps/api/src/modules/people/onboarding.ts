import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { identifierSchema, newPasswordSchema } from '@sms/shared';
import type { Db } from '../../db/client.js';
import { recordAudit } from '../../lib/audit.js';
import { AppError, conflict, invalid, notFound } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import { newToken } from '../../lib/tokens.js';
import { requirePermission } from '../../plugins/auth.js';
import { requestUserToken } from '../users/tokens.js';
import { routeId } from './common.js';

/**
 * Family sign-in onboarding (roadmap G-3). Deliberately narrow paths for the registrar, who does not hold
 * `users.manage`: each creates exactly one account with exactly one role and links it to the record.
 *
 * - Guardian: needs an email on the guardian record and at least one **verified** link. An invitation email
 *   (time-limited, single-use) lets them choose a password.
 * - Student: a school-issued username and a temporary password the student must change at first sign-in
 *   (many students have no email).
 * An existing account with the same email/username is never taken over: that returns 409 and an administrator
 * decides.
 */
export const onboardingRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.post('/guardians/:id/invite', { preHandler: requirePermission('guardians.link.manage') }, async (req, reply) => {
    const id = routeId(req);
    const userId = await db.transaction().execute(async (trx) => {
      const g = await trx.selectFrom('guardian_profiles').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!g) throw notFound();
      if (g.user_id) throw new AppError('CONFLICT', 'errors.accountAlreadyLinked');
      if (!g.email) throw invalid('email', 'errors.guardianNeedsEmail');
      const verified = await trx
        .selectFrom('student_guardians')
        .select('student_id')
        .where('guardian_id', '=', id)
        .where('verification_status', '=', 'verified')
        .executeTakeFirst();
      if (!verified) throw new AppError('CONFLICT', 'errors.guardianNotVerified');
      const exists = await trx.selectFrom('users').select('id').where('identifier', '=', g.email).executeTakeFirst();
      if (exists) throw conflict('errors.accountExists');
      const res = await trx
        .insertInto('users')
        .values({
          identifier: g.email,
          display_name: g.full_name,
          locale: g.preferred_locale,
          password_hash: await hashPassword(newToken()),
          status: 'invited',
        })
        .executeTakeFirstOrThrow();
      const uid = Number(res.insertId);
      await trx.insertInto('user_roles').values({ user_id: uid, role: 'guardian', granted_by: req.auth!.user.id }).execute();
      await trx.updateTable('guardian_profiles').set({ user_id: uid }).where('id', '=', id).execute();
      await requestUserToken(trx, { userId: uid, purpose: 'invite', createdBy: req.auth!.user.id });
      await recordAudit(trx, req, {
        action: 'user.created',
        entityType: 'user',
        entityId: uid,
        metadata: { onboarding: 'invite', roles: ['guardian'] },
      });
      await recordAudit(trx, req, { action: 'guardian.invited', entityType: 'guardian', entityId: id, metadata: { userId: uid } });
      return uid;
    });
    return reply.status(201).send({ userId });
  });

  app.post('/students/:id/account', { preHandler: requirePermission('students.manage') }, async (req, reply) => {
    const id = routeId(req);
    const input = z.object({ identifier: identifierSchema, temporaryPassword: newPasswordSchema }).parse(req.body);
    const userId = await db.transaction().execute(async (trx) => {
      const s = await trx
        .selectFrom('student_profiles')
        .select(['id', 'user_id', 'full_name', 'status'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!s) throw notFound();
      if (s.user_id) throw new AppError('CONFLICT', 'errors.accountAlreadyLinked');
      if (s.status !== 'active') throw new AppError('CONFLICT', 'errors.studentNotActive');
      const exists = await trx.selectFrom('users').select('id').where('identifier', '=', input.identifier).executeTakeFirst();
      if (exists) throw conflict('errors.accountExists');
      const school = await trx.selectFrom('schools').select('default_locale').executeTakeFirst();
      const res = await trx
        .insertInto('users')
        .values({
          identifier: input.identifier,
          display_name: s.full_name,
          locale: school?.default_locale ?? 'en',
          password_hash: await hashPassword(input.temporaryPassword),
          status: 'active',
          must_change_password: 1,
          password_changed_at: sql<Date>`CURRENT_TIMESTAMP`,
        })
        .executeTakeFirstOrThrow();
      const uid = Number(res.insertId);
      await trx.insertInto('user_roles').values({ user_id: uid, role: 'student', granted_by: req.auth!.user.id }).execute();
      await trx.updateTable('student_profiles').set({ user_id: uid }).where('id', '=', id).execute();
      await recordAudit(trx, req, {
        action: 'user.created',
        entityType: 'user',
        entityId: uid,
        metadata: { onboarding: 'temporary_password', roles: ['student'] },
      });
      await recordAudit(trx, req, { action: 'student.account_created', entityType: 'student', entityId: id, metadata: { userId: uid } });
      return uid;
    });
    return reply.status(201).send({ userId });
  });
};
