import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sql, type Kysely } from 'kysely';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../db/client.js';
import type { Database } from '../db/types.js';
import { recordAudit } from '../lib/audit.js';
import { APP_VERSION } from '../version.js';

/**
 * Full school data export for offboarding (roadmap O-5). Writes an open-format folder the school owns:
 *
 *   sms-export-<stamp>/
 *     README.txt         what is inside and how to read it
 *     manifest.json      app/schema version, row counts, SHA-256 of every file
 *     tables/<t>.jsonl   one JSON object per row (exact values; null stays null)
 *     tables/<t>.csv     the same rows as CSV for spreadsheets (null = empty cell)
 *     files/...          uploaded files (learning materials, student work)
 *
 * One consistent snapshot. Left out: password hashes, sessions, sign-in links, login attempts and the job queue —
 * these are secrets or transient, not school records. The folder is NOT encrypted: it is personal data, so it is
 * created owner-only (0700/0600) and the export is audited. Hand it over and delete it securely afterwards.
 */
const SKIP_TABLES = new Set(['sessions', 'user_tokens', 'login_attempts', 'jobs']);
const SKIP_COLUMNS: Record<string, Set<string>> = { users: new Set(['password_hash']) };

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15) + 'Z';

function plain(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return v.toString('base64');
  if (typeof v === 'bigint') return v.toString();
  return v;
}
function csvCell(v: unknown): string {
  const p = plain(v);
  if (p === null || p === undefined) return '';
  const s = typeof p === 'string' ? p : String(p);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function* walk(root: string, rel = ''): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (!rel && e.name === 'outbox') continue; // dev mail/SMS copies, not school records
    if (e.isDirectory()) yield* walk(root, r);
    else if (e.isFile()) yield r;
  }
}

export interface ExportResult {
  dir: string;
  tables: Record<string, number>;
  files: number;
}

export async function exportSchoolData(db: Db, cfg: AppConfig, outRoot: string): Promise<ExportResult> {
  const dir = path.resolve(outRoot, `sms-export-${stamp(new Date())}`);
  const storage = path.resolve(cfg.STORAGE_DIR);
  if (dir.startsWith(storage + path.sep)) throw new Error('Choose an output folder outside STORAGE_DIR');
  await mkdir(path.join(dir, 'tables'), { recursive: true, mode: 0o700 });
  const checksums: Record<string, string> = {};
  const write = async (rel: string, content: string) => {
    await writeFile(path.join(dir, rel), content, { mode: 0o600 });
    checksums[rel] = createHash('sha256').update(content).digest('hex');
  };

  const tables: Record<string, number> = {};
  let schemaVersion: string | null = null;
  await db.connection().execute(async (conn) => {
    await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`.execute(conn);
    await sql`START TRANSACTION WITH CONSISTENT SNAPSHOT`.execute(conn);
    try {
      const k = conn as unknown as Kysely<Database>;
      const names = (
        await sql<{ t: string }>`SELECT table_name AS t FROM information_schema.tables
          WHERE table_schema = ${cfg.DB_NAME} AND table_type = 'BASE TABLE' ORDER BY table_name`.execute(k)
      ).rows
        .map((r) => r.t)
        .filter((t) => !SKIP_TABLES.has(t) && !t.startsWith('schema_migrations'));
      const lastMigration = await sql<{ name: string }>`SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1`
        .execute(k)
        .catch(() => ({ rows: [] }));
      schemaVersion = lastMigration.rows[0]?.name ?? null;
      for (const t of names) {
        const cols = (
          await sql<{ c: string }>`SELECT column_name AS c FROM information_schema.columns
            WHERE table_schema = ${cfg.DB_NAME} AND table_name = ${t} ORDER BY ordinal_position`.execute(k)
        ).rows
          .map((r) => r.c)
          .filter((c) => !SKIP_COLUMNS[t]?.has(c));
        const rows = (await sql<Record<string, unknown>>`SELECT ${sql.join(cols.map((c) => sql.ref(c)))} FROM ${sql.table(t)}`.execute(k))
          .rows;
        tables[t] = rows.length;
        await write(
          `tables/${t}.jsonl`,
          rows.map((r) => JSON.stringify(Object.fromEntries(cols.map((c) => [c, plain(r[c])])))).join('\n') + (rows.length ? '\n' : ''),
        );
        await write(
          `tables/${t}.csv`,
          [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n',
        );
      }
    } finally {
      await sql`COMMIT`.execute(conn);
    }
  });

  let files = 0;
  for await (const rel of walk(storage)) {
    const target = path.join(dir, 'files', rel);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(path.join(storage, rel), target);
    files++;
  }

  await write(
    'README.txt',
    [
      'School data export',
      '',
      'tables/*.jsonl  one JSON object per line, exact values (dates in UTC ISO 8601, null = no value).',
      'tables/*.csv    the same data for spreadsheets (UTF-8, empty cell = no value).',
      "files/          uploaded files; stored_files.storage_key gives each file's path under files/.",
      '',
      'Not included: passwords, sign-in sessions and links, login attempts, the job queue.',
      'This folder contains personal data about students, families and staff. Keep it secure and delete it',
      'when it is no longer needed.',
      '',
    ].join('\n'),
  );
  const manifest = {
    format: 'sms-export/1',
    appVersion: APP_VERSION,
    schemaVersion,
    createdAt: new Date().toISOString(),
    tables,
    files,
    sha256: checksums,
  };
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  await recordAudit(db, null, { action: 'backup.exported', metadata: { tables: Object.keys(tables).length, files } });
  return { dir, tables, files };
}
