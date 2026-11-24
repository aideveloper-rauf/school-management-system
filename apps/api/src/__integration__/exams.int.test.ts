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
const errorKey = async (res: Promise<LightMyRequestResponse>, status: number) => {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r.json().error.message as string;
};

let sec6A: number;
let sec6B: number;
let maths: number;
let science: number;
let students: number[];
let series: number;
let mathsP1: number;
let mathsP2: number;
let sciencePaper: number;
const sheet = (comp: number, sec = sec6A) => `/exam-components/${comp}/sheets/${sec}`;

beforeAll(async () => {
  ({ db } = await freshDb());
  app = await buildApp({ config: testConfig(), db, logger: false });
  await createUser(db, { identifier: 'admin@test.lk', password: PASSWORD, roles: ['school_admin'] });
  await createUser(db, { identifier: 'registrar@test.lk', password: PASSWORD, roles: ['registrar'] });
  await createUser(db, { identifier: 'coord@test.lk', password: PASSWORD, roles: ['academic_coordinator'] });
  await createUser(db, { identifier: 'principal@test.lk', password: PASSWORD, roles: ['principal'] });
  const tm = await createUser(db, { identifier: 'maths@test.lk', password: PASSWORD, roles: ['teacher'] });
  const ts = await createUser(db, { identifier: 'science@test.lk', password: PASSWORD, roles: ['teacher'] });
  const su = await createUser(db, { identifier: 'kid@test.lk', password: PASSWORD, roles: ['student'] });
  const pu = await createUser(db, { identifier: 'parent@test.lk', password: PASSWORD, roles: ['guardian'] });
  for (const n of ['admin', 'registrar', 'coord', 'principal', 'maths', 'science', 'kid', 'parent']) c[n] = await signIn(`${n}@test.lk`);
  const admin = c.admin!;
  const year = (
    await json(admin('POST', '/academic-years', { label: 'Y', startsOn: '2020-01-01', endsOn: '2035-12-31', isCurrent: true }), 201)
  ).id;
  const g6 = (await json(admin('POST', '/grades', { name: 'Grade 6', level: 6 }), 201)).id;
  maths = (await json(admin('POST', '/subjects', { code: 'MATH', name: 'Mathematics' }), 201)).id;
  science = (await json(admin('POST', '/subjects', { code: 'SCI', name: 'Science' }), 201)).id;
  await json(admin('PUT', `/grades/${g6}/subjects`, { subjects: [{ subjectId: maths }, { subjectId: science }] }));
  sec6A = (await json(admin('POST', '/class-sections', { academicYearId: year, gradeId: g6, name: 'A' }), 201)).id;
  sec6B = (await json(admin('POST', '/class-sections', { academicYearId: year, gradeId: g6, name: 'B' }), 201)).id;
  const sm = (await json(admin('POST', '/staff', { staffNo: 'T1', fullName: 'Maths', userId: tm }), 201)).id;
  const ss = (await json(admin('POST', '/staff', { staffNo: 'T2', fullName: 'Science', userId: ts }), 201)).id;
  await json(admin('POST', '/teacher-assignments', { staffId: sm, classSectionId: sec6A, subjectId: maths }), 201);
  await json(admin('POST', '/teacher-assignments', { staffId: ss, classSectionId: sec6A, subjectId: science }), 201);
  students = [];
  for (const [i, n] of ['Amal', 'Bimal', 'Chamari'].entries()) {
    students.push(
      (
        await json(
          c.registrar!('POST', '/students', { admissionNo: `S${i}`, fullName: n, admittedOn: '2020-01-01', classSectionId: sec6A }),
          201,
        )
      ).id,
    );
  }
  await db.updateTable('student_profiles').set({ user_id: su }).where('id', '=', students[0]!).execute();
  const g = (await json(c.registrar!('POST', '/guardians', { fullName: 'Parent', userId: pu }), 201)).id;
  await json(c.registrar!('POST', `/students/${students[0]}/guardians`, { guardianId: g, relationship: 'mother' }), 201);
  await json(c.registrar!('POST', `/students/${students[0]}/guardians/${g}/verify`, { decision: 'verified', method: 'in_person' }));

  const scale = (
    await json(
      c.coord!('POST', '/grading-scales', {
        name: 'O/L',
        bands: [
          { min: 75, grade: 'A' },
          { min: 65, grade: 'B' },
          { min: 50, grade: 'C' },
          { min: 35, grade: 'S' },
          { min: 0, grade: 'W' },
        ],
      }),
      201,
    )
  ).id;
  const scales = await json(c.coord!('GET', '/grading-scales'));
  const scaleVersion = scales.items.find((s: { id: number }) => s.id === scale).versions[0].id;
  series = (
    await json(c.coord!('POST', '/exam-series', { academicYearId: year, name: 'Term 1 test', gradingScaleVersionId: scaleVersion }), 201)
  ).id;
  mathsP1 = (
    await json(
      c.coord!('POST', `/exam-series/${series}/components`, { gradeId: g6, subjectId: maths, name: 'Paper I', maxMarks: 40, weight: 40 }),
      201,
    )
  ).id;
  mathsP2 = (
    await json(
      c.coord!('POST', `/exam-series/${series}/components`, { gradeId: g6, subjectId: maths, name: 'Paper II', maxMarks: 60, weight: 60 }),
      201,
    )
  ).id;
  sciencePaper = (
    await json(
      c.coord!('POST', `/exam-series/${series}/components`, { gradeId: g6, subjectId: science, name: 'Paper', maxMarks: 100 }),
      201,
    )
  ).id;
});
afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

