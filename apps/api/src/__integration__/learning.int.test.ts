import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { CSRF_HEADER } from '@sms/shared';
import { buildApp } from '../app.js';
import type { Db } from '../db/client.js';
import { SESSION_COOKIE } from '../plugins/auth.js';
import { removeOrphanFiles } from '../jobs/housekeeping.js';
import { sniffMime } from '../lib/files.js';
import { createUser, freshDb, testConfig } from './test-db.js';

let db: Db;
let app: FastifyInstance;
let storage: string;
const PASSWORD = 'correct-horse-battery';
type Client = {
  (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown): Promise<LightMyRequestResponse>;
  upload: (name: string, body: Buffer) => Promise<LightMyRequestResponse>;
};
const c: Record<string, Client> = {};

async function signIn(identifier: string): Promise<Client> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier, password: PASSWORD } });
  expect(res.statusCode, res.body).toBe(200);
  const cookie = res.cookies.find((x) => x.name === SESSION_COOKIE)!.value;
  const csrf = res.json().csrfToken as string;
  const fn = ((method, url, payload) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      cookies: { [SESSION_COOKIE]: cookie },
      headers: { [CSRF_HEADER]: csrf },
      ...(payload !== undefined && { payload: payload as object }),
    })) as Client;
  fn.upload = (name, body) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/files?name=${encodeURIComponent(name)}`,
      cookies: { [SESSION_COOKIE]: cookie },
      headers: { [CSRF_HEADER]: csrf, 'content-type': 'application/octet-stream' },
      payload: body,
    });
  return fn;
}
const json = async (res: Promise<LightMyRequestResponse>, status = 200) => {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r.statusCode === 204 ? null : r.json();
};
const PDF = Buffer.from('%PDF-1.4\n% test file\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

let sec6A: number;
let sec6B: number;
let maths: number;
let science: number;
let studentA: number;

beforeAll(async () => {
  ({ db } = await freshDb());
  storage = mkdtempSync(path.join(tmpdir(), 'sms-files-'));
  app = await buildApp({ config: { ...testConfig(), STORAGE_DIR: storage }, db, logger: false });
  await createUser(db, { identifier: 'admin@test.lk', password: PASSWORD, roles: ['school_admin'] });
  await createUser(db, { identifier: 'registrar@test.lk', password: PASSWORD, roles: ['registrar'] });
  await createUser(db, { identifier: 'principal@test.lk', password: PASSWORD, roles: ['principal'] });
  const t1 = await createUser(db, { identifier: 'maths@test.lk', password: PASSWORD, roles: ['teacher'] });
  const t2 = await createUser(db, { identifier: 'science@test.lk', password: PASSWORD, roles: ['teacher'] });
  const sA = await createUser(db, { identifier: 'kid.a@test.lk', password: PASSWORD, roles: ['student'] });
  const sB = await createUser(db, { identifier: 'kid.b@test.lk', password: PASSWORD, roles: ['student'] });
  const p = await createUser(db, { identifier: 'parent@test.lk', password: PASSWORD, roles: ['guardian'] });
  for (const n of ['admin', 'registrar', 'principal', 'maths', 'science', 'kid.a', 'kid.b', 'parent']) c[n] = await signIn(`${n}@test.lk`);
  const admin = c.admin!;
  const reg = c.registrar!;
  const year = (
    await json(admin('POST', '/academic-years', { label: 'Y', startsOn: '2020-01-01', endsOn: '2035-12-31', isCurrent: true }), 201)
  ).id;
  const g6 = (await json(admin('POST', '/grades', { name: 'Grade 6', level: 6 }), 201)).id;
  maths = (await json(admin('POST', '/subjects', { code: 'MATH', name: 'Mathematics' }), 201)).id;
  science = (await json(admin('POST', '/subjects', { code: 'SCI', name: 'Science' }), 201)).id;
  await json(admin('PUT', `/grades/${g6}/subjects`, { subjects: [{ subjectId: maths }, { subjectId: science }] }));
  sec6A = (await json(admin('POST', '/class-sections', { academicYearId: year, gradeId: g6, name: 'A' }), 201)).id;
  sec6B = (await json(admin('POST', '/class-sections', { academicYearId: year, gradeId: g6, name: 'B' }), 201)).id;
  const st1 = (await json(admin('POST', '/staff', { staffNo: 'T1', fullName: 'Maths Teacher', userId: t1 }), 201)).id;
  const st2 = (await json(admin('POST', '/staff', { staffNo: 'T2', fullName: 'Science Teacher', userId: t2 }), 201)).id;
  await json(admin('POST', '/teacher-assignments', { staffId: st1, classSectionId: sec6A, subjectId: maths }), 201);
  await json(admin('POST', '/teacher-assignments', { staffId: st2, classSectionId: sec6A, subjectId: science }), 201);
  studentA = (
    await json(reg('POST', '/students', { admissionNo: 'A1', fullName: 'Kid A', admittedOn: '2020-01-01', classSectionId: sec6A }), 201)
  ).id;
  const studentB = (
    await json(reg('POST', '/students', { admissionNo: 'B1', fullName: 'Kid B', admittedOn: '2020-01-01', classSectionId: sec6B }), 201)
  ).id;
  await db.updateTable('student_profiles').set({ user_id: sA }).where('id', '=', studentA).execute();
  await db.updateTable('student_profiles').set({ user_id: sB }).where('id', '=', studentB).execute();
  const g = (await json(reg('POST', '/guardians', { fullName: 'Parent A', userId: p }), 201)).id;
  await json(reg('POST', `/students/${studentA}/guardians`, { guardianId: g, relationship: 'father' }), 201);
  await json(reg('POST', `/students/${studentA}/guardians/${g}/verify`, { decision: 'verified', method: 'in_person' }));
});
afterAll(async () => {
  await app?.close();
  await db?.destroy();
  rmSync(storage, { recursive: true, force: true });
});

describe('file storage', () => {
  it('sniffs content and refuses unsafe types whatever the name says', () => {
    expect(sniffMime(PDF, 'x.pdf')).toBe('application/pdf');
    expect(sniffMime(Buffer.from('<html><script>alert(1)</script>'), 'notes.pdf')).toBeNull();
    expect(sniffMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'a.svg')).toBeNull();
    expect(sniffMime(Buffer.from('MZ\x90\x00'), 'a.exe')).toBeNull();
    expect(sniffMime(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]), 'evil.jar')).toBeNull();
    expect(sniffMime(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]), 'work.docx')).toContain('wordprocessingml');
    expect(sniffMime(Buffer.from('plain notes\n'), 'n.txt')).toContain('text/plain');
  });

  it('stores uploads outside the web root and lets only the uploader read an unattached file', async () => {
    const up = await json(c.maths!.upload('../../etc/Worksheet 1.pdf', PDF), 201);
    expect(up).toMatchObject({ name: 'Worksheet 1.pdf', mimeType: 'application/pdf' });
    expect((await c.maths!.upload('page.html', Buffer.from('<html>'))).statusCode).toBe(422);
    const dl = await c.maths!('GET', `/files/${up.id}`);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['content-disposition']).toContain('attachment');
    expect(dl.rawPayload.equals(PDF)).toBe(true);
    expect((await c.science!('GET', `/files/${up.id}`)).statusCode).toBe(404);
    expect(readdirSync(path.join(storage, 'files')).length).toBe(1);
  });
});

describe('materials and assignments', () => {
  let resource: number;
  let assignment: number;
  let resourceFile: number;

  it('lets a teacher post only for a class and subject they are assigned to', async () => {
    resourceFile = (await json(c.maths!.upload('notes.pdf', PDF), 201)).id;
    resource = (
      await json(
        c.maths!('POST', '/learning-items', {
          kind: 'resource',
          classSectionId: sec6A,
          subjectId: maths,
          title: 'Fractions notes',
          fileIds: [resourceFile],
          publish: true,
        }),
        201,
      )
    ).id;
    await json(c.maths!('POST', '/learning-items', { kind: 'resource', classSectionId: sec6A, subjectId: science, title: 'x' }), 403);
    await json(c.maths!('POST', '/learning-items', { kind: 'resource', classSectionId: sec6B, subjectId: maths, title: 'x' }), 403);
    await json(c['kid.a']!('POST', '/learning-items', { kind: 'resource', classSectionId: sec6A, subjectId: maths, title: 'x' }), 403);
    // A file can be attached once only, and only by its uploader.
    await json(
      c.maths!('POST', '/learning-items', {
        kind: 'resource',
        classSectionId: sec6A,
        subjectId: maths,
        title: 'dup',
        fileIds: [resourceFile],
      }),
      422,
    );
    const dueAt = new Date(Date.now() + 86_400_000).toISOString();
    assignment = (
      await json(
        c.maths!('POST', '/learning-items', {
          kind: 'assignment',
          classSectionId: sec6A,
          subjectId: maths,
          title: 'Exercise 3',
          dueAt,
          allowLate: false,
          maxScore: 20,
        }),
        201,
      )
    ).id;
  });

  it('shows drafts to staff only and published items to the class and its verified guardians', async () => {
    const ids = async (who: string) => (await json(c[who]!('GET', '/learning-items'))).items.map((i: { id: number }) => i.id).sort();
    expect(await ids('maths')).toEqual([resource, assignment].sort());
    expect(await ids('science')).toEqual([]); // science teacher, different subject
    expect(await ids('principal')).toEqual([resource, assignment].sort()); // learning.read.all
    expect(await ids('kid.a')).toEqual([resource]); // assignment is still a draft
    expect(await ids('kid.b')).toEqual([]); // other class
    expect(await ids('parent')).toEqual([resource]);
    expect((await c['kid.b']!('GET', `/learning-items/${resource}`)).statusCode).toBe(404);
    // Attached file follows the item's visibility.
    expect((await c['kid.a']!('GET', `/files/${resourceFile}`)).statusCode).toBe(200);
    expect((await c.parent!('GET', `/files/${resourceFile}`)).statusCode).toBe(200);
    expect((await c['kid.b']!('GET', `/files/${resourceFile}`)).statusCode).toBe(404);
    await json(c.maths!('POST', `/learning-items/${assignment}/publish`));
    expect(await ids('kid.a')).toEqual([resource, assignment].sort());
  });

  it('takes submissions from enrolled students, allows resubmission until returned', async () => {
    await json(c['kid.b']!('POST', `/learning-items/${assignment}/submission`, { textAnswer: 'x' }), 404);
    await json(c['kid.a']!('POST', `/learning-items/${resource}/submission`, { textAnswer: 'x' }), 422);
    await json(c['kid.a']!('POST', `/learning-items/${assignment}/submission`, {}), 422);
    const f = (await json(c['kid.a']!.upload('answer.pdf', PDF), 201)).id;
    const first = await json(
      c['kid.a']!('POST', `/learning-items/${assignment}/submission`, { textAnswer: 'My answer', fileIds: [f] }),
      201,
    );
    expect(first.isLate).toBe(false);
    await json(c['kid.a']!('POST', `/learning-items/${assignment}/submission`, { textAnswer: 'Better answer' }), 201);

    const view = await json(c.maths!('GET', `/learning-items/${assignment}/submissions`));
    expect(view.items.map((r: { student: { id: number } }) => r.student.id)).toEqual([studentA]);
    expect(view.items[0].submission).toMatchObject({ textAnswer: 'Better answer', status: 'submitted', files: [] });
    await json(c.science!('GET', `/learning-items/${assignment}/submissions`), 404);

    // The replaced file is now unattached: only its uploader can fetch it, and housekeeping removes it after a day.
    expect((await c.maths!('GET', `/files/${f}`)).statusCode).toBe(404);
    await sql`UPDATE stored_files SET created_at = CURRENT_TIMESTAMP - INTERVAL 2 DAY WHERE id = ${f}`.execute(db);
    expect(await removeOrphanFiles(db, storage)).toBe(1);
    expect(await db.selectFrom('stored_files').select('id').where('id', '=', f).executeTakeFirst()).toBeUndefined();

    const subId = view.items[0].submission.id;
    await json(c.maths!('POST', `/submissions/${subId}/return`, { feedback: 'Good', score: 25 }), 422);
    await json(c.maths!('POST', `/submissions/${subId}/return`, { feedback: 'Good work', score: 17.5 }));
    await json(c['kid.a']!('POST', `/learning-items/${assignment}/submission`, { textAnswer: 'again' }), 409);
    const mine = await json(c['kid.a']!('GET', `/learning-items/${assignment}`));
    expect(mine.mySubmission).toMatchObject({ status: 'returned', feedback: 'Good work', score: 17.5 });
    const parentView = await json(c.parent!('GET', `/learning-items?studentId=${studentA}&kind=assignment`));
    expect(parentView.items[0].mySubmission).toMatchObject({ status: 'returned', score: 17.5 });
  });

  it('refuses late work when not allowed, and deleting items with submissions', async () => {
    await db
      .updateTable('learning_items')
      .set({ due_at: sql<Date>`CURRENT_TIMESTAMP - INTERVAL 1 HOUR` })
      .where('id', '=', assignment)
      .execute();
    const late = await c['kid.a']!('POST', `/learning-items/${assignment}/submission`, { textAnswer: 'late' });
    expect(late.statusCode).toBe(409);
    await json(c.maths!('DELETE', `/learning-items/${assignment}`), 409);
    await json(c.maths!('DELETE', `/learning-items/${resource}`), 204);
  });
});
