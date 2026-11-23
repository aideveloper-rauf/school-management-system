import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { CSRF_HEADER } from '@sms/shared';
import { buildApp } from '../app.js';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../db/client.js';
import { buildJobHandlers } from '../jobs/handlers.js';
import { drainQueue } from '../jobs/queue.js';
import type { OutgoingEmail } from '../mail/mailer.js';
import { SESSION_COOKIE } from '../plugins/auth.js';
import { createUser, freshDb } from './test-db.js';

let db: Db;
let cfg: AppConfig;
let app: FastifyInstance;
const PASSWORD = 'correct-horse-battery';
const outbox: OutgoingEmail[] = [];

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
interface Session {
  cookie: string;
  csrf: string;
  call: (method: Method, url: string, payload?: unknown) => Promise<LightMyRequestResponse>;
}

const anon = (method: Method, url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, ...(payload !== undefined && { payload: payload as object }) });

async function login(identifier: string, password = PASSWORD): Promise<LightMyRequestResponse> {
  return anon('POST', '/auth/login', { identifier, password });
}

async function signIn(identifier: string, password = PASSWORD): Promise<Session> {
  const res = await login(identifier, password);
  expect(res.statusCode, res.body).toBe(200);
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
  const csrf = res.json().csrfToken as string;
  return {
    cookie,
    csrf,
    call: (method, url, payload) =>
      app.inject({
        method,
        url: `/api/v1${url}`,
        cookies: { [SESSION_COOKIE]: cookie },
        headers: { [CSRF_HEADER]: csrf },
        ...(payload !== undefined && { payload: payload as object }),
      }),
  };
}

/** Run the email job(s) like cron would, capturing messages. */
async function runJobs(): Promise<void> {
  await drainQueue(db, buildJobHandlers({ config: cfg, mailer: { send: async (m) => void outbox.push(m) } }), 10_000);
}
const tokenFrom = (m: OutgoingEmail) => /[?&]token=([A-Za-z0-9_-]+)/.exec(m.text)![1]!;
const lastEmailTo = (to: string) => [...outbox].reverse().find((m) => m.to === to);

let admin: Session;

beforeAll(async () => {
  ({ db, cfg } = await freshDb());
  app = await buildApp({ config: cfg, db, logger: false });
  await db.insertInto('schools').values({ name: 'Royal Test College', default_locale: 'en', timezone: 'Asia/Colombo' }).execute();
  await createUser(db, { identifier: 'admin@test.lk', password: PASSWORD, roles: ['school_admin'] });
  await createUser(db, { identifier: 'teacher@test.lk', password: PASSWORD, roles: ['teacher'] });
  admin = await signIn('admin@test.lk');
});
afterAll(async () => {
  await app?.close();
  await db?.destroy();
});
beforeEach(async () => {
  await db.deleteFrom('login_attempts').execute();
});

describe('listing and permissions', () => {
  it('hides user management from non-admins', async () => {
    const teacher = await signIn('teacher@test.lk');
    expect((await teacher.call('GET', '/users')).statusCode).toBe(403);
    expect((await teacher.call('POST', '/users', {})).statusCode).toBe(403);
    expect((await teacher.call('PUT', '/users/1/roles', { roles: ['school_admin'] })).statusCode).toBe(403);
  });

  it('lists with search, role filter and paging', async () => {
    const all = (await admin.call('GET', '/users?pageSize=1')).json();
    expect(all).toMatchObject({ page: 1, pageSize: 1, total: 2 });
    const teachers = (await admin.call('GET', '/users?role=teacher')).json();
    expect(teachers.items.map((u: { identifier: string }) => u.identifier)).toEqual(['teacher@test.lk']);
    expect(teachers.items[0].roles).toEqual(['teacher']);
    const search = (await admin.call('GET', '/users?q=ADMIN%40')).json();
    expect(search.total).toBe(1);
    // LIKE wildcards in the search are literal.
    expect((await admin.call('GET', '/users?q=%25')).json().total).toBe(0);
  });
});

