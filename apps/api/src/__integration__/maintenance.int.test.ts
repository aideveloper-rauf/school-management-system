import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CSRF_HEADER } from '@sms/shared';
import { buildApp } from '../app.js';
import type { Db } from '../db/client.js';
import { setMaintenance } from '../lib/maintenance.js';
import { SESSION_COOKIE } from '../plugins/auth.js';
import { createUser, freshDb, testConfig } from './test-db.js';

let db: Db;
let app: FastifyInstance;
const PASSWORD = 'correct-horse-battery';
async function signIn(identifier: string) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier, password: PASSWORD } });
  expect(res.statusCode, res.body).toBe(200);
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
  const csrf = res.json().csrfToken as string;
  return (url: string) =>
    app.inject({ method: 'GET', url: `/api/v1${url}`, cookies: { [SESSION_COOKIE]: cookie }, headers: { [CSRF_HEADER]: csrf } });
}

beforeAll(async () => {
  ({ db } = await freshDb());
  app = await buildApp({ config: testConfig(), db, logger: false });
  await db.insertInto('schools').values({ name: 'SSV', default_locale: 'en', timezone: 'Asia/Colombo' }).execute();
  await createUser(db, { identifier: 'admin@test.lk', password: PASSWORD, roles: ['school_admin'] });
  await createUser(db, { identifier: 'teacher@test.lk', password: PASSWORD, roles: ['teacher'] });
});
afterAll(async () => {
  await setMaintenance(db, null);
  await app?.close();
  await db?.destroy();
});

describe('maintenance mode', () => {
  it('returns 503 to normal requests but keeps health, sign-in and admin ops working', async () => {
    await setMaintenance(db, 'Updating to 0.2.0');
    expect((await app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
    const teacher = await signIn('teacher@test.lk'); // sign-in still works
    const r = await teacher('/academic-years');
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'errors.maintenance',
      details: [{ message: 'Updating to 0.2.0' }],
    });
    expect((await teacher('/auth/session')).statusCode).toBe(200);
    expect((await teacher('/ops/status')).statusCode).toBe(503); // no ops permission
    const admin = await signIn('admin@test.lk');
    expect((await admin('/ops/status')).statusCode).toBe(200);
    expect((await admin('/users')).statusCode).toBe(503);

    await setMaintenance(db, null);
    expect((await teacher('/academic-years')).statusCode).toBe(200);
  });
});
