import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { CSRF_HEADER, isLocale, isRole, permissionsFor, type Permission, type SessionUser } from '@sms/shared';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../db/client.js';
import { AppError, forbidden, unauthenticated } from '../lib/errors.js';
import { sha256Hex } from '../lib/tokens.js';

export const SESSION_COOKIE = 'sms_session';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Only extend a session's expiry if it was last touched more than this long ago. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface AuthContext {
  user: SessionUser;
  permissions: Set<Permission>;
  sessionHash: string;
  csrfToken: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export function sessionCookieOptions(cfg: AppConfig) {
  return {
    path: '/',
    httpOnly: true,
    secure: cfg.COOKIE_SECURE,
    sameSite: 'strict' as const,
    maxAge: cfg.SESSION_TTL_MINUTES * 60,
  };
}

export async function loadAuthContext(db: Db, cfg: AppConfig, rawToken: string): Promise<AuthContext | null> {
  const sessionHash = sha256Hex(rawToken);
  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select(['sessions.user_id', 'sessions.csrf_token', 'sessions.expires_at', 'sessions.last_seen_at', 'users.display_name', 'users.locale', 'users.status'])
    .where('sessions.id_hash', '=', sessionHash)
    .executeTakeFirst();
  if (!row || row.status !== 'active' || new Date(row.expires_at).getTime() <= Date.now()) return null;

  const roles = (await db.selectFrom('user_roles').select('role').where('user_id', '=', row.user_id).execute())
    .map((r) => r.role)
    .filter(isRole);

  if (Date.now() - new Date(row.last_seen_at).getTime() > TOUCH_INTERVAL_MS) {
    const now = new Date();
    await db
      .updateTable('sessions')
      .set({ last_seen_at: now, expires_at: new Date(now.getTime() + cfg.SESSION_TTL_MINUTES * 60_000) })
      .where('id_hash', '=', sessionHash)
      .execute();
  }

  return {
    user: { id: row.user_id, displayName: row.display_name, roles, locale: isLocale(row.locale) ? row.locale : 'en' },
    permissions: permissionsFor(roles),
    sessionHash,
    csrfToken: row.csrf_token,
  };
}

/**
 * Resolves the session (if any) and enforces CSRF/origin rules for unsafe methods.
 * Authorization is NOT done here — routes declare it with requireAuth/requirePermission.
 */
export const authPlugin = fp<{ db: Db; config: AppConfig }>(async (app, { db, config }) => {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const unsafe = !SAFE_METHODS.has(req.method);

    // Origin check blocks cross-site form posts (including login CSRF).
    if (unsafe) {
      const origin = req.headers.origin;
      if (origin && origin !== config.APP_ORIGIN) throw new AppError('CSRF_FAILED', 'errors.csrf');
    }

    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return;
    req.auth = await loadAuthContext(db, config, raw);
    if (!req.auth) {
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return;
    }

    if (unsafe) {
      const header = req.headers[CSRF_HEADER];
      if (typeof header !== 'string' || header !== req.auth.csrfToken) {
        throw new AppError('CSRF_FAILED', 'errors.csrf');
      }
    }
  });
});

export const requireAuth: preHandlerHookHandler = async (req) => {
  if (!req.auth) throw unauthenticated();
};

/** Coarse permission gate. Routes must still apply record-level scope checks. */
export function requirePermission(...anyOf: Permission[]): preHandlerHookHandler {
  return async (req) => {
    if (!req.auth) throw unauthenticated();
    if (!anyOf.some((p) => req.auth!.permissions.has(p))) throw forbidden();
  };
}
