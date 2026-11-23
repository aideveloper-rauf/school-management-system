import { Kysely, MysqlDialect } from 'kysely';
import { createPool } from 'mysql2';
import type { AppConfig } from '../config/env.js';
import type { Database } from './types.js';

export type Db = Kysely<Database>;

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
  return new Kysely<Database>({ dialect: new MysqlDialect({ pool }) });
}
