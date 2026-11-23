import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { CSRF_HEADER } from '@sms/shared';
import { buildApp } from '../app.js';
import type { Db } from '../db/client.js';
import { SESSION_COOKIE } from '../plugins/auth.js';
import { createUser, freshDb } from './test-db.js';

let db: Db;
let app: FastifyInstance;
const PASSWORD = 'correct-horse-battery';
type Client = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => Promise<LightMyRequestResponse>;
let admin: Client;
let teacher: Client;

async function signIn(identifier: string): Promise<Client> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier, password: PASSWORD } });
  expect(res.statusCode).toBe(200);
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

const created = async (res: Promise<LightMyRequestResponse>) => {
  const r = await res;
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id as number;
};
const expectError = async (res: Promise<LightMyRequestResponse>, status: number, code?: string) => {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  if (code) expect(r.json().error.code).toBe(code);
  return r.json();
};

beforeAll(async () => {
  ({ db } = await freshDb());
  const { cfg } = { cfg: (await import('./test-db.js')).testConfig() };
  app = await buildApp({ config: cfg, db, logger: false });
  await createUser(db, { identifier: 'admin@test.lk', password: PASSWORD, roles: ['school_admin'] });
  await createUser(db, { identifier: 'teacher@test.lk', password: PASSWORD, roles: ['teacher'] });
  admin = await signIn('admin@test.lk');
  teacher = await signIn('teacher@test.lk');
});
afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

describe('authorization', () => {
  it('lets teachers read but not change the structure', async () => {
    expect((await teacher('GET', '/grades')).statusCode).toBe(200);
    await expectError(teacher('POST', '/grades', { name: 'Grade 1', level: 1 }), 403, 'FORBIDDEN');
    await expectError(teacher('POST', '/academic-years', { label: 'X', startsOn: '2027-01-01', endsOn: '2027-12-31' }), 403);
  });

  it('requires a session', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/class-sections' });
    expect(r.statusCode).toBe(401);
  });
});

describe('academic years and terms', () => {
  let year: number;

  it('creates a year and rejects duplicates and impossible dates', async () => {
    year = await created(admin('POST', '/academic-years', { label: '2027', startsOn: '2027-01-02', endsOn: '2027-12-10' }));
    await expectError(admin('POST', '/academic-years', { label: '2027', startsOn: '2027-01-02', endsOn: '2027-12-10' }), 409, 'CONFLICT');
    const bad = await expectError(admin('POST', '/academic-years', { label: 'Bad', startsOn: '2027-02-30', endsOn: '2027-12-10' }), 422);
    expect(bad.error.details[0].path).toBe('startsOn');
  });

  it('adds terms inside the year and rejects overlaps, out-of-range and duplicate sequence', async () => {
    await created(
      admin('POST', `/academic-years/${year}/terms`, { label: 'Term 1', sequence: 1, startsOn: '2027-01-02', endsOn: '2027-04-09' }),
    );
    const t2 = await created(
      admin('POST', `/academic-years/${year}/terms`, { label: 'Term 2', sequence: 2, startsOn: '2027-04-26', endsOn: '2027-08-06' }),
    );
    await expectError(
      admin('POST', `/academic-years/${year}/terms`, { label: 'Overlap', sequence: 3, startsOn: '2027-08-01', endsOn: '2027-09-01' }),
      422,
    );
    await expectError(
      admin('POST', `/academic-years/${year}/terms`, { label: 'Outside', sequence: 3, startsOn: '2027-09-01', endsOn: '2028-01-15' }),
      422,
    );
    await expectError(
      admin('POST', `/academic-years/${year}/terms`, { label: 'Dup seq', sequence: 2, startsOn: '2027-09-01', endsOn: '2027-12-01' }),
      409,
    );

    const patched = await admin('PATCH', `/terms/${t2}`, { endsOn: '2027-08-13' });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json().endsOn).toBe('2027-08-13');

    const list = (await admin('GET', `/academic-years/${year}/terms`)).json();
    expect(list.items.map((t: { label: string }) => t.label)).toEqual(['Term 1', 'Term 2']);
    await expectError(admin('GET', '/academic-years/999999/terms'), 404, 'NOT_FOUND');
  });

  it('will not shrink a year past its terms', async () => {
    await expectError(admin('PATCH', `/academic-years/${year}`, { endsOn: '2027-06-30' }), 422);
    const ok = await admin('PATCH', `/academic-years/${year}`, { label: '2027 (A/L)' });
    expect(ok.json().label).toBe('2027 (A/L)');
  });

  it('keeps exactly one current year', async () => {
    const other = await created(
      admin('POST', '/academic-years', { label: '2028', startsOn: '2028-01-03', endsOn: '2028-12-08', isCurrent: true }),
    );
    expect((await admin('POST', `/academic-years/${year}/current`)).statusCode).toBe(200);
    const years = (await admin('GET', '/academic-years')).json().items as Array<{ id: number; isCurrent: boolean }>;
    expect(years.filter((y) => y.isCurrent).map((y) => y.id)).toEqual([year]);

    // Unused year deletes; a year with terms does not.
    expect((await admin('DELETE', `/academic-years/${other}`)).statusCode).toBe(204);
    await expectError(admin('DELETE', `/academic-years/${year}`), 409, 'CONFLICT');
  });
});

