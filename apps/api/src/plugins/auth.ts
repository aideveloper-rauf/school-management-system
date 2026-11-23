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
  /** Temporary password in use: only routes with config.allowDuringPasswordChange are reachable. */
  mustChangePassword: boolean;
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
    .select([
      'sessions.user_id',
      'sessions.csrf_token',
      'sessions.expires_at',
      'sessions.last_seen_at',
      'users.display_name',
      'users.locale',
      'users.status',
      'users.must_change_password',
    ])
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
    mustChangePassword: Boolean(row.must_change_password),
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

    // Public routes (login, token links) never act on the session, so they do not need its CSRF token;
    // the Origin check above still blocks cross-site posts. Without this, opening an invitation or
    // reset link in a browser where someone is signed in would fail.
    if (unsafe && req.routeOptions.config?.public !== true) {
      const header = req.headers[CSRF_HEADER];
      if (typeof header !== 'string' || header !== req.auth.csrfToken) {
        throw new AppError('CSRF_FAILED', 'errors.csrf');
      }
    }
  });
});

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Mark a route as intentionally unauthenticated (see assertRouteDeclaresAuth). */
    public?: boolean;
    /** Reachable while the user must still replace a temporary password (session, password change, logout). */
    allowDuringPasswordChange?: boolean;
  }
}

/** Signed-in checks shared by every guard. */
function assertSignedIn(req: FastifyRequest): void {
  if (!req.auth) throw unauthenticated();
  if (req.auth.mustChangePassword && req.routeOptions.config.allowDuringPasswordChange !== true) {
    throw new AppError('PASSWORD_CHANGE_REQUIRED', 'errors.passwordChangeRequired');
  }
}

/** Tag carried by every authorization preHandler, so route registration can verify it. */
const AUTH_GUARD = Symbol('sms.authGuard');
const markGuard = (fn: preHandlerHookHandler): preHandlerHookHandler => Object.assign(fn, { [AUTH_GUARD]: true });
const isGuard = (fn: unknown) => typeof fn === 'function' && (fn as unknown as Record<symbol, unknown>)[AUTH_GUARD] === true;

export const requireAuth: preHandlerHookHandler = markGuard(async (req) => {
  assertSignedIn(req);
});

/** Coarse permission gate. Routes must still apply record-level scope checks. */
export function requirePermission(...anyOf: Permission[]): preHandlerHookHandler {
  return markGuard(async (req) => {
    assertSignedIn(req);
    if (!anyOf.some((p) => req.auth!.permissions.has(p))) throw forbidden();
  });
}

/** Revoke sessions of a user, optionally keeping one (e.g. the session that changed the password). */
export async function revokeSessions(db: Db, userId: number, keepSessionHash?: string): Promise<void> {
  let q = db.deleteFrom('sessions').where('user_id', '=', userId);
  if (keepSessionHash) q = q.where('id_hash', '!=', keepSessionHash);
  await q.execute();
}

/**
 * onRoute check: every route must either use requireAuth/requirePermission as a preHandler
 * or declare `config: { public: true }`. Throws at startup, so a forgotten guard cannot ship.
 */
export function assertRouteDeclaresAuth(route: {
  method: string | string[];
  url: string;
  preHandler?: unknown;
  config?: { public?: boolean };
}): void {
  if (route.config?.public === true) return;
  const handlers = Array.isArray(route.preHandler) ? route.preHandler : [route.preHandler];
  if (!handlers.some(isGuard)) {
    throw new Error(
      `Route ${String(route.method)} ${route.url} has no auth preHandler; use requireAuth/requirePermission or config.public`,
    );
  }
}
