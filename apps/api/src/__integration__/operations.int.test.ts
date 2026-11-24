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
const clients: Record<string, Client> = {};

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
const errorKey = async (res: Promise<LightMyRequestResponse>, status: number) => {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r.json().error.message as string;
};

let year: number;
let sec6A: number;
let sec6B: number;
let sec7A: number;
let grade6: number;
let maths: number;
let science: number;
let p1: number;
let p2: number;
let breakPeriod: number;
let roomA: number;
let ruwan: number;
let kumari: number;
let studentId: number;
let parentUser: number;
let studentUser: number;

beforeAll(async () => {
  ({ db } = await freshDb());
  app = await buildApp({ config: testConfig(), db, logger: false });
  await db.insertInto('schools').values({ name: 'Test School', default_locale: 'en', timezone: 'Asia/Colombo' }).execute();
  await createUser(db, { identifier: 'admin@test.lk', password: PASSWORD, roles: ['school_admin'] });
  await createUser(db, { identifier: 'registrar@test.lk', password: PASSWORD, roles: ['registrar'] });
  await createUser(db, { identifier: 'principal@test.lk', password: PASSWORD, roles: ['principal'] });
  const t1 = await createUser(db, { identifier: 'ruwan@test.lk', password: PASSWORD, roles: ['teacher'] });
  const t2 = await createUser(db, { identifier: 'kumari@test.lk', password: PASSWORD, roles: ['teacher'] });
  parentUser = await createUser(db, { identifier: 'parent@test.lk', password: PASSWORD, roles: ['guardian'] });
  studentUser = await createUser(db, { identifier: 'student@test.lk', password: PASSWORD, roles: ['student'] });
  await createUser(db, { identifier: 'otherparent@test.lk', password: PASSWORD, roles: ['guardian'] });
  for (const n of ['admin', 'registrar', 'principal', 'ruwan', 'kumari', 'parent', 'student', 'otherparent'])
    clients[n] = await signIn(`${n}@test.lk`);
  const { admin, registrar } = clients as Record<string, Client>;

  year = (await json(admin!('POST', '/academic-years', { label: 'Y', startsOn: '2020-01-01', endsOn: '2035-12-31', isCurrent: true }), 201))
    .id;
  grade6 = (await json(admin!('POST', '/grades', { name: 'Grade 6', level: 6 }), 201)).id;
  const grade7 = (await json(admin!('POST', '/grades', { name: 'Grade 7', level: 7 }), 201)).id;
  maths = (await json(admin!('POST', '/subjects', { code: 'MATH', name: 'Mathematics' }), 201)).id;
  science = (await json(admin!('POST', '/subjects', { code: 'SCI', name: 'Science' }), 201)).id;
  await json(admin!('PUT', `/grades/${grade6}/subjects`, { subjects: [{ subjectId: maths }, { subjectId: science }] }));
  await json(admin!('PUT', `/grades/${grade7}/subjects`, { subjects: [{ subjectId: maths }] }));
  sec6A = (await json(admin!('POST', '/class-sections', { academicYearId: year, gradeId: grade6, name: 'A' }), 201)).id;
  sec6B = (await json(admin!('POST', '/class-sections', { academicYearId: year, gradeId: grade6, name: 'B' }), 201)).id;
  sec7A = (await json(admin!('POST', '/class-sections', { academicYearId: year, gradeId: grade7, name: 'A' }), 201)).id;
  p1 = (await json(admin!('POST', '/periods', { label: 'P1', sequence: 1, startsAt: '07:50', endsAt: '08:30' }), 201)).id;
  p2 = (await json(admin!('POST', '/periods', { label: 'P2', sequence: 2, startsAt: '08:30', endsAt: '09:10' }), 201)).id;
  breakPeriod = (
    await json(admin!('POST', '/periods', { label: 'Interval', sequence: 3, startsAt: '10:30', endsAt: '10:50', isBreak: true }), 201)
  ).id;
  roomA = (await json(admin!('POST', '/rooms', { name: 'Lab' }), 201)).id;
  ruwan = (await json(admin!('POST', '/staff', { staffNo: 'T1', fullName: 'Ruwan', userId: t1 }), 201)).id;
  kumari = (await json(admin!('POST', '/staff', { staffNo: 'T2', fullName: 'Kumari', userId: t2 }), 201)).id;
  for (const [s, c, sub] of [
    [ruwan, sec6A, maths],
    [ruwan, sec6B, maths],
    [kumari, sec6A, science],
    [kumari, sec7A, maths],
  ] as const) {
    await json(admin!('POST', '/teacher-assignments', { staffId: s, classSectionId: c, subjectId: sub }), 201);
  }
  studentId = (
    await json(
      registrar!('POST', '/students', { admissionNo: 'S1', fullName: 'Nimal', admittedOn: '2020-01-01', classSectionId: sec6A }),
      201,
    )
  ).id;
  await db.updateTable('student_profiles').set({ user_id: studentUser }).where('id', '=', studentId).execute();
  const g = (await json(registrar!('POST', '/guardians', { fullName: 'Parent', userId: parentUser }), 201)).id;
  await json(registrar!('POST', `/students/${studentId}/guardians`, { guardianId: g, relationship: 'mother' }), 201);
  await json(registrar!('POST', `/students/${studentId}/guardians/${g}/verify`, { decision: 'verified', method: 'in_person' }));
});
afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

