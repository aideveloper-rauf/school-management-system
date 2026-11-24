import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { CSRF_HEADER } from '@sms/shared';
import { buildApp } from '../app.js';
import type { Db } from '../db/client.js';
import { SESSION_COOKIE } from '../plugins/auth.js';
import { absenceNoticeHandler, noticeRunAfter } from '../modules/attendance/notify.js';
import { todayIn } from '../modules/people/common.js';
import type { OutgoingEmail } from '../mail/mailer.js';
import { createUser, freshDb, testConfig } from './test-db.js';

let db: Db;
let app: FastifyInstance;
const PASSWORD = 'correct-horse-battery';
type Client = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => Promise<LightMyRequestResponse>;
let admin: Client;
let registrar: Client;
let principal: Client;
let teacher: Client;
let otherTeacher: Client;

async function signIn(identifier: string): Promise<Client> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier, password: PASSWORD } });
  expect(res.statusCode, res.body).toBe(200);
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
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
const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const today = todayIn('Asia/Colombo');
const yesterday = shift(today, -1);
const twoDaysAgo = shift(today, -2);
let section: number;
let students: number[];

beforeAll(async () => {
  ({ db } = await freshDb());
  app = await buildApp({ config: testConfig(), db, logger: false });
  await db.insertInto('schools').values({ name: 'Test School', default_locale: 'en', timezone: 'Asia/Colombo' }).execute();
  await createUser(db, { identifier: 'admin@test.lk', password: PASSWORD, roles: ['school_admin'] });
  await createUser(db, { identifier: 'registrar@test.lk', password: PASSWORD, roles: ['registrar'] });
  await createUser(db, { identifier: 'principal@test.lk', password: PASSWORD, roles: ['principal'] });
  const teacherId = await createUser(db, { identifier: 'teacher@test.lk', password: PASSWORD, roles: ['teacher'] });
  await createUser(db, { identifier: 'teacher2@test.lk', password: PASSWORD, roles: ['teacher'] });
  admin = await signIn('admin@test.lk');
  registrar = await signIn('registrar@test.lk');
  principal = await signIn('principal@test.lk');
  teacher = await signIn('teacher@test.lk');
  otherTeacher = await signIn('teacher2@test.lk');

  const yearStart = shift(today, -120);
  const year = (
    await json(admin('POST', '/academic-years', { label: 'Y', startsOn: yearStart, endsOn: shift(today, 120), isCurrent: true }), 201)
  ).id;
  const grade = (await json(admin('POST', '/grades', { name: 'Grade 6', level: 6 }), 201)).id;
  section = (await json(admin('POST', '/class-sections', { academicYearId: year, gradeId: grade, name: 'A' }), 201)).id;
  const staff = (await json(admin('POST', '/staff', { staffNo: 'T1', fullName: 'Class Teacher', userId: teacherId }), 201)).id;
  await json(admin('PUT', `/class-sections/${section}/class-teacher`, { staffId: staff }));
  students = [];
  for (const [i, name] of ['Amal', 'Bimal', 'Chamari'].entries()) {
    students.push(
      (
        await json(
          registrar('POST', '/students', { admissionNo: `S${i}`, fullName: name, admittedOn: yearStart, classSectionId: section }),
          201,
        )
      ).id,
    );
  }
});
afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

