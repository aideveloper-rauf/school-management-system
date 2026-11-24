import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { CSRF_HEADER } from '@sms/shared';
import { buildApp } from '../app.js';
import type { Db } from '../db/client.js';
import { SESSION_COOKIE } from '../plugins/auth.js';
import { todayIn } from '../modules/people/common.js';
import { createUser, freshDb, testConfig } from './test-db.js';

let db: Db;
let app: FastifyInstance;
const PASSWORD = 'correct-horse-battery';
type Client = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => Promise<LightMyRequestResponse>;
const c: Record<string, Client> = {};
async function signIn(identifier: string, password = PASSWORD): Promise<Client> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier, password } });
  expect(res.statusCode, res.body).toBe(200);
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

const today = todayIn('Asia/Colombo');
let kid1: number;
let kid2: number;
let guardianA: number;
let guardianB: number;
let section: number;

beforeAll(async () => {
  ({ db } = await freshDb());
  app = await buildApp({ config: testConfig(), db, logger: false });
  await db.insertInto('schools').values({ name: 'Test School', default_locale: 'en', timezone: 'Asia/Colombo' }).execute();
  await createUser(db, { identifier: 'admin@test.lk', password: PASSWORD, roles: ['school_admin'] });
  await createUser(db, { identifier: 'registrar@test.lk', password: PASSWORD, roles: ['registrar'] });
  await createUser(db, { identifier: 'principal@test.lk', password: PASSWORD, roles: ['principal'] });
  for (const n of ['admin', 'registrar', 'principal']) c[n] = await signIn(`${n}@test.lk`);
  const y = Number(today.slice(0, 4));
  const year = (
    await json(
      c.admin!('POST', '/academic-years', { label: 'Y', startsOn: `${y - 1}-01-01`, endsOn: `${y + 1}-12-31`, isCurrent: true }),
      201,
    )
  ).id;
  const grade = (await json(c.admin!('POST', '/grades', { name: 'Grade 6', level: 6 }), 201)).id;
  section = (await json(c.admin!('POST', '/class-sections', { academicYearId: year, gradeId: grade, name: 'A' }), 201)).id;
  kid1 = (
    await json(
      c.registrar!('POST', '/students', { admissionNo: 'K1', fullName: 'Kid One', admittedOn: `${y - 1}-01-01`, classSectionId: section }),
      201,
    )
  ).id;
  kid2 = (
    await json(
      c.registrar!('POST', '/students', { admissionNo: 'K2', fullName: 'Kid Two', admittedOn: `${y - 1}-01-01`, classSectionId: section }),
      201,
    )
  ).id;
  guardianA = (await json(c.registrar!('POST', '/guardians', { fullName: 'Parent A', email: 'parent.a@example.lk' }), 201)).id;
  guardianB = (await json(c.registrar!('POST', '/guardians', { fullName: 'Parent B' }), 201)).id;
  await json(c.registrar!('POST', `/students/${kid1}/guardians`, { guardianId: guardianA, relationship: 'mother' }), 201);
  await json(c.registrar!('POST', `/students/${kid2}/guardians`, { guardianId: guardianB, relationship: 'father' }), 201);
  await json(
    c.principal!('PUT', `/class-sections/${section}/attendance/${today}`, {
      records: [
        { studentId: kid1, status: 'absent' },
        { studentId: kid2, status: 'present' },
      ],
    }),
  );
});
afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

