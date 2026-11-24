/**
 * Full school data export for offboarding (unencrypted, open formats). See src/backup/export.ts.
 *   npm run export -- --out /path/outside/web/root
 */
import { loadConfig } from '../config/env.js';
import { createDb } from '../db/client.js';
import { exportSchoolData } from '../backup/export.js';

const i = process.argv.indexOf('--out');
const out = i > -1 ? process.argv[i + 1] : undefined;
if (!out) {
  console.error('Usage: export --out <folder outside the web root>');
  process.exit(2);
}
const cfg = loadConfig();
const db = createDb(cfg);
try {
  const r = await exportSchoolData(db, cfg, out);
  const rows = Object.values(r.tables).reduce((a, b) => a + b, 0);
  console.log(`export ok dir=${r.dir} tables=${Object.keys(r.tables).length} rows=${rows} files=${r.files}`);
  console.log('This folder contains personal data. Keep it secure and delete it after hand-over.');
} catch (e) {
  console.error(`export FAILED: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
