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
let admin: Client;
let registrar: Client;
let principal: Client;
let teacher: Client;
let otherTeacher: Client;
let parent: Client;
let teacherUserId: number;
let parentUserId: number;

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
const created = async (res: Promise<LightMyRequestResponse>) => {
  const r = await res;
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id as number;
};
const ok = async (res: Promise<LightMyRequestResponse>) => {
  const r = await res;
  expect(r.statusCode, r.body).toBeLessThan(300);
  return r.statusCode === 204 ? null : r.json();
};
const expectError = async (res: Promise<LightMyRequestResponse>, status: number, code?: string) => {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  if (code) expect(r.json().error.code).toBe(code);
  return r.json();
};

// Fixtures
let year: number;
let nextYear: number;
let grade6: number;
let grade7: number;
let maths: number;
let sec6A: number;
let sec6B: number;
let sec7A: number;

beforeAll(async () => {
  ({ db } = await freshDb());
  app = await buildApp({ config: testConfig(), db, logger: false });
  await createUser(db, { identifier: 'admin@test.lk', password: PASSWORD, roles: ['school_admin'] });
  await createUser(db, { identifier: 'registrar@test.lk', password: PASSWORD, roles: ['registrar'] });
  await createUser(db, { identifier: 'principal@test.lk', password: PASSWORD, roles: ['principal'] });
  teacherUserId = await createUser(db, { identifier: 'teacher@test.lk', password: PASSWORD, roles: ['teacher'] });
  await createUser(db, { identifier: 'teacher2@test.lk', password: PASSWORD, roles: ['teacher'] });
  parentUserId = await createUser(db, { identifier: 'parent@test.lk', password: PASSWORD, roles: ['guardian'] });
  admin = await signIn('admin@test.lk');
  registrar = await signIn('registrar@test.lk');
  principal = await signIn('principal@test.lk');
  teacher = await signIn('teacher@test.lk');
  otherTeacher = await signIn('teacher2@test.lk');
  parent = await signIn('parent@test.lk');

  year = await created(admin('POST', '/academic-years', { label: '2027', startsOn: '2027-01-02', endsOn: '2027-12-10', isCurrent: true }));
  nextYear = await created(admin('POST', '/academic-years', { label: '2028', startsOn: '2028-01-03', endsOn: '2028-12-08' }));
  grade6 = await created(admin('POST', '/grades', { name: 'Grade 6', level: 6 }));
  grade7 = await created(admin('POST', '/grades', { name: 'Grade 7', level: 7 }));
  maths = await created(admin('POST', '/subjects', { code: 'MATH', name: 'Mathematics' }));
  await ok(admin('PUT', `/grades/${grade6}/subjects`, { subjects: [{ subjectId: maths }] }));
  sec6A = await created(admin('POST', '/class-sections', { academicYearId: year, gradeId: grade6, name: 'A' }));
  sec6B = await created(admin('POST', '/class-sections', { academicYearId: year, gradeId: grade6, name: 'B' }));
  sec7A = await created(admin('POST', '/class-sections', { academicYearId: nextYear, gradeId: grade7, name: 'A' }));
});
afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