describe('setup', () => {
  it('only exams.manage sets up; scales are versioned', async () => {
    await json(
      c.maths!('POST', '/grading-scales', {
        name: 'X',
        bands: [
          { min: 0, grade: 'F' },
          { min: 50, grade: 'P' },
        ],
      }),
      403,
    );
    await json(
      c.coord!('POST', '/grading-scales', {
        name: 'Bad',
        bands: [
          { min: 10, grade: 'F' },
          { min: 50, grade: 'P' },
        ],
      }),
      422,
    ); // no band at 0
    const scale = (await json(c.coord!('GET', '/grading-scales'))).items[0];
    const v2 = await json(
      c.coord!('POST', `/grading-scales/${scale.id}/versions`, {
        bands: [
          { min: 0, grade: 'F' },
          { min: 40, grade: 'P' },
        ],
      }),
      201,
    );
    expect(v2.version).toBe(2);
    // The series keeps version 1.
    expect((await json(c.coord!('GET', `/exam-series/${series}`))).scale.version).toBe(1);
  });

  it('teachers see only their own class/subject sheets', async () => {
    const view = await json(c.maths!('GET', `/exam-series/${series}`));
    expect(view.components.map((x: { id: number }) => x.id).sort()).toEqual([mathsP1, mathsP2].sort());
    expect(view.components[0].sheets).toEqual([{ classSectionId: sec6A, className: 'A', status: 'open' }]);
    await json(c.science!('GET', sheet(mathsP1)), 404);
    await json(c.maths!('GET', sheet(mathsP1, sec6B)), 404);
  });
});

describe('mark entry, moderation and approval', () => {
  const [a, b, ch] = [0, 1, 2];
  it('validates marks against the component and keeps DECIMAL precision', async () => {
    const s = students;
    expect(
      await errorKey(c.maths!('PUT', `${sheet(mathsP1)}/marks`, { marks: [{ studentId: s[a], status: 'present', rawMark: 41 }] }), 422),
    ).toBe('errors.validation');
    await json(c.maths!('PUT', `${sheet(mathsP1)}/marks`, { marks: [{ studentId: s[a], status: 'absent', rawMark: 5 }] }), 422);
    await json(
      c.maths!('PUT', `${sheet(mathsP1)}/marks`, {
        marks: [
          { studentId: s[a], status: 'present', rawMark: 30.5 },
          { studentId: s[b], status: 'present', rawMark: 28 },
        ],
      }),
    );
    expect(await errorKey(c.maths!('POST', `${sheet(mathsP1)}/actions`, { action: 'submit' }), 409)).toBe('errors.marksIncomplete');
    await json(c.maths!('PUT', `${sheet(mathsP1)}/marks`, { marks: [{ studentId: s[ch], status: 'absent', rawMark: null }] }));
    const view = await json(c.maths!('GET', sheet(mathsP1)));
    expect(view.students.map((x: { rawMark: number | null; status: string }) => x.rawMark ?? x.status)).toEqual([30.5, 28, 'absent']);
    await json(c.maths!('POST', `${sheet(mathsP1)}/actions`, { action: 'submit' }));
  });

  it('locks submitted sheets for teachers; moderators change marks only with a reason', async () => {
    const s = students;
    expect(
      await errorKey(c.maths!('PUT', `${sheet(mathsP1)}/marks`, { marks: [{ studentId: s[a], status: 'present', rawMark: 31 }] }), 409),
    ).toBe('errors.sheetSubmitted');
    await json(c.coord!('PUT', `${sheet(mathsP1)}/marks`, { marks: [{ studentId: s[a], status: 'present', rawMark: 31 }] }), 422);
    await json(
      c.coord!('PUT', `${sheet(mathsP1)}/marks`, {
        marks: [{ studentId: s[a], status: 'present', rawMark: 31 }],
        reason: 'Re-added page 3 by the moderator',
      }),
    );
    const view = await json(c.coord!('GET', sheet(mathsP1)));
    expect(view.changes[0]).toMatchObject({ studentId: s[a], from: 30.5, to: 31, reason: 'Re-added page 3 by the moderator' });
    const audit = await db.selectFrom('audit_events').select('metadata').where('action', '=', 'marks.corrected').executeTakeFirstOrThrow();
    expect(audit.metadata).not.toContain('page 3');
    await json(c.maths!('POST', `${sheet(mathsP1)}/actions`, { action: 'approve' }), 403);
    await json(c.coord!('POST', `${sheet(mathsP1)}/actions`, { action: 'moderate' }));
    await json(c.coord!('POST', `${sheet(mathsP1)}/actions`, { action: 'approve' }), 403); // coordinator cannot approve
    await json(c.principal!('POST', `${sheet(mathsP1)}/actions`, { action: 'approve' }));
    expect(
      await errorKey(
        c.coord!('PUT', `${sheet(mathsP1)}/marks`, { marks: [{ studentId: s[a], status: 'present', rawMark: 1 }], reason: 'x' }),
        409,
      ),
    ).toBe('errors.sheetApproved');
  });

  it('completes the other sheets', async () => {
    const s = students;
    await json(
      c.maths!('PUT', `${sheet(mathsP2)}/marks`, {
        marks: [
          { studentId: s[a], status: 'present', rawMark: 48 },
          { studentId: s[b], status: 'present', rawMark: 50 },
          { studentId: s[ch], status: 'present', rawMark: 30 },
        ],
      }),
    );
    await json(
      c.science!('PUT', `${sheet(sciencePaper)}/marks`, {
        marks: [
          { studentId: s[a], status: 'present', rawMark: 70 },
          { studentId: s[b], status: 'present', rawMark: 70 },
          { studentId: s[ch], status: 'exempt', rawMark: null },
        ],
      }),
    );
    for (const [who, comp] of [
      ['maths', mathsP2],
      ['science', sciencePaper],
    ] as const) {
      await json(c[who]!('POST', `${sheet(comp)}/actions`, { action: 'submit' }));
      await json(c.principal!('POST', `${sheet(comp)}/actions`, { action: 'approve' }));
    }
  });
});

