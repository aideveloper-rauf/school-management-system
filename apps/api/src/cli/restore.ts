/**
 * Restore a backup into an EMPTY database (set DB_NAME to a new database first):
 *   node dist/cli/restore.js <file.smsbak>
 * See docs/backup-restore.md for the full runbook.
 */
import { loadConfig } from '../config/env.js';
import { createDb } from '../db/client.js';
import { restoreBackup } from '../backup/restore.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: restore <file.smsbak>');
  process.exit(1);
}
const cfg = loadConfig();
const db = createDb(cfg);
try {
  const s = await restoreBackup(db, cfg, file, cfg.BACKUP_PASSPHRASE);
  console.log(
    `Restored backup from ${s.meta.createdAt} into "${cfg.DB_NAME}": ${Object.values(s.tables).reduce((a, b) => a + b, 0)} rows, ${s.files} files. Users must sign in again.`,
  );
} catch (e) {
  console.error(`Restore FAILED: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
