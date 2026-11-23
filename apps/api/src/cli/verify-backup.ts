/** Decrypt and fully check a backup without writing anything:  node dist/cli/verify-backup.js <file> */
import { loadConfig } from '../config/env.js';
import { verifyBackup } from '../backup/restore.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: verify-backup <file.smsbak>');
  process.exit(1);
}
try {
  const s = await verifyBackup(file, loadConfig().BACKUP_PASSPHRASE);
  console.log(
    `OK: created ${s.meta.createdAt}, app ${s.meta.appVersion}, schema ${s.header.schemaVersion}, ${Object.keys(s.tables).length} tables, ${Object.values(s.tables).reduce((a, b) => a + b, 0)} rows, ${s.files} files`,
  );
} catch (e) {
  console.error(`Backup check FAILED: ${(e as Error).message}`);
  process.exitCode = 1;
}