describe('students and enrolment', () => {
  let amal: number;
  let nimali: number;

  it('lets only students.manage create students; rejects duplicates', async () => {
    await expectError(admin('POST', '/students', { admissionNo: 'X1', fullName: 'X', admittedOn: '2027-01-02' }), 403);
    amal = await created(
      registrar('POST', '/students', { admissionNo: '2027/001', fullName: 'Amal Perera', admittedOn: '2026-12-01', classSectionId: sec6A }),
    );
    nimali = await created(
      registrar('POST', '/students', { admissionNo: '2027/002', fullName: 'Nimali Silva', admittedOn: '2027-02-01', gender: 'female' }),
    );
    await expectError(
      registrar('POST', '/students', { admissionNo: '2027/001', fullName: 'Dup', admittedOn: '2027-01-02' }),
      409,
      'CONFLICT',
    );
    await expectError(registrar('POST', '/students', { admissionNo: 'bad no!', fullName: 'X', admittedOn: '2027-01-02' }), 422);
  });

  it('starts an enrolment at the year start when admitted earlier, and lists by class', async () => {
    const detail = await ok(registrar('GET', `/students/${amal}`));
    expect(detail.currentClass).toMatchObject({ id: sec6A, name: 'A', grade: { id: grade6 } });
    expect(detail.enrollments[0]).toMatchObject({ startsOn: '2027-01-02', endsOn: null });
    expect(detail.statusHistory[0]).toMatchObject({ toStatus: 'active', reason: 'admitted' });

    const list = await ok(registrar('GET', `/students?classSectionId=${sec6A}`));
    expect(list.items.map((s: { id: number }) => s.id)).toEqual([amal]);
    const unenrolled = await ok(registrar('GET', '/students?unenrolled=true'));
    expect(unenrolled.items.map((s: { id: number }) => s.id)).toEqual([nimali]);
    const search = await ok(registrar('GET', '/students?q=silva'));
    expect(search.total).toBe(1);
  });

  it('moves between sections keeping history, and refuses impossible dates', async () => {
    await expectError(
      registrar('POST', `/students/${amal}/enrollments`, { classSectionId: sec6A, startsOn: '2027-03-01' }),
      409,
      'CONFLICT',
    );
    await expectError(registrar('POST', `/students/${amal}/enrollments`, { classSectionId: sec6B, startsOn: '2026-03-01' }), 422);
    await created(registrar('POST', `/students/${amal}/enrollments`, { classSectionId: sec6B, startsOn: '2027-03-01', rollNo: 4 }));
    const detail = await ok(registrar('GET', `/students/${amal}`));
    expect(detail.currentClass).toMatchObject({ id: sec6B, rollNo: 4 });
    expect(detail.enrollments).toHaveLength(2);
    expect(detail.enrollments[1]).toMatchObject({ endsOn: '2027-02-28', endReason: 'section_change' });
    await created(registrar('POST', `/students/${nimali}/enrollments`, { classSectionId: sec6A, startsOn: '2027-02-01' }));
  });

  it('records leaving with a reason code (note stays out of the audit log) and re-admission', async () => {
    const other = await created(
      registrar('POST', '/students', { admissionNo: '2027/003', fullName: 'Kamal', admittedOn: '2027-01-05', classSectionId: sec6A }),
    );
    await ok(
      registrar('POST', `/students/${other}/leave`, {
        status: 'transferred',
        effectiveOn: '2027-05-31',
        reason: 'transfer',
        note: 'Moved to Kandy',
      }),
    );
    await expectError(registrar('POST', `/students/${other}/enrollments`, { classSectionId: sec6B, startsOn: '2027-06-02' }), 409);
    const detail = await ok(registrar('GET', `/students/${other}`));
    expect(detail).toMatchObject({ status: 'transferred', leftOn: '2027-05-31', currentClass: null });
    expect(detail.enrollments[0]).toMatchObject({ endsOn: '2027-05-31', endReason: 'left' });
    expect(detail.statusHistory[0]).toMatchObject({ toStatus: 'transferred', reason: 'transfer', note: 'Moved to Kandy' });
    const audit = await db.selectFrom('audit_events').select('metadata').where('action', '=', 'student.left').executeTakeFirstOrThrow();
    expect(audit.metadata).not.toContain('Kandy');

    await ok(registrar('POST', `/students/${other}/readmit`, { effectiveOn: '2027-07-01' }));
    await expectError(registrar('POST', `/students/${other}/readmit`, { effectiveOn: '2027-07-02' }), 409);
    await created(registrar('POST', `/students/${other}/enrollments`, { classSectionId: sec6A, startsOn: '2027-07-01' }));
  });

  it('promotes a whole section into the next year, leaving excluded students behind', async () => {
    const r = await ok(
      registrar('POST', '/enrollments/promote', {
        fromClassSectionId: sec6A,
        toClassSectionId: sec7A,
        startsOn: '2028-01-03',
        excludeStudentIds: [nimali],
      }),
    );
    expect(r).toEqual({ moved: 1, kept: 1 }); // Kamal moves; Nimali is excluded (repeating)
    const roster = await ok(principal('GET', `/class-sections/${sec7A}/students`));
    expect(roster.items.map((s: { fullName: string }) => s.fullName)).toEqual(['Kamal']);
    const kamal = await ok(registrar('GET', `/students/${roster.items[0].id}`));
    // The old enrolment closes on the last day of its own year, not the day before the new one.
    expect(kamal.enrollments[1]).toMatchObject({ endsOn: '2027-12-10', endReason: 'promoted' });
  });

  it('audits profile views', async () => {
    const views = await db.selectFrom('audit_events').select('id').where('action', '=', 'student.viewed').execute();
    expect(views.length).toBeGreaterThan(0);
  });
});