describe('temporary password onboarding', () => {
  it('forces a password change before anything else', async () => {
    const created = await admin.call('POST', '/users', {
      onboarding: 'temporary_password',
      identifier: 'Student.001',
      displayName: 'Student One',
      roles: ['student'],
      temporaryPassword: 'temp-pass-1234',
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({ identifier: 'student.001', status: 'active', mustChangePassword: true, roles: ['student'] });
    await expect(
      admin
        .call('POST', '/users', {
          onboarding: 'temporary_password',
          identifier: 'student.001',
          displayName: 'X',
          temporaryPassword: 'temp-pass-1234',
        })
        .then((r) => r.statusCode),
    ).resolves.toBe(409);

    const student = await signIn('student.001', 'temp-pass-1234');
    expect((await student.call('GET', '/auth/session')).json().mustChangePassword).toBe(true);
    const blocked = await student.call('GET', '/school');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const wrong = await student.call('POST', '/auth/password', { currentPassword: 'nope-nope-nope', newPassword: 'my-own-password-1' });
    expect(wrong.statusCode).toBe(422);
    const same = await student.call('POST', '/auth/password', { currentPassword: 'temp-pass-1234', newPassword: 'temp-pass-1234' });
    expect(same.statusCode).toBe(422);
    const ok = await student.call('POST', '/auth/password', { currentPassword: 'temp-pass-1234', newPassword: 'my-own-password-1' });
    expect(ok.statusCode, ok.body).toBe(200);

    // This session keeps working; the old password does not.
    expect((await student.call('GET', '/auth/session')).json().mustChangePassword).toBe(false);
    expect((await student.call('GET', '/announcements-not-built')).statusCode).toBe(404);
    expect((await login('student.001', 'temp-pass-1234')).statusCode).toBe(401);
  });

  it('signs out other sessions when the password changes', async () => {
    const a = await signIn('teacher@test.lk');
    const b = await signIn('teacher@test.lk');
    expect((await a.call('POST', '/auth/password', { currentPassword: PASSWORD, newPassword: 'teacher-new-pass-1' })).statusCode).toBe(200);
    expect((await a.call('GET', '/auth/session')).statusCode).toBe(200);
    expect((await b.call('GET', '/auth/session')).statusCode).toBe(401);
    // Restore for later tests.
    expect((await a.call('POST', '/auth/password', { currentPassword: 'teacher-new-pass-1', newPassword: PASSWORD })).statusCode).toBe(200);
  });
});

describe('email invitations', () => {
  it('requires an email address', async () => {
    const r = await admin.call('POST', '/users', { onboarding: 'invite', identifier: 'no-email-user', displayName: 'X' });
    expect(r.statusCode).toBe(422);
  });

  it('invites, emails a single-use link and activates on accept', async () => {
    const created = await admin.call('POST', '/users', {
      onboarding: 'invite',
      identifier: 'New.Teacher@Test.lk',
      displayName: 'New Teacher',
      roles: ['teacher'],
    });
    expect(created.statusCode, created.body).toBe(201);
    const user = created.json();
    expect(user.status).toBe('invited');

    // Before the job runs there is no token at all, and the job payload holds only an id.
    const pending = await db.selectFrom('user_tokens').selectAll().where('user_id', '=', user.id).executeTakeFirstOrThrow();
    expect(pending.token_hash).toBeNull();
    const job = await db
      .selectFrom('jobs')
      .select('payload')
      .where('type', '=', 'user_token.send')
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    expect(Object.keys(payload)).toEqual(['tokenId']);

    expect((await login('new.teacher@test.lk')).statusCode).toBe(401); // not active yet
    await runJobs();
    const email = lastEmailTo('new.teacher@test.lk')!;
    expect(email.subject).toContain('Royal Test College');
    expect(email.text).toContain(`${cfg.APP_ORIGIN}/#/accept-invite?token=`);
    const token = tokenFrom(email);

    // Only the hash is stored anywhere.
    const dump = JSON.stringify([
      await db.selectFrom('user_tokens').selectAll().execute(),
      await db.selectFrom('jobs').selectAll().execute(),
    ]);
    expect(dump).not.toContain(token);

    expect((await anon('POST', '/auth/invitations/accept', { token, password: 'chosen-password-1' })).statusCode).toBe(200);
    const again = await anon('POST', '/auth/invitations/accept', { token, password: 'chosen-password-2' });
    expect(again.statusCode).toBe(400);
    expect(again.json().error.message).toBe('errors.invalidToken');
    expect((await login('new.teacher@test.lk', 'chosen-password-1')).statusCode).toBe(200);
    expect((await admin.call('GET', `/users/${user.id}`)).json().status).toBe('active');
  });

  it('accepts a link opened in a browser where someone is already signed in', async () => {
    const user = (
      await admin.call('POST', '/users', { onboarding: 'invite', identifier: 'shared.pc@test.lk', displayName: 'Shared' })
    ).json();
    await runJobs();
    const token = tokenFrom(lastEmailTo('shared.pc@test.lk')!);
    // The admin's session cookie is present, but no CSRF header (a fresh page load would not have one).
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invitations/accept',
      cookies: { [SESSION_COOKIE]: admin.cookie },
      payload: { token, password: 'chosen-password-1' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await admin.call('GET', `/users/${user.id}`)).json().status).toBe('active');
    // Cross-site posts are still refused by the Origin check.
    const evil = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      headers: { origin: 'https://evil.example' },
      payload: { identifier: 'shared.pc@test.lk' },
    });
    expect(evil.statusCode).toBe(403);
    // And session routes still need the CSRF header.
    const noCsrf = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', cookies: { [SESSION_COOKIE]: admin.cookie } });
    expect(noCsrf.json().error.code).toBe('CSRF_FAILED');
  });

  it('re-sending an invitation invalidates the previous link', async () => {
    const user = (await admin.call('POST', '/users', { onboarding: 'invite', identifier: 'late@test.lk', displayName: 'Late' })).json();
    await runJobs();
    const first = tokenFrom(lastEmailTo('late@test.lk')!);
    expect((await admin.call('POST', `/users/${user.id}/invitation`)).statusCode).toBe(202);
    await runJobs();
    const second = tokenFrom(lastEmailTo('late@test.lk')!);
    expect(second).not.toBe(first);
    expect((await anon('POST', '/auth/invitations/accept', { token: first, password: 'chosen-password-1' })).statusCode).toBe(400);
    expect((await anon('POST', '/auth/invitations/accept', { token: second, password: 'chosen-password-1' })).statusCode).toBe(200);
    expect((await admin.call('POST', `/users/${user.id}/invitation`)).statusCode).toBe(409); // already active
  });

  it('does not send if the account was disabled before the job ran', async () => {
    const user = (await admin.call('POST', '/users', { onboarding: 'invite', identifier: 'cancelled@test.lk', displayName: 'C' })).json();
    expect((await admin.call('POST', `/users/${user.id}/disable`)).statusCode).toBe(200);
    await runJobs();
    expect(lastEmailTo('cancelled@test.lk')).toBeUndefined();
    // Enabling restores "invited" (never had a password), not "active".
    expect((await admin.call('POST', `/users/${user.id}/enable`)).json().status).toBe('invited');
  });
});