describe('grades, subjects, rooms and class sections', () => {
  let year: number;
  let grade6: number;
  let grade7: number;
  let maths: number;
  let science: number;
  let room: number;

  beforeAll(async () => {
    year = await created(admin('POST', '/academic-years', { label: '2029', startsOn: '2029-01-02', endsOn: '2029-12-07' }));
  });

  it('manages grades and subjects with unique names/codes', async () => {
    grade6 = await created(admin('POST', '/grades', { name: 'Grade 6', level: 6 }));
    grade7 = await created(admin('POST', '/grades', { name: 'Grade 7', level: 7 }));
    await expectError(admin('POST', '/grades', { name: 'Grade 6 again', level: 6 }), 409, 'CONFLICT');

    maths = await created(admin('POST', '/subjects', { code: 'MATH', name: 'Mathematics', nameSi: 'ගණිතය', nameTa: 'கணிதம்' }));
    science = await created(admin('POST', '/subjects', { code: 'SCI', name: 'Science' }));
    await expectError(admin('POST', '/subjects', { code: 'MATH', name: 'Maths' }), 409, 'CONFLICT');

    const subjects = (await admin('GET', '/subjects')).json().items;
    expect(subjects.find((s: { code: string }) => s.code === 'MATH')).toMatchObject({ nameSi: 'ගණිතය', nameTa: 'கணிதம்', isActive: true });
  });

  it('sets the subjects a grade takes and protects subjects in use', async () => {
    const put = await admin('PUT', `/grades/${grade6}/subjects`, {
      subjects: [{ subjectId: maths }, { subjectId: science, isOptional: true }],
    });
    expect(put.statusCode, put.body).toBe(200);
    const list = (await admin('GET', `/grades/${grade6}/subjects`)).json().items;
    expect(list).toHaveLength(2);
    expect(list.find((i: { subject: { id: number } }) => i.subject.id === science).isOptional).toBe(true);

    await expectError(admin('PUT', `/grades/${grade6}/subjects`, { subjects: [{ subjectId: 424242 }] }), 422);
    await expectError(admin('PUT', `/grades/${grade6}/subjects`, { subjects: [{ subjectId: maths }, { subjectId: maths }] }), 422);
    await expectError(admin('DELETE', `/subjects/${maths}`), 409, 'CONFLICT');
  });

  it('creates class sections per year and grade', async () => {
    room = await created(admin('POST', '/rooms', { name: 'Room 12', capacity: 40 }));
    const a = await created(
      admin('POST', '/class-sections', { academicYearId: year, gradeId: grade6, name: 'A', medium: 'si', homeRoomId: room }),
    );
    await created(admin('POST', '/class-sections', { academicYearId: year, gradeId: grade6, name: 'B', medium: 'ta' }));
    await expectError(admin('POST', '/class-sections', { academicYearId: year, gradeId: grade6, name: 'A' }), 409, 'CONFLICT');
    await expectError(admin('POST', '/class-sections', { academicYearId: year, gradeId: 999999, name: 'C' }), 422);

    const one = (await admin('GET', `/class-sections/${a}`)).json();
    expect(one).toMatchObject({ name: 'A', medium: 'si', grade: { id: grade6, level: 6 }, homeRoom: { id: room, name: 'Room 12' } });

    const filtered = (await admin('GET', `/class-sections?academicYearId=${year}&gradeId=${grade6}`)).json().items;
    expect(filtered.map((c: { name: string }) => c.name)).toEqual(['A', 'B']);

    // Deactivated grades cannot get new sections.
    expect((await admin('PATCH', `/grades/${grade7}`, { isActive: false })).statusCode).toBe(200);
    await expectError(admin('POST', '/class-sections', { academicYearId: year, gradeId: grade7, name: 'A' }), 422);

    // Grade with sections cannot be deleted; deleting a room clears the home room.
    await expectError(admin('DELETE', `/grades/${grade6}`), 409, 'CONFLICT');
    expect((await admin('DELETE', `/rooms/${room}`)).statusCode).toBe(204);
    expect((await admin('GET', `/class-sections/${a}`)).json().homeRoom).toBeNull();
  });

  it('deletes an unused grade together with its subject list', async () => {
    const g = await created(admin('POST', '/grades', { name: 'Grade 8', level: 8 }));
    await admin('PUT', `/grades/${g}/subjects`, { subjects: [{ subjectId: science }] });
    expect((await admin('DELETE', `/grades/${g}`)).statusCode).toBe(204);
    await expectError(admin('GET', `/grades/${g}/subjects`), 404);
  });
});

