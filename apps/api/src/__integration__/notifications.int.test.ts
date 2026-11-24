import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { sql } from 'kysely';
import { CSRF_HEADER } from '@sms/shared';
import { buildApp } from '../app.js';
import type { Db } from '../db/client.js';
import { SESSION_COOKIE } from '../plugins/auth.js';
import { buildJobHandlers } from '../jobs/handlers.js';
import { drainQueue } from '../jobs/queue.js';
import type { OutgoingEmail } from '../mail/mailer.js';
import { todayIn } from '../modules/people/common.js';
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

const emails: OutgoingEmail[] = [];
const texts: Array<{ to: string; message: string }> = [];
const fakeMailer = { send: async (m: OutgoingEmail) => void emails.push(m) };
const fakeSms = { enabled: true, send: async (to: string, message: string) => void texts.push({ to, message }) };
let secA: number;
let secB: number;
let kidA: number;

beforeAll(async () => {
  ({ db } = await freshDb());
  app = await buildApp({ config: testConfig(), db, logger: false });
  await db.insertInto('schools').values({ name: 'SSV', default_locale: 'en', timezone: 'Asia/Colombo' }).execute();
  await createUser(db, { identifier: 'admin@test.lk', password: PASSWORD, roles: ['school_admin'] });
  await createUser(db, { identifier: 'registrar@test.lk', password: PASSWORD, roles: ['registrar'] });
  await createUser(db, { identifier: 'principal@test.lk', password: PASSWORD, roles: ['principal'] });
  for (const n of ['admin', 'registrar', 'principal']) c[n] = await signIn(`${n}@test.lk`);
  const y = Number(todayIn('Asia/Colombo').slice(0, 4));
  const year = (
    await json(
      c.admin!('POST', '/academic-years', { label: 'Y', startsOn: `${y - 1}-01-01`, endsOn: `${y + 1}-12-31`, isCurrent: true }),
      201,
    )
  ).id;
  const g = (await json(c.admin!('POST', '/grades', { name: 'Grade 6', level: 6 }), 201)).id;
  secA = (await json(c.admin!('POST', '/class-sections', { academicYearId: year, gradeId: g, name: 'A' }), 201)).id;
  secB = (await json(c.admin!('POST', '/class-sections', { academicYearId: year, gradeId: g, name: 'B' }), 201)).id;
  kidA = (
    await json(
      c.registrar!('POST', '/students', { admissionNo: 'A1', fullName: 'Kid A', admittedOn: `${y - 1}-01-01`, classSectionId: secA }),
      201,
    )
  ).id;
  const kidB = (
    await json(
      c.registrar!('POST', '/students', { admissionNo: 'B1', fullName: 'Kid B', admittedOn: `${y - 1}-01-01`, classSectionId: secB }),
      201,
    )
  ).id;
  const both = (
    await json(
      c.registrar!('POST', '/guardians', { fullName: 'Both Channels', email: 'both@example.lk', phone: '0771234567', notifySms: true }),
      201,
    )
  ).id;
  const emailOnly = (
    await json(c.registrar!('POST', '/guardians', { fullName: 'Email Only', email: 'email@example.lk', phone: '0779999999' }), 201)
  ).id;
  const unverified = (await json(c.registrar!('POST', '/guardians', { fullName: 'Pending', email: 'pending@example.lk' }), 201)).id;
  const otherClass = (await json(c.registrar!('POST', '/guardians', { fullName: 'Class B', email: 'b@example.lk' }), 201)).id;
  for (const [s, gid, verify] of [
    [kidA, both, true],
    [kidA, emailOnly, true],
    [kidA, unverified, false],
    [kidB, otherClass, true],
  ] as const) {
    await json(c.registrar!('POST', `/students/${s}/guardians`, { guardianId: gid, relationship: 'guardian' }), 201);
    if (verify) await json(c.registrar!('POST', `/students/${s}/guardians/${gid}/verify`, { decision: 'verified', method: 'in_person' }));
  }
});
afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

describe('announcement notifications', () => {
  it('reach verified guardians of the target class only, by their chosen channels, once', async () => {
    await json(
      c.principal!('POST', '/announcements', {
        title: 'Class A trip',
        body: 'Bring lunch.',
        audience: 'guardians_of_class',
        audienceClassSectionId: secA,
        notifyGuardians: true,
        publish: true,
      }),
      201,
    );
    // A notice without notifyGuardians queues nothing.
    await json(c.principal!('POST', '/announcements', { title: 'Quiet', body: 'x', audience: 'school', publish: true }), 201);
    const handlers = buildJobHandlers({ config: testConfig(), mailer: fakeMailer, sms: fakeSms });
    await drainQueue(db, handlers, 10_000);
    expect(emails.map((e) => e.to).sort()).toEqual(['both@example.lk', 'email@example.lk']);
    expect(emails[0]!.text).toContain('Bring lunch.');
    expect(texts).toEqual([{ to: '+94771234567', message: expect.stringContaining('Class A trip') }]);

    // Re-running the job sends nothing new.
    const job = await db.selectFrom('jobs').select('id').where('type', '=', 'announcement.notify').executeTakeFirstOrThrow();
    await db
      .updateTable('jobs')
      .set({ status: 'pending', run_after: sql<Date>`CURRENT_TIMESTAMP - INTERVAL 1 MINUTE` })
      .where('id', '=', job.id)
      .execute();
    await drainQueue(db, handlers, 10_000);
    expect(emails).toHaveLength(2);
    expect(texts).toHaveLength(1);
  });

  it('logs every attempt with a masked address and never the message', async () => {
    const log = await json(c.admin!('GET', '/ops/deliveries'));
    expect(log.items.map((d: { to: string }) => d.to).sort()).toEqual(['+9477*****67', 'b***@example.lk', 'e****@example.lk']);
    expect(JSON.stringify(log)).not.toContain('Bring lunch');
    expect(JSON.stringify(log)).not.toContain('both@example.lk');
    await json(c.registrar!('GET', '/ops/deliveries'), 403);
  });
});

describe('absence notices over SMS', () => {
  it('logs SMS as skipped when SMS is switched off', async () => {
    const today = todayIn('Asia/Colombo');
    await json(c.principal!('PUT', `/class-sections/${secA}/attendance/${today}`, { records: [{ studentId: kidA, status: 'absent' }] }));
    const handlers = buildJobHandlers({ config: testConfig(), mailer: fakeMailer }); // no SMS sender
    await db
      .updateTable('jobs')
      .set({ run_after: sql<Date>`CURRENT_TIMESTAMP - INTERVAL 1 MINUTE` })
      .where('type', '=', 'attendance.absence_notice')
      .execute();
    await drainQueue(db, handlers, 10_000);
    const rows = await db
      .selectFrom('notification_deliveries')
      .select(['channel', 'status', 'error'])
      .where('purpose', '=', 'absence_notice')
      .execute();
    expect(rows).toEqual(
      expect.arrayContaining([
        { channel: 'email', status: 'sent', error: null },
        { channel: 'sms', status: 'skipped', error: 'sms disabled' },
      ]),
    );
    const status = await json(c.admin!('GET', '/ops/status'));
    expect(status).toMatchObject({ smsTransport: 'none', deliveryFailures24h: 0 });
  });
});
