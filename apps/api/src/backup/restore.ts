import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, open, readdir, rename, rm, type FileHandle } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { sql } from 'kysely';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../db/client.js';
import { createMigrator } from '../db/migrator.js';
import { migrationProvider } from '../db/migrations/index.js';
import { recordAudit } from '../lib/audit.js';
import { BackupError, assertPassphrase, decryptContainer, type ContainerHeader } from './container.js';
import { decodeValue, safeRelativePath, type BackupRecord, type MetaRecord } from './payload.js';

const INSERT_BATCH = 200;

export interface BackupSummary {
  header: ContainerHeader;
  meta: MetaRecord;
  tables: Record<string, number>;
  files: number;
}

/** Decrypt to a private temp folder, run `fn` over the records, always clean up. */
export async function withRecords<T>(
  file: string,
  passphrase: string,
  fn: (header: ContainerHeader, records: AsyncIterable<BackupRecord>) => Promise<T>,
): Promise<T> {
  assertPassphrase(passphrase);
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'sms-restore-'));
  try {
    const plain = path.join(tmp, 'payload.jsonl.gz');
    const header = await decryptContainer(file, passphrase, plain);
    // Open the reader only when iteration starts: readline emits lines as soon as it exists, and
    // lines emitted before the for-await loop attaches are lost (the caller may await other work first).
    async function* records(): AsyncGenerator<BackupRecord> {
      const lines = createInterface({ input: createReadStream(plain).pipe(createGunzip()), crlfDelay: Infinity });
      for await (const l of lines) if (l) yield JSON.parse(l) as BackupRecord;
    }
    return await fn(header, records());
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Shape checks shared by verify and restore: meta first, counts and file hashes match the end record. */
class Tally {
  meta: MetaRecord | null = null;
  rows: Record<string, number> = {};
  files = 0;
  private hash: ReturnType<typeof createHash> | null = null;
  private bytes = 0;
  private filePath: string | null = null;
  ended = false;

  see(r: BackupRecord): void {
    if (this.ended) throw new BackupError('Backup has data after its end marker.');
    if (!this.meta && r.type !== 'meta') throw new BackupError('Backup does not start with its description.');
    switch (r.type) {
      case 'meta':
        if (this.meta) throw new BackupError('Backup has two descriptions.');
        this.meta = r;
        break;
      case 'table':
        this.rows[r.name] = 0;
        break;
      case 'rows':
        if (!(r.table in this.rows)) throw new BackupError('Backup rows for an undeclared table.');
        this.rows[r.table] = (this.rows[r.table] ?? 0) + r.rows.length;
        break;
      case 'file':
        this.filePath = safeRelativePath(r.path);
        this.hash = createHash('sha256');
        this.bytes = 0;
        break;
      case 'chunk': {
        if (!this.hash) throw new BackupError('File data outside a file.');
        const buf = Buffer.from(r.data, 'base64');
        this.hash.update(buf);
        this.bytes += buf.length;
        break;
      }
      case 'fileEnd':
        if (!this.hash || this.filePath !== safeRelativePath(r.path)) throw new BackupError('File end does not match its start.');
        if (this.hash.digest('hex') !== r.sha256 || this.bytes !== r.bytes)
          throw new BackupError(`File ${r.path} is damaged in the backup.`);
        this.files++;
        this.hash = null;
        this.filePath = null;
        break;
      case 'end':
        for (const [t, n] of Object.entries(r.tables)) if (this.rows[t] !== n) throw new BackupError(`Row count mismatch for ${t}.`);
        if (Object.keys(r.tables).length !== Object.keys(this.rows).length || r.files !== this.files)
          throw new BackupError('Backup contents do not match its summary.');
        this.ended = true;
        break;
    }
  }

  finish(): { meta: MetaRecord; tables: Record<string, number>; files: number } {
    if (!this.meta || !this.ended) throw new BackupError('Backup is incomplete (no end marker).');
    return { meta: this.meta, tables: this.rows, files: this.files };
  }
}

/** Decrypt and fully check a backup without writing anything. Use it for restore rehearsals. */
export async function verifyBackup(file: string, passphrase: string): Promise<BackupSummary> {
  return withRecords(file, passphrase, async (header, records) => {
    const tally = new Tally();
    for await (const r of records) tally.see(r);
    return { header, ...tally.finish() };
  });
}

/** The backup's migrations must be an ordered prefix of the ones this release knows. */
export async function assertCompatible(backupMigrations: string[]): Promise<void> {
  const known = Object.keys(await migrationProvider.getMigrations()).sort();
  const unknown = backupMigrations.filter((m) => !known.includes(m));
  if (unknown.length)
    throw new BackupError(
      `This backup comes from a newer version (unknown schema ${unknown.join(', ')}). Install that version or newer first.`,
    );
  backupMigrations.forEach((m, i) => {
    if (known[i] !== m) throw new BackupError('The backup schema history does not match this release.');
  });
}

/**
 * Restore into an EMPTY database (a fresh one; switch the app over after checking it).
 * Order: decrypt + authenticate → check compatibility → migrate to the backup's schema →
 * load all rows in one transaction → check counts → migrate to latest → restore files.
 */
export async function restoreBackup(db: Db, cfg: AppConfig, file: string, passphrase: string): Promise<BackupSummary> {
  const existing = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ${cfg.DB_NAME}`.execute(db);
  if (Number(existing.rows[0]?.n ?? 0) > 0) {
    throw new BackupError(
      `Database "${cfg.DB_NAME}" is not empty. Restore into a new, empty database, check it, then switch the app to it.`,
    );
  }

  // Pass 1: authenticate and check the whole file before touching the database.
  const summary = await verifyBackup(file, passphrase);
  await assertCompatible(summary.meta.migrations);

  const target = summary.meta.migrations.at(-1);
  if (target) {
    const { error } = await createMigrator(db).migrateTo(target);
    if (error) throw error;
  }

  // Pass 2: load. Files go to a staging folder and are moved into place only after the rows commit.
  const storage = path.resolve(cfg.STORAGE_DIR);
  const staging = path.join(storage, `.restore-${randomBytes(4).toString('hex')}`);
  await withRecords(file, passphrase, async (_header, records) => {
    await db.connection().execute(async (conn) => {
      await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(conn);
      await sql`START TRANSACTION`.execute(conn);
      try {
        const columns: Record<string, string[]> = {};
        let out: FileHandle | null = null;
        for await (const r of records) {
          if (r.type === 'table') columns[r.name] = r.columns;
          else if (r.type === 'rows') {
            const cols = columns[r.table]!;
            for (let i = 0; i < r.rows.length; i += INSERT_BATCH) {
              const batch = r.rows.slice(i, i + INSERT_BATCH);
              await sql`INSERT INTO ${sql.table(r.table)} (${sql.join(cols.map((c) => sql.ref(c)))}) VALUES ${sql.join(
                batch.map((row) => sql`(${sql.join(row.map(decodeValue))})`),
              )}`.execute(conn);
            }
          } else if (r.type === 'file') {
            const dest = path.join(staging, safeRelativePath(r.path));
            await mkdir(path.dirname(dest), { recursive: true });
            out = await open(dest, 'w', 0o600);
          } else if (r.type === 'chunk' && out) await out.write(Buffer.from(r.data, 'base64'));
          else if (r.type === 'fileEnd' && out) {
            await out.close();
            out = null;
          }
        }
        for (const [t, n] of Object.entries(summary.tables)) {
          const c = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM ${sql.table(t)}`.execute(conn);
          if (Number(c.rows[0]?.n) !== n)
            throw new BackupError(`Row count check failed for ${t}: expected ${n}, found ${Number(c.rows[0]?.n)}.`);
        }
        await sql`COMMIT`.execute(conn);
      } catch (e) {
        await sql`ROLLBACK`.execute(conn);
        await rm(staging, { recursive: true, force: true });
        throw e;
      } finally {
        await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(conn);
      }
    });
  });

  // Bring the schema up to this release (a backup may be older than the code).
  const { error } = await createMigrator(db).migrateToLatest();
  if (error) throw error;

  // Move restored files into place (they are new: the target installation is fresh).
  await moveTree(staging, storage);
  await rm(staging, { recursive: true, force: true });

  await db.transaction().execute(async (trx) => {
    const meta = { restored_at: new Date().toISOString(), restored_from: path.basename(file) };
    for (const [k, v] of Object.entries(meta)) {
      await trx.insertInto('app_meta').values({ meta_key: k, meta_value: v }).onDuplicateKeyUpdate({ meta_value: v }).execute();
    }
    await recordAudit(trx, null, {
      action: 'backup.restored',
      actorUserId: null,
      entityType: 'backup',
      entityId: path.basename(file),
      metadata: { tables: Object.keys(summary.tables).length, files: summary.files, createdAt: summary.meta.createdAt },
    });
  });
  return summary;
}

async function moveTree(from: string, to: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(from, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) {
      await mkdir(dst, { recursive: true });
      await moveTree(src, dst);
    } else await rename(src, dst);
  }
}