describe('bell schedule and calendar', () => {
  it('normalises times and rejects overlapping periods', async () => {
    const p1 = await created(admin('POST', '/periods', { label: 'Period 1', sequence: 1, startsAt: '07:50', endsAt: '08:30' }));
    await created(admin('POST', '/periods', { label: 'Interval', sequence: 2, startsAt: '10:30', endsAt: '10:50', isBreak: true }));
    await expectError(admin('POST', '/periods', { label: 'Clash', sequence: 3, startsAt: '08:15', endsAt: '09:00' }), 422);
    await expectError(admin('POST', '/periods', { label: 'Dup', sequence: 1, startsAt: '11:00', endsAt: '11:40' }), 409);
    await expectError(admin('POST', '/periods', { label: 'Bad', sequence: 4, startsAt: '25:00', endsAt: '26:00' }), 422);

    const list = (await admin('GET', '/periods')).json().items;
    expect(list[0]).toMatchObject({ id: p1, startsAt: '07:50', endsAt: '08:30', isBreak: false });
    expect(list[1].isBreak).toBe(true);
  });

  it('keeps year-bound events inside their year and filters by date range', async () => {
    const year = await created(admin('POST', '/academic-years', { label: '2030', startsOn: '2030-01-02', endsOn: '2030-12-06' }));
    await created(
      admin('POST', '/calendar-events', {
        academicYearId: year,
        title: 'Sinhala & Tamil New Year',
        kind: 'holiday',
        startsOn: '2030-04-13',
        endsOn: '2030-04-14',
        isSchoolDay: false,
      }),
    );
    await created(
      admin('POST', '/calendar-events', {
        title: 'Sports meet',
        kind: 'event',
        startsOn: '2030-02-20',
        endsOn: '2030-02-20',
        isSchoolDay: true,
      }),
    );
    await expectError(
      admin('POST', '/calendar-events', {
        academicYearId: year,
        title: 'Outside',
        kind: 'event',
        startsOn: '2031-01-10',
        endsOn: '2031-01-10',
        isSchoolDay: true,
      }),
      422,
    );
    await expectError(
      admin('POST', '/calendar-events', {
        title: 'Backwards',
        kind: 'event',
        startsOn: '2030-03-02',
        endsOn: '2030-03-01',
        isSchoolDay: true,
      }),
      422,
    );

    const april = (await admin('GET', '/calendar-events?from=2030-04-01&to=2030-04-30')).json().items;
    expect(april.map((e: { title: string }) => e.title)).toEqual(['Sinhala & Tamil New Year']);
    expect(april[0].isSchoolDay).toBe(false);
  });
});

describe('audit trail', () => {
  it('records every structure change with the actor and field names only', async () => {
    const events = await db
      .selectFrom('audit_events as a')
      .innerJoin('users as u', 'u.id', 'a.actor_user_id')
      .select(['a.action', 'a.metadata', 'u.identifier'])
      .where('a.action', 'not like', 'auth.%')
      .execute();
    const actions = new Set(events.map((e) => e.action));
    for (const a of [
      'academic_year.created',
      'academic_year.updated',
      'academic_year.set_current',
      'academic_year.deleted',
      'term.created',
      'term.updated',
      'grade.created',
      'grade.updated',
      'grade.subjects_set',
      'grade.deleted',
      'subject.created',
      'room.created',
      'room.deleted',
      'class_section.created',
      'period.created',
      'calendar_event.created',
    ]) {
      expect(actions, a).toContain(a);
    }
    expect(events.every((e) => e.identifier === 'admin@test.lk')).toBe(true);
    const yearUpdate = events.find((e) => e.action === 'academic_year.updated')!;
    const meta = typeof yearUpdate.metadata === 'string' ? JSON.parse(yearUpdate.metadata) : yearUpdate.metadata;
    expect(meta).toEqual({ fields: ['label'] });
  });

  it('does not audit rejected writes', async () => {
    const before = await db.selectFrom('audit_events').select(db.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    await expectError(admin('POST', '/grades', { name: 'Grade 6', level: 19 }), 409);
    const after = await db.selectFrom('audit_events').select(db.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    expect(Number(after.n)).toBe(Number(before.n));
  });
});