describe('taking the register', () => {
  it('lists the class among my registers for today', async () => {
    const mine = await json(teacher('GET', '/me/attendance-registers'));
    expect(mine.items).toEqual([{ classSection: expect.objectContaining({ id: section }), taken: false, isClassTeacher: true }]);
    expect((await json(otherTeacher('GET', '/me/attendance-registers'))).items).toEqual([]);
  });

  it('saves today, queues a notice for each newly absent student, and stays editable today', async () => {
    const [a, b, c] = students as [number, number, number];
    await json(
      teacher('PUT', `/class-sections/${section}/attendance/${today}`, {
        records: [
          { studentId: a, status: 'present' },
          { studentId: b, status: 'absent' },
          { studentId: c, status: 'late' },
        ],
      }),
    );
    const reg = await json(teacher('GET', `/class-sections/${section}/attendance/${today}`));
    expect(reg.editable).toBe(true);
    expect(reg.students.map((s: { status: string }) => s.status)).toEqual(['present', 'absent', 'late']);
    const jobs = await db.selectFrom('jobs').select(['idempotency_key']).where('type', '=', 'attendance.absence_notice').execute();
    expect(jobs.map((j) => j.idempotency_key)).toEqual([`absence:${b}:${today}`]);

    // Saving again the same day is allowed and does not queue a second notice.
    await json(teacher('PUT', `/class-sections/${section}/attendance/${today}`, { records: [{ studentId: b, status: 'absent' }] }));
    expect(await db.selectFrom('jobs').select('id').where('type', '=', 'attendance.absence_notice').execute()).toHaveLength(1);
  });

  it('enforces scope, dates and the school calendar', async () => {
    const body = { records: [{ studentId: students[0], status: 'present' }] };
    expect((await otherTeacher('PUT', `/class-sections/${section}/attendance/${today}`, body)).statusCode).toBe(404);
    expect((await otherTeacher('GET', `/class-sections/${section}/attendance/${today}`)).statusCode).toBe(404);
    expect((await registrar('PUT', `/class-sections/${section}/attendance/${today}`, body)).statusCode).toBe(403);
    expect((await teacher('PUT', `/class-sections/${section}/attendance/${shift(today, 1)}`, body)).statusCode).toBe(422);
    expect((await teacher('PUT', `/class-sections/${section}/attendance/${shift(today, -400)}`, body)).statusCode).toBe(422);
    const stranger = (await json(registrar('POST', '/students', { admissionNo: 'X9', fullName: 'Not in class', admittedOn: today }), 201))
      .id;
    expect(
      (await teacher('PUT', `/class-sections/${section}/attendance/${today}`, { records: [{ studentId: stranger, status: 'present' }] }))
        .statusCode,
    ).toBe(422);

    await json(
      admin('POST', '/calendar-events', { title: 'Poya', kind: 'holiday', startsOn: twoDaysAgo, endsOn: twoDaysAgo, isSchoolDay: false }),
      201,
    );
    const closed = await principal('PUT', `/class-sections/${section}/attendance/${twoDaysAgo}`, body);
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error.message).toBe('errors.notSchoolDay');
  });

  it('locks past registers: teachers cannot back-fill; attendance.correct can catch up an untaken day', async () => {
    const body = { records: students.map((id) => ({ studentId: id, status: 'present' })) };
    const r = await teacher('PUT', `/class-sections/${section}/attendance/${yesterday}`, body);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.message).toBe('errors.attendanceLocked');
    await json(principal('PUT', `/class-sections/${section}/attendance/${yesterday}`, body));
    expect((await principal('PUT', `/class-sections/${section}/attendance/${yesterday}`, body)).statusCode).toBe(409);
    expect((await json(teacher('GET', `/class-sections/${section}/attendance/${yesterday}`))).editable).toBe(false);
  });
});

