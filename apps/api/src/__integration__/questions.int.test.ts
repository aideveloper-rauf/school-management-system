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

let maths: number;
let science: number;
let g6: number;

beforeAll(async () => {
  ({ db } = await freshDb());
  app = await buildApp({ config: testConfig(), db, logger: false });
  await createUser(db, { identifier: 'admin@test.lk', password: PASSWORD, roles: ['school_admin'] });
  await createUser(db, { identifier: 'coord@test.lk', password: PASSWORD, roles: ['academic_coordinator'] });
  const t = await createUser(db, { identifier: 'teacher@test.lk', password: PASSWORD, roles: ['teacher'] });
  await createUser(db, { identifier: 'student@test.lk', password: PASSWORD, roles: ['student'] });
  for (const n of ['admin', 'coord', 'teacher', 'student']) c[n] = await signIn(`${n}@test.lk`);
  const admin = c.admin!;
  const year = (
    await json(admin('POST', '/academic-years', { label: 'Y', startsOn: '2020-01-01', endsOn: '2035-12-31', isCurrent: true }), 201)
  ).id;
  g6 = (await json(admin('POST', '/grades', { name: 'Grade 6', level: 6 }), 201)).id;
  maths = (await json(admin('POST', '/subjects', { code: 'MATH', name: 'Mathematics' }), 201)).id;
  science = (await json(admin('POST', '/subjects', { code: 'SCI', name: 'Science' }), 201)).id;
  await json(admin('PUT', `/grades/${g6}/subjects`, { subjects: [{ subjectId: maths }, { subjectId: science }] }));
  const sec = (await json(admin('POST', '/class-sections', { academicYearId: year, gradeId: g6, name: 'A' }), 201)).id;
  const staff = (await json(admin('POST', '/staff', { staffNo: 'T1', fullName: 'Teacher', userId: t }), 201)).id;
  await json(admin('POST', '/teacher-assignments', { staffId: staff, classSectionId: sec, subjectId: maths }), 201);
});
afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

const mcq = (stem: string, marks = 2) => ({
  kind: 'mcq',
  stem,
  options: [
    { text: '1/2', correct: true },
    { text: '1/3', correct: false },
  ],
  marks,
});

describe('question bank', () => {
  let q1: number;
  let v1: number;

  it('authors write questions only in subjects they teach; students have no access', async () => {
    q1 = (
      await json(
        c.teacher!('POST', '/questions', {
          subjectId: maths,
          gradeId: g6,
          language: 'en',
          difficulty: 'easy',
          content: mcq('Which is half?'),
        }),
        201,
      )
    ).id;
    await json(c.teacher!('POST', '/questions', { subjectId: science, language: 'en', difficulty: 'easy', content: mcq('x') }), 403);
    await json(c.student!('GET', '/questions'), 403);
    await json(
      c.teacher!('POST', '/questions', {
        subjectId: maths,
        language: 'en',
        difficulty: 'easy',
        content: {
          ...mcq('bad'),
          options: [
            { text: 'a', correct: true },
            { text: 'b', correct: true },
          ],
        },
      }),
      422,
    );
    const list = await json(c.teacher!('GET', '/questions'));
    expect(list.items[0]).toMatchObject({ id: q1, latest: { version: 1, reviewStatus: 'draft' }, approvedVersionId: null });
    v1 = list.items[0].latest.id;
  });

  it('reviews specific versions; edits create new versions that need review again', async () => {
    await json(c.teacher!('POST', `/questions/${q1}/review`, { versionId: v1, decision: 'approved' }), 403);
    await json(c.teacher!('POST', `/questions/${q1}/submit-review`));
    await json(c.coord!('POST', `/questions/${q1}/review`, { versionId: v1, decision: 'approved' }));
    const v2 = (await json(c.teacher!('POST', `/questions/${q1}/versions`, mcq('Which fraction is one half?', 3)), 201)).id;
    const detail = await json(c.teacher!('GET', `/questions/${q1}`));
    expect(detail.versions.map((v: { version: number; reviewStatus: string }) => `${v.version}:${v.reviewStatus}`)).toEqual([
      '2:draft',
      '1:approved',
    ]);
    expect(detail.versions[0].options[0]).toEqual({ text: '1/2', correct: true });
    const list = await json(c.coord!('GET', '/questions?review=draft'));
    expect(list.items[0]).toMatchObject({ id: q1, approvedVersionId: v1 });
    expect(v2).toBeGreaterThan(v1);
  });
});

describe('exam papers', () => {
  it('uses exact approved question versions and freezes final versions', async () => {
    const qs = await json(c.teacher!('GET', '/questions'));
    const q = qs.items[0];
    const paper = (await json(c.teacher!('POST', '/papers', { title: 'Term 1 test', subjectId: maths, gradeId: g6 }), 201)).id;
    // Draft (unapproved) version cannot be used.
    await json(c.teacher!('PUT', `/papers/${paper}/draft`, { items: [{ questionVersionId: q.latest.id }] }), 422);
    const saved = await json(
      c.teacher!('PUT', `/papers/${paper}/draft`, {
        instructions: 'Answer all',
        durationMinutes: 40,
        items: [{ questionVersionId: q.approvedVersionId }],
      }),
    );
    expect(saved.version).toBe(1);
    await json(c.teacher!('POST', `/papers/${paper}/finalize`));
    await json(c.teacher!('POST', `/papers/${paper}/finalize`), 409);

    // Approve version 2 of the question; the final paper still shows version 1's text and marks.
    await json(c.teacher!('POST', `/questions/${q.id}/submit-review`));
    await json(c.coord!('POST', `/questions/${q.id}/review`, { versionId: q.latest.id, decision: 'approved' }));
    const v1paper = await json(c.teacher!('GET', `/paper-versions/${saved.versionId}`));
    expect(v1paper.questions[0]).toMatchObject({ stem: 'Which is half?', itemMarks: 2 });
    expect(v1paper.totalMarks).toBe(2);
    const noKey = await json(c.teacher!('GET', `/paper-versions/${saved.versionId}?answers=false`));
    expect(noKey.questions[0].options[0]).toEqual({ text: '1/2' });

    // Changing a final paper starts version 2.
    const next = await json(c.teacher!('PUT', `/papers/${paper}/draft`, { items: [{ questionVersionId: q.latest.id, marks: 5 }] }));
    expect(next.version).toBe(2);
    const detail = await json(c.teacher!('GET', `/papers/${paper}`));
    expect(detail.versions.map((v: { version: number; status: string }) => `${v.version}:${v.status}`)).toEqual(['2:draft', '1:final']);
    expect((await json(c.teacher!('GET', `/paper-versions/${saved.versionId}`))).questions[0].stem).toBe('Which is half?');
  });
});
