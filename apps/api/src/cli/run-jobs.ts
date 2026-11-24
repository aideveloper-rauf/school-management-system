/**
 * Cron entry point. Example cPanel cron (every 5 minutes):
 *   cd /home/USER/apps/sms/apps/api && /path/to/node dist/cli/run-jobs.js >> ../../logs/jobs.log 2>&1
 */
import { loadConfig } from '../config/env.js';
import { createDb } from '../db/client.js';
import { drainQueue, releaseStaleJobs } from '../jobs/queue.js';
import { buildJobHandlers } from '../jobs/handlers.js';
import { housekeeping } from '../jobs/housekeeping.js';
import { createMailer } from '../mail/mailer.js';

const config = loadConfig();
const db = createDb(config);
try {
  await releaseStaleJobs(db);
  const n = await drainQueue(db, buildJobHandlers({ config, mailer: createMailer(config) }));
  await housekeeping(db, config.STORAGE_DIR);
  console.log(`${new Date().toISOString()} processed=${n}`);
} finally {
  await db.destroy();
}
