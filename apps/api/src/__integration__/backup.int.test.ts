import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, copyFile, open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { CSRF_HEADER } from '@sms/shared';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../db/client.js';
import { createMigrator } from '../db/migrator.js';
import { buildApp } from '../app.js';
import { createBackup, pruneBackups } from '../backup/backup.js';
import { BackupError } from '../backup/container.js';
import { EXCLUDED_TABLES, safeRelativePath } from '../backup/payload.js';
import { assertCompatible, restoreBackup, verifyBackup, withRecords } from '../backup/restore.js';
import { recordAudit } from '../lib/audit.js';
import { SESSION_COOKIE } from '../plugins/auth.js';
import { createUser, dropAllTables, freshDb } from './test-db.js';

let db: Db;
let cfg: AppConfig;
let tmp: string;
const PASSPHRASE = 'correct horse battery staple 2027';

/** Every non-excluded table's rows, ordered, as plain JSON (Dates as ISO strings). */
async function snapshot(): Promise<Record<string, unknown[]>> {
  const tables = await sql<{ t: string }>`
    SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ${cfg.DB_NAME} ORDER BY table_name`.execute(db);
  const out: Record<string, unknown[]> = {};
  for (const { t } of tables.rows) {
    if (EXCLUDED_TABLES.has(t)) continue;
    const rows = await sql<Record<string, unknown>>`SELECT * FROM ${sql.table(t)}`.execute(db);
    out[t] = rows.rows
      .map((r) => JSON.parse(JSON.stringify(r, (_k, v) => (typeof v === 'string' && /^\{.*\}$/.test(v) ? JSON.parse(v) : v))))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return out;
}

async function seed(): Promise<void> {
  await db.insertInto('schools').values({ name: 'ශ්‍රී Test Vidyalaya / பாடசாலை', default_locale: 'si', timezone: 'Asia/Colombo' }).execute();
  const adminId = await createUser(db, { identifier: 'admin@test.lk', password: 'correct-horse-battery', roles: ['school_admin'] });
  await createUser(db, { identifier: 'teacher@test.lk', password: 'correct-horse-battery', roles: ['teacher', 'academic_coordinator'] });
  const year = Number(
    (
      await db
        .insertInto('academic_years')
        .values({ label: '2027', starts_on: '2027-01-04', ends_on: '2027-12-10', is_current: 1 })
        .executeTakeFirstOrThrow()
    ).insertId,
  );
  await db
    .insertInto('terms')
    .values({ academic_year_id: year, label: 'Term 1', sequence: 1, starts_on: '2027-01-04', ends_on: '2027-04-09' })
    .execute();
  const grade = Number(
    (await db.insertInto('grades').values({ name: 'Grade 6', level: 6, is_active: 1 }).executeTakeFirstOrThrow()).insertId,
  );
  const subject = Number(
    (
      await db
        .insertInto('subjects')
        .values({ code: 'MATH', name: 'Mathematics', name_si: 'ගණිතය', name_ta: 'கணிதம்', is_active: 1 })
        .executeTakeFirstOrThrow()
    ).insertId,
  );
  await db.insertInto('grade_subjects').values({ grade_id: grade, subject_id: subject, is_optional: 0 }).execute();
  const room = Number(
    (await db.insertInto('rooms').values({ name: 'Room 12', capacity: 40, is_active: 1 }).executeTakeFirstOrThrow()).insertId,
  );
  await db
    .insertInto('class_sections')
    .values({ academic_year_id: year, grade_id: grade, name: 'A', medium: 'si', capacity: 40, home_room_id: room })
    .execute();
  await db
    .insertInto('period_definitions')
    .values({ label: 'Period 1', sequence: 1, starts_at: '07:50:00', ends_at: '08:30:00', is_break: 0 })
    .execute();
  await db
    .insertInto('calendar_events')
    .values({
      academic_year_id: year,
      title: 'New Year',
      kind: 'holiday',
      starts_on: '2027-04-13',
      ends_on: '2027-04-14',
      is_school_day: 0,
    })
    .execute();
  await recordAudit(db, null, {
    action: 'test.seeded',
    actorUserId: adminId,
    entityType: 'school',
    entityId: 1,
    metadata: { fields: ['name'], n: 3 },
  });
  // Transient / credential tables that must NOT come back after a restore.
  await db
    .insertInto('sessions')
    .values({
      id_hash: 'a'.repeat(64),
      user_id: adminId,
      csrf_token: 'b'.repeat(64),
      expires_at: new Date(Date.now() + 3600_000),
      last_seen_at: new Date(),
    })
    .execute();
  await db
    .insertInto('user_tokens')
    .values({
      user_id: adminId,
      purpose: 'reset',
      token_hash: 'c'.repeat(64),
      expires_at: new Date(Date.now() + 3600_000),
      created_by: null,
    })
    .execute();
  await db.insertInto('login_attempts').values({ identifier: 'admin@test.lk', ip: '127.0.0.1', succeeded: 0 }).execute();
  await db
    .insertInto('jobs')
    .values({ type: 'user_token.send', payload: '{}', status: 'pending', attempts: 0, max_attempts: 5, run_after: new Date() })
    .execute();
  // Private files: one nested upload, and the dev outbox (never backed up).
  await mkdir(path.join(cfg.STORAGE_DIR, 'submissions', '2027'), { recursive: true });
  await writeFile(path.join(cfg.STORAGE_DIR, 'submissions', '2027', 'essay.txt'), 'Student essay — ශ්‍රී ලංකාව\n'.repeat(50000));
  await mkdir(path.join(cfg.STORAGE_DIR, 'outbox'), { recursive: true });
  await writeFile(path.join(cfg.STORAGE_DIR, 'outbox', 'mail.txt'), 'reset link token=secret');
}

beforeAll(async () => {
  ({ db, cfg } = await freshDb());
  tmp = await mkdtemp(path.join(os.tmpdir(), 'sms-backup-test-'));
  cfg = {
    ...cfg,
    BACKUP_DIR: path.join(tmp, 'backups'),
    STORAGE_DIR: path.join(tmp, 'storage'),
    BACKUP_PASSPHRASE: PASSPHRASE,
    BACKUP_KEEP: 3,
  };
  await seed();
});
afterAll(async () => {
  await db?.destroy();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe('backup and restore (real MySQL)', () => {
  let file: string;
  let before: Record<string, unknown[]>;

  it('creates an encrypted backup and records it', async () => {
    before = await snapshot();
    const r = await createBackup(db, cfg);
    file = r.file;
    expect(path.basename(file)).toMatch(/^sms-backup-\d{8}-\d{6}Z\.smsbak$/);
    expect(r.tables.users).toBe(2);
    expect(r.files).toBe(1); // outbox excluded
    for (const t of EXCLUDED_TABLES) expect(r.tables[t]).toBeUndefined();

    // Nothing readable inside: no names, no file text.
    const raw = await readFile(file);
    for (const plain of ['admin@test.lk', 'Mathematics', 'Student essay', 'Test Vidyalaya'])
      expect(raw.includes(Buffer.from(plain))).toBe(false);

    const meta = await db.selectFrom('app_meta').select(['meta_key', 'meta_value']).execute();
    expect(meta.find((m) => m.meta_key === 'last_backup_file')?.meta_value).toBe(path.basename(file));
    const audit = await db.selectFrom('audit_events').select('action').where('action', '=', 'backup.created').execute();
    expect(audit).toHaveLength(1);
  });

  it('verifies a good backup without writing anything', async () => {
    const s = await verifyBackup(file, PASSPHRASE);
    expect(s.tables.grades).toBe(1);
    expect(s.meta.migrations.at(-1)).toBe(s.header.schemaVersion);
  });

  it('rejects a wrong passphrase, a changed byte and a changed header', async () => {
    await expect(verifyBackup(file, 'a different passphrase!!')).rejects.toBeInstanceOf(BackupError);

    const flipped = path.join(tmp, 'flipped.smsbak');
    await copyFile(file, flipped);
    const fh = await open(flipped, 'r+');
    const b = Buffer.alloc(1);
    await fh.read(b, 0, 1, 700);
    await fh.write(Buffer.from([b[0]! ^ 0xff]), 0, 1, 700);
    await fh.close();
    await expect(verifyBackup(flipped, PASSPHRASE)).rejects.toThrow(/changed or damaged/);

    const header = path.join(tmp, 'header.smsbak');
    const bytes = await readFile(file);
    await writeFile(header, Buffer.from(bytes.toString('latin1').replace('"appVersion":"', '"appVersion":"9'), 'latin1'));
    await expect(verifyBackup(header, PASSPHRASE)).rejects.toThrow(/changed or damaged/);

    await writeFile(path.join(tmp, 'junk.smsbak'), 'not a backup');
    await expect(verifyBackup(path.join(tmp, 'junk.smsbak'), PASSPHRASE)).rejects.toThrow(/Not a backup/);
  });

  it('reads every record even when the caller does other work before iterating', async () => {
    // Regression: a line reader created too early dropped lines emitted before iteration began.
    const count = await withRecords(file, PASSPHRASE, async (_h, records) => {
      await new Promise((r) => setTimeout(r, 300));
      let n = 0;
      for await (const r of records) if (r.type === 'rows') n += r.rows.length;
      return n;
    });
    const expected = Object.values((await verifyBackup(file, PASSPHRASE)).tables).reduce((a, b) => a + b, 0);
    expect(count).toBe(expected);
  });

  it('refuses to restore over a database that has data', async () => {
    await expect(restoreBackup(db, cfg, file, PASSPHRASE)).rejects.toThrow(/not empty/);
  });

  it('restores everything exactly into an empty database', async () => {
    await dropAllTables(db, cfg);
    await rm(cfg.STORAGE_DIR, { recursive: true, force: true });

    const s = await restoreBackup(db, cfg, file, PASSPHRASE);
    expect(s.files).toBe(1);

    const after = await snapshot();
    // app_meta and audit gain restore bookkeeping; compare everything that existed before.
    for (const [t, rows] of Object.entries(before)) {
      if (t === 'audit_events' || t === 'app_meta') continue;
      expect(after[t], t).toEqual(rows);
    }
    expect(after.audit_events!.slice(0, before.audit_events!.length)).toEqual(before.audit_events);

    // Credentials and transient state did not come back.
    for (const t of ['sessions', 'user_tokens', 'login_attempts', 'jobs'] as const) {
      expect(await db.selectFrom(t).selectAll().execute(), t).toEqual([]);
    }
    // Schema is at the latest migration and foreign keys are enforced again.
    expect((await createMigrator(db).getMigrations()).every((m) => m.executedAt)).toBe(true);
    await expect(db.deleteFrom('grades').execute()).rejects.toThrow();

    // Files: restored byte for byte; outbox not restored.
    const essay = await readFile(path.join(cfg.STORAGE_DIR, 'submissions', '2027', 'essay.txt'), 'utf8');
    expect(essay).toBe('Student essay — ශ්‍රී ලංකාව\n'.repeat(50000));
    expect(await readdir(cfg.STORAGE_DIR)).toEqual(['submissions']);

    const restoredMeta = await db
      .selectFrom('app_meta')
      .select(['meta_key', 'meta_value'])
      .where('meta_key', '=', 'restored_from')
      .executeTakeFirst();
    expect(restoredMeta?.meta_value).toBe(path.basename(file));
  });

  it('shows the last backup on the system status endpoint', async () => {
    await createBackup(db, cfg);
    const app = await buildApp({ config: cfg, db, logger: false });
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { identifier: 'admin@test.lk', password: 'correct-horse-battery' },
      });
      const cookie = login.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/ops/status',
        cookies: { [SESSION_COOKIE]: cookie },
        headers: { [CSRF_HEADER]: login.json().csrfToken },
      });
      const body = res.json();
      expect(body.lastBackup.file).toMatch(/\.smsbak$/);
      expect(body.lastBackup.bytes).toBeGreaterThan(0);
      expect(body.lastRestore.from).toBe(path.basename(file));
      expect(JSON.stringify(body)).not.toContain(cfg.BACKUP_DIR); // no server paths exposed
    } finally {
      await app.close();
    }
  });
});

