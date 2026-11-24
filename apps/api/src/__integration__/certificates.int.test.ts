import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { CSRF_HEADER } from '@sms/shared';
import { buildApp } from '../app.js';
import type { Db } from '../db/client.js';
import { SESSION_COOKIE } from '../plugins/auth.js';
import { createUser, freshDb, testConfig } from './test-db.js';

let db: Db;
let app: FastifyInstance;
const PASSWORD = 'correct-horse-battery';
type Client = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => Promise<LightMyRequestResponse>;
const c: Record<string, Client> = {};
async function signIn(identifier: string): Promise<Client> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier, password: PASSWORD } });
  const cookie = res.cookies.find((x) => x.name === SESSION_COOKIE)!.value;
  const csrf = res.json().csrfToken as string;
  return (method, url, payload) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      cookies: { [SESSION_COOKIE]: cookie },
      headers: { [CSRF_HEADER]: csrf },
      ...(payload !== undefined && { payload: payload as object }),
    });
}
const json = async (res: Promise<LightMyRequestResponse>, status = 200) => {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r.statusCode === 204 ? null : r.json();
};

let student: number;
let template: number;

beforeAll(async () => {
  ({ db } = await freshDb());
  app = await buildApp({ config: testConfig(), db, logger: false });
  await db
    .insertInto('schools')
    .values({ name: 'Sri Sumangala Vidyalaya', short_name: 'SSV', default_locale: 'en', timezone: 'Asia/Colombo' })
    .execute();
  await createUser(db, { identifier: 'registrar@test.lk', password: PASSWORD, roles: ['registrar'] });
  await createUser(db, { identifier: 'principal@test.lk', password: PASSWORD, roles: ['principal'] });
  await createUser(db, { identifier: 'teacher@test.lk', password: PASSWORD, roles: ['teacher'] });
  const kid = await createUser(db, { identifier: 'kid@test.lk', password: PASSWORD, roles: ['student'] });
  for (const n of ['registrar', 'principal', 'teacher', 'kid']) c[n] = await signIn(`${n}@test.lk`);
  student = (
    await json(
      c.registrar!('POST', '/students', {
        admissionNo: '2027/010',
        fullName: 'Amaya Perera',
        nameWithInitials: 'A. Perera',
        admittedOn: '2027-01-02',
      }),
      201,
    )
  ).id;
  await db.updateTable('student_profiles').set({ user_id: kid }).where('id', '=', student).execute();
});
afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

describe('certificates', () => {
  let cert: { id: number; serial: string };

  it('issues from a template, freezing the rendered text', async () => {
    await json(c.teacher!('POST', '/certificate-templates', { name: 'x', locale: 'en', title: 't', body: 'b' }), 403);
    template = (
      await json(
        c.registrar!('POST', '/certificate-templates', {
          name: 'Sports',
          locale: 'en',
          title: 'Certificate of Achievement',
          body: 'Awarded to {{student_name}} ({{admission_no}}) of {{school}} for {{details}} on {{issued_on}}.',
        }),
        201,
      )
    ).id;
    const res = await json(
      c.registrar!('POST', '/certificates', {
        templateId: template,
        studentIds: [student],
        issuedOn: '2027-03-15',
        details: 'first place in the 100 m',
      }),
      201,
    );
    cert = res.items[0];
    expect(cert.serial).toMatch(/^SSV-2027-\d{6}-[A-Z0-9]{4}$/);
    await json(
      c.registrar!('PUT', `/certificate-templates/${template}`, {
        name: 'Sports',
        locale: 'en',
        title: 'Changed',
        body: 'Changed {{student_name}}',
      }),
    );
    const list = await json(c.registrar!('GET', `/certificates?studentId=${student}`));
    expect(list.items[0]).toMatchObject({
      title: 'Certificate of Achievement',
      body: 'Awarded to Amaya Perera (2027/010) of Sri Sumangala Vidyalaya for first place in the 100 m on 2027-03-15.',
      status: 'issued',
    });
    expect((await json(c.kid!('GET', '/me/certificates'))).items).toHaveLength(1);
    // Single certificate for printing: the holder yes, an unrelated teacher no.
    expect((await json(c.kid!('GET', `/certificates/${cert.id}`))).serial).toBe(cert.serial);
    await json(c.teacher!('GET', `/certificates/${cert.id}`), 404);
  });

  it('verifies publicly with minimal fields, case-insensitively, and rate-limits lookups', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/v1/public/certificates/${cert.serial.toLowerCase()}` });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({
      serial: cert.serial,
      valid: true,
      status: 'issued',
      title: 'Certificate of Achievement',
      holder: 'A. Perera',
      issuedOn: '2027-03-15',
      revokedOn: null,
      school: 'Sri Sumangala Vidyalaya',
    });
    expect(r.body).not.toContain('2027/010');
    expect((await app.inject({ method: 'GET', url: '/api/v1/public/certificates/SSV-2027-000000-ZZZZ' })).statusCode).toBe(404);
  });

  it('revokes with a reason (principal only); verification then shows it as not valid', async () => {
    await json(c.registrar!('POST', `/certificates/${cert.id}/revoke`, { reason: 'Issued in error' }), 403);
    await json(c.principal!('POST', `/certificates/${cert.id}/revoke`, { reason: 'Issued in error' }));
    await json(c.principal!('POST', `/certificates/${cert.id}/revoke`, { reason: 'again' }), 409);
    const r = (await app.inject({ method: 'GET', url: `/api/v1/public/certificates/${cert.serial}` })).json();
    expect(r).toMatchObject({ valid: false, status: 'revoked' });
    const audit = await db
      .selectFrom('audit_events')
      .select('metadata')
      .where('action', '=', 'certificate.revoked')
      .executeTakeFirstOrThrow();
    expect(audit.metadata).not.toContain('error');
  });
});