describe('timetable', () => {
  let entry: number;

  it('places lessons and refuses class, teacher and room clashes', async () => {
    const { admin } = clients as Record<string, Client>;
    entry = (
      await json(
        admin!('POST', '/timetable-entries', {
          classSectionId: sec6A,
          dayOfWeek: 1,
          periodId: p1,
          subjectId: maths,
          staffId: ruwan,
          roomId: roomA,
        }),
        201,
      )
    ).id;
    expect(
      await errorKey(admin!('POST', '/timetable-entries', { classSectionId: sec6A, dayOfWeek: 1, periodId: p1, subjectId: science }), 409),
    ).toBe('errors.timetableClassBusy');
    expect(
      await errorKey(
        admin!('POST', '/timetable-entries', { classSectionId: sec6B, dayOfWeek: 1, periodId: p1, subjectId: maths, staffId: ruwan }),
        409,
      ),
    ).toBe('errors.timetableTeacherBusy');
    expect(
      await errorKey(
        admin!('POST', '/timetable-entries', { classSectionId: sec7A, dayOfWeek: 1, periodId: p1, subjectId: maths, roomId: roomA }),
        409,
      ),
    ).toBe('errors.timetableRoomBusy');
    // Same teacher, other day: fine. Unassigned teacher / subject not taken / break: refused.
    await json(
      admin!('POST', '/timetable-entries', { classSectionId: sec6B, dayOfWeek: 2, periodId: p1, subjectId: maths, staffId: ruwan }),
      201,
    );
    await json(
      admin!('POST', '/timetable-entries', { classSectionId: sec6A, dayOfWeek: 1, periodId: p2, subjectId: science, staffId: ruwan }),
      422,
    );
    await json(admin!('POST', '/timetable-entries', { classSectionId: sec7A, dayOfWeek: 1, periodId: p2, subjectId: science }), 422);
    await json(admin!('POST', '/timetable-entries', { classSectionId: sec6A, dayOfWeek: 1, periodId: breakPeriod, subjectId: maths }), 422);
    await json(clients.ruwan!('POST', '/timetable-entries', { classSectionId: sec6A, dayOfWeek: 3, periodId: p1, subjectId: maths }), 403);
  });

  it('shows class, teacher and room views, and my week', async () => {
    const { ruwan: teacher, student, admin } = clients as Record<string, Client>;
    expect((await json(teacher!('GET', `/timetable?classSectionId=${sec6A}`))).items).toHaveLength(1);
    expect((await json(teacher!('GET', `/timetable?staffId=${ruwan}`))).items.map((e: { dayOfWeek: number }) => e.dayOfWeek)).toEqual([
      1, 2,
    ]);
    expect((await json(admin!('GET', `/timetable?roomId=${roomA}`))).items[0]).toMatchObject({
      subject: { code: 'MATH' },
      period: { startsAt: '07:50' },
    });
    await json(admin!('GET', '/timetable'), 422);
    expect(await json(teacher!('GET', '/me/timetable'))).toMatchObject({ kind: 'teacher' });
    const mine = await json(student!('GET', '/me/timetable'));
    expect(mine.kind).toBe('class');
    expect(mine.items[0]).toMatchObject({ classSection: { id: sec6A }, teacher: { fullName: 'Ruwan' } });
  });

  it('edits keep clash checks and the slot', async () => {
    const { admin } = clients as Record<string, Client>;
    // Kumari teaches 7A on Monday P1, so she cannot also take 6A then.
    const busy = (
      await json(
        admin!('POST', '/timetable-entries', { classSectionId: sec7A, dayOfWeek: 1, periodId: p1, subjectId: maths, staffId: kumari }),
        201,
      )
    ).id;
    expect(await errorKey(admin!('PATCH', `/timetable-entries/${entry}`, { subjectId: science, staffId: kumari }), 409)).toBe(
      'errors.timetableTeacherBusy',
    );
    await json(admin!('DELETE', `/timetable-entries/${busy}`), 204);
    await json(admin!('PATCH', `/timetable-entries/${entry}`, { subjectId: science, staffId: kumari }));
    expect((await json(admin!('GET', `/timetable?classSectionId=${sec6A}`))).items[0]).toMatchObject({
      subject: { id: science },
      teacher: { id: kumari },
      room: { id: roomA },
    });
    await json(admin!('DELETE', `/timetable-entries/${entry}`), 204);
  });
});

