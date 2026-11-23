/**
 * Create an encrypted backup. Cron (daily), e.g.:
 *   cd ~/apps/sms/apps/api && /path/to/node dist/cli/backup.js >> ~/logs/sms-backup.log 2>&1
 */
import { loadConfig } from '../config/env.js';
import { createDb } from '../db/client.js';
import { createBackup } from '../backup/backup.js';

const cfg = loadConfig();
const db = createDb(cfg);
try {
  const r = await createBackup(db, cfg);
  const rows = Object.values(r.tables).reduce((a, b) => a + b, 0);
  console.log(
    `${new Date().toISOString()} backup ok file=${r.file} bytes=${r.bytes} rows=${rows} files=${r.files} pruned=${r.pruned.length}`,
  );
} catch (e) {
  console.error(`${new Date().toISOString()} backup FAILED: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