describe('guardian onboarding', () => {
  it('invites only guardians with an email and a verified link, as guardian-only accounts', async () => {
    expect((await c.registrar!('POST', `/guardians/${guardianA}/invite`)).json().error.message).toBe('errors.guardianNotVerified');
    await json(c.registrar!('POST', `/students/${kid1}/guardians/${guardianA}/verify`, { decision: 'verified', method: 'in_person' }));
    await json(c.registrar!('POST', `/students/${kid2}/guardians/${guardianB}/verify`, { decision: 'verified', method: 'in_person' }));
    await json(c.registrar!('POST', `/guardians/${guardianB}/invite`), 422); // no email
    const { userId } = await json(c.registrar!('POST', `/guardians/${guardianA}/invite`), 201);
    await json(c.registrar!('POST', `/guardians/${guardianA}/invite`), 409); // already linked
    const user = await db.selectFrom('users').select(['identifier', 'status']).where('id', '=', userId).executeTakeFirstOrThrow();
    expect(user).toEqual({ identifier: 'parent.a@example.lk', status: 'invited' });
    const roles = await db.selectFrom('user_roles').select('role').where('user_id', '=', userId).execute();
    expect(roles.map((r) => r.role)).toEqual(['guardian']);
    const job = await db.selectFrom('jobs').select('type').where('type', '=', 'user_token.send').executeTakeFirst();
    expect(job).toBeDefined();
    // Make the account usable for the rest of the tests (as if the invitation was accepted).
    await createUser(db, { identifier: 'parent.b@test.lk', password: PASSWORD, roles: ['guardian'] }).then((id) =>
      db.updateTable('guardian_profiles').set({ user_id: id }).where('id', '=', guardianB).execute(),
    );
    await db.updateTable('users').set({ status: 'active' }).where('id', '=', userId).execute();
    const { hashPassword } = await import('../lib/password.js');
    await db
      .updateTable('users')
      .set({ password_hash: await hashPassword(PASSWORD) })
      .where('id', '=', userId)
      .execute();
    c.parentA = await signIn('parent.a@example.lk');
    c.parentB = await signIn('parent.b@test.lk');
  });

  it('creates student accounts with a temporary password', async () => {
    await json(c.registrar!('POST', `/students/${kid1}/account`, { identifier: 'kid.one', temporaryPassword: 'Temporary-pass-1' }), 201);
    await json(c.registrar!('POST', `/students/${kid1}/account`, { identifier: 'kid.one2', temporaryPassword: 'Temporary-pass-1' }), 409);
    await json(
      c.registrar!('POST', `/students/${kid2}/account`, { identifier: 'parent.a@example.lk', temporaryPassword: 'Temporary-pass-1' }),
      409,
    ); // taken
    await json(c.admin!('POST', `/students/${kid2}/account`, { identifier: 'kid.two', temporaryPassword: 'Temporary-pass-1' }), 403);
    const kid = await signIn('kid.one', 'Temporary-pass-1');
    expect((await kid('GET', '/me/attendance')).json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });
});

describe('family views never cross between families', () => {
  it('shows a guardian their own child only', async () => {
    const children = await json(c.parentA!('GET', '/me/children'));
    expect(children.items.map((x: { id: number }) => x.id)).toEqual([kid1]);
    const att = await json(c.parentA!('GET', `/me/attendance?studentId=${kid1}`));
    expect(att.items).toEqual([{ date: today, status: 'absent' }]);
    expect(att.summary.absent).toBe(1);
    await json(c.parentA!('GET', `/me/attendance?studentId=${kid2}`), 404);
    await json(c.parentB!('GET', `/me/attendance?studentId=${kid1}`), 404);
    await json(c.parentA!('GET', `/me/results?studentId=${kid2}`), 404);
    await json(c.parentA!('GET', `/me/timetable?studentId=${kid2}`), 404);
    expect((await json(c.parentA!('GET', `/me/timetable?studentId=${kid1}`))).kind).toBe('class');
    await json(c.parentA!('GET', `/students/${kid1}`), 403); // staff record views are not for families
  });

  it('stops access when a link is rejected', async () => {
    await json(c.registrar!('POST', `/students/${kid1}/guardians/${guardianA}/verify`, { decision: 'rejected' }));
    await json(c.parentA!('GET', `/me/attendance?studentId=${kid1}`), 404);
    expect((await json(c.parentA!('GET', '/me/children'))).items).toEqual([]);
  });
});
