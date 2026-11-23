/**
 * Preflight before switching to a new release. Run from the NEW release's api/ folder with the
 * installation's environment (.env):
 *   node --env-file=.env cli/upgrade-check.js [--max-backup-age-hours 24]
 *
 * Exits non-zero when the upgrade must not go ahead. Writes nothing.
 */
import { parseArgs } from 'node:util';
import { sql } from 'kysely';
import { loadConfig } from '../config/env.js';
import { createDb } from '../db/client.js';
import { createMigrator } from '../db/migrator.js';
import { migrationProvider } from '../db/migrations/index.js';
import { isMigrationPrefix } from '../release/release.js';
import { APP_VERSION } from '../version.js';

const { values } = parseArgs({ options: { 'max-backup-age-hours': { type: 'string', default: '24' } } });
const maxAgeHours = Number(values['max-backup-age-hours']);
const problems: string[] = [];
const notes: string[] = [];

const [major, minor] = process.versions.node.split('.').map(Number) as [number, number];
if (!(major === 22 ? minor >= 12 : major >= 24))
  problems.push(`Node.js ${process.versions.node} is not supported; use 22.12+ or 24+ (set it in Setup Node.js App).`);

const cfg = loadConfig();
const db = createDb(cfg);
try {
  await sql`SELECT 1`.execute(db);
  const releaseMigrations = Object.keys(await migrationProvider.getMigrations()).sort();
  const applied = (await createMigrator(db).getMigrations()).filter((m) => m.executedAt).map((m) => m.name);
  const known = new Set(releaseMigrations);
  const appliedKnown = applied.filter((m) => known.has(m));
  const unknown = applied.filter((m) => !known.has(m));
  if (unknown.length || !isMigrationPrefix(appliedKnown, releaseMigrations)) {
    problems.push(
      `The database is newer than this release (has ${unknown.join(', ') || 'a different history'}). Do not downgrade; install the newer release.`,
    );
  } else {
    const pending = releaseMigrations.slice(applied.length);
    notes.push(pending.length ? `Database changes to apply: ${pending.join(', ')}` : 'No database changes in this upgrade.');
  }

  const last = await db.selectFrom('app_meta').select('meta_value').where('meta_key', '=', 'last_backup_at').executeTakeFirst();
  if (!last) problems.push('No backup has ever been made. Run the backup first (node cli/backup.js with the CURRENT release).');
  else {
    const ageHours = (Date.now() - new Date(last.meta_value).getTime()) / 3600_000;
    if (ageHours > maxAgeHours) problems.push(`The last backup is ${ageHours.toFixed(1)} hours old. Make a fresh backup first.`);
    else notes.push(`Last backup ${ageHours.toFixed(1)} hours ago.`);
  }
} catch (e) {
  problems.push(`Cannot check the database: ${(e as Error).message}`);
} finally {
  await db.destroy();
}

console.log(`Upgrade check for release ${APP_VERSION}`);
for (const n of notes) console.log(`  ok    ${n}`);
for (const p of problems) console.log(`  STOP  ${p}`);
console.log(problems.length ? 'Result: do NOT upgrade yet.' : 'Result: ready to upgrade.');
if (problems.length) process.exitCode = 1;
