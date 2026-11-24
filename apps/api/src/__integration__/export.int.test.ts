import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import type { AppConfig } from '../config/env.js';
import { exportSchoolData } from '../backup/export.js';
import { createUser, freshDb } from './test-db.js';

let db: Db;
let cfg: AppConfig;
let work: string;

beforeAll(async () => {
  ({ db, cfg } = await freshDb());
  work = mkdtempSync(path.join(tmpdir(), 'sms-export-'));
  const storage = path.join(work, 'storage');
  mkdirSync(path.join(storage, 'files', 'ab'), { recursive: true });
  mkdirSync(path.join(storage, 'outbox'), { recursive: true });
  writeFileSync(path.join(storage, 'files', 'ab', 'x.bin'), 'worksheet');
  writeFileSync(path.join(storage, 'outbox', 'mail.txt'), 'secret link');
  cfg = { ...cfg, STORAGE_DIR: storage };
  await db.insertInto('schools').values({ name: 'SSV, "Main"', default_locale: 'en', timezone: 'Asia/Colombo' }).execute();
  const uid = await createUser(db, { identifier: 'admin@test.lk', password: 'correct-horse-battery', roles: ['school_admin'] });
  await db
    .insertInto('sessions')
    .values({ id_hash: 'h'.repeat(64), user_id: uid, csrf_token: 'c', expires_at: new Date(Date.now() + 3600_000) } as never)
    .execute();
  await db.insertInto('student_profiles').values({ admission_no: 'A1', full_name: 'Amaya Perera', admitted_on: '2027-01-02' }).execute();
});
afterAll(async () => {
  await db?.destroy();
  rmSync(work, { recursive: true, force: true });
});

describe('school data export', () => {
  it('writes open-format tables and files, without secrets, with verifiable checksums', async () => {
    const r = await exportSchoolData(db, cfg, path.join(work, 'out'));
    expect(r.tables.student_profiles).toBe(1);
    expect(r.tables.sessions).toBeUndefined();
    expect(r.tables.user_tokens).toBeUndefined();
    expect(r.files).toBe(1);
    const users = readFileSync(path.join(r.dir, 'tables', 'users.jsonl'), 'utf8');
    expect(JSON.parse(users.trim())).toMatchObject({ identifier: 'admin@test.lk' });
    expect(users).not.toContain('password_hash');
    expect(readFileSync(path.join(r.dir, 'tables', 'schools.csv'), 'utf8')).toContain('"SSV, ""Main"""');
    expect(readFileSync(path.join(r.dir, 'files', 'files', 'ab', 'x.bin'), 'utf8')).toBe('worksheet');
    expect(existsSync(path.join(r.dir, 'files', 'outbox'))).toBe(false);
    const manifest = JSON.parse(readFileSync(path.join(r.dir, 'manifest.json'), 'utf8'));
    for (const [rel, sum] of Object.entries(manifest.sha256 as Record<string, string>)) {
      expect(
        createHash('sha256')
          .update(readFileSync(path.join(r.dir, rel)))
          .digest('hex'),
        rel,
      ).toBe(sum);
    }
    const audit = await db.selectFrom('audit_events').select('action').where('action', '=', 'backup.exported').executeTakeFirst();
    expect(audit).toBeDefined();
  });

  it('refuses to write inside the storage folder', async () => {
    await expect(exportSchoolData(db, cfg, cfg.STORAGE_DIR)).rejects.toThrow(/outside STORAGE_DIR/);
  });
});