describe('password reset', () => {
  it('answers the same way whether or not the account exists', async () => {
    const before = outbox.length;
    for (const identifier of ['nobody@test.lk', 'student.001', 'teacher@test.lk']) {
      const r = await anon('POST', '/auth/password-reset/request', { identifier });
      expect(r.statusCode).toBe(202);
      expect(r.json()).toEqual({ ok: true });
    }
    await runJobs();
    // Only the active email account gets a message (student.001 is a username).
    expect(outbox.slice(before).map((m) => m.to)).toEqual(['teacher@test.lk']);
  });

  it('resets once, signs out everywhere and rejects expired links', async () => {
    const teacher = await signIn('teacher@test.lk');
    await anon('POST', '/auth/password-reset/request', { identifier: 'Teacher@Test.lk' });
    await runJobs();
    const token = tokenFrom(lastEmailTo('teacher@test.lk')!);
    expect(lastEmailTo('teacher@test.lk')!.text).toContain('/#/reset-password?token=');

    expect((await anon('POST', '/auth/password-reset/confirm', { token, newPassword: 'short' })).statusCode).toBe(422);
    expect((await anon('POST', '/auth/password-reset/confirm', { token, newPassword: 'reset-password-1' })).statusCode).toBe(200);
    expect((await teacher.call('GET', '/auth/session')).statusCode).toBe(401);
    expect((await anon('POST', '/auth/password-reset/confirm', { token, newPassword: 'reset-password-2' })).statusCode).toBe(400);
    expect((await login('teacher@test.lk', 'reset-password-1')).statusCode).toBe(200);

    await anon('POST', '/auth/password-reset/request', { identifier: 'teacher@test.lk' });
    await runJobs();
    const stale = tokenFrom(lastEmailTo('teacher@test.lk')!);
    await db
      .updateTable('user_tokens')
      .set({ expires_at: sql<Date>`CURRENT_TIMESTAMP - INTERVAL 1 MINUTE` })
      .execute();
    expect((await anon('POST', '/auth/password-reset/confirm', { token: stale, newPassword: 'reset-password-3' })).statusCode).toBe(400);
    expect(
      (await anon('POST', '/auth/password-reset/confirm', { token: 'x'.repeat(43), newPassword: 'reset-password-3' })).statusCode,
    ).toBe(400);
  });

  it('caps reset emails per account per hour', async () => {
    const teacherId = (await db.selectFrom('users').select('id').where('identifier', '=', 'teacher@test.lk').executeTakeFirstOrThrow()).id;
    const count = async () =>
      Number(
        (
          await db
            .selectFrom('user_tokens')
            .select(db.fn.countAll<number>().as('n'))
            .where('user_id', '=', teacherId)
            .where('purpose', '=', 'reset')
            .where('created_at', '>', sql<Date>`CURRENT_TIMESTAMP - INTERVAL 1 HOUR`)
            .executeTakeFirstOrThrow()
        ).n,
      );
    // The earlier reset tests already made 3 requests for this account within the hour.
    expect(await count()).toBe(3);
    const emailsBefore = outbox.filter((m) => m.to === 'teacher@test.lk').length;
    for (let i = 0; i < 5; i++) {
      expect((await anon('POST', '/auth/password-reset/request', { identifier: 'teacher@test.lk' })).statusCode).toBe(202);
    }
    await runJobs();
    expect(await count()).toBe(3);
    expect(outbox.filter((m) => m.to === 'teacher@test.lk').length).toBe(emailsBefore);
  });
});