describe('results', () => {
  let firstRelease: number;
  it('previews results and refuses publishing until every sheet is approved', async () => {
    const preview = await json(c.principal!('GET', `/exam-series/${series}/classes/${sec6A}/results`));
    expect(preview.allApproved).toBe(true);
    const [amal, bimal, chamari] = preview.preview.students;
    // Amal: maths 31/40*40 + 48/60*60 = 79 → A; science 70 → B; average 74.5
    expect(amal.subjects.map((x: { percent: number; grade: string }) => `${x.percent}${x.grade}`)).toEqual(['79A', '70B']);
    expect(amal).toMatchObject({ average: 74.5, rank: 1 });
    expect(bimal).toMatchObject({ average: 74, rank: 2 });
    expect(chamari.subjects[1]).toMatchObject({ exempt: true, percent: null });
    expect(chamari).toMatchObject({ average: 30, rank: 3 });
    await json(c.maths!('GET', `/exam-series/${series}/classes/${sec6A}/results`), 403);
    await json(c.coord!('POST', `/exam-series/${series}/releases`, { classSectionId: sec6A }), 403);
    expect(await errorKey(c.principal!('POST', `/exam-series/${series}/releases`, { classSectionId: sec6B }), 409)).toBe(
      'errors.resultsNotApproved',
    );
    firstRelease = (await json(c.principal!('POST', `/exam-series/${series}/releases`, { classSectionId: sec6A }), 201)).id;
  });

  it('shows students and verified guardians only their own released row', async () => {
    const mine = await json(c.kid!('GET', '/me/results'));
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({ version: 1, classSize: 3, result: { fullName: 'Amal', average: 74.5, rank: 1 } });
    expect(JSON.stringify(mine)).not.toContain('Bimal');
    const parent = await json(c.parent!('GET', `/me/results?studentId=${students[0]}`));
    expect(parent.items[0].result.id).toBe(students[0]);
    await json(c.parent!('GET', `/me/results?studentId=${students[1]}`), 404);
  });

  it('a correction reopens with a reason and publishes a new version; the old snapshot is untouched', async () => {
    const s = students;
    await json(c.principal!('POST', `${sheet(sciencePaper)}/actions`, { action: 'reopen' }), 422);
    await json(c.principal!('POST', `${sheet(sciencePaper)}/actions`, { action: 'reopen', reason: 'Addition error on script' }));
    await json(c.science!('PUT', `${sheet(sciencePaper)}/marks`, { marks: [{ studentId: s[1], status: 'present', rawMark: 80 }] }));
    await json(c.science!('POST', `${sheet(sciencePaper)}/actions`, { action: 'submit' }));
    await json(c.principal!('POST', `${sheet(sciencePaper)}/actions`, { action: 'approve' }));
    await json(c.principal!('POST', `/exam-series/${series}/releases`, { classSectionId: sec6A }), 422); // reason needed for v2
    const v2 = await json(
      c.principal!('POST', `/exam-series/${series}/releases`, { classSectionId: sec6A, reason: 'Science mark corrected for one student' }),
      201,
    );
    expect(v2.version).toBe(2);
    const old = await json(c.principal!('GET', `/result-releases/${firstRelease}`));
    expect(old.snapshot.students[1]).toMatchObject({ fullName: 'Bimal', average: 74 });
    const current = await json(c.principal!('GET', `/result-releases/${v2.id}`));
    expect(current.snapshot.students[1]).toMatchObject({ fullName: 'Bimal', average: 79, rank: 1 });
    // Families see the latest version only.
    const mine = await json(c.kid!('GET', '/me/results'));
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({ version: 2, result: { rank: 2 } });
  });
});
