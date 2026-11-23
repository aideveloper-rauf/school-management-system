import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { AUDIT_CATEGORIES, CSRF_HEADER, type AuditEventItem } from '@sms/shared';
import { buildApp } from '../app.js';
import type { Db } from '../db/client.js';
import { SESSION_COOKIE } from '../plugins/auth.js';
import { createUser, freshDb } from './test-db.js';

let db: Db;
let app: FastifyInstance;
const PASSWORD = 'correct-horse-battery';
type Call = (method: 'GET' | 'POST', url: string, payload?: unknown) => Promise<LightMyRequestResponse>;
let admin: Call;
let teacher: Call;
let adminId: number;

async function signIn(identifier: string): Promise<Call> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier, password: PASSWORD } });
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
const items = async (url: string) => (await admin('GET', url)).json().items as AuditEventItem[];

beforeAll(async () => {
  let cfg;
  ({ db, cfg } = await freshDb());
  app = await buildApp({ config: cfg, db, logger: false });
  await db.insertInto('schools').values({ name: 'Audit School', default_locale: 'en', timezone: 'Asia/Colombo' }).execute();
  adminId = await createUser(db, { identifier: 'principal.office@test.lk', password: PASSWORD, roles: ['school_admin'] });
  await db.updateTable('users').set({ display_name: 'Office Admin' }).where('id', '=', adminId).execute();
  await createUser(db, { identifier: 'teacher@test.lk', password: PASSWORD, roles: ['teacher'] });
  admin = await signIn('principal.office@test.lk');
  teacher = await signIn('teacher@test.lk');
  // A spread of events: academic, people, a failed sign-in (no actor).
  await admin('POST', '/grades', { name: 'Grade 6', level: 6 });
  await admin('POST', '/users', {
    onboarding: 'temporary_password',
    identifier: 'student.1',
    displayName: 'Student',
    temporaryPassword: 'temp-pass-1234',
  });
  await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: 'nobody@test.lk', password: 'wrong-pass-1' } });
});
afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

describe('audit log API', () => {
  it('is only for roles with audit.read', async () => {
    expect((await teacher('GET', '/audit-events')).statusCode).toBe(403);
  });

  it('returns the actor, record and details of each entry, newest first', async () => {
    const all = await items('/audit-events');
    expect(all.map((e) => e.id)).toEqual([...all.map((e) => e.id)].sort((a, b) => b - a));
    const grade = all.find((e) => e.action === 'grade.created')!;
    expect(grade.actor).toEqual({ id: adminId, displayName: 'Office Admin', identifier: 'principal.office@test.lk' });
    expect(grade.entityType).toBe('grade');
    const created = all.find((e) => e.action === 'user.created')!;
    expect(created.metadata).toMatchObject({ onboarding: 'temporary_password', roles: [] });
    expect(all.find((e) => e.action === 'auth.login.failed')!.actor).toBeNull();
  });

  it('filters by category, person, record and time', async () => {
    const academic = await items('/audit-events?category=academic');
    expect(academic.length).toBeGreaterThan(0);
    expect(academic.every((e) => AUDIT_CATEGORIES.academic.some((p) => e.action.startsWith(p)))).toBe(true);

    const signIn = await items('/audit-events?category=signIn');
    expect(signIn.every((e) => e.action.startsWith('auth.'))).toBe(true);
    expect(signIn.some((e) => e.action === 'auth.login.failed')).toBe(true);

    const byName = await items('/audit-events?q=office');
    expect(byName.length).toBeGreaterThan(0);
    expect(byName.every((e) => e.actor?.id === adminId)).toBe(true);
    expect(await items('/audit-events?q=%25')).toEqual([]); // wildcard is literal

    const byActor = await items(`/audit-events?actorUserId=${adminId}`);
    expect(byActor.every((e) => e.actor?.id === adminId)).toBe(true);

    const grade = (await items('/audit-events?action=grade.created'))[0]!;
    const record = await items(`/audit-events?entityType=grade&entityId=${grade.entityId}`);
    expect(record.map((e) => e.action)).toEqual(['grade.created']);

    const future = new Date(Date.now() + 86400_000).toISOString();
    expect(await items(`/audit-events?from=${encodeURIComponent(future)}`)).toEqual([]);
    const past = new Date(Date.now() - 86400_000).toISOString();
    expect((await items(`/audit-events?from=${encodeURIComponent(past)}&to=${encodeURIComponent(future)}`)).length).toBeGreaterThan(3);

    expect((await admin('GET', '/audit-events?category=nope')).statusCode).toBe(422);
    expect((await admin('GET', '/audit-events?from=yesterday')).statusCode).toBe(422);
  });

  it('every audited action in the API belongs to a filter category', () => {
    const root = path.resolve('src');
    const actions = new Set<string>();
    (function walk(dir: string) {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        if (statSync(p).isDirectory()) {
          if (f !== '__integration__') walk(p);
        } else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) {
          for (const m of readFileSync(p, 'utf8').matchAll(/action: '([a-z_.]+)'/g)) actions.add(m[1]!);
        }
      }
    })(root);
    expect(actions.size).toBeGreaterThan(30);
    const prefixes = Object.values(AUDIT_CATEGORIES).flat();
    const orphans = [...actions].filter((a) => !prefixes.some((p) => a.startsWith(p)));
    expect(orphans).toEqual([]);
  });
});

describe('system status API', () => {
  it('reports overdue background jobs (cron not running) and the email mode', async () => {
    let body = (await admin('GET', '/ops/status')).json();
    expect(body.jobsOverdue.count).toBe(0);
    expect(body.mailTransport).toBe('file');
    expect(body.lastBackup).toBeNull();
    expect(new Date(body.serverTime).getTime()).toBeGreaterThan(0);

    await db
      .insertInto('jobs')
      .values({
        type: 'user_token.send',
        payload: '{}',
        status: 'pending',
        attempts: 0,
        max_attempts: 5,
        run_after: sql<Date>`CURRENT_TIMESTAMP - INTERVAL 2 HOUR`,
      })
      .execute();
    body = (await admin('GET', '/ops/status')).json();
    expect(body.jobsOverdue.count).toBeGreaterThanOrEqual(1);
    expect(Date.now() - new Date(body.jobsOverdue.oldestDueAt).getTime()).toBeGreaterThan(60 * 60_000);
    expect((await teacher('GET', '/ops/status')).statusCode).toBe(403);
  });
});
