import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { sql, type Kysely, type Updateable } from 'kysely';
import {
  createUserSchema,
  idParamSchema,
  isEmailIdentifier,
  isRole,
  pageWindow,
  setTemporaryPasswordSchema,
  setUserRolesSchema,
  toPaginated,
  updateUserSchema,
  userListQuerySchema,
  type Paginated,
  type Role,
  type UserItem,
  type UserStatus,
} from '@sms/shared';
import type { Db } from '../../db/client.js';
import type { Database } from '../../db/types.js';
import { recordAudit } from '../../lib/audit.js';
import { AppError, conflict, forbidden, invalid, notFound } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import { newToken } from '../../lib/tokens.js';
import { requirePermission, revokeSessions } from '../../plugins/auth.js';
import { requestUserToken, revokeUserTokens } from './tokens.js';

/**
 * User accounts and role assignment for this school installation.
 *
 * - users.read: list/view accounts. users.manage: create, edit, disable/enable, invitations,
 *   temporary passwords. roles.assign: change roles (also needed to create a user with roles).
 * - The last active school_admin can never be disabled or lose that role (a school must not lock
 *   itself out). Nobody can disable their own account.
 * - Every change is audited in the same transaction; metadata holds role names / field names only.
 */
const ADMIN_ROLE: Role = 'school_admin';
const lastAdminError = () => new AppError('CONFLICT', 'errors.lastAdmin');

type Trx = Kysely<Database>;

async function rolesOf(db: Trx, userIds: number[]): Promise<Map<number, Role[]>> {
  const out = new Map<number, Role[]>(userIds.map((id) => [id, []]));
  if (userIds.length === 0) return out;
  const rows = await db.selectFrom('user_roles').select(['user_id', 'role']).where('user_id', 'in', userIds).orderBy('role').execute();
  for (const r of rows) if (isRole(r.role)) out.get(r.user_id)?.push(r.role);
  return out;
}

const USER_COLUMNS = [
  'id',
  'identifier',
  'display_name',
  'locale',
  'status',
  'must_change_password',
  'last_login_at',
  'created_at',
] as const;
type UserRow = {
  id: number;
  identifier: string;
  display_name: string;
  locale: string;
  status: UserStatus;
  must_change_password: number;
  last_login_at: Date | null;
  created_at: Date;
};
const toUser = (r: UserRow, roles: Role[]): UserItem => ({
  id: r.id,
  identifier: r.identifier,
  displayName: r.display_name,
  locale: r.locale,
  status: r.status,
  roles,
  mustChangePassword: Boolean(r.must_change_password),
  lastLoginAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
  createdAt: new Date(r.created_at).toISOString(),
});

/**
 * Lock all school_admin grants and count active admins other than `excludeUserId`.
 * Locking serialises concurrent "remove admin" / "disable admin" requests.
 */
async function otherActiveAdmins(trx: Trx, excludeUserId: number): Promise<number> {
  const rows = await trx
    .selectFrom('user_roles as r')
    .innerJoin('users as u', 'u.id', 'r.user_id')
    .select(['r.user_id', 'u.status'])
    .where('r.role', '=', ADMIN_ROLE)
    .forUpdate()
    .execute();
  return rows.filter((r) => r.user_id !== excludeUserId && r.status === 'active').length;
}

const actorId = (req: FastifyRequest) => req.auth!.user.id;

