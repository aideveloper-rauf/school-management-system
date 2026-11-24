/**
 * Maintenance mode for upgrades (see docs/upgrade.md):
 *   node dist/cli/maintenance.js on ["Message shown to users"]
 *   node dist/cli/maintenance.js off
 *   node dist/cli/maintenance.js status
 */
import { loadConfig } from '../config/env.js';
import { createDb } from '../db/client.js';
import { recordAudit } from '../lib/audit.js';
import { maintenanceMessage, setMaintenance } from '../lib/maintenance.js';

const [cmd, ...rest] = process.argv.slice(2);
const db = createDb(loadConfig());
try {
  if (cmd === 'on') {
    const msg = rest.join(' ').trim() || 'The school system is being updated. Please try again shortly.';
    await setMaintenance(db, msg);
    await recordAudit(db, null, { action: 'backup.maintenance_on' });
    console.log('maintenance ON');
  } else if (cmd === 'off') {
    await setMaintenance(db, null);
    await recordAudit(db, null, { action: 'backup.maintenance_off' });
    console.log('maintenance OFF');
  } else if (cmd === 'status') {
    const m = await maintenanceMessage(db);
    console.log(m === null ? 'maintenance OFF' : `maintenance ON: ${m}`);
  } else {
    console.error('Usage: maintenance on [message] | off | status');
    process.exitCode = 2;
  }
} finally {
  await db.destroy();
}
