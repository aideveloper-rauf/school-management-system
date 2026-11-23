import type { Migration, MigrationProvider } from 'kysely/migration';
import * as m0001 from './0001_foundation.js';

/**
 * Static registry so migrations work identically from tsx and compiled dist/.
 * Add new migrations here in order. Never rename or edit a released migration.
 */
const migrations: Record<string, Migration> = {
  '0001_foundation': m0001,
};

export const migrationProvider: MigrationProvider = {
  getMigrations: async () => migrations,
};