describe('staff, assignments and teacher scope', () => {
  let staffId: number;
  let scoped: number;
  let unscoped: number;

  it('creates staff linked to an account; one profile per account', async () => {
    staffId = await created(
      admin('POST', '/staff', { staffNo: 'T-01', fullName: 'Ruwan Teacher', userId: teacherUserId, workEmail: 'Ruwan@School.lk' }),
    );
    await expectError(admin('POST', '/staff', { staffNo: 'T-02', fullName: 'Other', userId: teacherUserId }), 409, 'CONFLICT');
    await expectError(registrar('POST', '/staff', { staffNo: 'T-03', fullName: 'Nope' }), 403);
    const s = await ok(admin('GET', `/staff/${staffId}`));
    expect(s).toMatchObject({ staffNo: 'T-01', workEmail: 'ruwan@school.lk', account: { id: teacherUserId } });
  });

  it('assigns subjects only for subjects the grade takes', async () => {
    const english = await created(admin('POST', '/subjects', { code: 'ENG', name: 'English' }));
    await expectError(admin('POST', '/teacher-assignments', { staffId, classSectionId: sec6B, subjectId: english }), 422);
    await created(admin('POST', '/teacher-assignments', { staffId, classSectionId: sec6B, subjectId: maths }));
    await expectError(admin('POST', '/teacher-assignments', { staffId, classSectionId: sec6B, subjectId: maths }), 409);
    const mine = await ok(teacher('GET', '/me/teaching'));
    expect(mine.assignments).toHaveLength(1);
  });

  it('teachers see only students currently in classes they teach (others are NOT_FOUND)', async () => {
    const list = await ok(teacher('GET', '/students'));
    const ids = list.items.map((s: { id: number }) => s.id);
    expect(list.items.every((s: { currentClass: { id: number } }) => s.currentClass.id === sec6B)).toBe(true);
    scoped = ids[0];
    const all = await ok(principal('GET', '/students?pageSize=100'));
    unscoped = all.items.find((s: { id: number }) => !ids.includes(s.id)).id;

    await ok(teacher('GET', `/students/${scoped}`));
    await expectError(teacher('GET', `/students/${unscoped}`), 404, 'NOT_FOUND');
    await expectError(otherTeacher('GET', `/students/${scoped}`), 404, 'NOT_FOUND');
    expect((await ok(otherTeacher('GET', '/students'))).total).toBe(0);
    await ok(teacher('GET', `/class-sections/${sec6B}/students`));
    await expectError(teacher('GET', `/class-sections/${sec6A}/students`), 404);
    // Teachers never see guardians or status history.
    const d = await ok(teacher('GET', `/students/${scoped}`));
    expect(d.guardians).toBeNull();
    expect(d.statusHistory).toEqual([]);
  });

  it('class teacher gains scope over that class', async () => {
    await ok(admin('PUT', `/class-sections/${sec6A}/class-teacher`, { staffId }));
    await ok(teacher('GET', `/class-sections/${sec6A}/students`));
    const sec = await ok(admin('GET', `/class-sections/${sec6A}`));
    expect(sec.classTeacher).toMatchObject({ id: staffId, fullName: 'Ruwan Teacher' });
    await ok(admin('PUT', `/class-sections/${sec6A}/class-teacher`, { staffId: null }));
    await expectError(teacher('GET', `/class-sections/${sec6A}/students`), 404);
  });
});

describe('guardians and verified links', () => {
  it('only verified links count; registrar manages and verifies', async () => {
    const student = (await ok(registrar('GET', '/students?q=2027/002'))).items[0].id as number;
    const g = await created(registrar('POST', '/guardians', { fullName: 'Sunil Silva', phone: '+94 77 123 4567', userId: parentUserId }));
    await expectError(teacher('POST', '/guardians', { fullName: 'X' }), 403);
    await created(registrar('POST', `/students/${student}/guardians`, { guardianId: g, relationship: 'father', isPrimary: true }));
    await expectError(registrar('POST', `/students/${student}/guardians`, { guardianId: g, relationship: 'father' }), 409);

    const queue = await ok(registrar('GET', '/guardian-links'));
    expect(queue.items[0]).toMatchObject({
      student: { id: student },
      guardian: { id: g, hasAccount: true },
      verificationStatus: 'pending',
    });

    // Pending link: the guardian account has no access through scope.
    const { studentScope } = await import('../modules/people/scope.js');
    const fakeAuth = { user: { id: parentUserId }, permissions: new Set() } as unknown as Parameters<typeof studentScope>[1];
    const visible = () => db.selectFrom('student_profiles as s').select('s.id').where(studentScope(db, fakeAuth)!).execute();
    expect(await visible()).toEqual([]);

    await ok(registrar('POST', `/students/${student}/guardians/${g}/verify`, { decision: 'verified', method: 'in_person' }));
    expect((await visible()).map((r) => r.id)).toEqual([student]);
    const d = await ok(registrar('GET', `/students/${student}`));
    expect(d.guardians[0]).toMatchObject({ id: g, relationship: 'father', isPrimary: true, verificationStatus: 'verified' });

    await ok(registrar('POST', `/students/${student}/guardians/${g}/verify`, { decision: 'rejected' }));
    expect(await visible()).toEqual([]);
    await expectError(registrar('DELETE', `/guardians/${g}`), 409);
    await ok(registrar('DELETE', `/students/${student}/guardians/${g}`));
    await ok(registrar('DELETE', `/guardians/${g}`));
    expect(parent).toBeDefined();
  });
});