export const userRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const loadUser = async (trx: Trx, id: number): Promise<UserItem> => {
    const row = await trx.selectFrom('users').select(USER_COLUMNS).where('id', '=', id).executeTakeFirst();
    if (!row) throw notFound();
    return toUser(row, (await rolesOf(trx, [id])).get(id) ?? []);
  };

  app.get('/users', { preHandler: requirePermission('users.read') }, async (req): Promise<Paginated<UserItem>> => {
    const q = userListQuerySchema.parse(req.query);
    let base = db.selectFrom('users');
    if (q.status) base = base.where('status', '=', q.status);
    if (q.role) base = base.where('id', 'in', db.selectFrom('user_roles').select('user_id').where('role', '=', q.role));
    if (q.q) {
      // Escape LIKE wildcards in the search text.
      const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      base = base.where((eb) => eb.or([eb('identifier', 'like', like), eb('display_name', 'like', like)]));
    }
    const { limit, offset } = pageWindow(q);
    const [rows, total] = await Promise.all([
      base.select(USER_COLUMNS).orderBy('display_name').orderBy('id').limit(limit).offset(offset).execute(),
      base.select(db.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    const roles = await rolesOf(
      db,
      rows.map((r) => r.id),
    );
    return toPaginated(
      rows.map((r) => toUser(r, roles.get(r.id) ?? [])),
      total.n,
      q,
    );
  });

  app.get('/users/:id', { preHandler: requirePermission('users.read') }, async (req) => loadUser(db, idParamSchema.parse(req.params).id));

  app.post('/users', { preHandler: requirePermission('users.manage') }, async (req, reply) => {
    const input = createUserSchema.parse(req.body);
    if (input.roles.length > 0 && !req.auth!.permissions.has('roles.assign')) throw forbidden();

    // Invited users get an unusable random password until they accept the invitation.
    const passwordHash = await hashPassword(input.onboarding === 'temporary_password' ? input.temporaryPassword : newToken());
    const id = await db.transaction().execute(async (trx) => {
      const exists = await trx.selectFrom('users').select('id').where('identifier', '=', input.identifier).executeTakeFirst();
      if (exists) throw conflict();
      const res = await trx
        .insertInto('users')
        .values({
          identifier: input.identifier,
          display_name: input.displayName,
          locale: input.locale,
          password_hash: passwordHash,
          status: input.onboarding === 'invite' ? 'invited' : 'active',
          must_change_password: input.onboarding === 'temporary_password' ? 1 : 0,
          // Non-null means "has had a usable password" — /enable relies on it to restore the right status.
          password_changed_at: input.onboarding === 'temporary_password' ? sql<Date>`CURRENT_TIMESTAMP` : null,
        })
        .executeTakeFirstOrThrow();
      const userId = Number(res.insertId);
      for (const role of input.roles) {
        await trx
          .insertInto('user_roles')
          .values({ user_id: userId, role, granted_by: actorId(req) })
          .execute();
        await recordAudit(trx, req, { action: 'role.granted', entityType: 'user', entityId: userId, metadata: { role } });
      }
      if (input.onboarding === 'invite') await requestUserToken(trx, { userId, purpose: 'invite', createdBy: actorId(req) });
      await recordAudit(trx, req, {
        action: 'user.created',
        entityType: 'user',
        entityId: userId,
        metadata: { onboarding: input.onboarding, roles: input.roles },
      });
      return userId;
    });
    return reply.status(201).send(await loadUser(db, id));
  });

  app.patch('/users/:id', { preHandler: requirePermission('users.manage') }, async (req) => {
    const id = idParamSchema.parse(req.params).id;
    const input = updateUserSchema.parse(req.body);
    await db.transaction().execute(async (trx) => {
      const row: Updateable<Database['users']> = {};
      if (input.displayName !== undefined) row.display_name = input.displayName;
      if (input.locale !== undefined) row.locale = input.locale;
      const res = await trx.updateTable('users').set(row).where('id', '=', id).executeTakeFirst();
      if (Number(res.numUpdatedRows) === 0) {
        const exists = await trx.selectFrom('users').select('id').where('id', '=', id).executeTakeFirst();
        if (!exists) throw notFound();
      }
      await recordAudit(trx, req, {
        action: 'user.updated',
        entityType: 'user',
        entityId: id,
        metadata: { fields: Object.keys(input).sort() },
      });
    });
    return loadUser(db, id);
  });

  app.put('/users/:id/roles', { preHandler: requirePermission('roles.assign') }, async (req) => {
    const id = idParamSchema.parse(req.params).id;
    const { roles } = setUserRolesSchema.parse(req.body);
    await db.transaction().execute(async (trx) => {
      const user = await trx.selectFrom('users').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!user) throw notFound();
      const current = (await rolesOf(trx, [id])).get(id) ?? [];
      const removing = current.filter((r) => !roles.includes(r));
      const adding = roles.filter((r) => !current.includes(r));
      if (removing.includes(ADMIN_ROLE) && (await otherActiveAdmins(trx, id)) === 0) throw lastAdminError();

      if (removing.length > 0) {
        await trx.deleteFrom('user_roles').where('user_id', '=', id).where('role', 'in', removing).execute();
      }
      for (const role of adding) {
        await trx
          .insertInto('user_roles')
          .values({ user_id: id, role, granted_by: actorId(req) })
          .execute();
      }
      for (const role of adding)
        await recordAudit(trx, req, { action: 'role.granted', entityType: 'user', entityId: id, metadata: { role } });
      for (const role of removing)
        await recordAudit(trx, req, { action: 'role.revoked', entityType: 'user', entityId: id, metadata: { role } });
    });
    return loadUser(db, id);
  });

  /** Disable: blocks sign-in immediately, ends all sessions and cancels pending links. */
  app.post('/users/:id/disable', { preHandler: requirePermission('users.manage') }, async (req) => {
    const id = idParamSchema.parse(req.params).id;
    if (id === actorId(req)) throw new AppError('CONFLICT', 'errors.cannotDisableSelf');
    await db.transaction().execute(async (trx) => {
      const user = await trx.selectFrom('users').select('status').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!user) throw notFound();
      if (user.status === 'disabled') return;
      const isAdmin = ((await rolesOf(trx, [id])).get(id) ?? []).includes(ADMIN_ROLE);
      if (isAdmin && user.status === 'active' && (await otherActiveAdmins(trx, id)) === 0) throw lastAdminError();
      await trx.updateTable('users').set({ status: 'disabled' }).where('id', '=', id).execute();
      await revokeSessions(trx, id);
      await revokeUserTokens(trx, id);
      await recordAudit(trx, req, { action: 'user.disabled', entityType: 'user', entityId: id });
    });
    return loadUser(db, id);
  });

  /** Enable a disabled account. If it never accepted its invitation it goes back to "invited". */
  app.post('/users/:id/enable', { preHandler: requirePermission('users.manage') }, async (req) => {
    const id = idParamSchema.parse(req.params).id;
    await db.transaction().execute(async (trx) => {
      const user = await trx
        .selectFrom('users')
        .select(['status', 'password_changed_at'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!user) throw notFound();
      if (user.status !== 'disabled') return;
      const status = user.password_changed_at === null ? 'invited' : 'active';
      await trx.updateTable('users').set({ status }).where('id', '=', id).execute();
      await recordAudit(trx, req, { action: 'user.enabled', entityType: 'user', entityId: id, metadata: { status } });
    });
    return loadUser(db, id);
  });

  /** Send (or re-send) the invitation email. Only for accounts still in "invited" state with an email. */
  app.post('/users/:id/invitation', { preHandler: requirePermission('users.manage') }, async (req, reply) => {
    const id = idParamSchema.parse(req.params).id;
    await db.transaction().execute(async (trx) => {
      const user = await trx.selectFrom('users').select(['status', 'identifier']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!user) throw notFound();
      if (user.status !== 'invited') throw new AppError('CONFLICT', 'errors.notInvited');
      if (!isEmailIdentifier(user.identifier)) throw invalid('identifier', 'An invitation needs an email address');
      await requestUserToken(trx, { userId: id, purpose: 'invite', createdBy: actorId(req) });
      await recordAudit(trx, req, { action: 'user.invitation_sent', entityType: 'user', entityId: id });
    });
    return reply.status(202).send({ ok: true });
  });

  /**
   * Set a temporary password (for users without email, or who are locked out). The user must
   * change it at next sign-in; all their sessions and pending links end now.
   */
  app.post('/users/:id/temporary-password', { preHandler: requirePermission('users.manage') }, async (req) => {
    const id = idParamSchema.parse(req.params).id;
    if (id === actorId(req)) throw new AppError('CONFLICT', 'errors.useChangePassword');
    const { temporaryPassword } = setTemporaryPasswordSchema.parse(req.body);
    const passwordHash = await hashPassword(temporaryPassword);
    await db.transaction().execute(async (trx) => {
      const user = await trx.selectFrom('users').select('status').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!user) throw notFound();
      if (user.status === 'disabled') throw new AppError('CONFLICT', 'errors.userDisabled');
      await trx
        .updateTable('users')
        .set({
          password_hash: passwordHash,
          must_change_password: 1,
          status: 'active',
          password_changed_at: sql<Date>`CURRENT_TIMESTAMP`,
        })
        .where('id', '=', id)
        .execute();
      await revokeSessions(trx, id);
      await revokeUserTokens(trx, id);
      await recordAudit(trx, req, { action: 'user.temporary_password_set', entityType: 'user', entityId: id });
    });
    return loadUser(db, id);
  });
};
