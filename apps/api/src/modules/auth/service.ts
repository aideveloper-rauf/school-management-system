import { sql } from 'kysely';
import { permissionsFor, isRole, isLocale, type SessionResponse } from '@sms/shared';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { DUMMY_HASH_PROMISE, hashPassword, needsRehash, verifyPassword } from '../../lib/password.js';
import { newCsrfToken, newToken, sha256Hex } from '../../lib/tokens.js';

/** Throttle windows. Tune with the pilot school; keep failures-per-account low. */
export const THROTTLE = {
  windowMinutes: 15,
  maxFailuresPerIdentifier: 5,
  maxFailuresPerIp: 30,
};

export const normalizeIdentifier = (s: string) => s.trim().toLowerCase();

export async function isThrottled(db: Db, identifier: string, ip: string): Promise<boolean> {
  const since = sql<Date>`CURRENT_TIMESTAMP - INTERVAL ${sql.lit(THROTTLE.windowMinutes)} MINUTE`;
  const [byId, byIp] = await Promise.all([
    db
      .selectFrom('login_attempts')
      .select(db.fn.countAll<number>().as('n'))
      .where('identifier', '=', identifier)
      .where('succeeded', '=', 0)
      .where('attempted_at', '>', since)
      .executeTakeFirst(),
    db
      .selectFrom('login_attempts')
      .select(db.fn.countAll<number>().as('n'))
      .where('ip', '=', ip)
      .where('succeeded', '=', 0)
      .where('attempted_at', '>', since)
      .executeTakeFirst(),
  ]);
  return Number(byId?.n ?? 0) >= THROTTLE.maxFailuresPerIdentifier || Number(byIp?.n ?? 0) >= THROTTLE.maxFailuresPerIp;
}

export async function recordAttempt(db: Db, identifier: string, ip: string, succeeded: boolean) {
  await db
    .insertInto('login_attempts')
    .values({ identifier, ip, succeeded: succeeded ? 1 : 0 })
    .execute();
}

/** Returns the user id when credentials are valid and the account is active. */
export async function verifyCredentials(db: Db, identifier: string, password: string): Promise<number | null> {
  const user = await db
    .selectFrom('users')
    .select(['id', 'password_hash', 'status'])
    .where('identifier', '=', identifier)
    .executeTakeFirst();
  if (!user) {
    await verifyPassword(password, await DUMMY_HASH_PROMISE); // equalize timing
    return null;
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok || user.status !== 'active') return null;
  if (needsRehash(user.password_hash)) {
    await db
      .updateTable('users')
      .set({ password_hash: await hashPassword(password) })
      .where('id', '=', user.id)
      .execute();
  }
  return user.id;
}

export async function createSession(db: Db, cfg: AppConfig, userId: number, userAgent: string | undefined) {
  const token = newToken();
  const csrfToken = newCsrfToken();
  const now = new Date();
  await db
    .insertInto('sessions')
    .values({
      id_hash: sha256Hex(token),
      user_id: userId,
      csrf_token: csrfToken,
      expires_at: new Date(now.getTime() + cfg.SESSION_TTL_MINUTES * 60_000),
      last_seen_at: now,
      user_agent: userAgent?.slice(0, 255) ?? null,
    })
    .execute();
  await db.updateTable('users').set({ last_login_at: now }).where('id', '=', userId).execute();
  return { token, csrfToken };
}

export async function buildSessionResponse(db: Db, userId: number, csrfToken: string): Promise<SessionResponse> {
  const user = await db.selectFrom('users').select(['id', 'display_name', 'locale']).where('id', '=', userId).executeTakeFirstOrThrow();
  const roles = (await db.selectFrom('user_roles').select('role').where('user_id', '=', userId).execute())
    .map((r) => r.role)
    .filter(isRole);
  return {
    user: { id: user.id, displayName: user.display_name, roles, locale: isLocale(user.locale) ? user.locale : 'en' },
    permissions: [...permissionsFor(roles)].sort(),
    csrfToken,
  };
}
