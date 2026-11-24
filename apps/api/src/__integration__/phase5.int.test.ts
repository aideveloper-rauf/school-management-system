import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { CSRF_HEADER } from '@sms/shared';
import { buildApp } from '../app.js';
import type { Db } from '../db/client.js';
import { SESSION_COOKIE } from '../plugins/auth.js';
import type { AiProvider, CurriculumPrompt } from '../lib/ai.js';
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

const seen: CurriculumPrompt[] = [];
const fakeAi: AiProvider = {
  name: 'fake',
  async draftQuestions(input) {
    seen.push(input);
    return [
      {
        kind: 'mcq',
        stem: 'Which fraction is half?',
        options: [
          { text: '1/2', correct: true },
          { text: '1/3', correct: false },
        ],
        answer: null,
        marks: 2,
      },
      {
        kind: 'mcq',
        stem: 'Broken: two correct',
        options: [
          { text: 'a', correct: true },
          { text: 'b', correct: true },
        ],
        answer: null,
        marks: 1,
      },
      { kind: 'short', stem: 'Simplify 4/8.', options: null, answer: '1/2', marks: 2 },
    ];
  },
};
let maths: number;
let smallClass: number;
let bigClass: number;

beforeAll(async () => {
  ({ db } = await freshDb());
  app = await buildApp({ config: testConfig(), db, logger: false, ai: fakeAi });
  await db.insertInto('schools').values({ name: 'SSV', default_locale: 'en', timezone: 'Asia/Colombo' }).execute();
  await createUser(db, { identifier: 'admin@test.lk', password: PASSWORD, roles: ['school_admin'] });
  await createUser(db, { identifier: 'registrar@test.lk', password: PASSWORD, roles: ['registrar'] });
  await createUser(db, { identifier: 'principal@test.lk', password: PASSWORD, roles: ['principal'] });
  const t = await createUser(db, { identifier: 'teacher@test.lk', password: PASSWORD, roles: ['teacher'] });
  for (const n of ['admin', 'registrar', 'principal', 'teacher']) c[n] = await signIn(`${n}@test.lk`);
  const today = todayIn('Asia/Colombo');
  const y = Number(today.slice(0, 4));
  const year = (
    await json(
      c.admin!('POST', '/academic-years', { label: 'Y', startsOn: `${y - 1}-01-01`, endsOn: `${y + 1}-12-31`, isCurrent: true }),
      201,
    )
  ).id;
  const g = (await json(c.admin!('POST', '/grades', { name: 'Grade 6', level: 6 }), 201)).id;
  maths = (await json(c.admin!('POST', '/subjects', { code: 'MATH', name: 'Mathematics' }), 201)).id;
  await json(c.admin!('PUT', `/grades/${g}/subjects`, { subjects: [{ subjectId: maths }] }));
  bigClass = (await json(c.admin!('POST', '/class-sections', { academicYearId: year, gradeId: g, name: 'A' }), 201)).id;
  smallClass = (await json(c.admin!('POST', '/class-sections', { academicYearId: year, gradeId: g, name: 'B' }), 201)).id;
  const staff = (await json(c.admin!('POST', '/staff', { staffNo: 'T1', fullName: 'Teacher', userId: t }), 201)).id;
  await json(c.admin!('POST', '/teacher-assignments', { staffId: staff, classSectionId: bigClass, subjectId: maths }), 201);
  const big: number[] = [];
  for (let i = 0; i < 6; i++)
    big.push(
      (
        await json(
          c.registrar!('POST', '/students', {
            admissionNo: `A${i}`,
            fullName: `Student Number${i} Perera`,
            admittedOn: `${y - 1}-01-01`,
            classSectionId: bigClass,
          }),
          201,
        )
      ).id,
    );
  const small = (
    await json(
      c.registrar!('POST', '/students', {
        admissionNo: 'B0',
        fullName: 'Only Child',
        admittedOn: `${y - 1}-01-01`,
        classSectionId: smallClass,
      }),
      201,
    )
  ).id;
  await json(
    c.principal!('PUT', `/class-sections/${bigClass}/attendance/${today}`, {
      records: big.map((id, i) => ({ studentId: id, status: i === 0 ? 'absent' : 'present' })),
    }),
  );
  await json(
    c.principal!('PUT', `/class-sections/${smallClass}/attendance/${today}`, { records: [{ studentId: small, status: 'absent' }] }),
  );
});
afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

describe('analytics', () => {
  it('gives aggregates only, suppressing groups smaller than five', async () => {
    await json(c.teacher!('GET', '/analytics/overview'), 403);
    const o = await json(c.principal!('GET', '/analytics/overview'));
    const big = o.classes.find((x: { id: number }) => x.id === bigClass);
    const small = o.classes.find((x: { id: number }) => x.id === smallClass);
    expect(big).toMatchObject({ enrolled: 6, attendanceRate: 83.3, suppressed: false });
    expect(small).toMatchObject({ enrolled: null, attendanceRate: null, suppressed: true });
    expect(JSON.stringify(o)).not.toContain('Only Child');
  });
});

describe('AI drafting', () => {
  it('is off until the school opts in, even with a provider configured', async () => {
    expect(await json(c.teacher!('GET', '/ai/status'))).toMatchObject({ available: true, schoolEnabled: false, usable: false });
    const r = await c.teacher!('POST', '/ai/question-drafts', { subjectId: maths, outcome: 'Equivalent fractions', difficulty: 'easy' });
    expect(r.statusCode).toBe(409);
    await json(c.teacher!('PATCH', '/school', { aiEnabled: true }), 403);
    await json(c.admin!('PATCH', '/school', { aiEnabled: true }));
  });

  it('sends curriculum fields only, refuses personal data, and validates drafts', async () => {
    await json(
      c.teacher!('POST', '/ai/question-drafts', { subjectId: maths, outcome: 'Fractions for Student Number3 Perera', difficulty: 'easy' }),
      422,
    );
    await json(
      c.teacher!('POST', '/ai/question-drafts', { subjectId: maths, outcome: 'Call 0771234567 about fractions', difficulty: 'easy' }),
      422,
    );
    await json(c.teacher!('POST', '/ai/question-drafts', { subjectId: maths + 99, outcome: 'Fractions', difficulty: 'easy' }), 404);
    const res = await json(
      c.teacher!('POST', '/ai/question-drafts', { subjectId: maths, outcome: 'Equivalent fractions', difficulty: 'easy', count: 3 }),
    );
    expect(res.drafts.map((d: { stem: string }) => d.stem)).toEqual(['Which fraction is half?', 'Simplify 4/8.']);
    expect(seen).toEqual([
      { subject: 'Mathematics', grade: null, outcome: 'Equivalent fractions', difficulty: 'easy', language: 'en', count: 3 },
    ]);
    const audit = await db
      .selectFrom('audit_events')
      .select('metadata')
      .where('action', '=', 'ai.question_drafts')
      .executeTakeFirstOrThrow();
    expect(audit.metadata).not.toContain('fractions');
  });
});