describe('announcements', () => {
  let schoolWide: number;
  let toGuardians6A: number;
  let toTeachers: number;
  let to7A: number;
  let draft: number;

  it('only publishers create; audience references are required', async () => {
    const { principal, ruwan: teacher } = clients as Record<string, Client>;
    await json(teacher!('POST', '/announcements', { title: 'x', body: 'y', audience: 'school' }), 403);
    await json(principal!('POST', '/announcements', { title: 'x', body: 'y', audience: 'class' }), 422);
    schoolWide = (
      await json(principal!('POST', '/announcements', { title: 'Sports day', body: 'Friday', audience: 'school', publish: true }), 201)
    ).id;
    toGuardians6A = (
      await json(
        principal!('POST', '/announcements', {
          title: 'PTA 6A',
          body: 'Meeting',
          audience: 'guardians_of_class',
          audienceClassSectionId: sec6A,
          publish: true,
        }),
        201,
      )
    ).id;
    toTeachers = (
      await json(
        principal!('POST', '/announcements', {
          title: 'Staff meeting',
          body: '2pm',
          audience: 'role',
          audienceRole: 'teacher',
          publish: true,
        }),
        201,
      )
    ).id;
    to7A = (
      await json(
        principal!('POST', '/announcements', {
          title: '7A trip',
          body: 'Bring lunch',
          audience: 'class',
          audienceClassSectionId: sec7A,
          publish: true,
        }),
        201,
      )
    ).id;
    draft = (await json(principal!('POST', '/announcements', { title: 'Draft', body: '...', audience: 'school' }), 201)).id;
  });

  it('targets each audience', async () => {
    const feed = async (who: string) => (await json(clients[who]!('GET', '/announcements'))).items.map((a: { id: number }) => a.id).sort();
    expect(await feed('parent')).toEqual([schoolWide, toGuardians6A].sort());
    expect(await feed('otherparent')).toEqual([schoolWide]); // no verified link
    expect(await feed('student')).toEqual([schoolWide]); // guardians-only notice is not for students
    expect(await feed('ruwan')).toEqual([schoolWide, toTeachers].sort());
    expect(await feed('kumari')).toEqual([schoolWide, toTeachers, to7A].sort()); // teaches 7A
    expect(await feed('principal')).toEqual([schoolWide, toGuardians6A, toTeachers, to7A].sort()); // publisher sees all published
    expect(await feed('principal')).not.toContain(draft);
  });

  it('tracks reads, and refuses marking an invisible notice as read', async () => {
    const { parent, principal } = clients as Record<string, Client>;
    expect((await json(parent!('GET', '/announcements'))).unread).toBe(2);
    await json(parent!('POST', `/announcements/${toGuardians6A}/read`));
    await json(parent!('POST', `/announcements/${toGuardians6A}/read`));
    expect((await json(parent!('GET', '/announcements'))).unread).toBe(1);
    await json(parent!('POST', `/announcements/${toTeachers}/read`), 404);
    const manage = await json(principal!('GET', '/announcements/manage'));
    expect(manage.items.find((a: { id: number }) => a.id === toGuardians6A).reads).toBe(1);
  });

  it('drafts can be edited and deleted; published ones only withdrawn', async () => {
    const { principal, parent } = clients as Record<string, Client>;
    await json(
      principal!('PUT', `/announcements/${draft}`, { title: 'Draft 2', body: 'Edited', audience: 'grade', audienceGradeId: grade6 }),
    );
    expect(
      await errorKey(principal!('PUT', `/announcements/${schoolWide}`, { title: 'Changed', body: 'x', audience: 'school' }), 409),
    ).toBe('errors.announcementPublished');
    await json(principal!('POST', `/announcements/${draft}/publish`));
    expect((await json(parent!('GET', '/announcements'))).items.map((a: { id: number }) => a.id)).toContain(draft); // grade 6 guardian
    await json(principal!('POST', `/announcements/${schoolWide}/withdraw`));
    expect((await json(parent!('GET', '/announcements'))).items.map((a: { id: number }) => a.id)).not.toContain(schoolWide);
    await json(principal!('DELETE', `/announcements/${schoolWide}`), 409);
    const d = (await json(principal!('POST', '/announcements', { title: 'Tmp', body: 'x', audience: 'school' }), 201)).id;
    await json(principal!('DELETE', `/announcements/${d}`), 204);
  });
});
