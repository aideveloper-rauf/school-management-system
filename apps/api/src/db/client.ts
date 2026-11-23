import { CompiledQuery, Kysely, MysqlDialect } from 'kysely';
import { createPool } from 'mysql2';
import type { AppConfig } from '../config/env.js';
import type { Database } from './types.js';

export type Db = Kysely<Database>;

/**
 * Session settings applied to every pooled connection, so behaviour does not depend on
 * the host's server defaults (shared/cPanel and WAMP servers often default to MyISAM,
 * a non-UTC time zone and a non-strict sql_mode):
 * - InnoDB: foreign keys, transactions and `SKIP LOCKED` need it; NO_ENGINE_SUBSTITUTION
 *   makes CREATE TABLE fail instead of silently falling back to another engine.
 * - UTC: TIMESTAMP values are read back as UTC (the pool uses `timezone: 'Z'`).
 * - Strict mode: reject out-of-range/truncated values instead of storing altered data.
 */
export const SESSION_INIT_SQL = [
  "SET SESSION default_storage_engine = 'InnoDB'",
  "SET SESSION time_zone = '+00:00'",
  "SET SESSION sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'",
] as const;

export function createDb(cfg: AppConfig): Db {
  const pool = createPool({
    host: cfg.DB_HOST,
    port: cfg.DB_PORT,
    database: cfg.DB_NAME,
    user: cfg.DB_USER,
    password: cfg.DB_PASSWORD,
    // Shared hosting often caps connections; keep the pool small.
    connectionLimit: 5,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: ['DATE'],
  });
  return new Kysely<Database>({
    dialect: new MysqlDialect({
      pool,
      onCreateConnection: async (conn) => {
        for (const stmt of SESSION_INIT_SQL) await conn.executeQuery(CompiledQuery.raw(stmt));
      },
    }),
  });
}
