import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CSRF_HEADER } from '@sms/shared';
import { buildApp } from '../app.js';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../db/client.js';
import { SESSION_COOKIE } from '../plugins/auth.js';
import { THROTTLE } from '../modules/auth/service.js';
import { createUser, freshDb } from './test-db.js';

let db: Db;
let cfg: AppConfig;
let app: FastifyInstance;
const PASSWORD = 'correct-horse-battery';

beforeAll(async () => {
  ({ db, cfg } = await freshDb());
  app = await buildApp({ config: cfg, db, logger: false });
  await db.insertInto('schools').values({ name: 'Test School', default_locale: 'en', timezone: 'Asia/Colombo' }).execute();
  await createUser(db, { identifier: 'admin@test.lk', password: PASSWORD, roles: ['school_admin'] });
  await createUser(db, { identifier: 'teacher@test.lk', password: PASSWORD, roles: ['teacher'] });
  await createUser(db, { identifier: 'gone@test.lk', password: PASSWORD, roles: ['teacher'], status: 'disabled' });
});
afterAll(async () => {
  await app?.close();
  await db?.destroy();
});
beforeEach(async () => {
  await db.deleteFrom('login_attempts').execute();
});

async function login(identifier: string, password = PASSWORD) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier, password } });
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)?.value;
  return { res, cookie, csrf: res.statusCode === 200 ? (res.json().csrfToken as string) : '' };
}

describe('login → session → logout (real MySQL)', () => {
  it('logs in, exposes the session, and logs out', async () => {
    const { res, cookie, csrf } = await login('  Admin@Test.lk ');
    expect(res.statusCode).toBe(200);
    expect(cookie).toBeTruthy();
    expect(res.json().permissions).toContain('users.manage');
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);

    // Only the SHA-256 of the token is stored.
    const stored = await db.selectFrom('sessions').select('id_hash').execute();
    expect(stored.map((s) => s.id_hash)).not.toContain(cookie);

    const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session', cookies: { [SESSION_COOKIE]: cookie! } });
    expect(session.statusCode).toBe(200);
    expect(session.json().user.displayName).toBe('admin@test.lk');

    const noCsrf = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', cookies: { [SESSION_COOKIE]: cookie! } });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().error.code).toBe('CSRF_FAILED');

    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      cookies: { [SESSION_COOKIE]: cookie! },
      headers: { [CSRF_HEADER]: csrf },
    });
    expect(out.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/api/v1/auth/session', cookies: { [SESSION_COOKIE]: cookie! } });
    expect(after.statusCode).toBe(401);
  });

  it('exposes only the school name publicly for the sign-in page', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/school/branding' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: 'Test School', shortName: null });
    // The full settings still require a session.
    expect((await app.inject({ method: 'GET', url: '/api/v1/school' })).statusCode).toBe(401);
  });

  it('issues a new session token on every login', async () => {
    const a = await login('admin@test.lk');
    const b = await login('admin@test.lk');
    expect(a.cookie).toBeTruthy();
    expect(a.cookie).not.toBe(b.cookie);
  });

  it('rejects wrong passwords and disabled accounts with the same message', async () => {
    const wrong = await login('admin@test.lk', 'not-the-password');
    const disabled = await login('gone@test.lk');
    for (const r of [wrong.res, disabled.res]) {
      expect(r.statusCode).toBe(401);
      expect(r.json().error.message).toBe('errors.invalidCredentials');
    }
  });

  it('throttles an identifier after repeated failures, even with the right password', async () => {
    for (let i = 0; i < THROTTLE.maxFailuresPerIdentifier; i++) {
      expect((await login('teacher@test.lk', 'wrong-password-x')).res.statusCode).toBe(401);
    }
    const blocked = await login('teacher@test.lk');
    expect(blocked.res.statusCode).toBe(429);
    expect(blocked.cookie).toBeUndefined();
  });

  it('enforces permissions with a real session', async () => {
    const { cookie } = await login('teacher@test.lk');
    const audit = await app.inject({ method: 'GET', url: '/api/v1/audit-events', cookies: { [SESSION_COOKIE]: cookie! } });
    expect(audit.statusCode).toBe(403);
    const years = await app.inject({ method: 'GET', url: '/api/v1/academic-years', cookies: { [SESSION_COOKIE]: cookie! } });
    expect(years.statusCode).toBe(200);
  });

  it('invalidates existing sessions when an account is disabled', async () => {
    const { cookie } = await login('teacher@test.lk');
    await db.updateTable('users').set({ status: 'disabled' }).where('identifier', '=', 'teacher@test.lk').execute();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/session', cookies: { [SESSION_COOKIE]: cookie! } });
      expect(res.statusCode).toBe(401);
    } finally {
      await db.updateTable('users').set({ status: 'active' }).where('identifier', '=', 'teacher@test.lk').execute();
    }
  });

  it('audits logins without storing secrets', async () => {
    await login('admin@test.lk');
    const events = await db.selectFrom('audit_events').selectAll().where('action', 'like', 'auth.%').execute();
    expect(events.length).toBeGreaterThan(0);
    const dump = JSON.stringify(events);
    expect(dump).not.toContain(PASSWORD);
  });

  it('pages the audit log with the shared list shape', async () => {
    const { cookie } = await login('admin@test.lk');
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit-events?page=2&pageSize=1', cookies: { [SESSION_COOKIE]: cookie! } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ page: 2, pageSize: 1 });
    expect(body.total).toBeGreaterThan(1);
    expect(body.items).toHaveLength(1);
    expect(Object.keys(body.items[0]).sort()).toEqual(['action', 'actorUserId', 'createdAt', 'entityId', 'entityType', 'id']);
    expect(new Date(body.items[0].createdAt).toISOString()).toBe(body.items[0].createdAt);

    const tooBig = await app.inject({ method: 'GET', url: '/api/v1/audit-events?pageSize=1000', cookies: { [SESSION_COOKIE]: cookie! } });
    expect(tooBig.statusCode).toBe(422);
  });
});
