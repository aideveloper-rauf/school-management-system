import { existsSync } from 'node:fs';
import { sql } from 'kysely';
import { loadConfig, type AppConfig } from '../config/env.js';
import { createDb, type Db } from '../db/client.js';
import { createMigrator } from '../db/migrator.js';
import { hashPassword } from '../lib/password.js';

/**
 * Integration-test database helpers.
 *
 * Connection settings come from the environment (CI) or apps/api/.env (local).
 * The database name is TEST_DB_NAME, defaulting to `<DB_NAME>_test`. Because these
 * helpers DROP every table, they refuse to run against a name not ending in `_test`.
 */
export function testConfig(): AppConfig {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const base = loadConfig({ ...process.env, NODE_ENV: 'test' });
  const name = process.env.TEST_DB_NAME ?? `${base.DB_NAME}_test`;
  if (!name.endsWith('_test')) throw new Error(`Refusing to use "${name}" for integration tests: name must end with _test`);
  return { ...base, DB_NAME: name, APP_ORIGIN: 'http://localhost:5173', LOG_LEVEL: 'silent' };
}

/** Drop every table in the test database (including Kysely's migration tables). */
export async function dropAllTables(db: Db, cfg: AppConfig): Promise<void> {
  const tables = await sql<{ t: string }>`
    SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ${cfg.DB_NAME}`.execute(db);
  // One connection, so the FOREIGN_KEY_CHECKS session setting applies to every DROP.
  await db.connection().execute(async (conn) => {
    await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(conn);
    for (const { t } of tables.rows) await sql`DROP TABLE IF EXISTS ${sql.table(t)}`.execute(conn);
    await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(conn);
  });
}

export async function migrateToLatest(db: Db): Promise<void> {
  const { error } = await createMigrator(db).migrateToLatest();
  if (error) throw error;
}

/** Fresh, fully migrated test database. Call from beforeAll; destroy the Db in afterAll. */
export async function freshDb(): Promise<{ db: Db; cfg: AppConfig }> {
  const cfg = testConfig();
  const db = createDb(cfg);
  await dropAllTables(db, cfg);
  await migrateToLatest(db);
  return { db, cfg };
}

export async function createUser(
  db: Db,
  opts: { identifier: string; password: string; roles?: string[]; status?: 'active' | 'disabled' | 'invited' },
): Promise<number> {
  const res = await db
    .insertInto('users')
    .values({
      identifier: opts.identifier,
      display_name: opts.identifier,
      password_hash: await hashPassword(opts.password),
      locale: 'en',
      status: opts.status ?? 'active',
    })
    .executeTakeFirstOrThrow();
  const id = Number(res.insertId);
  for (const role of opts.roles ?? []) await db.insertInto('user_roles').values({ user_id: id, role, granted_by: null }).execute();
  return id;
}
