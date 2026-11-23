import type { Migration, MigrationProvider } from 'kysely/migration';
import * as m0001 from './0001_foundation.js';
import * as m0002 from './0002_academic_structure.js';
import * as m0003 from './0003_foundation_foreign_keys.js';

/**
 * Static registry so migrations work identically from tsx and compiled dist/.
 * Add new migrations here in order. Never rename or edit a released migration.
 */
const migrations: Record<string, Migration> = {
  '0001_foundation': m0001,
  '0002_academic_structure': m0002,
  '0003_foundation_foreign_keys': m0003,
};

export const migrationProvider: MigrationProvider = {
  getMigrations: async () => migrations,
};
