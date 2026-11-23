import { loadConfig } from '../config/env.js';
import { createDb } from '../db/client.js';
import { createMigrator } from '../db/migrator.js';

const cfg = loadConfig();
const db = createDb(cfg);
const direction = process.argv[2] === 'down' ? 'down' : 'latest';

if (direction === 'down' && cfg.NODE_ENV === 'production') {
  console.error('Refusing to migrate down in production. Restore from a verified backup instead.');
  process.exit(1);
}

const migrator = createMigrator(db);
const { error, results } = direction === 'down' ? await migrator.migrateDown() : await migrator.migrateToLatest();
for (const r of results ?? []) console.log(`${r.status.padEnd(8)} ${r.direction} ${r.migrationName}`);
if (!results?.length) console.log('No migrations to run.');
await db.destroy();
if (error) {
  console.error('Migration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
