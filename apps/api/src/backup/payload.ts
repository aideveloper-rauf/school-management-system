/**
 * Backup payload: newline-delimited JSON records inside the encrypted container.
 *
 *   {"type":"meta", createdAt, appVersion, migrations:[...]}
 *   {"type":"table", name, columns:[...]}            then {"type":"rows", table, rows:[[...], ...]} (batched)
 *   {"type":"file", path}  {"type":"chunk", data}…   {"type":"fileEnd", path, bytes, sha256}
 *   {"type":"end", tables:{name: rowCount}, files: n}
 *
 * Values keep their type through JSON with small tags: {"$d": ISO date-time}, {"$b": base64 bytes},
 * {"$j": parsed JSON column value}.
 */
export interface MetaRecord {
  type: 'meta';
  createdAt: string;
  appVersion: string;
  migrations: string[];
}
export interface TableRecord {
  type: 'table';
  name: string;
  columns: string[];
}
export interface RowsRecord {
  type: 'rows';
  table: string;
  rows: unknown[][];
}
export interface FileRecord {
  type: 'file';
  path: string;
}
export interface ChunkRecord {
  type: 'chunk';
  data: string;
}
export interface FileEndRecord {
  type: 'fileEnd';
  path: string;
  bytes: number;
  sha256: string;
}
export interface EndRecord {
  type: 'end';
  tables: Record<string, number>;
  files: number;
}
export type BackupRecord = MetaRecord | TableRecord | RowsRecord | FileRecord | ChunkRecord | FileEndRecord | EndRecord;

/**
 * Tables never included: they hold live credentials or transient state. Restoring them could
 * revive signed-out sessions or old reset/invitation links. Users simply sign in again.
 */
export const EXCLUDED_TABLES = new Set([
  'sessions',
  'user_tokens',
  'login_attempts',
  'jobs',
  'schema_migrations',
  'schema_migrations_lock',
]);

/** Top-level folders of STORAGE_DIR that are never backed up (the dev outbox holds one-time links). */
export const EXCLUDED_STORAGE = new Set(['outbox']);

export function encodeValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return { $d: v.toISOString() };
  if (Buffer.isBuffer(v)) return { $b: v.toString('base64') };
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'object') return { $j: v };
  return v;
}

export function decodeValue(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if (typeof o.$d === 'string') return new Date(o.$d);
  if (typeof o.$b === 'string') return Buffer.from(o.$b, 'base64');
  if ('$j' in o) return JSON.stringify(o.$j);
  return v;
}

/** Normalise a stored relative path and reject anything that could escape the storage folder. */
export function safeRelativePath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || parts.some((s) => s === '..' || s === '' || s === '.' || s.includes('\0'))) {
    throw new Error(`Unsafe path in backup: ${JSON.stringify(p)}`);
  }
  return parts.join('/');
}