describe('backup housekeeping and safety checks', () => {
  it('keeps only the newest backups and never touches other files', async () => {
    const dir = path.join(tmp, 'prune');
    await mkdir(dir, { recursive: true });
    const names = ['20270101-010000Z', '20270102-010000Z', '20270103-010000Z', '20270104-010000Z'].map((s) => `sms-backup-${s}.smsbak`);
    for (const n of [...names, 'notes.txt', 'sms-backup-x.smsbak.partial']) await writeFile(path.join(dir, n), 'x');
    expect(await pruneBackups(dir, 2)).toEqual(names.slice(0, 2));
    expect((await readdir(dir)).sort()).toEqual([...names.slice(2), 'notes.txt', 'sms-backup-x.smsbak.partial'].sort());
  });

  it('refuses backups from a newer release', async () => {
    await expect(assertCompatible(['0001_foundation', '0099_future'])).rejects.toThrow(/newer version/);
    await expect(assertCompatible(['0002_academic_structure'])).rejects.toThrow(/does not match/);
    await expect(assertCompatible(['0001_foundation', '0002_academic_structure'])).resolves.toBeUndefined();
  });

  it('rejects file paths that could escape the storage folder', () => {
    for (const p of ['../etc/passwd', '/abs', 'C:/x', 'a/../../b', 'a//b', './a', 'a\0b']) expect(() => safeRelativePath(p), p).toThrow();
    expect(safeRelativePath('a\\b/c.txt')).toBe('a/b/c.txt');
  });
});