describe('roles, disable and temporary passwords', () => {
  it('grants and revokes roles with an audit entry per role', async () => {
    const id = (await db.selectFrom('users').select('id').where('identifier', '=', 'teacher@test.lk').executeTakeFirstOrThrow()).id;
    const r = await admin.call('PUT', `/users/${id}/roles`, { roles: ['teacher', 'academic_coordinator'] });
    expect(r.json().roles).toEqual(['academic_coordinator', 'teacher']);
    expect((await admin.call('PUT', `/users/${id}/roles`, { roles: ['teacher'] })).json().roles).toEqual(['teacher']);
    expect((await admin.call('PUT', `/users/${id}/roles`, { roles: ['superuser'] })).statusCode).toBe(422);
    const audit = await db
      .selectFrom('audit_events')
      .select(['action', 'metadata'])
      .where('entity_type', '=', 'user')
      .where('entity_id', '=', String(id))
      .where('action', 'like', 'role.%')
      .execute();
    expect(audit.map((a) => a.action)).toEqual(['role.granted', 'role.revoked']);
  });

  it('never leaves the school without an active administrator', async () => {
    const adminId = (await db.selectFrom('users').select('id').where('identifier', '=', 'admin@test.lk').executeTakeFirstOrThrow()).id;
    const r = await admin.call('PUT', `/users/${adminId}/roles`, { roles: [] });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.message).toBe('errors.lastAdmin');
    expect((await admin.call('POST', `/users/${adminId}/disable`)).json().error.message).toBe('errors.cannotDisableSelf');

    // With a second active admin, the first may step down.
    await createUser(db, { identifier: 'admin2@test.lk', password: PASSWORD, roles: ['school_admin'] });
    expect((await admin.call('PUT', `/users/${adminId}/roles`, { roles: ['principal', 'school_admin'] })).statusCode).toBe(200);
    const admin2 = await signIn('admin2@test.lk');
    expect((await admin2.call('PUT', `/users/${adminId}/roles`, { roles: ['principal'] })).statusCode).toBe(200);
    const admin2Id = (await db.selectFrom('users').select('id').where('identifier', '=', 'admin2@test.lk').executeTakeFirstOrThrow()).id;
    expect((await admin2.call('PUT', `/users/${admin2Id}/roles`, { roles: [] })).statusCode).toBe(409);
    // Restore the original admin for later tests.
    expect((await admin2.call('PUT', `/users/${adminId}/roles`, { roles: ['school_admin'] })).statusCode).toBe(200);
  });

  it('disables immediately and re-enables', async () => {
    const teacher = await signIn('teacher@test.lk', 'reset-password-1');
    const id = (await db.selectFrom('users').select('id').where('identifier', '=', 'teacher@test.lk').executeTakeFirstOrThrow()).id;
    expect((await admin.call('POST', `/users/${id}/disable`)).json().status).toBe('disabled');
    expect((await teacher.call('GET', '/auth/session')).statusCode).toBe(401);
    expect((await login('teacher@test.lk', 'reset-password-1')).statusCode).toBe(401);
    expect((await admin.call('POST', `/users/${id}/temporary-password`, { temporaryPassword: 'temp-pass-5678' })).statusCode).toBe(409);
    expect((await admin.call('POST', `/users/${id}/enable`)).json().status).toBe('active');
    expect((await login('teacher@test.lk', 'reset-password-1')).statusCode).toBe(200);
  });

  it('sets a temporary password that ends existing sessions', async () => {
    const teacher = await signIn('teacher@test.lk', 'reset-password-1');
    const id = (await db.selectFrom('users').select('id').where('identifier', '=', 'teacher@test.lk').executeTakeFirstOrThrow()).id;
    const r = await admin.call('POST', `/users/${id}/temporary-password`, { temporaryPassword: 'temp-pass-5678' });
    expect(r.json().mustChangePassword).toBe(true);
    expect((await teacher.call('GET', '/auth/session')).statusCode).toBe(401);
    expect((await login('teacher@test.lk', 'temp-pass-5678')).json().mustChangePassword).toBe(true);
    const self = await admin.call('POST', `/users/${(await admin.call('GET', '/auth/session')).json().user.id}/temporary-password`, {
      temporaryPassword: 'temp-pass-5678',
    });
    expect(self.statusCode).toBe(409);
  });

  it('updates profile fields and 404s unknown users', async () => {
    const id = (await db.selectFrom('users').select('id').where('identifier', '=', 'teacher@test.lk').executeTakeFirstOrThrow()).id;
    expect((await admin.call('PATCH', `/users/${id}`, { displayName: 'Ms. Perera', locale: 'si' })).json()).toMatchObject({
      displayName: 'Ms. Perera',
      locale: 'si',
    });
    expect((await admin.call('PATCH', '/users/999999', { displayName: 'X' })).statusCode).toBe(404);
    expect((await admin.call('GET', '/users/999999')).statusCode).toBe(404);
  });
});

describe('audit hygiene', () => {
  it('keeps passwords and tokens out of the audit log', async () => {
    const tokens = outbox.map(tokenFrom);
    const dump = JSON.stringify(await db.selectFrom('audit_events').selectAll().execute());
    for (const secret of [PASSWORD, 'temp-pass-1234', 'temp-pass-5678', 'reset-password-1', 'chosen-password-1', ...tokens]) {
      expect(dump).not.toContain(secret);
    }
    const actions = new Set((await db.selectFrom('audit_events').select('action').execute()).map((a) => a.action));
    for (const a of [
      'user.created',
      'user.updated',
      'user.disabled',
      'user.enabled',
      'user.invitation_sent',
      'user.invitation_accepted',
      'user.password_changed',
      'user.password_reset_requested',
      'user.password_reset',
      'user.temporary_password_set',
      'role.granted',
      'role.revoked',
    ]) {
      expect(actions, a).toContain(a);
    }
  });
});
