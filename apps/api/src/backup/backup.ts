import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { sql, type Kysely } from 'kysely';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../db/client.js';
import type { Database } from '../db/types.js';
import { createMigrator } from '../db/migrator.js';
import { recordAudit } from '../lib/audit.js';
import { APP_VERSION } from '../version.js';
import { assertPassphrase, writeContainer } from './container.js';
import { EXCLUDED_STORAGE, EXCLUDED_TABLES, encodeValue, type BackupRecord } from './payload.js';

const ROWS_PER_RECORD = 500;
const CHUNK_BYTES = 512 * 1024;
const FILE_RE = /^sms-backup-\d{8}-\d{6}Z\.smsbak$/;

export interface BackupResult {
  file: string;
  bytes: number;
  tables: Record<string, number>;
  files: number;
  pruned: string[];
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15) + 'Z';

async function listTables(db: Kysely<Database>, schema: string) {
  const r = await sql<{ t: string }>`
    SELECT table_name AS t FROM information_schema.tables
    WHERE table_schema = ${schema} AND table_type = 'BASE TABLE' ORDER BY table_name`.execute(db);
  return r.rows.map((x) => x.t).filter((t) => !EXCLUDED_TABLES.has(t));
}

async function columnsOf(db: Kysely<Database>, schema: string, table: string) {
  const cols = await sql<{ c: string }>`
    SELECT column_name AS c FROM information_schema.columns
    WHERE table_schema = ${schema} AND table_name = ${table} ORDER BY ordinal_position`.execute(db);
  const pk = await sql<{ c: string }>`
    SELECT column_name AS c FROM information_schema.key_column_usage
    WHERE table_schema = ${schema} AND table_name = ${table} AND constraint_name = 'PRIMARY' ORDER BY ordinal_position`.execute(db);
  return { columns: cols.rows.map((x) => x.c), pk: pk.rows.map((x) => x.c) };
}

async function* storageFiles(root: string, rel = ''): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(path.join(root, rel), { withFileTypes: true });
  } catch {
    return; // no storage folder yet
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (!rel && EXCLUDED_STORAGE.has(e.name)) continue;
    if (e.isDirectory()) yield* storageFiles(root, r);
    else if (e.isFile()) yield r;
  }
}

/**
 * Create an encrypted backup of the database (one consistent snapshot) and the private file
 * storage. Writes `<BACKUP_DIR>/sms-backup-<UTC stamp>.smsbak`, records it in app_meta and the
 * audit log, and keeps only the newest BACKUP_KEEP backups.
 */
export async function createBackup(db: Db, cfg: AppConfig): Promise<BackupResult> {
  assertPassphrase(cfg.BACKUP_PASSPHRASE);
  const dir = path.resolve(cfg.BACKUP_DIR);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const now = new Date();
  const name = `sms-backup-${stamp(now)}.smsbak`;
  const finalPath = path.join(dir, name);
  const partial = `${finalPath}.partial`;

  const migrations = (await createMigrator(db).getMigrations()).filter((m) => m.executedAt).map((m) => m.name);
  const counts: Record<string, number> = {};
  let fileCount = 0;

  await db.connection().execute(async (conn) => {
    // One read-only snapshot: every table reflects the same moment, without blocking the school.
    await sql`SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ`.execute(conn);
    await sql`START TRANSACTION WITH CONSISTENT SNAPSHOT`.execute(conn);
    try {
      const tables = await listTables(conn, cfg.DB_NAME);
      async function* records(): AsyncGenerator<string> {
        const line = (r: BackupRecord) => `${JSON.stringify(r)}\n`;
        yield line({ type: 'meta', createdAt: now.toISOString(), appVersion: APP_VERSION, migrations });
        for (const table of tables) {
          const { columns, pk } = await columnsOf(conn, cfg.DB_NAME, table);
          yield line({ type: 'table', name: table, columns });
          counts[table] = 0;
          const order = pk.length ? sql.join(pk.map((c) => sql.ref(c))) : sql.join(columns.map((c) => sql.ref(c)));
          for (let offset = 0; ; offset += ROWS_PER_RECORD) {
            const res = await sql<Record<string, unknown>>`
              SELECT ${sql.join(columns.map((c) => sql.ref(c)))} FROM ${sql.table(table)}
              ORDER BY ${order} LIMIT ${sql.lit(ROWS_PER_RECORD)} OFFSET ${sql.lit(offset)}`.execute(conn);
            if (res.rows.length === 0) break;
            counts[table] += res.rows.length;
            yield line({ type: 'rows', table, rows: res.rows.map((row) => columns.map((c) => encodeValue(row[c]))) });
            if (res.rows.length < ROWS_PER_RECORD) break;
          }
        }
        const storage = path.resolve(cfg.STORAGE_DIR);
        for await (const rel of storageFiles(storage)) {
          yield line({ type: 'file', path: rel });
          const hash = createHash('sha256');
          let bytes = 0;
          for await (const chunk of createReadStream(path.join(storage, rel), { highWaterMark: CHUNK_BYTES })) {
            const buf = chunk as Buffer;
            hash.update(buf);
            bytes += buf.length;
            yield line({ type: 'chunk', data: buf.toString('base64') });
          }
          yield line({ type: 'fileEnd', path: rel, bytes, sha256: hash.digest('hex') });
          fileCount++;
        }
        yield line({ type: 'end', tables: counts, files: fileCount });
      }
      await writeContainer(
        partial,
        cfg.BACKUP_PASSPHRASE,
        { createdAt: now.toISOString(), appVersion: APP_VERSION, schemaVersion: migrations.at(-1) ?? null },
        Readable.from(records()),
      );
    } catch (e) {
      await unlink(partial).catch(() => undefined);
      throw e;
    } finally {
      await sql`COMMIT`.execute(conn);
    }
  });

  await rename(partial, finalPath);
  const bytes = (await stat(finalPath)).size;

  await db.transaction().execute(async (trx) => {
    const meta = { last_backup_at: now.toISOString(), last_backup_file: name, last_backup_bytes: String(bytes) };
    for (const [k, v] of Object.entries(meta)) {
      await trx.insertInto('app_meta').values({ meta_key: k, meta_value: v }).onDuplicateKeyUpdate({ meta_value: v }).execute();
    }
    await recordAudit(trx, null, {
      action: 'backup.created',
      actorUserId: null,
      entityType: 'backup',
      entityId: name,
      metadata: { bytes, tables: Object.keys(counts).length, files: fileCount },
    });
  });

  const pruned = await pruneBackups(dir, cfg.BACKUP_KEEP);
  return { file: finalPath, bytes, tables: counts, files: fileCount, pruned };
}

/** Delete all but the newest `keep` backups (names sort by time). Never touches other files. */
export async function pruneBackups(dir: string, keep: number): Promise<string[]> {
  const all = (await readdir(dir)).filter((f) => FILE_RE.test(f)).sort();
  const remove = all.slice(0, Math.max(0, all.length - keep));
  for (const f of remove) await unlink(path.join(dir, f));
  return remove;
}