describe('CSV import', () => {
  const studentsCsv = [
    'Admission No,Full Name,Name with initials,Date of birth,Gender,Admitted on,Grade,Class',
    'IMP-1,Saman Kumara,S. Kumara,14/03/2015,Male,2027-01-02,Grade 6,A',
    'IMP-2,"Dilani, Perera",,2015-07-01,female,02/01/2027,,',
  ].join('\r\n');

  it('previews without writing, then applies exactly once', async () => {
    const preview = await ok(registrar('POST', '/imports', { kind: 'students', fileName: 'students.csv', content: studentsCsv }));
    expect(preview).toMatchObject({ status: 'previewed', totalRows: 2, created: 2, updated: 0, errorRows: 0, alreadyAppliedAs: null });
    expect((await ok(registrar('GET', '/students?q=IMP-'))).total).toBe(0);

    await expectError(registrar('POST', `/imports/${preview.id}/apply`, { content: studentsCsv + '\n' }), 409); // different file
    const applied = await ok(registrar('POST', `/imports/${preview.id}/apply`, { content: studentsCsv }));
    expect(applied).toMatchObject({ status: 'applied', created: 2 });
    const saman = (await ok(registrar('GET', '/students?q=IMP-1'))).items[0];
    expect(saman.currentClass).toMatchObject({ id: sec6A });
    await expectError(registrar('POST', `/imports/${preview.id}/apply`, { content: studentsCsv }), 409);

    // The same file again: preview shows it was applied and that nothing would change.
    const again = await ok(registrar('POST', '/imports', { kind: 'students', fileName: 'students.csv', content: studentsCsv }));
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 2, alreadyAppliedAs: preview.id });
    await expectError(registrar('POST', `/imports/${again.id}/apply`, { content: studentsCsv }), 409);
  });

  it('reports row errors without cell values and refuses to apply them', async () => {
    const bad = [
      'admission_no,full_name,admitted_on,grade,class',
      'IMP-3,Bad Date,2027-02-30,,',
      'IMP-3,Dup,2027-01-02,,',
      'IMP-4,No class,2027-01-02,Grade 6,Z',
    ].join('\n');
    const preview = await ok(registrar('POST', '/imports', { kind: 'students', fileName: 'bad.csv', content: bad }));
    expect(preview.errorRows).toBe(2);
    expect(preview.errors.map((e: { row: number; field: string }) => `${e.row}:${e.field}`)).toEqual(['2:admitted_on', '4:class']);
    expect(JSON.stringify(preview.errors)).not.toContain('Bad Date');
    await expectError(registrar('POST', `/imports/${preview.id}/apply`, { content: bad }), 422);
    await expectError(registrar('POST', '/imports', { kind: 'students', fileName: 'x.csv', content: 'full_name\nA' }), 422);
  });

  it('imports staff and guardians with the right permission only', async () => {
    const staffCsv = 'staff_no;full_name;designation\nS-9;Kumari Bandara;Teacher';
    await expectError(registrar('POST', '/imports', { kind: 'staff', fileName: 's.csv', content: staffCsv }), 403);
    const s = await ok(admin('POST', '/imports', { kind: 'staff', fileName: 's.csv', content: staffCsv }));
    await ok(admin('POST', `/imports/${s.id}/apply`, { content: staffCsv }));
    expect((await ok(admin('GET', '/staff?q=S-9'))).items[0]).toMatchObject({ fullName: 'Kumari Bandara', designation: 'Teacher' });
    // Admin cannot see the registrar's student imports.
    expect((await ok(admin('GET', '/imports'))).items.every((j: { kind: string }) => j.kind === 'staff')).toBe(true);

    const gCsv =
      'student_admission_no,full_name,relationship,phone,is_primary\nIMP-1,Mala Kumara,Mother,0771234567,yes\nIMP-1,Mala Kumara,mother,0771234567,yes';
    const g = await ok(registrar('POST', '/imports', { kind: 'guardians', fileName: 'g.csv', content: gCsv }));
    expect(g).toMatchObject({ created: 1, unchanged: 1 });
    await ok(registrar('POST', `/imports/${g.id}/apply`, { content: gCsv }));
    const pending = await ok(registrar('GET', '/guardian-links'));
    expect(pending.items.some((l: { guardian: { fullName: string } }) => l.guardian.fullName === 'Mala Kumara')).toBe(true);
  });
});
