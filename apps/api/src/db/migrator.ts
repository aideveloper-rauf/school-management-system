import { Migrator } from 'kysely/migration';
import type { Db } from './client.js';
import { migrationProvider } from './migrations/index.js';

export function createMigrator(db: Db): Migrator {
  return new Migrator({
    db,
    provider: migrationProvider,
    migrationTableName: 'schema_migrations',
    migrationLockTableName: 'schema_migrations_lock',
  });
}

/** Latest migration name applied, for the health/status endpoint. */
export async function currentSchemaVersion(db: Db): Promise<string | null> {
  const list = await createMigrator(db).getMigrations();
  const applied = list.filter((m) => m.executedAt);
  return applied.at(-1)?.name ?? null;
}