describe('corrections', () => {
  let correctionId: number;

  it('teacher requests a correction with a reason; the reason stays out of the audit log', async () => {
    const res = await json(
      teacher('POST', '/attendance/corrections', {
        classSectionId: section,
        date: yesterday,
        studentId: students[0],
        toStatus: 'excused',
        reason: 'Medical note from Dr Silva',
      }),
      201,
    );
    expect(res.status).toBe('pending');
    correctionId = res.id;
    expect(
      (
        await teacher('POST', '/attendance/corrections', {
          classSectionId: section,
          date: yesterday,
          studentId: students[0],
          toStatus: 'late',
          reason: 'x',
        })
      ).statusCode,
    ).toBe(409);
    const audit = await db
      .selectFrom('audit_events')
      .select('metadata')
      .where('action', '=', 'attendance.correction_requested')
      .executeTakeFirstOrThrow();
    expect(audit.metadata).not.toContain('Silva');
    const reg = await json(teacher('GET', `/class-sections/${section}/attendance/${yesterday}`));
    expect(reg.students[0]).toMatchObject({ status: 'present', correctionPending: true });
  });

  it('only attendance.correct can decide; approval updates the record once', async () => {
    expect((await teacher('POST', `/attendance/corrections/${correctionId}/decide`, { decision: 'approved' })).statusCode).toBe(403);
    const queue = await json(principal('GET', '/attendance/corrections?status=pending'));
    expect(queue.items[0]).toMatchObject({ id: correctionId, reason: 'Medical note from Dr Silva', toStatus: 'excused' });
    expect((await json(otherTeacher('GET', '/attendance/corrections'))).total).toBe(0);
    await json(principal('POST', `/attendance/corrections/${correctionId}/decide`, { decision: 'approved' }));
    expect((await principal('POST', `/attendance/corrections/${correctionId}/decide`, { decision: 'rejected' })).statusCode).toBe(409);
    const reg = await json(teacher('GET', `/class-sections/${section}/attendance/${yesterday}`));
    expect(reg.students[0]).toMatchObject({ status: 'excused', correctionPending: false });
  });

  it('a correction by an approver applies immediately and can queue an absence notice', async () => {
    const res = await json(
      principal('POST', '/attendance/corrections', {
        classSectionId: section,
        date: yesterday,
        studentId: students[2],
        toStatus: 'absent',
        reason: 'Left early',
      }),
      201,
    );
    expect(res.status).toBe('approved');
    const keys = (await db.selectFrom('jobs').select('idempotency_key').where('type', '=', 'attendance.absence_notice').execute()).map(
      (j) => j.idempotency_key,
    );
    expect(keys).toContain(`absence:${students[2]}:${yesterday}`);
  });

  it('summarises a date range per student', async () => {
    const s = await json(teacher('GET', `/class-sections/${section}/attendance?from=${shift(today, -7)}&to=${today}`));
    expect(s.daysTaken).toBe(2);
    expect(s.students[0]).toMatchObject({ present: 1, excused: 1, marked: 2, rate: 50 });
    expect(s.students[1]).toMatchObject({ absent: 1, present: 1, rate: 50 });
  });
});

describe('absence notices', () => {
  it('emails verified, opted-in guardians only while the student is still absent', async () => {
    const b = students[1]!;
    const sent: OutgoingEmail[] = [];
    const handler = absenceNoticeHandler({ mailer: { send: async (m) => void sent.push(m) } });
    const verified = (await json(registrar('POST', '/guardians', { fullName: 'Mother B', email: 'mother@example.lk' }), 201)).id;
    const pending = (await json(registrar('POST', '/guardians', { fullName: 'Uncle B', email: 'uncle@example.lk' }), 201)).id;
    const optedOut = (
      await json(registrar('POST', '/guardians', { fullName: 'Father B', email: 'father@example.lk', notifyEmail: false }), 201)
    ).id;
    for (const g of [verified, pending, optedOut])
      await json(registrar('POST', `/students/${b}/guardians`, { guardianId: g, relationship: 'guardian' }), 201);
    await json(registrar('POST', `/students/${b}/guardians/${verified}/verify`, { decision: 'verified', method: 'in_person' }));
    await json(registrar('POST', `/students/${b}/guardians/${optedOut}/verify`, { decision: 'verified', method: 'in_person' }));

    await handler({ studentId: b, date: today }, { db });
    expect(sent.map((m) => m.to)).toEqual(['mother@example.lk']);
    expect(sent[0]!.text).toContain('Bimal');
    expect(sent[0]!.text).toContain(today);

    sent.length = 0;
    await json(teacher('PUT', `/class-sections/${section}/attendance/${today}`, { records: [{ studentId: b, status: 'present' }] }));
    await handler({ studentId: b, date: today }, { db });
    expect(sent).toHaveLength(0);
  });

  it('never schedules notices inside quiet hours (school time)', () => {
    // 2027-03-01 21:10 in Colombo (UTC+5:30) = 15:40 UTC → next 07:00 local = 01:30 UTC next day.
    const evening = noticeRunAfter(new Date('2027-03-01T15:40:00Z'), 'Asia/Colombo');
    expect(evening.toISOString()).toBe('2027-03-02T01:30:00.000Z');
    // 10:00 local → 30 minutes later.
    expect(noticeRunAfter(new Date('2027-03-01T04:30:00Z'), 'Asia/Colombo').toISOString()).toBe('2027-03-01T05:00:00.000Z');
    // 05:00 local → 07:00 local.
    expect(noticeRunAfter(new Date('2027-02-28T23:30:00Z'), 'Asia/Colombo').toISOString()).toBe('2027-03-01T01:30:00.000Z');
  });
});
